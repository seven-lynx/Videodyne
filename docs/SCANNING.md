# Scanning

A scan turns a folder or a server into rows in `items`, `shows` and `live_streams`. It never writes to
the media itself: the mount is read-only by design, and nothing in `scanner.js` opens a media file for
writing.

## 1. What one scan does, in order

`runScan` (`server.js:58-100`) runs one library at a time, and only one scan at a time — a second
request is queued and runs afterwards:

1. **Per library**, dispatch to the right scanner (section 2). A library that cannot be read is
   recorded in `scan.error` and skipped; the others still run (`server.js:71`).
2. **Read durations** — `probePending` (`media.js:49-70`) fills in the runtime for every item whose NFO
   had none, four probes at a time, retrying on the ladder 0 / 1 h / 6 h / 24 h.
3. **Rebuild channels** — `inferChannels` runs only if the scan found something new or gone, or if
   there are no channels yet (`server.js:79`). An unchanged library therefore costs nothing.
4. **Sync live channels** and check their health (`server.js:80-81`).
5. **Re-plan only the channels that lost programmes** (`server.js:83-87`) — see
   [SCHEDULE.md](SCHEDULE.md) §8.

`GET /api/scan` reports the same object the progress callbacks write into: `phase`, `library`, `dirs`,
`files`, `changed`, `removed`, `probe`, `started`, `finished`, `error`.

## 2. Which scanner handles which library type

All thirteen types are accepted by `POST /api/libraries` (`server.js:157`); the dispatch is
`scanLibrary` (`scanner.js:63-67`).

| Library type | Scanner | Produces |
|---|---|---|
| `tv` | the video walk, with `tvshow.nfo` per folder | `shows` + `episode` items |
| `movies` | the video walk | `movie` items |
| `music` (music videos) | the video walk | `musicvideo` items |
| `clips` | the video walk, title from the file name | `clip` items |
| `radio` | the audio walk | `track` items |
| `talk_interviews`, `talk_podcasts`, `talk_audiobooks` | the audio walk with `TALK` (`scanner.js:203-207`) | `talk` items |
| `ads`, `ads_tv`, `ads_movies`, `ads_idents` | `scanAdsLibrary` | `ads` rows, `kind` from the library type |
| `iptv` | `syncIptvLibrary` (`iptv.js`) | `live_streams` rows |
| any `ms://…` path | `scanMediaServer` (`mediaserver.js`) | `episode`/`movie`/`track` from a server |

## 3. The video walk

Scans `tv`, `movies`, `music` and `clips` libraries, one directory tree at a time, with
`cfg.scanConcurrency` (24) filesystem operations in flight and inserts batched 400-to-a-transaction.

**What is ignored**: anything not in the video extension set (`scanner.js:11`), and anything that looks
like an extra — `trailer`, `sample`, `featurette`, `behindthescenes`, `deleted`, `interview`, `clip`
in the file name, or a folder named `extras`, `trailers`, `behind the scenes`, `@eaDir`, `#recycle`
(`scanner.js:12-13`).

**Symlinks are not followed.** The walk filters on `dirent.isDirectory()` and `isFile()`
(`scanner.js:168,171,181`), which are false for a symbolic link, so a library made of symlinked folders
or files scans as empty rather than following them. That is a documented limitation, not a bug that
was fixed (issue #35).

**Change detection** is `mtime` + `size` + the NFO's own `mtime` (`scanner.js:128`). A file whose
sidecar NFO changed is re-read even when the video did not, because a changed `tvshow.nfo` alters which
channels exist (`scanner.js:107-109`).

**Where the metadata comes from**, in order: the sidecar `<name>.nfo`, then the folder name, then the
file name. For TV, `tvshow.nfo` is looked for in the episode's folder and, failing that, in its parent
when the folder is named like a season (`scanner.js:169-178`). Season and episode come from the NFO,
or from `S01E02` / `1x02` in the file name (`scanner.js:154-157`).

**Posters** are found by name: for an episode `*-thumb.jpg` then `<base>.jpg`; otherwise `-poster`,
`poster`, `folder`, `<base>`, `cover` with `.jpg/.jpeg/.png/.webp` (`scanner.js:54-61`). A poster is a
path, not a copy.

**After the walk**: vanished files are removed through `safeRemovals` (section 5), shows with no
episodes left are deleted, and `libraries.last_scan` is updated (`scanner.js:188-196`).

## 4. The audio walk

`scanRadio` (`scanner.js:238-312`) reads tags with ffprobe, eight files at a time, and only for new or
changed files.

- **Extensions**: `.mp3 .flac .m4a .aac .ogg .opus .wav .wma .m4b` (`scanner.js:199`).
- **Title**: the tag, else `01 - Artist - Title` parsed from the name, else the cleaned file name.
- **Artist**: `artist`, else `album_artist`, else the leading part of the file name — but a leading
  number is a track number, not an artist, and a library scanned before that rule existed is healed once
  by setting `mtime=0` on the affected rows (`scanner.js:239-245`).
- **Year**: the first tag that yields 1900–2100, else a `[1985] Album` folder name
  (`yearFromTags`, `scanner.js:221-228`). A junk date such as `0001-01-01` is zeroed so it is re-read
  (`scanner.js:246`).
- **Cover art**: `cover/folder/front/album/albumart` + an image extension in the folder; failing that,
  the picture embedded in the file, extracted once per album folder into `config/covers` and shared by
  its tracks (`scanner.js:209-218,282-285`). Tracks scanned before this existed are backfilled at up to
  25 seconds per scan, four folders at a time (`backfillCovers`, `:318-334`).
- **Spoken word**: for `talk_*` libraries the *album* is the show or book, the *artist* is the host or
  author (falling back to the folder names), `disc` and `track` keep chapters in order, `aired` is the
  date from the tags or a `YYYY-MM-DD` file name, and the description becomes the plot
  (`scanner.js:290-301`).

## 5. Removing what vanished — `safeRemovals`

An offline share and an empty folder look exactly like "every file was deleted", and believing it wipes
a library and its schedule. `safeRemovals` (`scanner.js:23-34`) is the guard:

1. Nothing under a folder that could not be listed is ever removed — it is "unknown", not "gone".
2. The scan is **suspicious** when nothing at all was seen, or when more than half of a library of 20+
   files has vanished.
3. A suspicious scan removes **nothing** on its first pass: it records a timestamp in
   `settings.scanguard_<libraryId>` and logs how many files it is holding back. If a second scan within
   6 hours agrees, the removal goes ahead.

This is also why `POST /api/libraries/:id` can re-point a library at another folder safely: the items
are kept, and the next scan reconciles them through the same rule.

## 6. The four server sources

| Source | Stored path | Metadata from | Notes |
|---|---|---|---|
| Jellyfin / Emby | `ms://<sourceId>/<itemId>` | the server's API, mapped onto the same columns as an NFO | one API for both; a Plex music library is refused, a Navidrome one is not |
| Plex | `ms://<sourceId>/<partKey>` | the server's JSON API | durations are milliseconds, the token travels as `X-Plex-Token` |
| Navidrome / Subsonic | `ms://<sourceId>/<songId>` | the server's API | stores a token + salt, never the password; cover art and lyrics come from the server |
| IPTV playlist | a URL in `live_streams` | the playlist itself | not an `items` row at all |

The credential is never written into a path or a row: the `ms://` reference is resolved to a real URL
with the key only at the moment ffmpeg needs it (`mediaserver.js`, `plex.js`, `navidrome.js`), and
`GET /api/sources` never returns a token (`server.js:131`).

Pictures from a server are downloaded a few hundred at a time per scan, so a big library fills in over
several scans rather than blocking the first one.

What is **not** supported today: music from Jellyfin/Emby/Plex, audiobooks from any server, and
subtitles fetched through a server's own subtitle endpoint — embedded subtitles are extracted by
reading the file.

## 7. IPTV libraries

An `iptv` library is a playlist URL, a single HLS stream, a YouTube live link or a playlist file
(`server.js:160-165`). `syncIptvLibrary` writes one `live_streams` row per entry with its
`group-title` as `grp`, its logo and `tvg-id`; `alive` and `checked` are filled by the health check
(`iptv.js`), and only working streams become channels. A large playlist enables the first 80 working
channels by default.

## 8. What a scan never does

- **Write to the media.** No rename, no NFO edit, no artwork beside a file.
- **Delete an item because one scan did not see it.** `safeRemovals` decides.
- **Remove anything when the folder is unreadable.** Unknown is not gone.
- **Block the server.** Filesystem work is pooled, inserts are batched, and the planner yields between
  channels.

