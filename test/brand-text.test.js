import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The product name reached the web UI and nine published documents while the server had long since
// introduced itself as Videodyne, so a viewer read one name in the API and another in the interface.
// BRAND/B3 renamed them; this file is what keeps them renamed, because nothing else in the suite
// reads `public/` or the prose in `README.md` - a string that can go stale silently gets stale.
//
// Some old-name literals are deliberate and belong to another segment: the access-key header and the
// session cookie still accepted after the rename (B5), the `/opt/wbtv` mount in `tools/README.md`, and
// upstream's repository and published image, which have to keep resolving. The environment prefix,
// the container name and the tmpfs path are deliberately *not* among them any more: they were renamed,
// and the last two tests here are what keeps them renamed and keeps the pair in step.
// Two more are this rename's own migration: the old preference keys are still *read* so a returning
// viewer keeps their theme. The scan strips exactly those before it looks, so anything else is a
// regression rather than noise.
//
// The theme is a stored preference: a viewer who chose one before the rename must keep it, so the
// new key has to be read with the old one behind it - asserted here, not left to a manual check.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const OWNED = /WB2024\/WBTV|wb20244\/wbtv|x-wbtv-key|wbtv_session|\/opt\/wbtv|wbtv-theme|wbtv-\$\{key\}/g;

const SURFACES = [
  'public/index.html',
  'public/app.js',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/API.md',
  'docs/FEATURES.md',
  'docs/COMPARISON.md',
  'tools/README.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
];

test('the web UI introduces the product by its own name', () => {
  const html = read('public/index.html');
  assert.match(html, /<title>Videodyne<\/title>/, 'the document title names the product');
  // A rebuilt `public/` that dropped the rename would still pass a grep for "Videodyne", so the
  // absence of the old name is asserted too - after the literals another segment owns are removed.
  assert.deepEqual(html.replace(OWNED, '').match(/wbtv/i), null, 'no old name left in the web UI');
  assert.deepEqual(read('public/app.js').replace(OWNED, '').match(/wbtv/i), null, 'nor in its script');
});

test('the documents name the product the same way', () => {
  const stale = SURFACES.filter((f) => /wbtv/i.test(read(f).replace(OWNED, '')));
  assert.deepEqual(stale, [], 'documents still naming the old product');
});

test('a stored theme, filter and fullscreen choice survives the renamed keys', () => {
  const html = read('public/index.html');
  assert.match(html, /getItem\("videodyne-theme"\) \|\| localStorage\.getItem\("wbtv-theme"\)/,
    'the inline script reads the new theme key and falls back to the old one');
  const app = read('public/app.js');
  // One reader that tries the new key then the old, and one writer that only ever writes the new -
  // so the migration happens on the next read instead of silently resetting a viewer's settings.
  assert.match(app, /localStorage\.getItem\(`videodyne-\$\{key\}`\) \?\? localStorage\.getItem\(`wbtv-\$\{key\}`\)/,
    'the stored-preference reader still honours the old key');
  assert.deepEqual(app.match(/localStorage\.setItem\(['"]/g), null,
    'no preference is written under a literal key - the writer owns the new one');
});

// The environment prefix is identity too: it is what an operator types and what `docker logs` shows.
// It is also the one rename where a half-done job costs a viewer a channel - a compose file that
// mounts `/tmp/wbtv` while the server writes to `/tmp/videodyne` sends the segments to a full RAM disk -
// so the path is asserted as a pair (default, image, compose) rather than as three separate greps.
const STALE = /WBTV_|docker logs wbtv|\/tmp\/wbtv|container_name: wbtv|--name wbtv/;

test('the environment prefix, the container name and the tmpfs path are the new ones', () => {
  const surfaces = [...SURFACES, 'docker-compose.yml', 'Dockerfile'];
  const stale = surfaces.filter((f) => STALE.test(read(f)));
  assert.deepEqual(stale, [], 'surfaces still carrying a pre-rename name');
  assert.match(read('docker-compose.yml'), /container_name: videodyne/, 'the container is named after the product');
});

// The database file is the one old name that must not linger in a document: `openDb` moves a pre-rename
// file in place on the first boot, so after B5 nobody types the old name again. `docs/OPERATIONS.md` is
// not on this list because its upgrade note names the old file deliberately, and `docs/UPSTREAM.md`
// records the rename itself.
test('the documents that describe the database name the new file', () => {
  const docs = ['docs/ARCHITECTURE.md', 'docs/DATA-MODEL.md', 'tools/README.md'];
  const stale = docs.filter((f) => /wbtv\.db/.test(read(f)));
  assert.deepEqual(stale, [], 'documents still naming the pre-rename database file');
});

test('every knob keeps the old name behind the new one, and the container agrees with the default', () => {
  const cfgSrc = read('src/config.js');
  for (const knob of ['CONFIG', 'TMP', 'BROWSE_ROOTS', 'WIDTH', 'HEIGHT', 'CRF', 'PRESET', 'FONT', 'SCAN_CONCURRENCY']) {
    assert.match(cfgSrc, new RegExp(`env\\.VIDEODYNE_${knob} \\|\\| env\\.WBTV_${knob}`), `${knob} is read under both names`);
  }
  // The three reads outside `config.js` are the documented exceptions, and they carry the same fallback.
  assert.match(read('src/hw.js'), /VIDEODYNE_HWACCEL \|\| process\.env\.WBTV_HWACCEL/, 'the GPU override');
  assert.match(read('src/hw.js'), /VIDEODYNE_VAAPI_DEVICE \|\| process\.env\.WBTV_VAAPI_DEVICE/, 'the render node');
  assert.match(read('src/broadcaster.js'), /VIDEODYNE_DEBUG \|\| process\.env\.WBTV_DEBUG/, 'the verbose log switch');
  const tmp = /env\.VIDEODYNE_TMP \|\| env\.WBTV_TMP \|\| '([^']+)'/.exec(cfgSrc);
  assert.ok(tmp, 'the tmp dir default is spelled once');
  assert.ok(read('docker-compose.yml').includes(`${tmp[1]}:size=`), 'the compose tmpfs mounts that path');
  assert.ok(read('Dockerfile').includes(`VIDEODYNE_TMP=${tmp[1]}`), 'the image sets that path');
  const cfgDir = /env\.VIDEODYNE_CONFIG \|\| env\.WBTV_CONFIG \|\| '([^']+)'/.exec(cfgSrc);
  assert.ok(cfgDir, 'the config dir default is spelled once');
  assert.ok(read('Dockerfile').includes(`VIDEODYNE_CONFIG=${cfgDir[1]}`), 'the image and the default agree');
});

