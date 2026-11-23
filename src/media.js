import { spawn } from 'node:child_process';
import { cfg } from './config.js';

export function run(cmd, args, { timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = timeout ? setTimeout(() => p.kill('SIGKILL'), timeout) : null;
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', (e) => { if (t) clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code, out, err }); });
  });
}

/** -> { duration, hasAudio } or null when the file is unreadable */
export async function probe(file) {
  const r = await run(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name:stream_tags=language,title:stream_disposition=default,forced', '-of', 'json', file], { timeout: 30000 });
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.out);
    const duration = parseFloat(j.format?.duration);
    const st = j.streams || [];
    const pick = (type, withCodec) => st.filter((s) => s.codec_type === type).map((s) => ({ lang: s.tags?.language || '', title: s.tags?.title || '', default: !!s.disposition?.default, forced: !!s.disposition?.forced, ...(withCodec ? { codec: s.codec_name } : {}) }));
    return { duration: Number.isFinite(duration) ? duration : 0, size: Number(j.format?.size) || 0, hasAudio: st.some((s) => s.codec_type === 'audio'), hasVideo: st.some((s) => s.codec_type === 'video'), audio: pick('audio'), subs: pick('subtitle', true) };
  } catch { return null; }
}

/** Audio file -> { duration, tags:{title,artist,album,genre,date} } (tag keys lower-cased) */
export async function probeTags(file) {
  const r = await run(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', file], { timeout: 30000 });
  if (r.code !== 0) return null;
  try {
    const f = JSON.parse(r.out).format || {};
    const tags = {};
    for (const [k, v] of Object.entries(f.tags || {})) tags[k.toLowerCase()] = String(v);
    const duration = parseFloat(f.duration);
    return { duration: Number.isFinite(duration) ? duration : 0, tags };
  } catch { return null; }
}

// A failed probe is retried, not written off: an unmounted share or a file still being copied is the
// common case, and the old permanent `probed=2` never came back because nothing looked at it again.
// Seconds to wait since the previous attempt, indexed by the number of failures already recorded;
// past the last entry the file is given up and logged once.
const RETRY = [0, 3600, 21600, 86400];

/** Background fill-in of durations for items whose NFO had no durationinseconds. */
export async function probePending(db, onProgress, { now = Date.now, probe: probeFn = probe, log = console.error } = {}) {
  const at = Math.floor(now() / 1000); // seconds, the unit `probe_checked` is stored in
  const rows = db.prepare('SELECT id,path,probed,probe_attempts,probe_checked FROM items WHERE probed IN (0,2)').all()
    // never probed is always due; a failure waits its backoff, and a file already given up is not selected
    .filter((r) => r.probed === 0 || (r.probe_attempts < RETRY.length && (r.probe_checked == null || at - r.probe_checked >= RETRY[r.probe_attempts])));
  let i = 0, done = 0;
  const ok = db.prepare('UPDATE items SET runtime=?, probed=1, probe_attempts=0, probe_checked=? WHERE id=?');
  const bad = db.prepare('UPDATE items SET probed=2, probe_attempts=probe_attempts+1, probe_checked=? WHERE id=?');
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < rows.length) {
      const r = rows[i++];
      const p = await probeFn(r.path);
      if (p && p.duration > 0) ok.run(p.duration, at, r.id);
      else {
        // the runtime is left as it was: a duration from the NFO is a claim, and 0 would read as "measured, and empty"
        bad.run(at, r.id);
        if (r.probe_attempts + 1 >= RETRY.length) log(`probe: giving up on "${r.path}" after ${RETRY.length - 1} retries, ffprobe cannot read it`);
      }
      onProgress?.(++done, rows.length);
    }
  }));
}
