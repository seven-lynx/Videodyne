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
// Some old-name literals are deliberate and belong to another segment: the environment knobs (B4),
// the access-key header and the database filename (B5), the container name and tmpfs path (B4), the
// widget artefact (B8), and upstream's repository and published image, which have to keep resolving.
// Two more are this rename's own migration: the old preference keys are still *read* so a returning
// viewer keeps their theme. The scan strips exactly those before it looks, so anything else is a
// regression rather than noise.
//
// The theme is a stored preference: a viewer who chose one before the rename must keep it, so the
// new key has to be read with the old one behind it - asserted here, not left to a manual check.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const OWNED = /WBTV_[A-Z]+|WB2024\/WBTV|wb20244\/wbtv|WBTV-Tizen\.wgt|x-wbtv-key|wbtv\.db|docker logs wbtv|\/tmp\/wbtv|\/opt\/wbtv|container_name: wbtv|--name wbtv|\n\s+wbtv:|wbtv-theme|wbtv-\$\{key\}/g;

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
