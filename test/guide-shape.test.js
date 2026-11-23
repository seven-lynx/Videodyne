import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { SCHEMA } from '../src/db.js';
import { registerGuide } from '../src/guide.js';

// "What is on now" and the guide answer one question about one programme, so both routes have to
// describe it identically (#8): a client renders the on-now answer with the guide's own code.
// Both handlers read the real clock, so every fixture sits minutes away from now and from any
// boundary: these cases compare the two answers, never two readings of the clock.

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const now = Date.now() / 1000;
  db.prepare("INSERT INTO libraries (id, name, path, type) VALUES (1, 'lib', '/media/lib', 'tv')").run();
  db.prepare("INSERT INTO shows (id, library_id, path, title) VALUES (10, 1, '/media/lib/show', 'The Show')").run();
  db.prepare(`INSERT INTO items (id, library_id, show_id, kind, path, title, plot, season, episode, year, genres, runtime)
    VALUES (100, 1, 10, 'episode', '/media/lib/show/s1e1.mkv', 'Pilot', 'The first episode.', 1, 1, 2004, '["Drama"]', 1200)`).run();
  db.prepare("INSERT INTO channels (id, key, kind, auto_name, enabled) VALUES (1, 'tv:one', 'tv', 'One', 1)").run();
  db.prepare('INSERT INTO programmes (id, channel_id, item_id, start, end) VALUES (1000, 1, 100, ?, ?)').run(now - 600, now + 600);

  // a radio programme is a run of tracks: the guide describes it by its track list, so /now must too
  db.prepare("INSERT INTO channels (id, key, kind, auto_name, enabled) VALUES (2, 'radio:two', 'radio', 'Two', 1)").run();
  const tracks = [['Artist A', 'Track A'], ['Artist B', 'Track B'], ['Artist C', 'Track C']];
  tracks.forEach(([artist, title], i) => {
    db.prepare(`INSERT INTO items (id, library_id, kind, path, title, artist, album, runtime)
      VALUES (?, 1, 'track', ?, ?, ?, 'An Album', 600)`).run(200 + i, `/media/lib/track${i}.mp3`, title, artist);
  });
  db.prepare('INSERT INTO programmes (id, channel_id, item_id, start, end) VALUES (2000, 2, 200, ?, ?)').run(now - 1800, now + 1200);
  tracks.forEach((_, i) => {
    db.prepare("INSERT INTO blocks (channel_id, programme_id, kind, item_id, start, end) VALUES (2, 2000, 'content', ?, ?, ?)")
      .run(200 + i, now - 1500 + i * 600, now - 900 + i * 600);
  });

  // an enabled channel with nothing to air is the case that used to answer a bare row too
  db.prepare("INSERT INTO channels (id, key, kind, auto_name, enabled) VALUES (3, 'tv:quiet', 'tv', 'Quiet', 1)").run();

  const app = Fastify();
  registerGuide(app, db);
  return { app };
}

test('the on-now answer is the guide\'s own entry for the same instant', async () => {
  const { app } = setup();
  const guide = (await app.inject({ url: '/api/epg' })).json();
  const now = (await app.inject({ url: '/api/channels/1/now' })).json();
  await app.close();
  assert.equal(typeof now.now, 'number');
  assert.deepEqual(now.programme, guide.programmes['1'][0]);
  // the fields the old raw programmes row never carried
  assert.equal(now.programme.title, 'The Show');
  assert.equal(now.programme.subtitle, 'Pilot');
  assert.deepEqual(now.programme.genres, ['Drama']);
  assert.equal(now.programme.item, 100);
});

test('a music/radio programme carries the same track list on both routes', async () => {
  const { app } = setup();
  const guide = (await app.inject({ url: '/api/epg' })).json();
  const now = (await app.inject({ url: '/api/channels/2/now' })).json();
  await app.close();
  assert.deepEqual(now.programme, guide.programmes['2'][0]);
  // what is on, not the first track of the half hour, and the whole list as the description
  assert.equal(now.programme.title, 'Artist C – Track C');
  assert.equal(now.programme.plot, 'Artist A – Track A\nArtist B – Track B\nArtist C – Track C');
  assert.equal(now.programme.trk.length, 3);
});

test('a channel with nothing scheduled answers null, and the guide has no entry for it', async () => {
  const { app } = setup();
  const guide = (await app.inject({ url: '/api/epg' })).json();
  const now = (await app.inject({ url: '/api/channels/3/now' })).json();
  await app.close();
  assert.equal(now.programme, null);
  assert.equal(guide.programmes['3'], undefined);
});

test('/api/epg still answers its window, and ?slim=1 still thins it', async () => {
  const { app } = setup();
  const full = (await app.inject({ url: '/api/epg' })).json();
  const slim = (await app.inject({ url: '/api/epg?slim=1' })).json();
  await app.close();
  for (const k of ['now', 'from', 'to', 'programmes']) assert.ok(k in full, `${k} missing from the guide`);
  assert.equal(slim.programmes['1'][0].plot, undefined); // the app fetches that description per programme
  assert.ok(slim.programmes['2'][0].plot); // a track list is the only description a music programme has
  assert.equal(slim.programmes['1'][0].season, 1);
  assert.equal(full.programmes['1'][0].plot, 'The first episode.');
});
