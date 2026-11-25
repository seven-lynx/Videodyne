# Broadcast

One `Broadcaster` per **watched** channel, shared by every viewer of it, started on the first tune-in
and stopped 25 seconds after the last one leaves. It is not a transcoder you call per request: it is a
continuous 4-second-segment HLS feed written to disk, and the HTTP layer only serves files from it.

## 1. What one broadcaster owns

| State | Value | Why |
|---|---|---|
| `SEG_SECONDS` | 4 | segment length; also the shortest thing a viewer can skip |
| `LEAD` | 10 s | how far ahead of wall clock the encoder runs, so a slow segment does not starve a player |
| `WINDOW` | 6 | segments advertised in the live playlist — a 24 s live edge |
| `streamTime` | seconds produced so far | carried across ffmpeg runs so the channel is one timeline, not one per block |
| `runNo` | 1, 2, 3 … | each block is its own ffmpeg process writing `r<n>_%05d.ts` into the channel's folder |

A new run starts for every block — a content slice, an advert, an ident, an announcement — with
`-output_ts_offset streamTime`, so the segments concatenate into a continuous stream even though each
one was produced by a different process (`broadcaster.js:583-612`). That is the single most important
design decision in the module: it is why an advert can be spliced into a film without re-muxing
anything.

## 2. The common encoder settings

Every run ends with the same HLS arguments (`broadcaster.js:589-591`):

```
-f hls -hls_time 4 -hls_list_size 0 -hls_flags independent_segments
-hls_segment_filename <dir>/r<n>_%05d.ts <dir>/r<n>.m3u8
```

and the same picture pipeline (`encodeArgs`, `broadcaster.js:385-392`):

`yadif` (deinterlace) → `scale` + `pad` to `cfg.width × cfg.height` (aspect preserved, black bars) →
`setsar=1` → `fps=25` → `format=yuv420p`, then the hardware tail when VAAPI is active.

The codec is `videoCodec(4, firstRun ? 'superfast' : cfg.preset)` plus `aac 128k, 48 kHz, stereo`
(`broadcaster.js:390`). The first run of a channel uses `superfast` deliberately: tune-in latency
matters more than the bitrate of the first four seconds.

Input files are read with `-readrate 1 -readrate_initial_burst <n>`: real time, with a burst big enough
to catch up after a slow seek. A URL input (`ms://` resolved, archive.org, a live source) adds
`-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -rw_timeout 15000000`
(`broadcaster.js:419`), so a dropped connection is ridden out instead of failing the segment.

## 3. The five things it can put on air

| Piece | Function | What it looks and sounds like |
|---|---|---|
| content | `runContent` (`:403-426`) | the file, with the preferred audio track selected, subtitles burned in when needed, the channel bug, and a lower-third for a music video |
| a radio track | `runAudio` + `audioVisual` (`:428-476`) | generated background, cover art, now-playing text, a live waveform, and synced lyrics when the track has them |
| an announcement | `runPromo` (`:300-370`) | a clip from inside the next programme at 0.18 volume under the announcer at 0.85, with UP NEXT / AFTER THAT captions in a bar at the bottom |
| a station ident | `runIdent` (`:553-572`) | a solid colour chosen by channel id, the channel number and name, a fade, and a 659 Hz sting |
| closedown | `runSignoff` (`:534-550`) | `pal75bars` with a caption — "has closed down for the night" and when programmes resume — over a quiet 1 kHz tone |
| a failure slate | `runSlate` (`:574-581`) | `smptebars` and a tone: what a viewer sees when there is nothing playable |

The radio picture deserves a note because it is the most complex graph in the codebase
(`audioVisual`, `:428-448`): the audio is split, one branch drives `showwaves` (classic) or `showfreqs`
(bars), a second supplies the background — a blurred, enlarged copy of the cover in `blur` style, or a
flat colour — the waveform is overlaid at the bottom, the cover is overlaid on the left, and four
`drawtext` layers read their text from files. Text lives in files because a caption with an apostrophe
or a comma in it is otherwise a filtergraph injection (`textFile`, `:394-401`).

## 4. Paths, fonts and the colon rule

`filterPath` (`streams.js:130`) turns a Windows path into something ffmpeg's filter parser can read:
forward slashes, and **every colon doubled**, because ffmpeg unescapes the graph and then the option —
a drive letter needs two backslashes to survive both passes. Every filter option that carries a path
goes through it: `subtitles=filename=`, `fontsdir=`, `movie=`, and every `drawtext` `fontfile=` and
`textfile=` (`broadcaster.js:354-355,414-415,446,526,530`). A path without a colon is byte-identical,
so the Linux container is unaffected.

When no font file exists, every `drawtext` layer is skipped rather than failing the run
(`:341,433,528,539,561`) — the programme still plays, it just has no captions or bug.

## 5. The loop that decides what plays

`loop` (`broadcaster.js:208` onward) is one `while (!this.stopped)` cycle: ask the schedule for the
block at `now + LEAD` (`getBlockAt`, `scheduler.js:418-423`), then dispatch on `block.kind`:

| Block kind | Played by |
|---|---|
| `content` | `runContent` (or `runAudio` when the item is a track or talk) |
| `ad` | `runContent` with `in_point` and a duration, no bug text logic beyond the usual |
| `promo` | `runPromo`, using the `promos` row the block points at |
| `ident` | `runIdent`, or the user's own clip when the block carries an `ad_id` |
| `signoff` | `runSignoff` until the block ends |

A hole in the schedule is not a crash: the broadcaster asks the scheduler to extend its own channel
(`ensureChannelSchedule`, `:20`) and, if the hole is immediate, fills it with a ready advert of the
right kind (`pickFiller`, `:372-383`, logged as `schedule hole of Ns filled with ad`). With no advert
available it plays the slate.

`signoff` blocks are the one kind that is not re-evaluated at `LEAD`: the test card runs until the
block's `end`.

## 6. The pause / rewind window

The live playlist *is* the window: `windowSegs = max(6, pauseBufferMinutes × 60 / 4)` segments are
advertised (`broadcaster.js:103-104`), so with the default ten minutes a player can seek back 150
segments — there is no second playlist and no separate buffer to keep in sync. `playlist()`
(`:190-202`) emits the last `windowSegs` entries with `#EXT-X-MEDIA-SEQUENCE`, and a
`#EXT-X-DISCONTINUITY` at each run boundary so a player knows the encoder restarted between blocks.

Files are kept a little longer than they are advertised — `windowSegs + 6` before the oldest is dropped
(`:181`) — which absorbs a player that is a segment behind. A dropped file the OS refuses to unlink is
parked by `createReaper` and retried on the next sync, reported once if it never comes free; stopping
the channel removes the folder entirely, which is the backstop (`:142-154`).

Two different stops, and the difference matters when a stream seems to linger:

- **explicit** — the last viewer calls `POST /live/:id/stop`, `leave()` stops the channel at once
  (`:135-138`);
- **abandoned** — a viewer that simply stops fetching is forgotten after 25 s and the channel then
  stops, but not before it has been alive 25 s (`:127-131`).

So "one encoder per watched channel, stopped 25 seconds after the last viewer leaves" is true for the
abandoned case; an explicit stop is immediate.


## 7. Live channels

An IPTV or YouTube channel has no schedule at all (`loopLive`, `:480-493`): resolve the source
(`openLive`, cached for a few minutes), relay it with `runLive`, and if it produces nothing, play six
seconds of slate and retry. A YouTube live with separate audio and video is mapped as two inputs
(`:496-514`). A live radio stream is given the same generated picture as a radio track, labelled
`LIVE RADIO`.

## 8. When it goes wrong, what you see

| Symptom | Cause | Where to look |
|---|---|---|
| `[chN] ffmpeg: …` with three stderr lines | the encoder rejected something; the last 1500 chars of stderr are kept | `broadcaster.js:597-608` |
| `[chN] failed command: …` | the run produced no segments at all — the full command, key-redacted, is logged so it can be reproduced by hand | `:607` |
| `run N made no segments` in `WBTV_DEBUG` | same, at debug level with the arguments | `:604` |
| a viewer sees bars and a tone | the slate — nothing playable for that block | `runSlate` |
| `schedule hole of Ns filled with ad` | the schedule ran out and an advert covered it | `pickFiller` |
| tune-in timing lines | `WBTV_DEBUG=1` prints schedule, probe, spawn and first-segment timings | `:114` |

Every command and every stderr line passes through `hideKeys` (`:17`) before it is printed: `api_key=`,
Subsonic `t=`/`s=` tokens and `X-Plex-Token` are replaced with `***`. A source URL with a password in it
never reaches a log.

## 9. What the tests cannot tell you

Nothing in `test/` spawns ffmpeg, by design (`test/streams.test.js` tests the *choice* functions, not
the process). So a change to a filtergraph is verified by watching a channel, and the honest evidence
for it is: the channel id, the block kind, and the `[chN]` line or the picture. A filtergraph nobody
watched is a hypothesis — and it fails loudly rather than subtly, because a rejected filter means no
segments at all and the failure is logged with the command.

