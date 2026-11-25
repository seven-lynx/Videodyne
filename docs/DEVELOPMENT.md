# Development

Everything here runs from the repository root. Node 22.13+ (24 is what CI and the container use),
`ffmpeg` and `ffprobe` on `PATH`. There is no build step: `src/` and `public/` are served as written.

## 1. Run it locally

```bash
npm ci
PORT=8099 WBTV_CONFIG=./cfg WBTV_TMP=./tmp WBTV_BROWSE_ROOTS=/path/to/media node src/server.js
```

All three of `WBTV_CONFIG`, `WBTV_TMP` and `WBTV_BROWSE_ROOTS` must be set outside a container: their
defaults are container paths (`/config`, `/tmp/wbtv`). `WBTV_FONT` needs pointing at a font that
exists on your platform if you want captions and the channel bug. `WBTV_DEBUG=1` logs tune-in timings.
See [ENVIRONMENT.md](ENVIRONMENT.md) for the full list.

## 2. The test suite

```bash
npm test                        # node --test "test/**/*.test.js"
node --test test/one.test.js    # the file you touched
```

Rules the suite lives by, because they are what makes it runnable anywhere:

- `node:test` + `node:assert/strict`, each test named for the behaviour;
- **no real ffmpeg, no media file, no port binding** — anything that needs those is a manual check,
  and the write-up says which machine and which file;
- `new DatabaseSync(':memory:')` for the database; a fixture builds the tables it needs from `SCHEMA`;
- no assertion on wall-clock time without a tolerance;
- a pure function is the easy thing to test, which is why `promo.js`, `speech.js`, `daypart.js`,
  `streams.js` and `plex.js` keep their decisions in pure functions.

Four tests keep the documents honest, and they will fail the suite if you skip the doc:

| Test | Fails when |
|---|---|
| `test/api-docs.test.js` | a registered route is missing from `docs/API.md`, or vice versa; a library type is undocumented |
| `test/docs-config.test.js` | a `DEFAULTS` key is missing from `docs/SETTINGS.md`, an environment name from `docs/ENVIRONMENT.md`, or `RANGES`/`ENUMS` names a key `DEFAULTS` does not declare |
| `test/docs-index.test.js` | a document is not linked from `docs/README.md`, or a relative link points at nothing |

## 3. Four checklists

**Add a route.** Register it in the module that owns the data (not in `server.js` if it can be a
`register…` function — that is what makes it testable). Add a row to `docs/API.md`; the contract test
then enforces it in both directions. Inside a protected prefix (`/api/`, `/live/`, `/iptv/`, `/auto/`,
`/lineup`, `/discover.json`, `/device.xml`) it inherits the auth gate; outside one, say in
`docs/API.md` why it is deliberately open.

**Add a setting.** `DEFAULTS` in `src/db.js` (and `RANGES`/`ENUMS` if it is bounded or enumerated);
validation in `PUT /api/settings` (`server.js:372-395`) only when `fitSetting` cannot express the rule;
`docs/SETTINGS.md` (enforced by the test); and decide its effect — add it to `scanKeys` if it needs no
re-plan, or to `inferKeys` if it changes which channels exist (`server.js:386-390`).

**Add a library type.** The whitelist in `POST /api/libraries` (`server.js:157`), the dispatch in
`scanLibrary` (`scanner.js:63-67`), the channel inference in `channels.js` (what kind of channel it
becomes), the type list in `docs/API.md` (enforced by the test), and `docs/FEATURES.md`.

**Add a module.** A design note at the top saying *why* it exists (`src/stillcheck.js:1` and
`src/plex.js:1` are the models); `node:` prefixes; named exports only; no I/O at import time (the one
sanctioned exception is `src/config.js`); no top-level `await`; imports acyclic, with `config.js`,
`db.js` and `media.js` as the shared floor; a test file beside the behaviour it adds.

## 4. Style, as the tree actually is

ES modules, two spaces, single quotes, semicolons. Comments explain why; a comment that restates the
line is noise. `catch { /* ignore */ }` is allowed only when the comment says what is being ignored.
Never reformat a file you did not otherwise change. `public/` stays dependency-free vanilla JS — no
framework, no bundler, ever.

## 5. Before you commit

- `npm test` green, and say how many tests.
- The docs that the change invalidates are in the same commit ([API.md](API.md), [SETTINGS.md](SETTINGS.md),
  [ENVIRONMENT.md](ENVIRONMENT.md), [FEATURES.md](FEATURES.md)).
- A wire format is frozen: `x-wbtv-key`, `wbtv_session`, `tvg-id="wbtv.`, `WBTV_*`. Changing one is a
  decision for the maintainer, not a refactor.
- A change that alters behaviour and is not purely cosmetic needs a note in the changelog of the fork
  that carries it ([UPSTREAM.md](UPSTREAM.md) exists so a rebase never loses a fix).
