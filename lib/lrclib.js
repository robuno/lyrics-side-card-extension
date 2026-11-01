// LRCLIB API client (https://lrclib.net/docs). Free, no API key.
// findLyrics() returns an LRCLIB record ({ plainLyrics, syncedLyrics, instrumental, ... })
// or null when nothing was found. Network/server problems throw, so the caller
// can tell "error" apart from "not_found".

const API = "https://lrclib.net/api";
// LRCLIB asks clients to identify themselves.
const HEADERS = { "Lrclib-Client": "LyricsSidePanel/0.1 (personal Chrome extension)" };

// Only accept loose "q" search hits this close to the real duration (seconds).
const LOOSE_MAX_DIFF = 10;

// "Server busy" / rate-limit answers are usually gone a moment later.
const RETRY_STATUS = [429, 503];
const RETRY_DELAY_MS = 1500;

async function request(path, params, retries = 1) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: HEADERS });
  if (RETRY_STATUS.includes(res.status) && retries > 0) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return request(path, params, retries - 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${path} HTTP ${res.status}`);
  return res.json();
}

const hasLyrics = (r) => Boolean(r && (r.instrumental || r.syncedLyrics || r.plainLyrics));

// Best search result: within ±3 s first, then ones with synced lyrics, then closest duration.
export function pickBest(results, duration, maxDiff = Infinity) {
  const scored = (results || [])
    .filter(hasLyrics)
    .map((r) => ({ r, diff: duration ? Math.abs((r.duration || 0) - duration) : 0 }))
    .filter((c) => c.diff <= maxDiff);
  scored.sort(
    (a, b) => (a.diff > 3) - (b.diff > 3) || !a.r.syncedLyrics - !b.r.syncedLyrics || a.diff - b.diff,
  );
  return scored.length ? scored[0].r : null;
}

// track: { titleCandidates: [title, fallbacks...], artistCandidates: [primary, all...], album, duration }
// (a plain `title` works too). Exact lookups for every title/artist pair run
// before any fuzzy search, so a fallback title never beats an exact match.
export async function findLyrics({ title, titleCandidates = [title], artistCandidates, album, duration }) {
  const d = duration ? Math.round(duration) : null;
  const [primary] = artistCandidates;
  [title] = titleCandidates;

  // 1. Exact match with album and duration.
  if (album || d) {
    const params = { track_name: title, artist_name: primary };
    if (album) params.album_name = album;
    if (d) params.duration = d;
    const r = await request("get", params);
    if (hasLyrics(r)) return r;
  }

  // 2. Exact match on title + artist only.
  for (const t of titleCandidates) {
    for (const artist of artistCandidates) {
      const r = await request("get", { track_name: t, artist_name: artist });
      if (hasLyrics(r)) return r;
    }
  }

  // 3. Field search, closest duration wins.
  for (const t of titleCandidates) {
    for (const artist of artistCandidates) {
      const r = pickBest(await request("search", { track_name: t, artist_name: artist }), d);
      if (r) return r;
    }
  }

  // 4. Free-text search as a last resort; stricter on duration.
  return pickBest(await request("search", { q: `${primary} ${title}` }), d, d ? LOOSE_MAX_DIFF : Infinity);
}

// Manual search from the panel: field search first, free text if that finds nothing.
export async function searchLyrics({ title = "", artist = "" }) {
  title = title.trim();
  artist = artist.trim();
  if (!title && !artist) return [];
  let list = title && artist ? await request("search", { track_name: title, artist_name: artist }) : null;
  if (!list || !list.length) list = await request("search", { q: `${artist} ${title}`.trim() });
  return (list || []).filter(hasLyrics).slice(0, 20);
}

// One record by LRCLIB id (null if gone).
export function getById(id) {
  return request(`get/${encodeURIComponent(id)}`, {});
}
