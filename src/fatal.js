// What the server does when it is the thing that broke (#5).
//
// An uncaught exception means the process no longer knows what state it is in: a `node:sqlite`
// statement applied halfway, a Map written from two async paths, a timer that fires against a
// broadcaster that was never started. The server used to log it and keep serving
// (`src/server.js`, before this module), which is a confident answer from a process that cannot have
// one - the schedule says a channel is on air, ffmpeg is gone, and a viewer debugs a server that is
// already broken. Stopping every channel and exiting says what happened out loud, and lets the
// container's `restart: unless-stopped` (or the desktop supervisor) bring back a process that knows
// nothing is running. Exiting is cheap here because ffmpeg is SIGKILLed synchronously and the live
// folder is wiped at the next boot (`src/server.js` boot section), so a hard exit leaves nothing that
// a restart has to clean up.
//
// A rejection is narrower: the pending operation is dead, but the state it touched is usually not
// shared with anyone else. The codes below are what a client hanging up mid-response produces - a
// viewer closing a tab, a tuner dropping a connection - and they happen in normal operation, so
// ending every other viewer's stream over one is worse than the leak. Everything else, including a
// rejection with no code at all, is treated as fatal: Node's own default for an unhandled rejection
// is to crash, and a server that swallows an unknown one is the defect this module exists for.

const BENIGN_REJECTIONS = new Set([
  'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_PREMATURE_CLOSE',
]);

// A rejection a peer caused by leaving - the one case that is logged and survived.
export function benignRejection(e) {
  const code = e && typeof e === 'object' ? e.code : null;
  return typeof code === 'string' && BENIGN_REJECTIONS.has(code);
}

// Install the two handlers. Every dependency is injected so the policy is testable without a port,
// a child process or a real exit: `stop` is the caller's "stop every broadcaster", and `target` is
// `process` in production and a two-line fake in the test.
export function installFatalHandlers({
  stop, log = console.error, exit = (code) => process.exit(code), target = process,
} = {}) {
  let dying = false;
  const fatal = (what, e) => {
    if (dying) return; // a second failure while unwinding gets no second teardown
    dying = true;
    log(`fatal: ${what} - stopping every channel and exiting so a restart sees a clean process`, e);
    try { stop(); } catch (err) { log(`fatal: a channel refused to stop: ${err?.code || err}`); }
    exit(1);
  };
  target.on('uncaughtException', (e) => fatal('uncaught exception', e));
  target.on('unhandledRejection', (e) => {
    if (benignRejection(e)) { log('unhandled rejection (peer went away, continuing):', e?.code); return; }
    fatal('unhandled rejection', e);
  });
  return { isDying: () => dying };
}
