import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-plex-'));
process.env.WBTV_CONFIG = dir;
const { openDb } = await import('../src/db.js');
const { safeRemovals } = await import('../src/scanner.js');
const { plexPartUrl, partRef, discoverPlex, scanPlex } = await import('../src/plex.js');
const { resolveMedia } = await import('../src/mediaserver.js');

// A Plex that answers JSON, so no XML, no port, no server and no media file. The `fetch` is injected the same way
// media.js injects its `probe`: these tests assert on the requests as much as on the rows they produce, because
// they are the only proof available without a real Plex (see the plan's section 2).
const PLEX = 'http://plex.test:32400';

const EPISODES = [
  { ratingKey: '2001', type: 'episode', title: 'Pilot', summary: 'First.', duration: 1800000, grandparentRatingKey: '1001', grandparentTitle: 'Great Show', grandparentYear: 2010, grandparentThumb: '/library/metadata/1001/thumb/1', parentIndex: 1, index: 1, thumb: '/library/metadata/2001/thumb/1', updatedAt: 111, originallyAvailableAt: '2010-01-01T00:00:00Z', audienceRating: 7.5, contentRating: 'TV-14', Genre: [{ tag: 'Drama' }], Director: [{ tag: 'Director' }], Role: [{ tag: 'Actor', role: 'Hero' }], Media: [{ Part: [{ key: '/library/parts/301/1700000000/pilot.mkv' }] }] },
  { ratingKey: '2002', type: 'episode', title: 'Second', duration: 1800123, grandparentRatingKey: '1001', grandparentTitle: 'Great Show', parentIndex: 1, index: 2, updatedAt: 112, Media: [{ Part: [{ key: '/library/parts/302/1700000001/second.mkv' }] }] },
  { ratingKey: '2003', type: 'episode', title: 'No part', duration: 1800000, grandparentRatingKey: '1001' }, // nothing to play: skipped
];
const MOVIES = [
  { ratingKey: '101', type: 'movie', title: 'A Film', year: 1999, duration: 5400000, studio: 'Warner Bros.', thumb: '/library/metadata/101/thumb/1', updatedAt: 222, Genre: [{ tag: 'Horror' }], Media: [{ Part: [{ key: '/library/parts/141/1699999999/film.mkv' }] }] },
];

const jsonRes = (o, code = 200) => ({ ok: code < 400, status: code, json: async () => o });
const binRes = (b) => ({ ok: true, status: 200, arrayBuffer: async () => b });

function fake({ down = false, episodes = EPISODES, movies = MOVIES, token = 'tok1', sections } = {}) {
  const seen = [];
  const f = async (u, opts = {}) => {
    seen.push({ url: u, headers: opts.headers || {} });
    if (down) throw new TypeError('fetch failed');
    if (opts.headers['X-Plex-Token'] !== token) return jsonRes({}, 401);
    const { pathname } = new URL(u);
    if (pathname === '/') return jsonRes({ MediaContainer: { friendlyName: 'Test Plex', machineIdentifier: 'abc', version: '1.40.0' } });
    if (pathname === '/library/sections') return jsonRes({ MediaContainer: { Directory: sections || [
      { key: '1', type: 'movie', title: 'Films' }, { key: '2', type: 'show', title: 'Shows' }, { key: '3', type: 'artist', title: 'Music' }] } });
    if (pathname === '/library/sections/2/all') return jsonRes({ MediaContainer: { totalSize: episodes.length, Metadata: episodes } });
    if (pathname === '/library/sections/1/all') return jsonRes({ MediaContainer: { totalSize: movies.length, Metadata: movies } });
    if (/^\/library\/metadata\/[^/]+\/thumb/.test(pathname)) return binRes(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return jsonRes({}, 404);
  };
  f.seen = seen;
  return f;
}

const setup = () => {
  const db = openDb(fs.mkdtempSync(path.join(dir, 'db-')));
  db.prepare('INSERT INTO sources(kind,name,url,token) VALUES(?,?,?,?)').run('plex', 'Test Plex', PLEX, 'tok1');
  const add = (name, key, type) => Number(db.prepare('INSERT INTO libraries(name,path,type) VALUES(?,?,?)').run(name, `ms://1/${key}`, type).lastInsertRowid);
  return { db, tv: add('Shows', '2', 'tv'), films: add('Films', '1', 'movies') };
};
const scan = (db, lib, key, doFetch, progress = { files: 0, changed: 0 }) =>
  scanPlex(db, db.prepare('SELECT * FROM libraries WHERE id=?').get(lib), db.prepare('SELECT * FROM sources WHERE id=1').get(), key, progress, { safeRemovals, fetch: doFetch });

test('the part key is the stored path, and the token lives only in the URL ffmpeg reads', () => {
  assert.equal(partRef({ key: '/library/parts/141/1699999999/film.mkv' }), '141/1699999999/film.mkv');
  assert.equal(partRef({ id: 7, file: '/mnt/movies/x y.mkv' }), '7/x y.mkv'); // no key: rebuilt from what Plex did give
  assert.equal(partRef({}), null);
  const src = { url: PLEX, token: 't o k' };
  assert.equal(plexPartUrl(src, '141/1699/a b.mkv'), `${PLEX}/library/parts/141/1699/a%20b.mkv?X-Plex-Token=t%20o%20k`); // each segment, so the slashes survive
  const { db } = setup();
  assert.equal(resolveMedia(db, 'ms://1/141/1699999999/film.mkv'), `${PLEX}/library/parts/141/1699999999/film.mkv?X-Plex-Token=tok1`);
  assert.equal(resolveMedia(db, '/mnt/tv/a.mkv'), '/mnt/tv/a.mkv'); // plain files still pass through
});

test('a Plex server offers its film and TV sections, and the token never travels in a URL', async () => {
  const f = fake();
  const d = await discoverPlex(PLEX, 'tok1', { doFetch: f });
  assert.equal(d.name, 'Test Plex');
  assert.equal(d.kind, 'plex');
  assert.equal(d.userId, 'abc');
  assert.deepEqual(d.views, [{ id: '1', name: 'Films', type: 'movies' }, { id: '2', name: 'Shows', type: 'tv' }]); // music dropped
  assert.ok(f.seen.every((s) => s.headers['X-Plex-Token'] === 'tok1'), 'the token is a header on every call');
  assert.ok(f.seen.every((s) => !s.url.includes('tok1')), 'and never in a URL');
});

test('a wrong token and an unreachable server say which one it was', async () => {
  await assert.rejects(discoverPlex(PLEX, 'wrong', { doFetch: fake() }), /rejected the token/);
  await assert.rejects(discoverPlex(PLEX, 'tok1', { doFetch: fake({ down: true }) }), /could not reach/);
  await assert.rejects(discoverPlex('', 'tok1', { doFetch: fake() }), /server address/);
  await assert.rejects(discoverPlex(PLEX, '', { doFetch: fake() }), /Plex token/);
});

test('a server with only music says so, rather than offering a section it cannot add', async () => {
  const f = fake({ sections: [{ key: '3', type: 'artist', title: 'Music' }] });
  await assert.rejects(discoverPlex(PLEX, 'tok1', { doFetch: f }), /not supported/);
});

test('a TV section becomes a show and its episodes, and a second scan changes nothing', async () => {
  const { db, tv } = setup();
  const f = fake();
  const p = { files: 0, changed: 0 };
  await scan(db, tv, '2', f, p);
  const show = db.prepare('SELECT * FROM shows').get();
  assert.equal(show.title, 'Great Show');
  assert.equal(show.year, 2010);
  const eps = db.prepare("SELECT * FROM items WHERE kind='episode' ORDER BY episode").all();
  assert.equal(eps.length, 2, 'the episode with no Part is skipped: there is nothing to play');
  assert.equal(eps[0].path, 'ms://1/301/1700000000/pilot.mkv');
  assert.equal(eps[0].runtime, 1800);
  assert.equal(eps[1].runtime, 1800, 'Plex reports milliseconds, the schedule thinks in seconds');
  assert.equal(eps[0].season, 1);
  assert.equal(eps[0].episode, 1);
  assert.equal(eps[0].aired, '2010-01-01');
  assert.equal(eps[0].probed, 1, 'the API duration is trusted: no ffprobe over the network, ever');
  assert.deepEqual(JSON.parse(eps[0].actors), [{ name: 'Actor', role: 'Hero' }]);
  assert.ok(fs.existsSync(path.join(dir, 'covers', 'plex_1_2001.jpg')), 'the poster was downloaded');
  assert.ok(eps[0].poster.endsWith('plex_1_2001.jpg'));
  assert.ok(f.seen.some((s) => /X-Plex-Container-Start=0&X-Plex-Container-Size=500$/.test(s.url)), 'the library is read a page at a time');
  const again = { files: 0, changed: 0 };
  await scan(db, tv, '2', f, again);
  assert.equal(again.changed, 0, 'an unchanged server changes nothing');
});

test('a film section becomes movies, with the studio and genre the channels are built from', async () => {
  const { db, films } = setup();
  await scan(db, films, '1', fake());
  const row = db.prepare("SELECT * FROM items WHERE kind='movie'").get();
  assert.equal(row.title, 'A Film');
  assert.equal(row.year, 1999);
  assert.equal(row.runtime, 5400);
  assert.equal(row.mpaa, '');
  assert.deepEqual(JSON.parse(row.studios), ['Warner Bros.']);
  assert.deepEqual(JSON.parse(row.genres), ['Horror']);
  assert.equal(row.path, 'ms://1/141/1699999999/film.mkv');
});

test('a Plex server that answers with nothing is not a deleted library', async () => {
  const { db, tv } = setup();
  await scan(db, tv, '2', fake());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 2);
  // the server is restarting and answers with an empty section, so every item looks gone
  await scan(db, tv, '2', fake({ episodes: [] }), { files: 0, changed: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 2, 'kept until a second scan agrees');
  // a second scan that agrees is believed
  await scan(db, tv, '2', fake({ episodes: [] }), { files: 0, changed: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 0);
});
