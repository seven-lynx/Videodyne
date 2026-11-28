import test from 'node:test';
import assert from 'node:assert/strict';
import { benignRejection, installFatalHandlers } from '../src/fatal.js';

// The policy under test is "what does the server do when this fires", so the harness is a listener
// registry, a log and an exit code - no real process, no port, no child. `events` keeps the order,
// because stopping every channel *before* exiting is the whole point: an exit that runs first leaves
// an ffmpeg per channel behind.
function harness({ throwOnStop = false } = {}) {
  const listeners = new Map();
  const events = [];
  let stops = 0;
  const handle = installFatalHandlers({
    stop: () => {
      if (throwOnStop) throw Object.assign(new Error('kill failed'), { code: 'EPERM' });
      stops++;
      events.push('stop');
    },
    log: (...a) => events.push(`log:${a.map((x) => (x && x.message) || String(x)).join(' ')}`),
    exit: (code) => events.push(`exit:${code}`),
    target: { on: (name, fn) => listeners.set(name, fn) },
  });
  return { fire: (name, value) => listeners.get(name)(value), events, handle, stops: () => stops };
}

test('an uncaught exception stops every channel and then exits 1', () => {
  const h = harness();
  h.fire('uncaughtException', new Error('boom'));
  assert.deepEqual(h.events.filter((e) => e === 'stop' || e.startsWith('exit:')), ['stop', 'exit:1'],
    'the channels stop first, so no ffmpeg outlives the process');
  assert.match(h.events[0], /^log:fatal: uncaught exception/);
  assert.equal(h.handle.isDying(), true, 'the process knows it is on its way out');
});

test('a rejection a peer caused by leaving is logged and the server keeps serving', () => {
  for (const code of ['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_PREMATURE_CLOSE']) {
    const h = harness();
    h.fire('unhandledRejection', Object.assign(new Error('client went away'), { code }));
    assert.equal(h.stops(), 0, `${code} must not stop a channel another viewer is watching`);
    assert.deepEqual(h.events.filter((e) => e.startsWith('exit:')), [], `${code} is not fatal`);
    assert.match(h.events[0], /^log:unhandled rejection \(peer went away, continuing\)/);
  }
});

test('an unrecognised rejection is as fatal as an exception, code or no code', () => {
  const coded = harness();
  coded.fire('unhandledRejection', Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }));
  assert.deepEqual(coded.events.filter((e) => e === 'stop' || e.startsWith('exit:')), ['stop', 'exit:1']);

  const bare = harness();
  bare.fire('unhandledRejection', 'not even an error');
  assert.deepEqual(bare.events.filter((e) => e === 'stop' || e.startsWith('exit:')), ['stop', 'exit:1'],
    'a rejection with no code is the case the old log-and-continue handler hid');
});

test('a second failure while unwinding gets no second teardown', () => {
  const h = harness();
  h.fire('uncaughtException', new Error('first'));
  h.fire('uncaughtException', new Error('second'));
  assert.equal(h.stops(), 1, 'the teardown ran once');
  assert.deepEqual(h.events.filter((e) => e.startsWith('exit:')), ['exit:1'], 'and exited once');
});

test('a channel that throws on stop does not keep the process alive', () => {
  const h = harness({ throwOnStop: true });
  h.fire('uncaughtException', new Error('boom'));
  assert.deepEqual(h.events.filter((e) => e.startsWith('exit:')), ['exit:1'],
    'a failing teardown is reported, not swallowed, and still exits');
  assert.ok(h.events.some((e) => e.includes('refused to stop') && e.includes('EPERM')));
});

test('benignRejection reads a code and nothing else', () => {
  assert.equal(benignRejection(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(benignRejection(Object.assign(new Error('x'), { code: 'EPIPE' })), true);
  assert.equal(benignRejection(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), false, 'a refused connection was never opened, so it is a defect to find');
  assert.equal(benignRejection(new Error('x')), false);
  assert.equal(benignRejection('x'), false);
  assert.equal(benignRejection(null), false);
  assert.equal(benignRejection({ code: 42 }), false, 'a non-string code is not a known one');
});
