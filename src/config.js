import path from 'node:path';
const env = process.env;
export const cfg = {
  port: Number(env.PORT || 8080),
  configDir: env.VIDEODYNE_CONFIG || env.WBTV_CONFIG || '/config',
  tmpDir: env.VIDEODYNE_TMP || env.WBTV_TMP || '/tmp/videodyne',
  browseRoots: (env.VIDEODYNE_BROWSE_ROOTS || env.WBTV_BROWSE_ROOTS || '/mnt,/media').split(',').map((s) => path.resolve(s.trim())).filter(Boolean),
  width: Number(env.VIDEODYNE_WIDTH || env.WBTV_WIDTH || 1280),
  height: Number(env.VIDEODYNE_HEIGHT || env.WBTV_HEIGHT || 720),
  crf: Number(env.VIDEODYNE_CRF || env.WBTV_CRF || 23),
  preset: env.VIDEODYNE_PRESET || env.WBTV_PRESET || 'veryfast',
  ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: env.FFPROBE_PATH || 'ffprobe',
  ytdlp: env.YTDLP_PATH || 'yt-dlp',
  piperBin: env.PIPER_BIN || '/opt/piper/piper',
  voiceDir: env.PIPER_VOICES || '/opt/piper/voices',
  fontFile: env.VIDEODYNE_FONT || env.WBTV_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  scanConcurrency: Number(env.VIDEODYNE_SCAN_CONCURRENCY || env.WBTV_SCAN_CONCURRENCY || 24),
};
// The old WBTV_ name is still read behind the new one so an install that has not touched its compose
// file keeps working across the rename; the new name wins when both are set. Kept below the object so
// every `config.js:NN` anchor in the docs keeps pointing at the line it names.
