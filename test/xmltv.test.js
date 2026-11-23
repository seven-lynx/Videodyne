import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { esc, registerIptvOut } from '../src/iptvout.js';
import { HORIZON_HOURS } from '../src/scheduler.js';

test('xml escaping handles markup characters', () => {
  assert.equal(esc(`Tom & Jerry <"quoted"> it's`), 'Tom &amp; Jerry &lt;&quot;quoted&quot;&gt; it&apos;s');
  assert.equal(esc(null), '');
  assert.equal(esc(1999), '1999');
});

test('control characters that XML 1.0 forbids are removed, normal whitespace is kept', () => {
  assert.equal(esc('Bad\u0001Title\u0008!'), 'BadTitle!');
  assert.equal(esc('line one\nline two\ttabbed'), 'line one\nline two\ttabbed');
  assert.equal(esc('ends\u0000here'), 'endshere');
});

// The guide is built from /api/epg, so both have to agree on how far ahead the schedule exists: a
// guide that asks for more than the scheduler plans ends in a blank grid, which reads as a bug (#9).
test('the guide asks /api/epg for exactly the horizon the scheduler plans', async () => {
  const app = Fastify();
  let asked;
  app.get('/api/epg', async (req) => { asked = req.query; return { programmes: {} }; });
  // no channels, so the route needs no items and never resolves a logo file
  registerIptvOut(app, { prepare: () => ({ all: () => [] }) }, () => null);
  const before = Math.floor(Date.now() / 1000);
  const res = await app.inject({ url: '/iptv/epg.xml' });
  await app.close();
  assert.equal(res.statusCode, 200);
  const from = Number(asked.from), to = Number(asked.to);
  // an hour of history, then the horizon - both floored from the same now, so this is exact
  assert.equal(to - from - 3600, HORIZON_HOURS * 3600);
  // and anchored on the clock, not on a hardcoded timestamp
  assert.ok(to - before >= HORIZON_HOURS * 3600 && to - before <= HORIZON_HOURS * 3600 + 5, `guide reached ${to - before}s past now`);
});
