import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { rescheduleFuture } from '../src/scheduler.js';

// `rescheduleFuture(db, now, [ids])` is the only thing that deletes part of the guide, so an id
// landing in another channel's `IN (...)` list would wipe a schedule nobody asked about. Both
// channels here are disabled and empty, so `ensureSchedule` plans nothing afterwards and the rows
// that move are exactly the ones the delete touched.
const NOW = 1_700_000_000;

function setup() {
  const db = openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-sched-')));
  db.prepare("INSERT INTO libraries(id,name,path,type) VALUES(1,'Films','/media/films','movies')").run();
  db.prepare("INSERT INTO items(id,library_id,kind,path,title,runtime,probed) VALUES(1,1,'movie','/media/films/a.mkv','A',100,1)").run();
  const chan = db.prepare("INSERT INTO channels(key,kind,auto_name,enabled,item_count) VALUES(?,'movie',?,0,0)");
  chan.run('one', 'One');
  chan.run('two', 'Two');
  const prog = db.prepare('INSERT INTO programmes(channel_id,item_id,start,end) VALUES(?,1,?,?)');
  prog.run(1, NOW + 600, NOW + 6600);
  prog.run(2, NOW + 600, NOW + 6600);
  // a stray ad break: a block nothing claims, which the second delete is for
  const block = db.prepare("INSERT INTO blocks(channel_id,programme_id,kind,start,end) VALUES(?,NULL,'ad',?,?)");
  block.run(1, NOW + 700, NOW + 730);
  block.run(2, NOW + 700, NOW + 730);
  const future = (c) => db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE channel_id=? AND start > ?').get(c, NOW).n;
  const breaks = (c) => db.prepare('SELECT COUNT(*) AS n FROM blocks WHERE channel_id=? AND start > ?').get(c, NOW).n;
  return { db, future, breaks };
}

test('rescheduling one channel leaves the other channel alone', async () => {
  const { db, future, breaks } = setup();
  await rescheduleFuture(db, NOW, [1]);
  assert.equal(future(1), 0);
  assert.equal(breaks(1), 0);
  assert.equal(future(2), 1);
  assert.equal(breaks(2), 1);
});

test('no channel list still clears every channel', async () => {
  const { db, future } = setup();
  await rescheduleFuture(db, NOW);
  assert.equal(future(1), 0);
  assert.equal(future(2), 0);
});

test('every channel id is a bound parameter, never a number inside the statement', async () => {
  const { db } = setup();
  const seen = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  await rescheduleFuture(db, NOW, [1, 2]);
  const deletes = seen.filter((sql) => sql.startsWith('DELETE FROM programmes WHERE start > ?'));
  assert.equal(deletes.length, 1);
  assert.match(deletes[0], /channel_id IN \(\?,\?\)$/); // one placeholder per id
  assert.doesNotMatch(deletes[0], /\d/);               // any digit here is a value spliced into SQL
});

test('an id that is not a number deletes nothing instead of building IN (NaN)', async () => {
  const { db, future } = setup();
  await rescheduleFuture(db, NOW, ['not-an-id']);
  assert.equal(future(1), 1);
  assert.equal(future(2), 1);
});
