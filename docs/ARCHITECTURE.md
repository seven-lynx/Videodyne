# Architecture

One Node process, ES modules throughout, no build step, four runtime dependencies (`fastify`,
`@fastify/static`, `fast-xml-parser`, `hls.js`). The server, the web UI and the three clients are each
plain source; nothing is compiled.

## 1. The entry point

`src/server.js` is the only executable. `npm start`, `Dockerfile:40` and the desktop supervisor all
run it, and it does three unremarkable things that shape the codebase:

- it **listens at import time** (`server.js:502`), so no test may import it — which is why
  `guide.js`, `iptvout.js`, `imvdb.js` and `auth.js` export a `register…` function and are given the
  Fastify instance instead of owning it (`guide.js:5-6` explains this in the source);
- it **opens the database at import** (`server.js:35`), so every module below it receives `db` as an
  argument and none of them opens its own;
- it **registers the same four hooks for every route** — the auth gate (`auth.js:70`), CORS for `GET`
  `/api/*` and `/live/*` (`server.js:37-40`), gzip above 1.4 KB (`server.js:43-47`) and a buffer
  parser for logo uploads (`server.js:52`) — so a new route inherits the whole policy by existing.

## 2. The module graph, measured

The arrows below are real imports (`from './x.js'`), not intent. It is acyclic, and it has a floor:
`config.js` imports nothing but `node:path`, `db.js` imports `config.js`, `media.js` imports
`config.js`. Everything else sits above that floor.

```
config.js  ←  db.js  ←  …every stateful module
           ←  media.js ←  every module that spawns ffmpeg/ffprobe
```

| Module | Imports | Imported by |
|---|---|---|
| `config.js` | `node:path` | 18 modules |
| `db.js` | config | broadcaster, channels, mediaserver, navidrome, plex, scanner, scheduler, server |
| `media.js` | config | ads, broadcaster, iptv, lyrics, scanner, streams, tts |
| `nfo.js` | fast-xml-parser | scanner |
| `speech.js` | — | promo, tts |
| `promo.js` | speech | scheduler, tts |
| `daypart.js` | — | scheduler |
| `hw.js` | config | broadcaster, server |
| `logos.js` | config | broadcaster, iptvout, server |
| `streams.js` | config, media, lyrics | broadcaster |
| `lyrics.js` | config, media | broadcaster, streams |
| `tts.js` | config, media, promo, speech | broadcaster, scheduler, server |
| `stillcheck.js` | config | imvdb |
| `archive.js` | — | ads |
| `ads.js` | config, media, archive | server |
| `imvdb.js` | config, stillcheck, `../tools/mvlib.mjs`, `../tools/mvfix.mjs` | server |
| `iptv.js` | config, media | broadcaster, scanner, server |
| `navidrome.js` | config, db | mediaserver, server |
| `plex.js` | config, db | mediaserver, server |
| `mediaserver.js` | config, db, navidrome, plex | broadcaster, scanner, server |
| `scanner.js` | nfo, db, config, media, iptv, mediaserver | channels, server |
| `channels.js` | db, scanner | server |
| `scheduler.js` | db, promo, tts, daypart | broadcaster, iptvout, server |
| `broadcaster.js` | hw, config, media, scheduler, db, logos, tts, lyrics, mediaserver, streams, iptv | server |
| `guide.js` | — (takes `app`) | server |
| `auth.js` | `node:crypto` | server |
| `fatal.js` | — | server |
| `iptvout.js` | config, logos, scheduler | server |
| `server.js` | the other 27 | — (the entry point) |

### Why each module exists

One line each, by symbol rather than by line, so the note cannot go stale when a file grows. This is
the design note the source files do not carry: a comment at the top of a file shifts every line in it,
and the rest of this document cites those lines.

| Module | Why it exists |
|---|---|
| `config.js` | the single import-time read of the environment, so no feature module has to know where it runs |
| `db.js` | `SCHEMA` for a fresh install, `migrate()` for an old one, and the settings gate that fits a value on the way in and out |
| `media.js` | the only probe/`run` wrapper: bounded stderr, a kill timeout, and the retry ladder that stops one offline share costing a library its durations |
| `nfo.js` | a forgiving `.nfo` reader: missing element → empty value, repeated tags → always arrays |
| `scanner.js` | folders and servers into rows, incremental by mtime, and every removal decided by `safeRemovals` |
| `channels.js` | inference keyed by `key`, with the user's name and number in overrides so an edit survives a rescan |
| `scheduler.js` | the only writer of `programmes` and `blocks`; planned ahead, persisted, and stable across a rescan |
| `daypart.js` | two pure functions (classify, weight) so the taste of a schedule is testable without a database |
| `promo.js` | the announcement script, pure, so the wording can be tested |
| `speech.js` | text a person would read aloud: numbers, years, episode codes; `SPEECH_VERSION` bumps the cache |
| `tts.js` | optional Piper, cached by the words it speaks, through one low-priority queue that never holds a tune-in |
| `broadcaster.js` | one encoder per watched channel; a segment timeline assembled from per-block ffmpeg runs |
| `streams.js` | the audio track and subtitle decision, and the escaping that makes a Windows path survive a filtergraph |
| `lyrics.js` | sidecar or tag lyrics, into an `.ass` that libass can draw under the artwork |
| `hw.js` | a GPU encoder is only used after it is proven by a real encode, and the CPU is the fallback |
| `logos.js` | a channel logo is a file in `config/logos`, never a blob in the database |
| `ads.js` | an advert is downloaded once and then local; an archive.org item is only resolved |
| `archive.js` | picks the small h.264 copy of an Internet Archive item, and the ladder that makes it deterministic |
| `stillcheck.js` | "is this a music video or an album cover with audio", asked before a download is kept |
| `imvdb.js` | optional music-video discovery and download, gated on a key, a password and a writable folder |
| `iptv.js` | playlists and live streams as channels, plus the health check that hides the dead ones |
| `iptvout.js` | the output side: M3U, XMLTV and the HDHomeRun handshake |
| `guide.js` | one row mapping shared by `/api/epg` and `/api/channels/:id/now`, in a register function so it can be tested |
| `auth.js` | optional password, session cookie and access key, in one hook rather than in every route |
| `mediaserver.js` | Jellyfin/Emby items as `ms://`, resolved to a URL only when ffmpeg needs it |
| `plex.js` | Plex, whose token travels as a header and whose durations are milliseconds |
| `navidrome.js` | Subsonic music, storing a token and salt rather than a password |
| `server.js` | the only listener; it wires the register functions and starts the timers |

Three consequences worth knowing before adding a module:

- **`db` is passed, never imported twice.** A module that needs storage takes it as its first
  argument; that is what keeps the suite able to run against `new DatabaseSync(':memory:')`.
- **`tools/` is part of the server.** `imvdb.js:11-12` imports `mvlib.mjs` and `mvfix.mjs`, and
  `Dockerfile:29` copies the directory. Deleting `tools/` breaks the image at import, not at runtime.
- **Importing `server.js` is a cycle by definition**, and it binds a port — never do it from a test.

## 3. The six surfaces

A change belongs to one of these, and naming the surface first is what keeps `server.js` from
growing another responsibility.

| Surface | Modules | The outcome it produces |
|---|---|---|
| **Request** | `server.js`, `guide.js`, `auth.js`, `iptvout.js`, `imvdb.js` (routes) | an HTTP answer: JSON, a playlist, an image, a segment |
| **Library** | `scanner.js`, `nfo.js`, `media.js`, `mediaserver.js`, `navidrome.js`, `plex.js`, `iptv.js` | rows in `shows`, `items`, `live_streams` |
| **Channels** | `channels.js`, `logos.js` | rows in `channels` and `channel_items` |
| **Schedule** | `scheduler.js`, `daypart.js`, `promo.js`, `speech.js`, `tts.js` | rows in `programmes`, `blocks`, `promos` |
| **Broadcast** | `broadcaster.js`, `streams.js`, `lyrics.js`, `hw.js`, `ads.js`, `archive.js` | an HLS stream on disk, one per watched channel |
| **Clients** | `public/`, `android/`, `desktop/` | what a viewer sees |

`stillcheck.js` sits beside broadcast but is only used by `imvdb.js`: it answers "is this download a
real video", before anything is scheduled.

## 4. Startup, in order

| Step | Where | What it does |
|---|---|---|
| 1 | `server.js:30` → `db.js:88-108` | moves an older database file to `videodyne.db` and opens or creates it, sets `WAL`, `foreign_keys`, `busy_timeout`, runs `SCHEMA`, then `migrate()` |
| 2 | `server.js:37-52` | Fastify instance, the CORS and gzip `onSend` hooks, the image-body parser |
| 3 | `server.js:45` | `initAuth` — the gate, then the six `/api/auth/*` routes |
| 4 | `server.js:103-486` | the library, channel, schedule, settings, ad, promo and live routes |
| 5 | `server.js:307`, `:488`, `:489` | `registerGuide`, `registerImvdb`, `registerIptvOut` — the modules that own their routes |
| 6 | `server.js:492-493` | static: `public/` at `/`, `hls.js` at `/vendor/` |
| 7 | `server.js:496-497` | creates the tmp dir and **deletes `/tmp/wbtv/live` from the previous run** |
| 8 | `server.js:502` | listens on `0.0.0.0:PORT`; a bind failure is the one fatal error |
| 9 | `server.js:505-509` | `detectHw`, first `ensureSchedule`, resume `processAds`, prune the TTS cache |
| 10 | `server.js:514` | a scan 20 s after boot when `scanOnStartup` is on and a library exists |

The scan itself (`server.js:60-100`) is serialised through a queue: a scan in progress takes new
requests into a set and runs once more when it finishes, which is why pressing Scan twice does not
start two probes of the same file.

## 5. The lifetime of one channel

1. A viewer asks for `/live/:id/index.m3u8` (`server.js:443`). If no `Broadcaster` exists for that
   channel, the request waits 250 ms and then for a cold-start slot — at most
   `MAX_COLD_STARTS = 3` channels may be spinning up at once (`server.js:440-458`), so surfing does
   not start six encoders.
2. `b.touch(viewer)` records the viewer; the request then waits up to 9 s for two segments, or 25 s
   for one (`server.js:462`), touching the viewer while it waits so the idle timer cannot stop the
   encoder that is starting for it.
3. `broadcaster.js` spawns `ffmpeg`, writes 4-second segments (`SEG_SECONDS`) into a per-instance
   folder, keeps 10 seconds buffered ahead of wall clock (`LEAD`) and advertises 6 segments
   (`WINDOW`).
4. Every segment request is `/live/:id/:seg` with a name matched against `^r\d+_\d+\.ts$`
   (`server.js:480`) — a name the channel does not have is a 404, never a path traversal.
5. A viewer leaves by `POST /live/:id/stop` or by the connection closing; the broadcaster's own
   25-second reaper (`broadcaster.js:127-130`) both deletes segments older than 25 s and stops the
   encoder when no viewer has been seen for 25 s.
6. `SIGTERM`/`SIGINT` stops every broadcaster and exits (`server.js:520-522`), so a container restart
   does not leave orphan encoders.

## 6. Timers and background work

| What | Period | Where |
|---|---|---|
| schedule top-up | 10 min | `server.js:507` → `ensureSchedule` |
| auto-scan check | 60 s | `server.js:515-519` |
| TTS cache prune (3 days) | 6 h | `server.js:509` → `tts.js:205` |
| narration/stream pre-warm | 15 s | `broadcaster.js:126` |
| segment + viewer reaper | 25 s | `broadcaster.js:127` |
| live-stream health check | on demand and after a scan | `server.js:81`, `:325` → `iptv.js` |

Every timer is `setInterval` on the event loop, none is `unref`d — that is why the process stays alive
between requests, and why a timer that throws is caught at its own call site rather than at the top.

## 7. Failure containment

The rule is that a broken piece degrades and the channel keeps airing:

- no ffmpeg, a bad file or a failed probe → the test card (`broadcaster.js` shows a generated card);
- no Piper → the announcement is skipped, the programme still plays;
- no GPU → x264 (`hw.js:67`);
- no `yt-dlp` → a download fails with its reason in `ads.error` / `mv_jobs.error`;
- an unhandled rejection from a peer that hung up → logged, and the server keeps serving
  (`fatal.js` names the five codes that count);
- an uncaught exception, or any other unhandled rejection → every channel is stopped, then the process
  exits 1 (`fatal.js`, `server.js` boot) so the container's restart policy — or the desktop
  supervisor — brings back a process that knows nothing is running. Issue #5: the state after an
  uncaught throw is undefined, so continuing to serve from it is the one failure that is silent.

## 8. Where new code belongs

| You are adding | It goes in | Because |
|---|---|---|
| a route over existing tables | the module that owns the data, as a `register…` function | a `register…` function is testable and `server.js` stays a wiring file |
| a scanner for a new source | a new module, called from `scanner.js`, rows written through it | `scanner.js` owns the removal rules for every source |
| a way to choose what airs | `scheduler.js` (weights in `daypart.js`) | the schedule is the only writer of `programmes`/`blocks` |
| a change to the picture or the sound | `broadcaster.js`'s filtergraph, or `streams.js` | one encoder per channel, one place that builds its arguments |
| a new output format | `iptvout.js` or a new `register…` module | outputs read the schedule, they never write it |
| a client feature | the client, plus `docs/API.md` if it needs a new route | the API is the contract |

