# Upstream divergence

This fork keeps a written record of everything it changes in WBTV, and of what it offered back.
The point is not bookkeeping. A fork is a diff, every line of that diff is a conflict to resolve on
the next update, and a change the original author accepts is a conflict that never happens again.

Two rules make the record worth reading:

- A change that is not in this table is drift. Drift is either an oversight or a bug, and both get
  fixed rather than documented.
- A row is never deleted. When a change lands upstream the row says `merged`, and this fork's copy
  of it disappears on the next rebase.

## The three kinds of change

| Kind | Fate | Lives in |
|---|---|---|
| Identity - name, palette, idents, tuner metadata | never sent upstream | `brand/`, `public/brand.css`, themes |
| A capability this fork adds - packaging, installers, extra clients | never sent upstream, by choice | new files, reached from the author's files by a single line |
| A general improvement - a bug, a slow path, a stale doc | offered upstream, and the debt disappears when it is merged | `src/`, `public/`, `test/`, `docs/` |

Only the third row can shrink, which is why it is the interesting one.

## The ledger

`Upstream` says whether the change belongs in the author's repository at all.
`Status` is one of `candidate` (could be sent), `queued` (a pull request is already open - one at a
time), `drafted` (text ready, not sent), `open`, `merged`, `declined`, or `not-sent` with the
reason beside it.
`Link` names one tracker and never leaves the reader to guess which: a bare `#18` is this fork's
issue, and the author's repository is always written `upstream#4`. A row whose offer was closed
without merging says `declined` and keeps the number, because the change itself stays in the tree -
`c1190be` is the first one (#22, #61).

| Date | Commit | Lane | What | Upstream | Status | Link |
|---|---|---|---|---|---|---|
| 2026-11-22 | `c1190be` | upstream | Untrack `tools/__pycache__/*.pyc` and add the ignore rule | yes | declined | upstream#3 (the author closed the pull request unmerged on 2026-11-26, so the ignore rule stays a fork change until `tools/` is offered again with something he wants) |
| 2026-11-22 | - | upstream | Hardware-encoder results from a real GPU, for the open help-wanted issue | yes | candidate | upstream#1 |
| 2026-11-22 | `99487f8` | upstream | Test the migration path: an old-shaped database gains every column `migrate()` adds, and the old `libraries` CHECK is rebuilt | yes | candidate | #18 |
| 2026-11-23 | `0468867` | upstream | Test the access gate: the 401 challenge, the three ways an API key is presented, the signed cookie and its expiry, and that deleting the password opens the app again | yes | candidate | #17 |
| 2026-11-23 | `5fbc835` | upstream | Build the three columns that lived only in `migrate()` into `SCHEMA`, so a fresh database is correct without it; the ALTERs stay as the upgrade path | yes | candidate | #2 |
| 2026-11-23 | `e473a8b` | upstream | Read the stream height once: the settings default comes from `cfg.height` instead of a second `process.env` read, so a documented knob cannot be outranked at import | yes | candidate | #11 |
| 2026-11-23 | `80a0511` | upstream | Bind the channel and library ids in the two statements that built them into SQL text - a channel list inside `IN (...)` and a library id after `library_id=` - and drop a filter that is not a number instead of writing `NaN` into it | yes | candidate | #12 |
| 2026-11-23 | `fb6cadf` | upstream | Treat only SQLite's unique violation on `ads.source` as a duplicate while scanning an ads library, so a failing insert reaches the scan result instead of being dropped as if the advert were already there | yes | candidate | #6 |
| 2026-11-23 | `454b31e` | upstream | Give the still-check's `ffprobe` the kill timer the sampler already had and clear both timers when their child closes, so a probe wedged on a network file rejects instead of holding the download worker for ever | yes | candidate | #7 |
| 2026-11-23 | `41dc6f8` | upstream | Stamp the failed-login counter, halve it for every quiet minute and cap the wait at 3 s, so a mistyped password no longer slows every later login for ever; the throttle takes an injected clock and the route an injected sleep, so the decay is tested without waiting | yes | candidate | #4 |
| 2026-11-23 | `b13a421` | upstream | Ask the XMLTV guide for the horizon the scheduler actually plans (14 h) instead of 36, so an IPTV player's grid stops ending a third of the way through the document and the guide is not two and a half times the size it can fill | yes | candidate | #9 |
| 2026-11-23 | `c732bfb` | upstream | Answer "what is on now" with the guide's own programme object: both guide routes select one joined row and map it through one function, so a client renders the on-now answer with the code it already has for the guide, and a music programme's track list comes back on both | yes | candidate | #8 |
| 2026-11-23 | `a5e6976` | upstream | Keep the media server's two id namespaces apart when downloading art: the download list says series or item and the prefix picks the table, instead of membership in a set of series ids, and only an id the server uses for both gains its namespace in the file name, so the covers already in the config folder keep theirs | yes | candidate | #16 |
| 2026-11-23 | - | fork | Plex as a media source, archive.org ads streamed from archive.org instead of downloaded, and `X-Plex-Token` redaction in log lines | no | not-sent: it edits the fork's own `/api/sources` section in `docs/API.md` and lands beside the fork's `createReaper` constants in `broadcaster.js`, so the patch does not apply to pristine `main` (`git apply --check` in `../wb-pristine` fails on both). A portable version is a later piece of work, not a reworded commit | - |
| 2026-11-23 | `5fd06db` | upstream | Retry a file `ffprobe` could not read instead of writing it off for ever: the failure counter and the time of the last attempt become `items` columns in `SCHEMA` and in `migrate()`, the wait between tries grows from an hour to six to a day, the fourth failure is logged once with the path, and a failed probe stops zeroing the duration an NFO had supplied | yes | candidate | #1 |
| 2026-11-23 | `fc06095` | upstream | Bound the album walk for a Subsonic server that ignores an empty search, which can only be read one album at a time: 200 albums (or 20,000 songs) per pass, the album offset kept in a bookkeeping row so the next scan or a restarted process continues where it stopped, the albums and songs reported through the scan's progress as they are read, and one line each when the fallback is taken and when the cap is reached; a pass that read a slice of the view no longer prunes, because one slice cannot tell a deleted album from an unwalked one | yes | candidate | #14 |
| 2026-11-23 | `0b6543f` | upstream | Escape the colon in every path a filter option carries: ffmpeg unescapes the graph and then the option, so a Windows drive letter needs two backslashes, and burned-in subtitles, the channel logo, the radio lyrics and every drawtext font and caption path now survive a config folder under a drive letter; a path without a colon is byte-identical, and the defect is invisible on a Linux install, so the row offers it to nobody | no | not-sent | #3 |
| 2026-11-23 | `72296c0` | upstream | Park a live segment the OS refuses to unlink and retry it on the next playlist sync instead of dropping the error the fs.rm callback threw away, so a file a viewer still holds stops accumulating in the live folder for the life of the channel; a file that never comes free is reported once, the retry list is capped, and stopping the channel no longer lets a still-held file throw out of its removal timer; Windows-only, because Linux unlinks a file that is still open | no | not-sent | #15 |
| 2026-11-23 | `c5e3147` | upstream | Publish the routes and library types the API doc was missing and keep the document honest with a test: twenty-five routes (music videos, Jellyfin / Emby / Navidrome sources, channel logos and deletion, the promo preview, the HLS segment fetch, the HDHomeRun XML pair) and five library types join the contract, the channel kinds gain `clips`, and `test/api-docs.test.js` reads every registered route out of `src/*.js` and asserts the set equals the documented one in both directions; a row that names a bare path documents a GET, because the Tuner table cannot carry a method until this file's two unsent fixes land, which is also why the new rows sit in sections of their own | yes | drafted | #13 |
| 2026-11-23 | `744c4ae` | upstream | Turn the radio track window into two settings instead of a literal `BETWEEN 45 AND 900`: `minTrackSeconds` (45) and `maxTrackSeconds` (900) join `DEFAULTS` and `RANGES`, so a station no longer silently drops a 40-second song or a 20-minute track with nothing explaining why; the pair is bound in the one query that filters the pool, listed in `inferKeys` so a change rebuilds the stations instead of leaving their item counts stale, and read low-to-high because `fitSetting` validates one key at a time and cannot refuse a crossed pair; the defaults air exactly what aired before. The two Settings fields are this fork's own copy of `public/app.js` and ride in no patch | yes | candidate | #10 |

| 2026-11-24 | - | fork | Rename every `WBTV` reference to the fork's own name on all surfaces it owns: `x-videodyne-key` issued with `x-wbtv-key` still accepted, `videodyne_session` with the old cookie honoured, `tvg-id="videodyne.<id>"`, `VIDEODYNE_*` env knobs with the `WBTV_*` names still read, `/tmp/videodyne`, `videodyne.db` renamed on first boot with a fallback, the Android package, the Tizen widget, the desktop identity, the Docker image name and the four `WBTV` channel catch-alls | no | not-sent: a name is the author's. Ruling 9 (`PLAN.md` §6, 2026-11-24) accepts the costs - installed APKs are not upgraded in place, every tuner client must re-add its source, and `auth.js`, `iptvout.js`, `config.js` and `db.js` diverge from upstream permanently, so a later PR touching one of them has to be reconstructed rather than rebased | - |

| 2026-11-25 | - | fork | Drop the Samsung (Tizen) TV client: `tizen/` deleted (nine files), its section out of `README.md` and `docs/FEATURES.md`, its rows out of `docs/CLIENTS.md`, the TizenBrew block out of `package.json` and its line out of `.dockerignore`; the `Access-Control-Allow-Origin: *` header stays, with its reason restated for an IPTV or web player rather than for one client | no | not-sent: the client exists in the author's tree, so removing it is a fork decision and the directory is simply absent here. The row above already records the widget's rename; this one records its removal | - |

| 2026-11-25 | `9cd344b` | upstream | Settle `motionOf` once: a spawn that fails emits `error` and then `close`, so the close handler used to start a sample for a child that never ran - spawning `ffmpeg` and arming a second 60 s kill timer after the call had already rejected, which wasted a child on an install with a wrong `FFMPEG_PATH` and left an orphan timer holding the event loop; a `failed` flag on the probe and a `settled` flag in `sample()` close that path, and a test counts the timers a failed spawn arms. The patch sits on `454b31e`, which is still a candidate, so it is reconstructed against pristine `main` together with that row instead of applying on its own; landed in `dev` as `9cd344b`, the squash of this change and its ledger row (PR #56) | yes | candidate | #55 |
| 2026-11-27 | - | upstream | Ask the author, as an issue with no patch, for the two seams a branch-free rebrand needs: one `STATION` constant in `src/brand.js` defaulting to today's strings (`src/iptvout.js:44,66,72`, `src/server.js:576`, `public/index.html:6`, and the three catch-all channel names at `src/channels.js:202,212,227`), and one version source, because the manifests that describe the same release already disagree at `6f9747b` - `package.json:3` is `0.9.3` against `android/app/build.gradle.kts:18-19` at `0.9.1` / versionCode `12`; the issue promises byte-identical output at the defaults, leaves the four wire literals alone, and asks whether either pull request would be welcome at all | yes | open | upstream#4 |

## How a row is added

1. The lane trailer in the commit is the claim: `brand`, `fork` or `upstream`.
2. A commit claimed as `upstream` gets its row here in that same commit, with a `Status`.
3. `Status: open`, `merged` or `declined` carries the issue or pull request number.
4. A change that is offered and declined stays in the tree, and its row says so. That is a fork
   change now, not drift.

## What this fork will not send

- A look, a name or a wordmark. The author's screenshots and his users' tuner names are his.
- A wire format: `x-wbtv-key`, `wbtv_session`, `tvg-id="wbtv.` and the `WBTV_` environment prefix.
- The Docker image, its publishing workflow, or its namespace.
- A change that only exists because of something else in this fork.
