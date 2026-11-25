import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `docs/` had no entry point: four documents and no page that said which one answers which
// question, so a new document was found only by listing the directory. This file keeps the index
// complete in both directions - every document is reachable from it, and every link in every
// document resolves - because a broken or missing link is the only way a document silently stops
// being read.
//
// Links inside a fenced code block are examples, not references, so the scan skips them. External
// URLs and bare anchors are not this directory's business. The shape follows
// `test/api-docs.test.js`: read the tree as text, bind no port, assert the set in both directions.

const docsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const INDEX = 'README.md';

const documents = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
const read = (f) => fs.readFileSync(path.join(docsDir, f), 'utf8');
const local = (target) => !/^(https?:|mailto:|#)/i.test(target) && target.split('#')[0] !== '';

/** Every `[text](target)` outside a fenced code block. */
function linksIn(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) out.push(m[1]);
  }
  return out;
}

test('every document in docs/ is reachable from docs/README.md', () => {
  // The scan is what could break silently, so it is asserted before it is trusted.
  assert.ok(documents.length > 1, `expected documents beside the index, found ${documents.length}`);
  const linked = new Set(linksIn(read(INDEX)).map((t) => t.split('#')[0]));
  const orphans = documents.filter((f) => f !== INDEX && !linked.has(f));
  assert.deepEqual(orphans, [], 'documents that docs/README.md does not link');
  assert.ok(linksIn(read(INDEX)).filter(local).length >= 3, 'the index links almost nothing');
});

test('every relative link in every document resolves', () => {
  const broken = [];
  for (const f of documents) {
    for (const target of linksIn(read(f))) {
      if (!local(target)) continue;
      if (!fs.existsSync(path.resolve(docsDir, target.split('#')[0]))) broken.push(`${f} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'links in docs/ that point at nothing');
});
