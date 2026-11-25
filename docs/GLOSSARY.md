# Glossary

Terms that mean something specific here, with the file that decides them.

| Term | Meaning | Where |
|---|---|---|
| **library** | a scan root: a folder, an IPTV playlist, or one view of a media server. One of 13 types | `server.js:157`, `scanner.js:63-67` |
| **item** | one playable file: `episode`, `movie`, `track`, `musicvideo`, `clip`, `talk` | `db.js:28-37` |
| **show** | a series as its `tvshow.nfo` describes it; episodes hang off it | `db.js:23-27` |
| **channel** | a station: `tv`, `movie`, `music`, `radio`, `clips`, `live`, `talk`. Inferred, never created by hand | `channels.js:inferChannels` |
| **channel group** (`grp`) | a name that merges several libraries into one channel, and a chip in the guide | `libraries.channel_group`, `group_mode` |
| **programme** | one entry in the guide: a start, an end, an item | `db.js:63-67` |
| **block** | one playable piece inside a programme. A programme is usually several blocks | `db.js:68-74` |
| **segment** | a 4-second HLS file written by ffmpeg; what a player actually fetches | `broadcaster.js` `SEG_SECONDS` |
| **run** | one ffmpeg process, one block; `r<n>_<seg>.ts` is its output | `broadcaster.js:583-612` |
| **reel** | an advert longer than 10 minutes — a recorded ad break, entered at a random offset | `scheduler.js:81` `REEL` |
| **ident** | a short station identity clip before a programme: generated, or one of yours | `scheduler.js:107`, `broadcaster.js:553` |
| **promo** | the "coming up next" announcement: a script, then a Piper recording | `promo.js`, `tts.js` |
| **closedown / sign-off** | the overnight test card | `scheduler.js:120-132` |
| **horizon** | how far ahead the schedule exists: 14 hours | `scheduler.js:14` |
| **dayparting** | leaning the schedule towards what suits the hour, by genre and age rating | `daypart.js` |
| **era ad** | an advert whose year matches the programme's | `daypart.js:guessAdYear` |
| **`ms://` path** | an item that lives on a media server: `ms://<sourceId>/<ref>`, resolved only at play time | `mediaserver.js`, `plex.js`, `navidrome.js` |
| **probe** | an `ffprobe` call that learns a file's duration and tracks; `probed` records whether it worked | `media.js:17-27` |
| **safe removal** | an item is only deleted when two scans agree, and never under an unreadable folder | `scanner.js:23-34` |
| **tuner** | this server pretending to be an HDHomeRun, so Plex/Jellyfin/Emby/Channels can add it | `iptvout.js:64-108` |
| **access key** | the token an app or IPTV player sends instead of logging in | `auth.js:60` |
| **slim** | the guide answer with empty fields removed, used by the TV apps | `guide.js:13-21` |
| **inferred / single / both** | how a library becomes channels: by genre and studio, one channel for its group, or both | `libraries.group_mode` |
