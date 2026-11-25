// Internet Archive items as ads, streamed straight from archive.org instead of downloaded.
// An ad is normally fetched once by yt-dlp into /config/ads; an archive.org item is already a plain MP4 behind a stable
// URL, so resolving it once (metadata) is enough and nothing is written to disk. The file is picked with the same ladder
// the archive's own viewers use: the small h.264 derivative, not the 300 MB MPEG2 master.
//
// Only metadata is read here, never a media byte: the duration comes from the item's own `length`, which the scheduler
// needs to fit an ad into a break before it plays.
const METADATA = 'https://archive.org/metadata/';

/** h.264 IA, then h.264, then the 512 Kb MPEG4, then any MPEG4 — smallest playable copy first, never the master. */
const LADDER = ['h.264 ia', 'h.264', '512kb mpeg4', 'mpeg4'];

/** `https://archive.org/details/<id>` or `/download/<id>/<file>` -> { identifier, file } | null */
export function parseArchiveUrl(url) {
  const m = /^https?:\/\/(?:www\.)?archive\.org\/(details|download)\/([^/?#]+)(?:\/([^?#]+))?/i.exec(String(url || '').trim());
  if (!m) return null;
  let file = null;
  try { file = m[3] ? decodeURIComponent(m[3]) : null; } catch { file = m[3] || null; }
  return { identifier: decodeURIComponent(m[2]), file };
}

/** The playable file for an item, or null when it has none. */
export function pickVideoFile(files) {
  const list = (files || []).filter((f) => f && typeof f.name === 'string' && /\.mp4$/i.test(f.name));
  for (const want of LADDER) {
    const hit = list.find((f) => String(f.format || '').trim().toLowerCase() === want);
    if (hit) return hit;
  }
  return list.find((f) => String(f.format || '').toLowerCase() !== 'hires mpeg4') || null; // any plain MP4 beats nothing
}

/** "602.23" | "10:01" | "1:02:03" -> seconds; anything unreadable is 0, which the caller treats as "unknown". */
export function secondsOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0));
}

export const downloadUrl = (identifier, name) =>
  `https://archive.org/download/${encodeURIComponent(identifier)}/${String(name).split('/').map(encodeURIComponent).join('/')}`;

const yearOf = (meta) => {
  const y = Number(String(meta?.year || '').trim());
  if (Number.isFinite(y) && y > 1800) return y;
  const d = /^(\d{4})/.exec(String(meta?.date || ''));
  return d ? Number(d[1]) : null;
};

/**
 * What is needed to play and schedule one item: { url, seconds, title, year }.
 * The year is folded into the title, which is how the scheduler already dates an ad (daypart.js guessAdYear reads the
 * title), so a 1950s ad lands in a 1950s break without a new column.
 */
export async function resolveItem(identifier, { prefer = null, doFetch = fetch } = {}) {
  const id = String(identifier || '').trim();
  if (!id) throw new Error('no archive.org identifier');
  const r = await doFetch(`${METADATA}${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(20000) });
  if (r.status === 404) throw new Error('archive.org has no item by that name');
  if (!r.ok) throw new Error(`archive.org answered ${r.status}`);
  const j = await r.json();
  if (!j || j.is_dark === true) throw new Error('that archive.org item is not available');
  const named = prefer ? (j.files || []).find((f) => f.name === prefer) : null;
  const file = named || pickVideoFile(j.files);
  if (!file) throw new Error('that archive.org item has no playable MP4');
  const seconds = secondsOf(file.length);
  if (!(seconds > 0)) throw new Error('that archive.org item does not say how long it is'); // the scheduler could not place it
  const year = yearOf(j.metadata);
  const title = String(j.metadata?.title || id).replace(/\s+/g, ' ').trim().slice(0, 180);
  return { url: downloadUrl(id, file.name), seconds, title: year ? `${title} (${year})` : title, year };
}
