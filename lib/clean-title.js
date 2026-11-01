// Title/artist cleanup so LRCLIB can match tracks.
// Pure functions, no browser APIs (tested with Node in tests/).

// Words that mark a bracketed part as noise: "(Official Video)", "[HD]", "(Remastered 2011)"...
// Also live-session markers: "(acoustic)", "(Maida Vale Sessions)", "(BBC Radio 1)".
const NOISE =
  /\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|remaster(ed)?|live|mv|m\/v|explicit|clean|acoustic|acoustique|sessions?|unplugged|bbc|radio|cover|performance)\b/i;

// "(feat. X)", "[ft. X]", "(with X)"
const BRACKET_FEAT = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;

// Unbracketed "Song feat. X"; stops before a " - " so "A ft. B - Song" still splits later.
const INLINE_FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s+[-–—]\s+|$)/i;

// Spotify-style suffixes: "- Remastered 2011", "- 2009 Remaster", "- Live at Wembley", "- Radio Edit"
const DASH_SUFFIX =
  /\s+[-–—]\s+(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|live\b.*|radio edit|single version|album version|(?:mono|stereo)(?:\s+version)?)$/i;

// "Song | Official Video", "Song | Radio X": on YouTube the part after " | " is never the song.
const PIPE_SUFFIX = /\s+\|\s+.*$/;

// Fallback cut for live-session uploads: "505 BBC Radio 1 Live" -> "505".
// Only used if the full title finds nothing ("Video Killed the Radio Star" must survive).
const LIVE_TAIL = /\s+(?:acoustic|acoustique|live|sessions?|unplugged|bbc|radio|performance|cover)\b.*$/i;

// "Artist - Song"
const ARTIST_DASH_SONG = /^(.+?)\s+[-–—]\s+(.+)$/;

const tidy = (s) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s*[-–—|]\s*$/, "")
    .trim();

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const unique = (list) => list.filter((x, i) => x && list.indexOf(x) === i);

// "A, B & C" / "A feat. B" -> ["A", "B", "C"]
export function splitArtists(artist) {
  return (artist || "")
    .split(/\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

// Removes noise from a song title. Featured artists are returned separately.
export function cleanTitle(raw) {
  const feat = [];
  let title = (raw || "").replace(/\s*[([【]([^)\]】]*)[)\]】]/g, (match, inner) => {
    const f = BRACKET_FEAT.exec(inner.trim());
    if (f) {
      feat.push(...splitArtists(f[1]));
      return "";
    }
    return NOISE.test(inner) ? "" : match; // keep e.g. "(Taylor's Version)"
  });

  title = title.replace(INLINE_FEAT, (_, who) => {
    feat.push(...splitArtists(who));
    return "";
  });
  title = title.replace(DASH_SUFFIX, "");
  title = title.replace(PIPE_SUFFIX, "");

  return { title: tidy(title), feat };
}

// Turns YouTube channel names into artist names:
// "AdeleVEVO" -> "Adele", "Adele - Topic" -> "Adele", "Queen Official" -> "Queen".
export function cleanChannel(raw) {
  let name = (raw || "").trim();
  let isChannel = false;
  const strip = (re, fn = () => "") =>
    (name = name.replace(re, (...m) => {
      isChannel = true;
      return fn(...m);
    }));

  strip(/\s*-\s*Topic$/i);
  strip(/\s*VEVO$/);
  if (isChannel && !/\s/.test(name)) name = name.replace(/([a-z])([A-Z])/g, "$1 $2"); // "TaylorSwift"
  strip(/\s+Official(?:\s+(?:YouTube\s+|Artist\s+)?Channel)?$/i);
  return { name: name.trim(), isChannel };
}

// Main entry: raw NOW_PLAYING data -> what we show and what we send to LRCLIB.
// Returns:
//   title, artist         cleaned, for display (artist may list several names)
//   titleCandidates       query order: [title, shorter fallbacks for live/session uploads]
//   primaryArtist         first artist, used as the main query and cache key
//   artistCandidates      query order: [primary, all artists]
//   album, feat
export function cleanTrack({ title = "", artist = "", album = "", source = "other" } = {}) {
  const channel = cleanChannel(artist);
  let artistName = channel.name;
  const cleaned = cleanTitle(title);
  let song = cleaned.title;

  const dash = ARTIST_DASH_SONG.exec(song);
  if (dash) {
    const [, left, right] = dash;
    // "Adele - Hello" while the artist is already "Adele": just drop the prefix.
    // On YouTube (or when the artist was a channel name) trust the title instead.
    if (same(left, artistName) || source === "youtube" || channel.isChannel || !artistName) {
      artistName = left;
      song = right;
    } else if (same(right, artistName)) {
      song = left; // "Song - Artist"
    }
  }

  // Cleaning the right half again catches "Artist - Song - Remastered 2011".
  const again = cleanTitle(song);
  song = again.title;
  const feat = unique([...cleaned.feat, ...again.feat]);

  const all = splitArtists(artistName);
  const primaryArtist = all[0] || artistName;

  // Fallbacks: "Song - FM 94/9" -> "Song", "505 BBC Radio 1 Live" -> "505".
  const beforeDash = tidy(song.split(/\s+[-–—]\s+/)[0]);
  const titleCandidates = unique([song, beforeDash, tidy(beforeDash.replace(LIVE_TAIL, ""))]);

  return {
    title: song,
    titleCandidates,
    artist: tidy(artistName),
    primaryArtist,
    artistCandidates: unique([primaryArtist, tidy(artistName)]),
    album: (album || "").trim(),
    feat,
  };
}
