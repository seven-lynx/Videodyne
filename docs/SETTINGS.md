# Settings

Everything a user toggles lives in the `settings` table, one row per key, and every read goes through
`getSettings(db)` (`db.js:194-201`). Deploy-time facts are environment variables and are documented in
[ENVIRONMENT.md](ENVIRONMENT.md) — a restart applies those, not a click.

## How a value is stored, validated and read

`fitSetting` (`db.js:175-193`) is the single gate, applied on the way in *and* on the way out:

| Declared type | Accepted | Rejected |
|---|---|---|
| boolean | `true`/`false`, `'true'`/`'false'`, `1`/`0` | anything else — the previous value stays |
| number | finite, coerced; clamped to `RANGES`, or restricted to `ENUMS` when the key has one | `null`, `''`, a boolean, `NaN` |
| string | a member of `ENUMS` when the key has one; `HH:MM` for the two times | anything else |

`setSettings` ignores a value it cannot use rather than writing a default over it (`db.js:202-209`),
and `getSettings` re-fits each stored row, so a hand-edited bad value cannot reach the scheduler. A key
that is not in `DEFAULTS` is not a setting: it is ignored on write and on read.

## The 34 keys

`Accepted` shows the clamp or the enum. `Read by` is the module that acts on the value.

| Setting | Default | Accepted | What it does | Read by |
|---|---|---|---|---|
| `autoDaypart` | `true` | bool | leans the schedule towards what suits the time of day, using genres and age ratings as soft weights | `scheduler.js` |
| `eraAds` | `true` | bool | prefers adverts whose year matches the programme's | `scheduler.js` |
| `radioStyle` | `classic` | `classic` `blur` `bars` | how a radio station looks: waveform, blurred cover backdrop, or frequency bars | `broadcaster.js` |
| `lyrics` | `true` | bool | draws synced lyrics (`.lrc`/`.srt`) or pages plain ones across the song | `broadcaster.js` |
| `language` | `eng` | 12 ISO codes | the audio track preferred, and the subtitle language burned in when that audio is absent | `streams.js` |
| `subtitleMode` | `foreign` | `off` `foreign` `always` | when subtitles are burned into the picture | `streams.js` |
| `channelBug` | `true` | bool | the channel logo or name in the corner | `broadcaster.js` |
| `identsEnabled` | `false` | bool | a station ident before each programme — a generated card, or a clip from an ident library | `scheduler.js` |
| `signOffEnabled` | `false` | bool | closedown: a test card in the window below | `scheduler.js` |
| `signOffFrom` | `03:00` | `HH:MM` | start of the closedown window | `scheduler.js` |
| `signOffTo` | `05:00` | `HH:MM` | end of it | `scheduler.js` |
| `streamHeight` | `cfg.height` (720) | `480` `576` `720` | the encoded height; 576 costs roughly 30 % less CPU | `server.js`, `broadcaster.js` |
| `hwEncoder` | `auto` | `auto` `none` `vaapi` `nvenc` | which encoder to try; a candidate is proven by a real test encode or the CPU is used | `hw.js` via `server.js` |
| `pauseBufferMinutes` | `10` | 0–30 | how far back a viewer may rewind, and how long a pause survives; `0` turns the window off | `broadcaster.js` |
| `autoScan` | `true` | bool | rescan libraries on a timer | `server.js` |
| `scanIntervalMinutes` | `60` | 5–1440 | how often | `server.js` |
| `scanOnStartup` | `true` | bool | one scan 20 s after boot | `server.js` |
| `promosEnabled` | `true` | bool | "coming up next" announcements between programmes | `scheduler.js` |
| `promoVoice` | `alan` | a voice id | which installed Piper voice reads them | `scheduler.js`, `broadcaster.js` |

| `promoCount` | `3` | 1–4 | how many upcoming programmes to mention | `scheduler.js` |
| `promoMaxSeconds` | `60` | 15–120 | the longest an announcement slot may run | `scheduler.js` |
| `promoReadPlots` | `true` | bool | read the description, not just the title | `scheduler.js` |
| `adsEnabled` | `false` | bool | mid-programme ad breaks | `scheduler.js` |
| `alignMinutes` | `5` | 1–60 | the grid programmes start on when ads are on | `scheduler.js` |
| `breakEveryMinutes` | `20` | 5–180 | roughly one break per this much content | `scheduler.js` |
| `breakLengthMinutes` | `3` | 0.5–15 | how long a break is | `scheduler.js` |
| `fillGaps` | `true` | bool | fill the gap up to the next grid line with adverts | `scheduler.js` |
| `minChannelMinutes` | `30` | 0–1000 | how much content a studio or genre needs before it becomes a channel | `channels.js` |
| `minTrackSeconds` | `45` | 0–3600 | radio skips anything shorter | `channels.js` |
| `maxTrackSeconds` | `900` | 1–86400 | and anything longer; the pair is read low-to-high | `channels.js` |
| `tvGenreChannelsForAll` | `false` | bool | give every show a genre channel, not only studio-less ones | `channels.js` |
| `movieStudioChannels` | `true` | bool | one channel per film studio | `channels.js` |
| `movieStudioMinFilms` | `5` | 1–1000 | how many films a studio needs | `channels.js` |
| `movieDecadeChannels` | `true` | bool | one channel per decade | `channels.js` |

## Three rows that are not settings

They live in the same table but are deliberately absent from `DEFAULTS`, so `getSettings` never
returns them and no route can echo them:

| Key | Written by | Why it is not a setting |
|---|---|---|
| `auth` | `auth.js:46-48` | the credential record (salt, hash, API key, cookie secret). Reading it requires the password. |
| `imvdb_key` | `imvdb.js:167` | an API key. `GET /api/settings` never includes it; `/api/imvdb/status` returns only whether it is set. |
| `talk_per_title_<libId>` | `server.js:213` | a per-library flag ("one channel per show/book"), keyed by library id, so it cannot live in a fixed schema. |

## What a change actually does

A stored setting is only half the story — some values are read on the next request, some need the
schedule rebuilt, and one waits for the encoder to restart:

| Change | Takes effect |
|---|---|
| `adsEnabled`, `alignMinutes`, `break*`, `fillGaps`, `promos*`, `identsEnabled`, `signOff*`, `autoDaypart`, `eraAds` | after `rescheduleFuture` — the settings route calls it (`server.js:372-395`) |
| `minChannelMinutes`, `minTrackSeconds`, `maxTrackSeconds`, `tvGenre*`, `movie*` | after `inferChannels` — the channel list and its counts are rebuilt |
| `streamHeight`, `hwEncoder` | the next channel start; a running channel keeps its encoder until the last viewer leaves |
| `language`, `subtitleMode`, `channelBug`, `radioStyle`, `lyrics` | the next *programme* on each channel, because the filtergraph is built per block |
| `pauseBufferMinutes` | the next playlist sync — the buffer is a file window, not something the encoder knows |
| `autoScan`, `scanIntervalMinutes`, `scanOnStartup` | the next minute — the scan ticker re-reads settings every 60 s (`server.js:515-519`) |
| `promoVoice` | the next announcement generated; audio already cached keeps its voice |

