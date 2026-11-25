import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-ms-'));
process.env.WBTV_CONFIG = dir;
const { openDb } = await import('../src/db.js');
const { scanLibrary } = await import('../src/scanner.js');
const { discover, normalizeUrl, resolveMedia, parseRemote, isRemote, forgetSource } = await import('../src/mediaserver.js');

// a tiny Jellyfin: one user, a TV view with one series and three episodes, a movie view with one film
let down = false;
let externalAuth = ''; // the last Authorization header an authenticated call arrived with
const TICKS = 10_000_000;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (down) { res.destroy(); return; }
  if (req.headers.authorization) externalAuth = req.headers.authorization;
  if (u.pathname === '/System/Info/Public') return json({ ServerName: 'Test Jelly', ProductName: 'Jellyfin Server', Version: '10.9.0' });
  if (!/Token="goodkey"/.test(req.headers.authorization || '')) return json({}, 401); // Jellyfin 12: only the MediaBrowser Authorization header
  if (u.pathname === '/Users') return json([{ Id: 'u1', Name: 'will', Policy: { IsAdministrator: true } }]);
  if (u.pathname === '/Users/u1/Views') return json({ Items: [{ Id: 'tvview', Name: 'Shows', CollectionType: 'tvshows' }, { Id: 'mview', Name: 'Films', CollectionType: 'movies' }, { Id: 'music', Name: 'Music', CollectionType: 'music' }, { Id: 'mvview', Name: 'Music Videos', CollectionType: 'musicvideos' }] });
  if (u.pathname === '/Users/u1/Items') {
    const types = u.searchParams.get('IncludeItemTypes');
    const parent = u.searchParams.get('ParentId');
    let Items = [];
    if (parent === 'tvview' && types === 'Series') Items = [{ Id: 's1', Name: 'Great Show', Overview: 'A show.', ProductionYear: 2010, OfficialRating: 'TV-14', Genres: ['Drama'], Studios: [{ Name: 'BBC One' }] }];
    if (parent === 'tvview' && types === 'Episode') Items = [1, 2, 3].map((n) => ({ Id: `e${n}`, Name: `Ep ${n}`, SeriesId: 's1', ParentIndexNumber: 1, IndexNumber: n, RunTimeTicks: 1800 * TICKS, PremiereDate: `2010-01-0${n}T00:00:00Z`, DateLastSaved: '2024-01-01T00:00:00Z', People: [{ Name: 'Actor', Role: 'Hero', Type: 'Actor' }, { Name: 'Dir', Type: 'Director' }] }));
    if (parent === 'mview' && types === 'Movie') Items = [{ Id: 'm1', Name: 'A Film', ProductionYear: 1999, RunTimeTicks: 5400 * TICKS, Genres: ['Horror'], Studios: [{ Name: 'Warner Bros.' }], OfficialRating: 'R', DateLastSaved: '2024-01-01T00:00:00Z' }, { Id: 'm2', Name: 'No runtime' }];
    if (parent === 'mvview' && types === 'MusicVideo') Items = [{ Id: 'v1', Name: 'Boxers', Artists: ['Morrissey'], Album: 'Your Arsenal', ProductionYear: 1995, RunTimeTicks: 240 * TICKS, DateLastSaved: '2024-01-01T00:00:00Z' }, { Id: 'v2', Name: 'No length' }];
    return json({ Items, TotalRecordCount: Items.length });
  }
  if (/^\/Items\/[^/]+\/Images\/Primary$/.test(u.pathname)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
  json({}, 404);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* open database files on Windows: the OS temp folder cleans up */ } });

test('addresses are tidied up', () => {
  assert.equal(normalizeUrl('192.168.1.111:8096'), 'http://192.168.1.111:8096');
  assert.equal(normalizeUrl('https://jelly.example.com/web/index.html#!/home'), 'https://jelly.example.com');
  assert.equal(normalizeUrl(''), '');
});

test('discovery lists the TV, movie and music-video libraries and ignores the rest', async () => {
  const d = await discover(url, 'goodkey');
  assert.equal(d.name, 'Test Jelly');
  assert.deepEqual(d.views.map((v) => [v.id, v.type]), [['tvview', 'tv'], ['mview', 'movies'], ['mvview', 'music']]);
  assert.equal(d.userId, 'u1');
});

test('a wrong key or an unreachable server gives a clear message', async () => {
  await assert.rejects(discover(url, 'nope'), /rejected the API key/);
  await assert.rejects(discover('127.0.0.1:1', 'goodkey'), /could not reach/);
});

const setup = () => {
  const db = openDb(fs.mkdtempSync(path.join(dir, 'db-')));
  const base = `http://${url}`;
  db.prepare('INSERT INTO sources(kind,name,url,token,user_id) VALUES(?,?,?,?,?)').run('jellyfin', 'Test Jelly', base, 'goodkey', 'u1');
  const add = (name, view, type) => db.prepare('INSERT INTO libraries(name,path,type) VALUES(?,?,?)').run(name, `ms://1/${view}`, type).lastInsertRowid;
  return { db, tv: Number(add('Shows', 'tvview', 'tv')), mv: Number(add('Films', 'mview', 'movies')), base };
};
const run = (db, id) => scanLibrary(db, db.prepare('SELECT * FROM libraries WHERE id=?').get(id), { files: 0, changed: 0, dirs: 0 });

test('a TV view becomes shows and episodes, with the studio on the show', async () => {
  const { db, tv } = setup();
  const lib = db.prepare('SELECT * FROM libraries WHERE id=?').get(tv);
  await scanLibrary(db, lib, { files: 0, changed: 0, dirs: 0 });
  const show = db.prepare('SELECT * FROM shows').get();
  assert.equal(show.title, 'Great Show');
  assert.deepEqual(JSON.parse(show.studios), ['BBC One']);
  const eps = db.prepare("SELECT * FROM items WHERE kind='episode' ORDER BY episode").all();
  assert.equal(eps.length, 3);
  assert.equal(eps[0].path, 'ms://1/e1');
  assert.equal(eps[0].runtime, 1800);
  assert.equal(eps[0].season, 1);
  assert.equal(eps[0].aired, '2010-01-01');
  assert.deepEqual(JSON.parse(eps[0].actors), [{ name: 'Actor', role: 'Hero' }]); // the director is not an actor
  assert.ok(fs.existsSync(path.join(dir, 'covers', 'ms_1_s1.jpg')), 'the series picture was downloaded');
  assert.ok(db.prepare('SELECT poster FROM shows').get().poster.endsWith('ms_1_s1.jpg'));
  // a second scan of an unchanged server changes nothing
  const again = { files: 0, changed: 0, dirs: 0 };
  await scanLibrary(db, lib, again);
  assert.equal(again.changed, 0);
});

test('a movie view becomes movies, skipping ones with no runtime', async () => {
  const { db, mv } = setup();
  await run(db, mv);
  const rows = db.prepare("SELECT * FROM items WHERE kind='movie'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'A Film');
  assert.deepEqual(JSON.parse(rows[0].studios), ['Warner Bros.']);
});

test('a server that is down leaves the library exactly as it was', async () => {
  const { db, tv } = setup();
  await run(db, tv);
  down = true;
  try { await assert.rejects(run(db, tv), /could not reach|did not answer/); } finally { down = false; }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM items WHERE kind='episode'").get().n, 3);
});

test('item paths never contain the key; it is added only when a stream URL is needed', () => {
  const { db, base } = setup();
  assert.ok(isRemote('ms://1/e1'));
  assert.deepEqual(parseRemote('ms://1/e1'), { source: 1, ref: 'e1' });
  const u = resolveMedia(db, 'ms://1/e1');
  assert.equal(u, `${base}/Videos/e1/stream?static=true&MediaSourceId=e1&ApiKey=goodkey&api_key=goodkey`);
  assert.equal(resolveMedia(db, '/mnt/tv/a.mkv'), '/mnt/tv/a.mkv'); // plain files pass through
});

test('log lines never carry a media server key, in either spelling', async () => {
  const { hideKeys } = await import('../src/broadcaster.js');
  const out = hideKeys('ffmpeg -i http://h/Videos/1/stream?static=true&ApiKey=SECRET1&api_key=SECRET2 -f x');
  assert.ok(!/SECRET/.test(out), out);
});

// Plex puts the whole account token in the URL, and ffmpeg repeats its input line in every error tail
// (broadcaster.js:600-603): without this rule the token is in the log the first time a piece fails.
test('a Plex part URL is redacted, and the rest of the line survives', async () => {
  const { hideKeys } = await import('../src/broadcaster.js');
  const out = hideKeys('ffmpeg -i http://h:32400/library/parts/141/1699999999/file.mkv?X-Plex-Token=SECRET3 -f hls');
  assert.ok(!/SECRET/.test(out), out);
  assert.match(out, /library\/parts\/141\/1699999999\/file\.mkv/); // still enough to find the file by hand
  assert.match(out, /X-Plex-Token=\*\*\*/);
  assert.ok(!/TOKENX/.test(hideKeys('ffmpeg -i http://h/a?X-Plex-Token=TOKENX&b=1'))); // and behind an `&`
});

test('a Jellyfin music-video view becomes music videos with artist and album', async () => {
  const { db } = setup();
  const id = Number(db.prepare("INSERT INTO libraries(name,path,type) VALUES('MVs','ms://1/mvview','music')").run().lastInsertRowid);
  await run(db, id);
  const rows = db.prepare("SELECT kind, title, artist, album, year, runtime FROM items WHERE library_id=?").all(id);
  assert.equal(rows.length, 1, 'the one without a length is skipped');
  assert.deepEqual({ ...rows[0] }, { kind: 'musicvideo', title: 'Boxers', artist: 'Morrissey', album: 'Your Arsenal', year: 1995, runtime: 240 });
});

test('Emby still gets the old header and api_key, and is told apart from Jellyfin', async () => {
  let seen = null;
  const emby = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/System/Info/Public') return json({ ServerName: 'Test Emby', ProductName: 'Emby Server', Version: '4.8.0' });
    seen = { token: req.headers['x-emby-token'], auth: req.headers.authorization };
    if (req.headers['x-emby-token'] !== 'embykey') return json({}, 401);
    if (u.pathname === '/Users') return json([{ Id: 'u1', Name: 'will', Policy: {} }]);
    if (u.pathname === '/Users/u1/Views') return json({ Items: [{ Id: 'mview', Name: 'Films', CollectionType: 'movies' }] });
    json({}, 404);
  });
  await new Promise((r) => emby.listen(0, '127.0.0.1', r));
  try {
    const d = await discover(`127.0.0.1:${emby.address().port}`, 'embykey');
    assert.equal(d.product, 'Emby Server');
    assert.equal(seen.token, 'embykey');
    assert.equal(seen.auth, undefined, 'no MediaBrowser header for Emby');
    const db = openDb(fs.mkdtempSync(path.join(dir, 'db-')));
    db.prepare('INSERT INTO sources(kind,name,url,token,user_id) VALUES(?,?,?,?,?)').run('emby', 'E', 'http://emby:8096', 'embykey', 'u1');
    forgetSource(1); // sources are remembered by id for a minute, and the earlier tests used id 1 in another database
    assert.equal(resolveMedia(db, 'ms://1/x'), 'http://emby:8096/Videos/x/stream?static=true&MediaSourceId=x&api_key=embykey');
  } finally { emby.close(); }
});

test('a series id an episode also uses gets its own cover, and the art already on disk keeps its name', async () => {
  // one id in both namespaces: the server hands out the same string for a series and for an episode
  const jelly = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/System/Info/Public') return json({ ServerName: 'Collide', ProductName: 'Jellyfin Server', Version: '10.9.0' });
    if (!/Token="goodkey"/.test(req.headers.authorization || '')) return json({}, 401);
    if (u.pathname === '/Users') return json([{ Id: 'u1', Name: 'will', Policy: {} }]);
    if (u.pathname === '/Users/u1/Views') return json({ Items: [{ Id: 'tvview', Name: 'Shows', CollectionType: 'tvshows' }] });
    if (u.pathname === '/Users/u1/Items') {
      const Items = u.searchParams.get('IncludeItemTypes') === 'Series'
        ? [{ Id: 'x1', Name: 'Collided Show' }]
        : [{ Id: 'x1', Name: 'The Episode', SeriesId: 'x1', ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 1800 * TICKS, DateLastSaved: '2024-01-01T00:00:00Z' }];
      return json({ Items, TotalRecordCount: Items.length });
    }
    if (/^\/Items\/[^/]+\/Images\/Primary$/.test(u.pathname)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    json({}, 404);
  });
  await new Promise((r) => jelly.listen(0, '127.0.0.1', r));
  try {
    const db = openDb(fs.mkdtempSync(path.join(dir, 'db-')));
    db.prepare('INSERT INTO sources(kind,name,url,token,user_id) VALUES(?,?,?,?,?)').run('jellyfin', 'Collide', `http://127.0.0.1:${jelly.address().port}`, 'goodkey', 'u1');
    const id = Number(db.prepare("INSERT INTO libraries(name,path,type) VALUES('Shows','ms://1/tvview','tv')").run().lastInsertRowid);
    await run(db, id);
    const show = db.prepare('SELECT poster FROM shows').get().poster;
    const item = db.prepare("SELECT poster FROM items WHERE kind='episode'").get().poster;
    assert.ok(show, 'the series got its picture');
    assert.ok(item, 'the episode got its picture: the collision no longer routes both writes to the show');
    assert.notEqual(show, item, 'the two namespaces keep one file each');
    assert.ok(path.basename(show).includes('x1') && path.basename(item).includes('x1'), 'both names still carry the id');
    assert.ok(fs.existsSync(show) && fs.existsSync(item));
    assert.equal(fs.readdirSync(path.join(dir, 'covers')).filter((f) => f.includes('x1')).length, 2);
    // a second scan finds both pictures and downloads nothing again
    const again = { files: 0, changed: 0, dirs: 0 };
    await scanLibrary(db, db.prepare('SELECT * FROM libraries WHERE id=?').get(id), again);
    assert.equal(fs.readdirSync(path.join(dir, 'covers')).filter((f) => f.includes('x1')).length, 2);
  } finally { jelly.close(); }
});

// Jellyfin 12 reads the product out of the MediaBrowser Authorization header, so the name has to be
// in the header itself and not in a URL (BRAND/B2).
test('every call to Jellyfin is signed as Videodyne', async () => {
  await discover(url, 'goodkey');
  assert.match(externalAuth, /Client="Videodyne"/);
  assert.match(externalAuth, /DeviceId="videodyne"/);
  assert.doesNotMatch(externalAuth, /WBTV/i);
});
