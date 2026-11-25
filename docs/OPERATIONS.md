# Operations

How to find out what the server is doing, and what to do when a channel misbehaves.

## 1. Three ways to ask "is it alive"

| Route | Answers |
|---|---|
| `GET /healthz` | `{ok:true}` — always open, and deliberately shallow: it does not touch the database, so it proves the process is listening, nothing more. The container health check uses it (`Dockerfile:39`). |
| `GET /api/status` | the real answer (below) |
| `GET /api/scan` | `phase`, `library`, `dirs`, `files`, `changed`, `removed`, `probe`, `started`, `finished`, `error`, `autoScan`, `nextAuto` |

`/api/status` (`server.js:358-371`) returns:

| Field | Means |
|---|---|
| `version` | `package.json` version |
| `uptimeSeconds`, `memoryMB` | RSS, not heap — what the container limit sees |
| `load`, `cpus` | OS load average; on Windows `load` is always `[0,0,0]` |
| `streamHeight`, `encoder` | the height in use and which encoder was proven active |
| `scanning` | the current scan phase, or null |
| `speechQueue` | pending announcement jobs (`tts.js` limiter) |
| `broadcasters[]` | `channel`, `name`, `viewers`, `segments`, `ageSeconds` per running encoder |

A channel that is **not** in `broadcasters` is not being encoded: nobody is watching it. That is the
single most useful distinction when someone reports "the channel is broken but the guide is fine".

## 2. Logs

Everything is on stdout/stderr; Fastify itself logs at `warn` (`server.js:36`), so the useful lines are
the module's own:

| Prefix | From |
|---|---|
| `[chN] …` | the broadcaster for channel N — ffmpeg stderr, tune-in timing, holes |
| `[scan] …` | a scan, including the "is the share offline?" warning |
| `[libraries] …` | adding, re-pointing and removing a library |
| `[plan] channel N could not be planned` | one channel's scheduling failed; the rest continue |
| `scan of "X" failed` | a whole library was unreadable |

`WBTV_DEBUG=1` adds a tune-in timing line for every channel, and a line per ffmpeg run.

Nothing redacts itself: `hideKeys` (`broadcaster.js:17`) must be applied to anything derived from a
source URL, and the modules that log a path already do.

## 3. Symptom → cause → action

| The viewer sees | Most likely cause | Where to look |
|---|---|---|
| a channel 404s on a segment | the encoder stopped between the playlist and the fetch — usually the last viewer left | `broadcasters` in `/api/status`; `[chN] ffmpeg:` lines |
| a still frame, no movement | the source file is an image with audio, or the filtergraph dropped it | `[chN] ffmpeg:` stderr |
| bars and a tone | the slate: nothing playable for that block, or the schedule ran out with no advert to fill it | `schedule hole of Ns filled with ad`, `/api/epg` for that hour |
| an empty guide | no channel has `item_count > 0`, or nothing has a runtime yet | `GET /api/channels?all=1`, then `GET /api/scan` for a stuck probe |
| the guide stops a few hours out | the schedule could not advance | `[plan] channel N could not be planned` |
| a tuner or Plex says the device is offline | auth is on and discovery is behind the gate | issue #33; `docs/API.md` §Tuner |
| a channel vanished from an IPTV playlist | its number was taken by another channel | issue #32; `GET /api/channels?all=1` |
| every library looks empty after a mount blip | `safeRemovals` is holding the removal back — this is the guard working | `[scan] "X": N of M known files look gone` |
| a library scans to zero files | the folder is not under `WBTV_BROWSE_ROOTS`, or it is built from symlinks | issue #35; `GET /api/libraries` |
| playback is fine, announcements are not | no Piper, no voice, or the voice is not installed | `GET /api/promo/status` |

## 4. Backup and restore

Everything that matters is in the config volume: `wbtv.db`, `covers/`, `ads/`, `logos/`, `voices/`,
`tts/`. Copy the directory with the container stopped, or copy `wbtv.db` **with** its `-wal` and
`-shm` files while it runs — a lone `.db` taken during a write can be a database missing its last
transaction.

Restoring is dropping the directory back and starting the server: `SCHEMA` and `migrate()` run on
open, so an older database is upgraded in place.

## 5. Upgrading

Pull the image and restart. There is no migration step to run by hand, and
`node --disable-warning=ExperimentalWarning` hides the `node:sqlite` experimental notice rather than
disabling anything.

## 6. The three things that use disk

| Path | Size is driven by | Trimmed by |
|---|---|---|
| `/tmp/wbtv` (tmpfs) | live segments, roughly 1 MB/s per watched channel at 720p | the broadcaster, 25 s after the last viewer |
| `<config>/covers` | one image per poster/album | nothing — 300 downloads per scan is the ingest cap |
| `<config>/tts` | one audio file per announcement | `pruneCache`, older than 3 days, every 6 h |

## 7. What to put in a bug report

`/api/status`, the `[chN]` lines around the time it happened, the channel number, whether it is one
channel or all of them, and whether `WBTV_DEBUG=1` was set. A screenshot of the picture is worth more
than a description of it.
