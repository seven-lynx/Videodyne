import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, setSettings } from '../src/db.js';
import { inferChannels } from '../src/channels.js';

// A channel name is a brand word, not a description of the medium: `Nightshade` is a network whose two
// channels are `Nightshade` (shows) and `Nightshade Grindhouse` (films), and a music station is its
// video channel plus a dial position (`Cadence`, `Cadence 103.2`). No name says TV, Cinema, Movies or
// FM - the number band and the guide's network chip carry that - and an item the roster cannot place
// lands in a catch-all of its own brand rather than in a channel named after the product.
//
// The assertions are about the relationship between two names, not about a literal string, so
// renaming a network keeps passing only while the pairing holds - which is the part that is easy to
// break by hand, one table row at a time.

const MEDIUM = /\b(TV|FM|Cinema|Movies)\b/;

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = openDb(dir);
  setSettings(db, { minChannelMinutes: 1 });
  const lib = (name, type) => Number(db.prepare('INSERT INTO libraries(name,path,type) VALUES(?,?,?)').run(name, `/${type}-${name}`, type).lastInsertRowid);
  const item = (kind, library, p, title, runtime, genres) => db.prepare('INSERT INTO items(library_id,kind,path,title,runtime,probed,genres) VALUES(?,?,?,?,?,1,?)')
    .run(library, kind, p, title, runtime, JSON.stringify(genres || []));
  const track = (library, genre, i) => item('track', library, `/radio/${genre}/${i}.mp3`, `${genre} ${i}`, 300, [genre]);
  const video = (library, genre, i) => item('musicvideo', library, `/video/${genre}/${i}.mp4`, `${genre} ${i}`, 240, [genre]);
  const film = (library, title, genre) => item('movie', library, `/film/${title}.mkv`, title, 5400, genre && [genre]);
  const show = (library, name, genre) => {
    const id = Number(db.prepare("INSERT INTO shows(library_id,path,title,studios,genres) VALUES(?,?,?,'[]',?)").run(library, `/${name}`, name, JSON.stringify(genre ? [genre] : [])).lastInsertRowid);
    for (let e = 1; e <= 3; e++) db.prepare("INSERT INTO items(library_id,show_id,kind,path,title,runtime,probed) VALUES (?,?,'episode',?,?,1800,1)").run(library, id, `/${name}/e${e}.mkv`, `${name} ${e}`);
  };
  const channels = () => db.prepare('SELECT key, kind, COALESCE(name_override, auto_name) AS name, number, network, item_count FROM channels WHERE item_count>0 ORDER BY key').all();
  const done = () => { db.close?.(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, lib, item, track, video, film, show, channels, done };
}

test('a music station is its video channel plus a dial position, and the sub-genres fold into it', () => {
  const { db, lib, track, video, channels, done } = fresh('wbtv-names-');
  try {
    const radio = lib('Radio', 'radio'), vids = lib('Videos', 'music');
    for (const g of ['Jazz', 'Acid Jazz', 'Smooth Jazz']) for (let i = 0; i < 3; i++) { track(radio, g, i); video(vids, g, i); }

    inferChannels(db);
    const station = channels().filter((c) => c.kind === 'radio');
    const clips = channels().filter((c) => c.kind === 'music');
    assert.equal(station.length, 1, 'Jazz, Acid Jazz and Smooth Jazz are one station');
    assert.equal(clips.reduce((n, c) => n + c.item_count, 0), 9, 'every video is on a channel');
    const brand = station[0].name.replace(/ \d{2,3}\.\d$/, '');
    assert.equal(MEDIUM.test(brand), false, `the video channel is a brand, not a medium: ${brand}`);
    assert.match(station[0].name, new RegExp(`^${brand} \\d{2,3}\\.\\d$`), `the station leads with it and is known by its dial position: ${station[0].name}`);
    assert.equal(clips.filter((c) => c.name === brand).length, 1, 'the plainest sub-genre keeps the plain name');
    assert.deepEqual(clips.filter((c) => c.network !== station[0].network), [], 'and the whole family is one network');
  } finally { done(); }
});

test('a film channel is its television channel plus a sibling word, on the same network', () => {
  const { db, lib, show, film, channels, done } = fresh('wbtv-net-');
  try {
    const shows = lib('Shows', 'tv'), films = lib('Films', 'movies');
    show(shows, 'Spooky Show', 'Horror');
    film(films, 'Spooky Film', 'Horror');

    inferChannels(db);
    const tv = channels().filter((c) => c.kind === 'tv');
    const movie = channels().filter((c) => c.kind === 'movie');
    assert.equal(tv.length, 1, 'one television genre channel');
    assert.equal(movie.length, 1, 'and one film channel');
    assert.ok(tv[0].network, 'a genre channel is known by its network');
    assert.equal(movie[0].network, tv[0].network, 'the film channel is the same network');
    assert.ok(movie[0].name.startsWith(`${tv[0].name} `), `the film channel leads with the television one: ${movie[0].name}`);
    assert.deepEqual([tv[0].name, movie[0].name].filter((n) => MEDIUM.test(n)), [], 'neither name says the medium');
  } finally { done(); }
});

test('what the roster cannot place lands in a catch-all of its own brand', () => {
  const { db, lib, show, film, channels, done } = fresh('wbtv-misc-');
  try {
    const shows = lib('Shows', 'tv'), films = lib('Films', 'movies');
    show(shows, 'Unlabelled Show', null);
    film(films, 'Unlabelled Film', null);

    inferChannels(db);
    const all = channels();
    assert.deepEqual(all.filter((c) => /wbtv/i.test(c.name)), [], 'no channel is named after the product');
    const tv = all.find((c) => c.kind === 'tv'), movie = all.find((c) => c.kind === 'movie');
    assert.ok(tv && movie, 'an item with no genre still reaches a channel');
    assert.ok(tv.network && movie.network && tv.network !== movie.network, 'each medium has its own catch-all brand');
  } finally { done(); }
});
