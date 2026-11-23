import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { probePending } from '../src/media.js';

// A file `ffprobe` cannot read used to be marked `probed=2` for ever: an unmounted share, a file
// still being copied or a wedged probe lost its duration and never came back, even when the scan
// itself re-read the library. These drive the retry with an injected `probe`, an injected clock and
// an injected `log` -- no ffmpeg, no media file, no sleeping -- and assert on the `items` row, which
// is what the `runtime > 0` pool in `channels.js` actually reads.
const T = 1_700_000_000; // epoch seconds; `probe_checked` is stored in seconds, like programmes do
const clock = (s) => () => s * 1000;

function setup({ probed = 0, runtime = 0, attempts = 0, checked = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-probe-'));
  const db = openDb(dir);
  db.prepare("INSERT INTO libraries(id,name,path,type) VALUES(1,'Films','/media/films','movies')").run();
  db.prepare("INSERT INTO items(id,library_id,kind,path,title,runtime,probed,probe_attempts,probe_checked) VALUES(1,1,'movie','/media/films/a.mkv','A',?,?,?,?)")
    .run(runtime, probed, attempts, checked);
  const row = () => db.prepare('SELECT runtime, probed, probe_attempts, probe_checked FROM items WHERE id=1').get();
  return { db, dir, row };
}

test('an item whose NFO had no duration is probed and its duration recorded', async () => {
  const { db, row } = setup({ runtime: 0, probed: 0 });
  const calls = [];
  await probePending(db, null, { now: clock(T), probe: async (p) => { calls.push(p); return { duration: 120 }; } });
  assert.deepEqual(calls, ['/media/films/a.mkv']);
  const r = row();
  assert.equal(r.runtime, 120);
  assert.equal(r.probed, 1);
  assert.equal(r.probe_attempts, 0, 'a success leaves no failure behind');
  db.close();
});

test('a failed probe is recorded without zeroing a provisional runtime', async () => {
  const { db, row } = setup({ runtime: 150, probed: 0 });
  await probePending(db, null, { now: clock(T), probe: async () => null, log: () => {} });
  const r = row();
  assert.equal(r.probed, 2);
  assert.equal(r.probe_attempts, 1);
  assert.equal(r.probe_checked, T);
  assert.equal(r.runtime, 150, 'an unprobed runtime is the NFO claim, not a measurement to overwrite');
  db.close();
});

test('the retry waits the backoff out, and a file that becomes readable returns to the pool', async () => {
  const { db, row } = setup({ runtime: 0, probed: 2, attempts: 1, checked: T - 3599 });
  let readable = false, calls = 0;
  const probe = async () => (++calls, readable ? { duration: 90 } : null);
  await probePending(db, null, { now: clock(T), probe, log: () => {} });
  assert.equal(calls, 0, 'one second short of the first hour is not due');
  await probePending(db, null, { now: clock(T + 1), probe, log: () => {} });
  assert.equal(calls, 1, 'due at exactly the hour');
  assert.equal(row().probe_attempts, 2, 'the second failure counts');
  readable = true;
  await probePending(db, null, { now: clock(T + 1 + 21600), probe, log: () => {} });
  assert.equal(calls, 2);
  const r = row();
  assert.equal(r.probed, 1);
  assert.equal(r.runtime, 90);
  assert.equal(r.probe_attempts, 0, 'a success clears the failure record');
  assert.ok(db.prepare('SELECT 1 FROM items WHERE runtime > 0').get(), 'the item is back in the pool the scheduler reads');
  db.close();
});

test('the wait grows 1 h, then 6 h, then 24 h', async () => {
  const { db, row } = setup({ runtime: 0, probed: 0 });
  let calls = 0;
  const logs = [];
  const probe = async () => (++calls, null);
  const run = (s) => probePending(db, null, { now: clock(s), probe, log: (m) => logs.push(m) });
  await run(T);                        // failure 1, one hour out
  await run(T + 3600);                 // failure 2, six hours out
  await run(T + 3600 + 21600);         // failure 3, a day out
  assert.equal(calls, 3);
  assert.equal(row().probe_attempts, 3);
  assert.deepEqual(logs, [], 'nothing is given up while a retry is still owed');
  await run(T + 3600 + 21600 + 86400 - 1);
  assert.equal(calls, 3, 'the last retry is a full day out, not sooner');
  db.close();
});

test('the fourth failure gives up, says so once and is never probed again', async () => {
  const { db, row } = setup({ runtime: 0, probed: 2, attempts: 3, checked: T - 86400 });
  let calls = 0;
  const logs = [];
  const probe = async () => (++calls, null);
  const log = (m) => logs.push(m);
  await probePending(db, null, { now: clock(T), probe, log });
  assert.equal(calls, 1);
  assert.equal(row().probe_attempts, 4);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /a\.mkv/, 'the line names the file a person has to look at');
  await probePending(db, null, { now: clock(T + 7 * 86400), probe, log });
  assert.equal(calls, 1, 'a later scan does not wake a given-up file');
  assert.equal(logs.length, 1, 'and does not repeat the line');
  db.close();
});

test('a database written before the columns existed gains them, and its old failures get one retry', async () => {
  const { db, dir, row } = setup({ runtime: 0, probed: 2, attempts: 0, checked: null });
  assert.equal(row().probe_attempts, 0);
  db.exec('ALTER TABLE items DROP COLUMN probe_attempts; ALTER TABLE items DROP COLUMN probe_checked');
  db.close();
  const again = openDb(dir);
  try {
    const cols = again.prepare('SELECT name FROM pragma_table_info(?)').all('items').map((c) => c.name);
    assert.ok(cols.includes('probe_attempts'), 'migrate() adds what SCHEMA would have built');
    assert.ok(cols.includes('probe_checked'));
    let calls = 0;
    await probePending(again, null, { now: clock(T), probe: async () => (++calls, null), log: () => {} });
    assert.equal(calls, 1, 'a failure recorded before the fix was permanent; now it gets the retry schedule');
  } finally {
    again.close();
  }
});
