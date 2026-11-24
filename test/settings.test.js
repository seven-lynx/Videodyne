import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fitSetting, getSettings, setSettings } from '../src/db.js';
import { breakSegments } from '../src/scheduler.js';

test('numbers are clamped into a sane range, junk is rejected', () => {
  assert.equal(fitSetting('breakEveryMinutes', 0), 5);
  assert.equal(fitSetting('breakEveryMinutes', -50), 5);
  assert.equal(fitSetting('breakEveryMinutes', 9999), 180);
  assert.equal(fitSetting('breakEveryMinutes', '25'), 25);
  assert.equal(fitSetting('breakEveryMinutes', NaN), undefined);
  assert.equal(fitSetting('breakEveryMinutes', ''), undefined);
  assert.equal(fitSetting('breakEveryMinutes', null), undefined);
  assert.equal(fitSetting('alignMinutes', 0), 1);
  assert.equal(fitSetting('scanIntervalMinutes', 1), 5);
});

test('the radio track window is two settings, each clamped and neither dropped', () => {
  assert.equal(fitSetting('minTrackSeconds', 20), 20);
  assert.equal(fitSetting('minTrackSeconds', '45'), 45);
  assert.equal(fitSetting('minTrackSeconds', -5), 0);
  assert.equal(fitSetting('minTrackSeconds', 99999), 3600);
  assert.equal(fitSetting('minTrackSeconds', 'x'), undefined);
  assert.equal(fitSetting('maxTrackSeconds', 1200), 1200);
  assert.equal(fitSetting('maxTrackSeconds', 0), 1);
  assert.equal(fitSetting('maxTrackSeconds', 999999), 86400);
  assert.equal(fitSetting('maxTrackSeconds', null), undefined);
});

test('booleans, enums and times are checked', () => {
  assert.equal(fitSetting('adsEnabled', 'false'), false);
  assert.equal(fitSetting('adsEnabled', true), true);
  assert.equal(fitSetting('adsEnabled', 'banana'), undefined);
  assert.equal(fitSetting('streamHeight', 576), 576);
  assert.equal(fitSetting('streamHeight', 999), undefined);
  assert.equal(fitSetting('hwEncoder', 'vaapi'), 'vaapi');
  assert.equal(fitSetting('hwEncoder', 'bogus'), undefined);
  assert.equal(fitSetting('signOffFrom', '03:00'), '03:00');
  assert.equal(fitSetting('signOffFrom', 'junk'), undefined);
});

test('a bad value never reaches the scheduler, even if one was stored earlier', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  setSettings(db, { breakEveryMinutes: 0, adsEnabled: 'true', streamHeight: 999, nonsense: 1 });
  let s = getSettings(db);
  assert.equal(s.breakEveryMinutes, 5);
  assert.equal(s.adsEnabled, true);
  assert.equal(s.streamHeight, 720, 'an invalid value is ignored and the previous setting stays');
  assert.equal('nonsense' in s, false);
  // simulate an old database that already holds garbage
  db.prepare("INSERT INTO settings(key,value) VALUES('alignMinutes','null') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  db.prepare("INSERT INTO settings(key,value) VALUES('breakLengthMinutes','\"abc\"') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  s = getSettings(db);
  assert.equal(s.alignMinutes, 5);
  assert.equal(s.breakLengthMinutes, 3);
});

test('ad-break splitting is always finite (a zero setting used to loop forever)', () => {
  for (const every of [0, -1, NaN, undefined, null, 20, 5, 1000]) {
    const n = breakSegments(2 * 3600, every);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 40, `every=${every} gave ${n}`);
  }
  assert.equal(breakSegments(3600, 20), 3);
});

test('the stream height default comes from the one reader, taken at boot', () => {
  // WBTV_HEIGHT was read a second time here, at import, so a later change to the environment
  // silently outranked the value config.js read at boot. A child process is the only way to change
  // an env var between the two imports; it must still see the boot value.
  const src = new URL('../src/', import.meta.url).href;
  const script = `
    const { DatabaseSync } = await import('node:sqlite');
    process.env.WBTV_HEIGHT = '576';
    await import(${JSON.stringify(`${src}config.js`)});
    process.env.WBTV_HEIGHT = '1080';
    const { getSettings } = await import(${JSON.stringify(`${src}db.js?one-reader`)});
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    console.log(getSettings(db).streamHeight);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '576', 'db.js read WBTV_HEIGHT again instead of using cfg.height');
});
