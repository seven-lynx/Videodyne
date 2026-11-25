import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { syncLiveChannels } from '../src/channels.js';
import { Broadcaster, createReaper } from '../src/broadcaster.js';

test('channels whose stream has gone are deleted and free their number', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-live-'));
  const db = openDb(dir);
  try {
    db.prepare("INSERT INTO libraries(id,name,path,type) VALUES(1,'News','http://example.test/list.m3u','iptv')").run();
    const ins = db.prepare("INSERT INTO live_streams(library_id,name,url,src_kind,alive) VALUES(1,?,?,'hls',1)");
    ins.run('Stream A', 'http://example.test/a.m3u8');
    ins.run('Stream B', 'http://example.test/b.m3u8');
    // a leftover from a playlist that has since been removed: a live channel with no stream behind it
    db.prepare("INSERT INTO channels(key,kind,auto_name,number,enabled,item_count) VALUES('live:999','live','Old stream',601,1,1)").run();

    syncLiveChannels(db);

    const keys = db.prepare("SELECT key FROM channels WHERE kind='live' ORDER BY key").all().map((r) => r.key);
    assert.equal(keys.includes('live:999'), false, 'the orphan is gone');
    assert.equal(keys.length, 2, 'both real streams have a channel');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM live_streams WHERE channel_id IS NOT NULL').get().n, 2);
    // running it again changes nothing
    syncLiveChannels(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM channels WHERE kind='live'").get().n, 2);
  } finally {
    db.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A ten-segment playlist with a two-segment window: window + 6 stay listed and the files that fell out are
// gone before sync() returns. The pre-fix code deleted them from an fs.rm callback, so on every platform the
// assertion below ran before the unlink did, and on Windows the callback's error was thrown away.
test('sync trims the segment list and removes the files it dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-sync-'));
  const db = openDb(dir);
  const live = path.join(dir, 'live');
  fs.mkdirSync(live);
  const name = (i) => `r1_${String(i).padStart(5, '0')}.ts`;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4'];
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(live, name(i)), 'x');
    lines.push('#EXTINF:4.000,', name(i));
  }
  const playlist = path.join(live, 'r1.m3u8');
  fs.writeFileSync(playlist, lines.join('\n') + '\n');
  const b = new Broadcaster(db, 1);
  b.dir = live;
  b.windowSegs = 2;
  b.runs = [{ playlist, count: 0, produced: 0, ended: false }];
  try {
    b.sync();
    assert.equal(b.segs.length, 8, 'window + 6 segments stay listed');
    assert.equal(fs.existsSync(path.join(live, name(0))), false, 'the first dropped file is gone');
    assert.equal(fs.existsSync(path.join(live, name(1))), false);
    assert.equal(fs.existsSync(path.join(live, name(2))), true, 'a listed segment keeps its file');
    assert.equal(b.retire.pending(), 0, 'nothing was held, so nothing is waiting for a retry');
  } finally {
    b.stopped = true;
    db.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The failure is injected so it is the same on every platform: EPERM is what this Windows box returns when a
// second program holds the file (measured 2026-11-23, Node 24.18.1), and EBUSY is its documented sibling.
test('a segment the OS still holds is parked and retried, not leaked', () => {
  const logged = [];
  const gone = [];
  let busy = 2; // two failures, then the file comes free
  const reaper = createReaper({
    rm: (file) => {
      if (busy > 0) { busy--; throw Object.assign(new Error('still open'), { code: 'EPERM' }); }
      gone.push(file);
    },
    tries: 3,
    log: (m) => logged.push(m),
  });
  reaper.drop('a.ts');
  assert.equal(reaper.pending(), 1, 'a held file is parked instead of forgotten');
  assert.deepEqual(gone, []);
  reaper.drain();
  assert.equal(reaper.pending(), 1, 'still held after the second attempt');
  reaper.drain();
  assert.deepEqual(gone, ['a.ts'], 'the third attempt removed it');
  assert.equal(reaper.pending(), 0);
  assert.deepEqual(logged, [], 'a file that came free is not reported');
});

test('a segment that never comes free is reported once and the retry list stays bounded', () => {
  const logged = [];
  const reaper = createReaper({
    rm: () => { throw Object.assign(new Error('still open'), { code: 'EBUSY' }); },
    tries: 2,
    cap: 2,
    log: (m) => logged.push(m),
  });
  reaper.drop('a.ts');
  reaper.drain();
  assert.equal(reaper.pending(), 1, 'one retry is still owed');
  reaper.drain();
  assert.equal(reaper.pending(), 0, 'given up after its retries');
  assert.equal(logged.length, 1, 'reported once, not on every sync');
  assert.match(logged[0], /a\.ts/);
  for (const f of ['b.ts', 'c.ts', 'd.ts']) reaper.drop(f);
  assert.equal(reaper.pending(), 2, 'the list is capped, so a long session cannot grow it');
});
