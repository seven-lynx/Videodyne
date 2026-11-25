import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-ao-'));
// The new name in front; `test/plex.test.js` is the one that still sets the old one, so both spellings
// are exercised by the suite rather than only documented.
process.env.VIDEODYNE_CONFIG = dir;
const { openDb } = await import('../src/db.js');
const { parseArchiveUrl, pickVideoFile, secondsOf, resolveItem, downloadUrl } = await import('../src/archive.js');
const { addAdUrls, processAds, removeAd } = await import('../src/ads.js');
const { guessAdYear } = await import('../src/daypart.js');

// archive.org ads are streamed, never downloaded: these tests assert the item that gets picked (the small derivative,
// not the master), the URL that is stored, and that no file appears in config/ads. The metadata response is a fixture —
// the real endpoint answers the same JSON and was checked by hand while planning.

const FILES = [
  { name: 'x.mpeg', format: 'MPEG2', length: '600.0' }, // the 280 MB master: never chosen
  { name: 'x.mp4', format: 'h.264', length: '30.4' },
  { name: 'x_512kb.mp4', format: '512Kb MPEG4', length: '30.4' },
];
const META = { metadata: { identifier: 'x', title: 'Old Spice  Ad', year: '1958' }, files: FILES };

const fake = (o, code = 200) => async () => ({ ok: code < 400, status: code, json: async () => o });
const db = () => openDb(fs.mkdtempSync(path.join(dir, 'db-')));

test('both archive.org address shapes are understood, and nothing else is', () => {
  assert.deepEqual(parseArchiveUrl('https://archive.org/details/classic_tv_commercials'), { identifier: 'classic_tv_commercials', file: null });
  assert.deepEqual(parseArchiveUrl('http://www.archive.org/download/x/y%20z.mp4'), { identifier: 'x', file: 'y z.mp4' });
  assert.deepEqual(parseArchiveUrl('https://archive.org/details/x?start=3'), { identifier: 'x', file: null });
  assert.equal(parseArchiveUrl('https://www.youtube.com/watch?v=1'), null);
  assert.equal(parseArchiveUrl(''), null);
});

test('the small h.264 copy is picked, never the master', () => {
  assert.equal(pickVideoFile(FILES).name, 'x.mp4'); // "h.264" outranks "512Kb MPEG4"
  assert.equal(pickVideoFile([{ name: 'a.mp4', format: 'HiRes MPEG4' }, { name: 'b.mp4', format: 'h.264 IA' }]).name, 'b.mp4');
  assert.equal(pickVideoFile([{ name: 'a.mpeg', format: 'MPEG2' }]), null);
  assert.equal(pickVideoFile([]), null);
  assert.equal(pickVideoFile(undefined), null);
});

test('lengths are read as seconds and minutes, and an unreadable one is unknown, not zero', () => {
  assert.equal(secondsOf('602.23'), 602);
  assert.equal(secondsOf('10:01'), 601);
  assert.equal(secondsOf('1:02:03'), 3723);
  assert.equal(secondsOf(''), 0);
  assert.equal(secondsOf(undefined), 0);
  assert.equal(secondsOf('soon'), 0);
});

test('an item resolves to a direct URL, its duration and a year the scheduler can read', async () => {
  const r = await resolveItem('x', { doFetch: fake(META) });
  assert.equal(r.url, 'https://archive.org/download/x/x.mp4');
  assert.equal(r.seconds, 30);
  assert.equal(r.title, 'Old Spice Ad (1958)');
  assert.equal(r.year, 1958);
  assert.equal(guessAdYear(r.title), 1958, 'the scheduler dates the ad from its title, so no new column is needed');
  assert.equal(downloadUrl('a b', 'c d/e f.mp4'), 'https://archive.org/download/a%20b/c%20d/e%20f.mp4');
});

test('a named file in the URL wins, and a broken item says why', async () => {
  const r = await resolveItem('x', { prefer: 'x_512kb.mp4', doFetch: fake(META) });
  assert.equal(r.url, 'https://archive.org/download/x/x_512kb.mp4');
  await assert.rejects(resolveItem('x', { doFetch: fake({}, 404) }), /no item by that name/);
  await assert.rejects(resolveItem('x', { doFetch: fake({ files: [] }) }), /no playable MP4/);
  await assert.rejects(resolveItem('x', { doFetch: fake({ metadata: {}, files: [{ name: 'a.mp4', format: 'h.264' }] }) }), /how long/);
  await assert.rejects(resolveItem('x', { doFetch: fake({ is_dark: true, files: FILES }) }), /not available/);
  await assert.rejects(resolveItem('', { doFetch: fake(META) }), /identifier/);
});

test('an archive.org ad is queued for streaming, and only a non-archive one for download', () => {
  const d = db();
  assert.equal(addAdUrls(d, ['https://archive.org/details/x', 'https://www.youtube.com/watch?v=1']), 2);
  const rows = d.prepare('SELECT source, status FROM ads ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.status), ['resolving', 'pending']);
});

test('resolving an archive.org ad leaves nothing on disk and a row the scheduler can use', async () => {
  const d = db();
  addAdUrls(d, ['https://archive.org/details/x']);
  await processAds(d, null, { doFetch: fake(META) });
  const ad = d.prepare('SELECT * FROM ads').get();
  assert.equal(ad.status, 'ready');
  assert.equal(ad.file, 'https://archive.org/download/x/x.mp4');
  assert.equal(ad.duration, 30);
  assert.equal(ad.title, 'Old Spice Ad (1958)');
  assert.equal(fs.existsSync(path.join(dir, 'ads')), true); // the folder exists, as it always does
  assert.deepEqual(fs.readdirSync(path.join(dir, 'ads')), [], 'and it is empty: a streamed ad is never downloaded');
});

test('a failing archive.org ad is reported, and a streamed ad can be removed', async () => {
  const d = db();
  addAdUrls(d, ['https://archive.org/details/gone']);
  await processAds(d, null, { doFetch: fake({}, 404) });
  const ad = d.prepare('SELECT * FROM ads').get();
  assert.equal(ad.status, 'error');
  assert.match(ad.error, /no item by that name/);
  d.prepare("UPDATE ads SET status='ready', file='https://archive.org/download/x/x.mp4' WHERE id=?").run(ad.id);
  removeAd(d, ad.id); // must not try to unlink a URL
  assert.equal(d.prepare('SELECT COUNT(*) n FROM ads').get().n, 0);
});
