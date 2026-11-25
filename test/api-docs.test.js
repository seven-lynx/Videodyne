import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `docs/API.md` calls itself the whole contract, and it drifted: five library types and twenty-five
// routes were missing while every test was green, because nothing ever compared the document to the
// code. This file is that comparison, so the drift cannot come back: every route the server registers
// is named in the doc, and every route the doc names exists.
//
// Both sides are normalised before they are compared. `:id` and `<number>` are one placeholder, so
// `/live/:id/:seg` and `/live/:channelId/:seg` are the same route written twice, and a query string is
// not part of the path. A Tuner table row that names only a path documents a `GET`: that table cannot
// carry a method yet, because the file already differs from pristine there and an upstream patch has
// to apply to both trees (SWEEP X16, L5).
//
// It is a file of its own rather than a case in an existing suite on purpose: the others are upstream's
// or were built around a running server, and this one reads `src/` as text and binds no port.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const apiPath = path.join(root, 'docs', 'API.md');

/** One shape for a path: `<x>` and `:x` are the same placeholder, and a query string is not the path. */
const norm = (p) => p.split('?')[0].replace(/<[^>]*>/g, ':').replace(/:[A-Za-z0-9_]+/g, ':').replace(/\/+$/, '');

const registered = fs.readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .flatMap((f) => [...fs.readFileSync(path.join(srcDir, f), 'utf8').matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
    .map((m) => `${m[1].toUpperCase()} ${norm(m[2])}`));

const documented = [];
for (const line of fs.readFileSync(apiPath, 'utf8').split('\n')) {
  if (!line.startsWith('|')) continue; // a table row is the only place the doc names a route
  const pairs = [...line.matchAll(/(GET|POST|PUT|PATCH|DELETE)\s+`?(\/[^`\s|,()]*)/g)].map((m) => `${m[1]} ${norm(m[2])}`);
  if (pairs.length) documented.push(...pairs);
  else for (const m of line.matchAll(/`(\/[^`]+)`/g)) documented.push(`GET ${norm(m[1])}`);
}

test('every route the server registers is documented, and every route the doc names exists', () => {
  // The scan is what could break silently (a route written as `app.route()` would vanish from it), so it
  // is asserted before the comparison rather than trusted.
  assert.ok(registered.length > 40, `the route scan found ${registered.length} routes in src/*.js`);
  const missing = [...new Set(registered)].filter((r) => !documented.includes(r)).sort();
  const extra = [...new Set(documented)].filter((r) => !registered.includes(r)).sort();
  assert.deepEqual(missing, [], 'routes the server registers and docs/API.md does not list');
  assert.deepEqual(extra, [], 'routes docs/API.md lists and the server does not register');
});

test('the API doc lists every library type the server accepts', () => {
  const text = fs.readFileSync(path.join(srcDir, 'server.js'), 'utf8');
  // The one whitelist, found by its own text: `[...].includes(type)`. A line-wise search would also hit
  // the media-server view check (`allowed.includes(type)`), which lists no types at all.
  const list = /\[([^\]]*)\]\.includes\(type\)/.exec(text);
  const types = list ? [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
  assert.ok(types.length >= 13, `the library-type scan found ${types.length} types in src/server.js`);
  const doc = fs.readFileSync(apiPath, 'utf8');
  assert.deepEqual(types.filter((t) => !doc.includes(`\`${t}\``)), [], 'types the server accepts and docs/API.md does not list');
});
