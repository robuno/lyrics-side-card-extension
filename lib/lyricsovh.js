// lyrics.ovh client: backup lyrics source ("source 2"), used when LRCLIB is down.
// Free, no API key, open source (MIT): https://github.com/NTag/lyrics.ovh
// Plain lyrics only (no timestamps). Results look like LRCLIB records so the
// rest of the code can treat both sources the same way.

const API = "https://api.lyrics.ovh/v1";
// It searches other sites behind the scenes, so answers can be slow.
const TIMEOUT_MS = 15000;
const MAX_REQUESTS = 4;

export function cleanOvhLyrics(text) {
  return (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/^Paroles de la chanson .*\n/, "") // header line some answers start with
    .replace(/[ \t]{2,}/g, " ") // some answers have doubled spaces between words
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One artist/title lookup. Returns an LRCLIB-like record or null (404 = not found).
// Network problems, timeouts and server errors throw.
export async function getOvh(artist, title) {
  const url = `${API}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lyrics.ovh HTTP ${res.status}`);
  const plain = cleanOvhLyrics((await res.json()).lyrics);
  if (!plain) return null;
  return {
    id: `ovh:${artist}|${title}`,
    trackName: title,
    artistName: artist,
    albumName: "",
    duration: null,
    instrumental: false,
    plainLyrics: plain,
    syncedLyrics: null,
  };
}

// Tries title/artist candidates (from cleanTrack) in order, at most MAX_REQUESTS calls.
export async function findLyricsOvh({ titleCandidates, artistCandidates }) {
  const pairs = titleCandidates.flatMap((t) => artistCandidates.map((a) => [a, t])).slice(0, MAX_REQUESTS);
  for (const [artist, title] of pairs) {
    const record = await getOvh(artist, title);
    if (record) return record;
  }
  return null;
}
