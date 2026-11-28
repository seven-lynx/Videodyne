# Videodyne HTTP API

Everything the web UI and the Android TV app do goes through this API, so you can script Videodyne or build your own client. All JSON unless noted. The base URL is your server, e.g. `http://192.168.1.110:8420`.

## Authentication

Off by default. When you set a password (Setup > Settings > Security) every endpoint below except `/healthz` and `/api/auth/*` needs one of:

- the session cookie from `POST /api/auth/login` — `videodyne_session` (browsers), or
- the **access key**, sent as `Authorization: Bearer <key>`, `x-videodyne-key: <key>`, or `?key=<key>` (apps, scripts, IPTV players).

The pre-rename spellings `wbtv_session` and `x-wbtv-key` are still accepted, so a browser or an app built
before the rename is not locked out; only the new names are issued.

A missing or wrong credential returns `401 {"error":"login required"}`.

## Good to know

- JSON answers over about 1.4 KB are gzipped for clients that send `Accept-Encoding: gzip` (the guide shrinks about 20 times). Browsers, Android and most HTTP libraries do this on their own.
- `GET` requests to `/api/*` and `/live/*` carry `Access-Control-Allow-Origin: *`, so a page served from another origin can read the guide and streams. Nothing that changes data is opened up.

| Method & path | Notes |
|---|---|
| `GET /healthz` | Always open. `{ok:true}` |
| `GET /api/auth/status` | `{enabled, authed}` |
| `POST /api/auth/login` | `{password}` sets the session cookie |
| `POST /api/auth/logout` | clears the cookie |
| `POST /api/auth/password` | `{password}` (4+ chars) turns the password on or changes it; returns `{key}` |
| `DELETE /api/auth` | turns the password off |
| `GET /api/auth/key` / `POST /api/auth/key` | read / regenerate the access key |

## Guide and channels

| Method & path | Notes |
|---|---|
| `GET /api/channels` | Enabled channels: `id, key, kind, name, number, enabled, item_count`. `kind` is `tv`, `movie`, `music`, `radio`, `clips` or `live`. `?all=1` includes disabled ones |
| `PATCH /api/channels/:id` | `{name?, number?, enabled?}`. A `number` another channel already holds is refused with `409` and `{ error, channel }`, and the other channel keeps its number |
| `POST /api/channels/rebuild` | Re-infer channels and re-plan |
| `GET /api/epg?from=&to=` | Unix seconds. `{now, from, to, programmes: {channelId: [{id, item, start, end, title, subtitle, plot, season, episode, year, genres, ...}]}}` |
| `GET /api/channels/:id/now` | `{now, programme}`: `programme` is the object `/api/epg` lists for that channel at that instant (title, subtitle, plot, genres and the rest), or `null` when nothing is scheduled — a live channel has no programme row, so it answers `null` too |
| `GET /api/items/:id` | Full metadata for a programme's item |
| `GET /api/art/:id` | Poster / cover image |

## Watching

| Method & path | Notes |
|---|---|
| `GET /live/:channelId/index.m3u8?v=<viewerId>` | The channel's live HLS stream. Pass a random `v` per viewer and `POST /live/:id/stop?v=` when done so the server can stop encoding. Includes the pause/rewind window |
| `GET /auto/v<number>` | The same channel as a plain MPEG-TS stream (no re-encode), used by the HDHomeRun emulation |
| `GET /live/:id/:seg` | One segment of the stream above (`r<session>_<n>.ts`), as `index.m3u8` lists them. Players fetch these directly; a name the channel does not have is a `404` |

## Libraries, scanning, live sources

| Method & path | Notes |
|---|---|
| `GET /api/libraries`, `POST /api/libraries`, `PATCH /api/libraries/:id`, `DELETE /api/libraries/:id` | `{path, type, name?}`; `PATCH` takes `{name?, path?, group?, groupMode?, perTitle?}` — rename or re-point a library (the next scan sorts out what moved), give it a channel group, or split a spoken-word library one channel per show / book (`perTitle`). Types: `tv`, `movies`, `music`, `clips`, `radio`, `talk_interviews`, `talk_podcasts`, `talk_audiobooks`, `iptv`, `ads`, `ads_tv`, `ads_movies`, `ads_idents`. `iptv` takes a URL or a file |
| `GET /api/scan`, `POST /api/scan` | Status / start (`{libraryId?}`) |
| `GET /api/browse?path=` | Folder browser for the setup UI |
| `GET /api/live/presets`, `GET /api/live/summary`, `POST /api/live/recheck`, `POST /api/live/:lib/enable` | IPTV / YouTube-live sources |
| `GET /api/sources`, `POST /api/sources`, `POST /api/sources/discover`, `DELETE /api/sources/:id` | Jellyfin, Emby, Plex and Navidrome servers. `POST` `{url, token, userId}` (Jellyfin / Emby), `{kind:'plex', url, token}` (Plex — the token is the `X-Plex-Token` from any media URL) or `{kind:'navidrome', url, username, password}` connects and stores one; `/api/sources/discover` answers the same without storing it. Plex offers film and TV sections only, as `views` of type `movies` / `tv`. The list never includes a token, and `DELETE` takes that server's libraries with it |

## Managing channels

| Method & path | Notes |
|---|---|
| `GET /api/channels/:id/logo` | The channel's logo image; `404` when it has none |
| `PUT /api/channels/:id/logo` | Upload one: a PNG, JPEG or WebP body, max 2 MB |
| `DELETE /api/channels/:id/logo` | Drop the logo and go back to the generated card |
| `DELETE /api/channels/:id` | Delete a channel — only an **empty** one, and never a live channel, which would be rebuilt by the next re-plan |
| `DELETE /api/channels` | Delete every empty channel; answers `{removed}` |

## Settings and ads

| Method & path | Notes |
|---|---|
| `GET /api/settings`, `PUT /api/settings` | Partial update, e.g. `{adsEnabled:true}`. Credentials are never included |
| `GET /api/status` | What the server is doing now: version, uptime, memory, CPU load, running channels with viewer counts, voice-over queue. Useful when something feels slow |
| `GET /api/hw` | Which video encoder is active (`software`, `vaapi`, `nvenc`) and why |
| `GET /api/ads`, `POST /api/ads`, `DELETE /api/ads/:id` | Ad URLs (`POST {urls, kind}`) |
| `GET /api/promo/status`, `GET /api/promo/sample?voice=` | "Coming up next" voices |
| `POST /api/promo/voices/:id/install` | Download an extra announcer voice into `/config/voices`; answers `{started}` and finishes in the background |
| `GET /api/channels/:id/promos` | What the announcer says next on a channel: up to eight `{start, end, segments: [{label, text}]}` |

## Music videos (IMVDb)

Needs an IMVDb app key (Settings > Music videos) and a music-video library the server can write to.
`/api/imvdb/status` says which of the two is missing, and the rest answer `400` with that reason until
both are there.

| Method & path | Notes |
|---|---|
| `GET /api/imvdb/status` | `{keySet, authEnabled, library, ready, problems}` |
| `PUT /api/imvdb/key` | `{key}` — needs a password on the server first, because the key is a credential |
| `GET /api/imvdb/artists?q=` | Artists already in your library, filtered |
| `GET /api/imvdb/search?q=` | Search IMVDb for artists and videos to download |
| `GET /api/imvdb/entity/:id?artist=` | One entity's videos, each marked `have` (already in the library) and `job` (its download state) |
| `GET /api/imvdb/jobs`, `POST /api/imvdb/jobs`, `DELETE /api/imvdb/jobs` | The download queue, newest first, capped at 300 rows. `POST` `{artist, videos: [{id, title, year}]}` queues up to 300; `DELETE` clears what is done, failed or cancelled and answers `{removed}` |
| `POST /api/imvdb/jobs/:id/retry`, `POST /api/imvdb/jobs/:id/cancel` | `{force?}` re-queues a failed or cancelled download and keeps it even if it looked like a still image or a lyric upload; `cancel` drops a queued one |

## HDHomeRun XML

The paths under Tuner / IPTV output below cover what a client discovers; these two are the XML
spellings it may ask for.

| Method & path | Notes |
|---|---|
| `GET /lineup.xml` | The lineup as XML: `GuideNumber`, `GuideName`, `URL` |
| `POST /lineup.post` | The lineup's save call: answers `{ok:true}` and changes nothing |

## Tuner / IPTV output

| Path | Use |
|---|---|
| `/iptv/playlist.m3u` | M3U playlist for any IPTV player |
| `/iptv/epg.xml` | XMLTV guide — one hour of history plus exactly the horizon the scheduler plans (14 hours), so it never runs past the schedule |
| `/discover.json`, `/lineup.json`, `/lineup_status.json`, `/device.xml` | HDHomeRun emulation for Plex, Jellyfin, Emby and Channels |

When a password is set, URLs shown in Setup > Settings > Security already include `?key=`.

**A tuner and a password do not mix yet.** The four HDHomeRun paths above sit behind the access gate,
and a client has no way to present a key during discovery, so Plex, Jellyfin, Emby and Channels report
the device as offline while a password is set. Either turn the password off, or point the client at a
reachable URL and wait for the pairing fix (issue #33). The M3U and XMLTV paths do work with a password,
because their URLs can carry `?key=`.
