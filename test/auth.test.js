// Access control is the one module where a mistake is silent: the app keeps working, just without
// the protection. Everything here is driven through app.inject against an in-memory database, so
// the gate, the cookie and the key are covered without a port, ffmpeg or a media file.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { initAuth } from '../src/auth.js';

// The issued cookie is the new name; the old one is still honoured, so it gets a constant of its own
// rather than a stray literal (BRAND/B5).
const COOKIE = 'videodyne_session';
const LEGACY_COOKIE = 'wbtv_session';
const PASSWORD = 'hunter2!';
const KEY = 'k'.repeat(24);
const SECRET = 'secret-that-signs-the-cookie';
const SALT = 'salt-that-goes-with-the-password';

// the same two primitives src/auth.js uses, so the fixture is a record it can verify
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('base64url');
const sign = (exp, secret = SECRET) => crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
const cookie = (exp, secret) => `${COOKIE}=${exp}.${sign(exp, secret)}`;
const legacyCookie = (exp) => cookie(exp).replace(COOKIE, LEGACY_COOKIE);
const soon = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

// a fresh app per test: `failures` and its delay are initAuth closure state (src/auth.js:51)
const setup = async ({ password = PASSWORD } = {}) => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  if (password) {
    const record = { salt: SALT, hash: hashPw(password, SALT), apiKey: KEY, secret: SECRET };
    db.prepare("INSERT INTO settings(key,value) VALUES('auth',?)").run(JSON.stringify(record));
  }
  const app = Fastify();
  initAuth(app, db);
  // nowhere in src/ sits under a protected prefix, so the test registers the route it is guarding
  app.get('/api/probe', async () => ({ ok: true }));
  await app.ready();
  const get = (url, headers) => app.inject({ method: 'GET', url, headers });
  const post = (url, payload) => app.inject({ method: 'POST', url, payload });
  return { app, db, get, post };
};

test('with no password stored, every route is open', async () => {
  const { get } = await setup({ password: null });
  assert.equal((await get('/api/probe')).statusCode, 200);
  assert.deepEqual((await get('/api/auth/status')).json(), { enabled: false, authed: true });
});

test('a protected prefix needs a key and answers with a challenge; /healthz stays open', async () => {
  const { get } = await setup();
  const r = await get('/api/probe');
  assert.equal(r.statusCode, 401);
  assert.equal(r.headers['www-authenticate'], 'Bearer');
  assert.deepEqual(r.json(), { error: 'login required' });
  assert.equal((await get('/healthz')).statusCode, 200);
});

test('the api key is accepted as x-videodyne-key, still as x-wbtv-key, as a bearer token and as ?key=', async () => {
  const { get } = await setup();
  assert.equal((await get('/api/probe', { 'x-videodyne-key': KEY })).statusCode, 200);
  // the pre-rename header is what every Android build in the field sends, so it has to keep working
  assert.equal((await get('/api/probe', { 'x-wbtv-key': KEY })).statusCode, 200);
  assert.equal((await get('/api/probe', { authorization: `Bearer ${KEY}` })).statusCode, 200);
  assert.equal((await get('/api/probe', { authorization: `bearer ${KEY}` })).statusCode, 200);
  assert.equal((await get(`/api/probe?key=${KEY}`)).statusCode, 200);
});

test('a wrong key is rejected whether or not it has the same length as the real one', async () => {
  const { get } = await setup();
  assert.equal((await get('/api/probe', { 'x-wbtv-key': 'short' })).statusCode, 401);
  assert.equal((await get('/api/probe', { 'x-wbtv-key': 'x'.repeat(KEY.length) })).statusCode, 401);
});

test('a valid cookie is accepted; a tampered signature and an expired one are not', async () => {
  const { get } = await setup();
  assert.equal((await get('/api/probe', { cookie: cookie(soon()) })).statusCode, 200);
  // a browser that logged in before the rename holds the old cookie name: the session survives it
  assert.equal((await get('/api/probe', { cookie: legacyCookie(soon()) })).statusCode, 200);
  assert.equal((await get('/api/probe', { cookie: cookie(soon(), 'not-the-secret') })).statusCode, 401);
  assert.equal((await get('/api/probe', { cookie: cookie(past()) })).statusCode, 401);
});

test('the login sets a working cookie, and a wrong password of the same length is refused', async () => {
  const { get, post } = await setup();
  const bad = await post('/api/auth/login', { password: 'hunter2?' });
  assert.equal(bad.statusCode, 401);
  const ok = await post('/api/auth/login', { password: PASSWORD });
  assert.equal(ok.statusCode, 200);
  const set = String(ok.headers['set-cookie']);
  assert.match(set, /^videodyne_session=\d+\.[\w-]+;/);
  assert.match(set, /HttpOnly/);
  assert.equal((await get('/api/probe', { cookie: set.split(';')[0] })).statusCode, 200);
});

test('logging out clears the issued cookie and the pre-rename one', async () => {
  const { post } = await setup();
  const out = await post('/api/auth/logout', {});
  assert.equal(out.statusCode, 200);
  const cleared = [].concat(out.headers['set-cookie']).map((c) => c.split(';')[0]);
  // a stale old cookie left behind is a session that outlives the logout that asked for it
  assert.deepEqual(cleared.sort(), [`${COOKIE}=`, `${LEGACY_COOKIE}=`].sort());
});

test('status stays reachable without a key and reports the gate honestly', async () => {
  const { get } = await setup();
  assert.deepEqual((await get('/api/auth/status')).json(), { enabled: true, authed: false });
  assert.equal((await get('/api/auth/status', { 'x-wbtv-key': KEY })).json().authed, true);
});

test('setting a password through the route locks the app and returns a key that works', async () => {
  const { app, db, get, post } = await setup({ password: null });
  assert.equal((await post('/api/auth/password', { password: 'abc' })).statusCode, 400);
  const set = await post('/api/auth/password', { password: 'four-characters' });
  assert.equal(set.statusCode, 200);
  const { key } = set.json();
  assert.ok(key && key.length >= 24, 'a key is generated with the password');
  assert.equal((await get('/api/probe')).statusCode, 401);
  assert.equal((await get('/api/probe', { 'x-videodyne-key': key })).statusCode, 200);

  // and deleting it opens the app again, with the row gone
  const del = await app.inject({ method: 'DELETE', url: '/api/auth', headers: { 'x-wbtv-key': key } });
  assert.equal(del.statusCode, 200);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='auth'").get(), undefined);
  assert.equal((await get('/api/probe')).statusCode, 200);
});
