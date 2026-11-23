// The login delay is the one place where a security feature can punish the owner instead of the
// attacker: a counter that never forgets turns five mistyped passwords into a permanently slow login
// box. So the throttle is driven by an injected clock - the decay is asserted in virtual milliseconds
// instead of seconds of wall clock - and the route takes an injected sleep, which is why nothing here
// waits at all. No port, no ffmpeg, no media file.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { createThrottle, initAuth } from '../src/auth.js';

const PASSWORD = 'hunter2!';
const KEY = 'k'.repeat(24);
const SECRET = 'secret-that-signs-the-cookie';
const SALT = 'salt-that-goes-with-the-password';
const MINUTE = 60_000;

// the same primitive src/auth.js hashes with, so the fixture is a record it can verify
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('base64url');

const fakeClock = () => {
  let t = 1_700_000_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

test('each wrong password costs more, up to a three-second cap', () => {
  const t = createThrottle({ now: fakeClock().now });
  const delays = [];
  for (let i = 0; i < 8; i++) { t.fail(); delays.push(t.delay()); }
  // a cap, not min(failures, 5): the eighth attempt waits no longer than the fifth
  assert.deepEqual(delays, [600, 1200, 1800, 2400, 3000, 3000, 3000, 3000]);
});

test('a quiet minute halves the count and five quiet minutes forgive it', () => {
  const clock = fakeClock();
  const t = createThrottle({ now: clock.now });
  for (let i = 0; i < 4; i++) t.fail();
  assert.equal(t.delay(), 2400);
  clock.advance(MINUTE);
  assert.equal(t.delay(), 1200);
  clock.advance(MINUTE);
  assert.equal(t.delay(), 600); // a minute already spent is not spent twice
  clock.advance(MINUTE);
  assert.equal(t.delay(), 0);

  for (let i = 0; i < 16; i++) t.fail();
  assert.equal(t.delay(), 3000);
  clock.advance(5 * MINUTE);
  assert.equal(t.delay(), 0);
});

test('a gap shorter than a quiet minute forgives nothing', () => {
  const clock = fakeClock();
  const t = createThrottle({ now: clock.now });
  t.fail();
  t.fail();
  clock.advance(59_000);
  assert.equal(t.delay(), 1200);
  clock.advance(1_000);
  assert.equal(t.delay(), 600);
});

test('a failure after a quiet spell is counted from the decayed value', () => {
  const clock = fakeClock();
  const t = createThrottle({ now: clock.now });
  for (let i = 0; i < 4; i++) t.fail();
  clock.advance(2 * MINUTE); // 4 -> 1
  t.fail(); // 1 + 1, not 4 + 1
  assert.equal(t.delay(), 1200);
});

test('a successful login clears the count outright', () => {
  const t = createThrottle({ now: fakeClock().now });
  for (let i = 0; i < 6; i++) t.fail();
  assert.equal(t.delay(), 3000);
  t.reset();
  assert.equal(t.delay(), 0);
  t.fail();
  assert.equal(t.delay(), 600);
});

test('the login route waits on the throttle and forgets failures after a quiet spell', async () => {
  const clock = fakeClock();
  const waits = [];
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const record = { salt: SALT, hash: hashPw(PASSWORD, SALT), apiKey: KEY, secret: SECRET };
  db.prepare("INSERT INTO settings(key,value) VALUES('auth',?)").run(JSON.stringify(record));
  const app = Fastify();
  initAuth(app, db, { now: clock.now, sleep: async (ms) => { waits.push(ms); } });
  await app.ready();
  const login = (password) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });

  assert.equal((await login('wrong')).statusCode, 401); // nothing to wait for on the first guess
  assert.deepEqual(waits, []);
  assert.equal((await login('wrong')).statusCode, 401);
  assert.equal((await login('wrong')).statusCode, 401);
  assert.deepEqual(waits, [600, 1200]);

  clock.advance(5 * MINUTE); // five quiet minutes: the three failures are gone
  assert.equal((await login('wrong')).statusCode, 401);
  assert.deepEqual(waits, [600, 1200]);
  assert.equal((await login('wrong')).statusCode, 401);
  assert.deepEqual(waits, [600, 1200, 600]); // counted from one, not from four

  assert.equal((await login(PASSWORD)).statusCode, 200);
  assert.deepEqual(waits, [600, 1200, 600, 1200]);
  assert.equal((await login('wrong')).statusCode, 401); // reset: one failure waits for nothing
  assert.deepEqual(waits, [600, 1200, 600, 1200]);
});
