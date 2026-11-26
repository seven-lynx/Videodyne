# Environment

Deploy-time facts, read once at start-up (`src/config.js:1-19`) or in the one place that needs them
(`hw.js`, `imvdb.js`, `broadcaster.js`). A change here needs a restart; everything a user toggles is in
[SETTINGS.md](SETTINGS.md).

## The variables

Nineteen names are read by the server. `Where` is the line that reads it — the four outside
`config.js` are deliberate exceptions, and a fifth read anywhere else is a defect.

| Variable | Default | Where | What it does |
|---|---|---|---|
| `PORT` | `8080` | `config.js:4` | the only listening port |
| `VIDEODYNE_CONFIG` | `/config` | `config.js:5` | database, covers, downloaded ads, logos, TTS cache, installed voices |
| `VIDEODYNE_TMP` | `/tmp/videodyne` | `config.js:6` | live HLS segments; wiped at boot (`server.js:497`) |
| `VIDEODYNE_BROWSE_ROOTS` | `/mnt,/media` | `config.js:7` | comma-separated roots the folder browser and library paths are confined to |
| `VIDEODYNE_WIDTH` | `1280` | `config.js:8` | encoded width |
| `VIDEODYNE_HEIGHT` | `720` | `config.js:9` | encoded height, and the default for the `streamHeight` setting |
| `VIDEODYNE_CRF` | `23` | `config.js:10` | x264 quality; lower is better and bigger |
| `VIDEODYNE_PRESET` | `veryfast` | `config.js:11` | x264 preset |
| `FFMPEG_PATH` | `ffmpeg` | `config.js:12` | the encoder binary |
| `FFPROBE_PATH` | `ffprobe` | `config.js:13` | the probe binary |
| `YTDLP_PATH` | `yt-dlp` | `config.js:14` | downloads for ads and music videos |
| `PIPER_BIN` | `/opt/piper/piper` | `config.js:15` | the speech engine |
| `PIPER_VOICES` | `/opt/piper/voices` | `config.js:16` | the built-in voices; extra ones install to `<config>/voices` |
| `VIDEODYNE_FONT` | `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` | `config.js:17` | the font `drawtext` and the subtitles use |
| `VIDEODYNE_SCAN_CONCURRENCY` | `24` | `config.js:18` | how many files are stat-ed/probed at once during a scan |
| `VIDEODYNE_DEBUG` | off | `broadcaster.js:114,140` | logs every tune-in with its timing breakdown |
| `VIDEODYNE_HWACCEL` | unset | `hw.js:56` | **overrides** the `hwEncoder` setting for the process |
| `VIDEODYNE_VAAPI_DEVICE` | `/dev/dri/renderD128` | `hw.js:7` | the render node VAAPI uses |
| `IMVDB_BASE` | `https://imvdb.com/api/v1` | `imvdb.js:15` | the metadata host; set it only to point at a mirror |

Every `VIDEODYNE_*` name is also read under its pre-rename spelling — `WBTV_CONFIG`, `WBTV_TMP`,
`WBTV_BROWSE_ROOTS`, `WBTV_WIDTH`, `WBTV_HEIGHT`, `WBTV_CRF`, `WBTV_PRESET`, `WBTV_FONT`,
`WBTV_SCAN_CONCURRENCY`, `WBTV_DEBUG`, `WBTV_HWACCEL`, `WBTV_VAAPI_DEVICE` — behind the new one, so a
compose file or a script that still carries the old name behaves identically. The new name wins when
both are set. `PORT`, the three binaries and `IMVDB_BASE` never had the prefix and are unchanged.

`TZ` is not read by the code — it is the process timezone, and the guide, dayparting and closedown all
use local time. `NODE_ENV=production` is set in the image and changes nothing in `src/`.

Two of these are traps worth knowing:

- **`VIDEODYNE_HEIGHT` is not a live knob.** It seeds `streamHeight` (`db.js:142`), which is then fitted to
  `480 | 576 | 720`. `VIDEODYNE_HEIGHT=1080` silently becomes 720. 1080p is not supported today.
- **`VIDEODYNE_HWACCEL` beats the setting.** `hw.js:56` reads it over the value `server.js:505` passes, so a
  container left with `VIDEODYNE_HWACCEL=none` will ignore a user who selects VAAPI in the UI.

## The container

| Fact | Value | Where |
|---|---|---|
| base image | `node:24-trixie-slim` | `Dockerfile:1` |
| system packages | `ffmpeg`, `ca-certificates`, `curl`, `fonts-dejavu-core`, `mesa-va-drivers`, `vainfo` (+ Intel drivers on amd64) | `Dockerfile:6-8` |
| downloaded at build | `yt-dlp` (arch-specific), Piper 2023.11.14-2, two British voices (`alan`, `jenny_dioco`) | `Dockerfile:9-22` |
| shipped code | `package.json`, `package-lock.json`, `src/`, `public/`, `tools/` | `Dockerfile:25-29` |
| runtime env | `NODE_ENV=production`, `PORT`, `VIDEODYNE_CONFIG=/config`, `VIDEODYNE_TMP=/tmp/videodyne`, `VIDEODYNE_BROWSE_ROOTS=/mnt,/media,/data` | `Dockerfile:31-35` |
| volume | `/config` | `Dockerfile:37` |
| health | `GET /healthz` every 30 s, 5 s timeout, 60 s grace, 5 retries | `Dockerfile:39` |
| command | `node --disable-warning=ExperimentalWarning src/server.js` | `Dockerfile:40` |

The compose file publishes **8420 → 8080**, mounts `./config` and the media read-only, and gives
`/tmp/videodyne` a 2 GB tmpfs (`docker-compose.yml:7-23`). The tmpfs size is the pause/rewind ceiling: a
720p stream at this bitrate costs roughly 1 MB/s per watched channel, so 2 GB is hours of buffer across
several channels, not a limit anyone reaches.

## Hardware encoding

`detectHw` proves a candidate with a real two-second test encode and falls back to x264 (`hw.js:31-67`).
For VAAPI pass the device through:

```yaml
devices:
  - /dev/dri:/dev/dri
```

NVENC needs the NVIDIA container runtime and `nvidia-smi` visible inside the container; the image
ships no NVIDIA driver. `GET /api/hw` reports which encoder is active and why.

## Optional binaries, and what happens without them

| Missing | Consequence |
|---|---|
| `yt-dlp` | IMVDb downloads and non-archive ad downloads fail with a message in `ads.error` / `mv_jobs.error`; channels are unaffected |
| Piper or a voice | announcements are skipped, the programme plays |
| `ffmpeg` | nothing plays — the test card is also produced by ffmpeg, so this is fatal in practice |
| a GPU | x264 |
| a font file | captions, the channel bug's text fallback and the ident card lose their text |

## Exposure

The server binds `0.0.0.0` (`server.js:502`) and has no TLS. It is a LAN service: put it behind a
reverse proxy for HTTPS, and see [API.md](API.md#authentication) for what a password protects. The one
cross-origin exception is `Access-Control-Allow-Origin: *` on `GET /api/*` and `GET /live/*`
(`server.js:37-40`), so a page served from another origin can read the guide and the streams. It is
GET-only: nothing that changes data is opened up.

## Running it on a workstation

`npm start` with `VIDEODYNE_CONFIG` and `VIDEODYNE_TMP` pointed at writable folders, and `VIDEODYNE_BROWSE_ROOTS`
pointed at the media. The defaults are container paths (`/config`, `/tmp/videodyne`), so on Windows or macOS
all three must be set or the server will try to create `C:\config`. `ffmpeg`/`ffprobe` must be on
`PATH`, and the font must be set to an existing file — the DejaVu path in the default is Linux-only.
