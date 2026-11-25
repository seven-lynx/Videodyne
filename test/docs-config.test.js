import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The two surfaces a machine can read, and the two documents that described neither: before this
// file, `src/db.js` held 34 settings and `src/config.js` 15 environment knobs while the README
// listed nine names between them. A knob nobody documents is a knob that silently breaks an
// install, so the documents are compared with the code here the same way `api-docs.test.js`
// compares the route table.
//
// Only the names are compared, never the prose: a document may word the effect however it likes, it
// may not omit the key.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** Keys of the `DEFAULTS` object in `src/db.js` — `const DEFAULTS = {` up to the first `};`. */
function settingKeys() {
  const text = read('src/db.js');
  const block = /const DEFAULTS = \{([\s\S]*?)\n\};/.exec(text);
  assert.ok(block, 'could not find the DEFAULTS object in src/db.js');
  return [...block[1].matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
}

/** Every environment name the server reads: `env.X` in config.js and `process.env.X` anywhere. */
function envNames() {
  const names = new Set();
  for (const m of read('src/config.js').matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(src, file), 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  }
  return [...names];
}

test('every setting in src/db.js is documented in docs/SETTINGS.md', () => {
  const keys = settingKeys();
  // The scan is what could break silently, so it is asserted before it is trusted.
  assert.ok(keys.length >= 30, `the DEFAULTS scan found ${keys.length} keys`);
  const doc = read('docs/SETTINGS.md');
  const missing = keys.filter((k) => !doc.includes(`\`${k}\``)).sort();
  assert.deepEqual(missing, [], 'settings the server reads and docs/SETTINGS.md does not name');
});

test('every environment name the server reads is documented in docs/ENVIRONMENT.md', () => {
  const names = envNames();
  assert.ok(names.length >= 15, `the environment scan found ${names.length} names`);
  const doc = read('docs/ENVIRONMENT.md');
  const missing = names.filter((n) => !doc.includes(`\`${n}\``)).sort();
  assert.deepEqual(missing, [], 'environment names the server reads and docs/ENVIRONMENT.md does not name');
});

test('the range and enum tables describe the same keys the defaults do', () => {
  // A key clamped or enumerated in one table but not declared in DEFAULTS is invisible to
  // fitSetting (it returns the declared default's type), which is how a "setting" ends up doing
  // nothing. This is cheap to assert and impossible to notice by reading.
  const text = read('src/db.js');
  const defaults = new Set(settingKeys());
  const ranged = [...(/const RANGES = \{([\s\S]*?)\n\};/.exec(text)?.[1] || '').matchAll(/([a-zA-Z][a-zA-Z0-9]*):/g)].map((m) => m[1]);
  const enums = [...(/const ENUMS = \{([\s\S]*?)\n\};/.exec(text)?.[1] || '').matchAll(/([a-zA-Z][a-zA-Z0-9]*):/g)].map((m) => m[1]);
  const unknown = [...ranged, ...enums].filter((k) => !defaults.has(k));
  assert.deepEqual(unknown, [], 'keys in RANGES/ENUMS that DEFAULTS does not declare');
});
