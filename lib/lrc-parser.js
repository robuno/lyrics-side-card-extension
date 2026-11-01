// Parses LRC ("[mm:ss.xx] text") into [{ t: seconds, text }], sorted by time.
// - A line may carry several timestamps: "[00:10.00][01:20.00] chorus".
// - Metadata lines ([ar:], [ti:], ...) are skipped; [offset:+/-ms] is applied.
// - Empty-text lines are kept (instrumental gaps; the panel shows them as "♪").

const LEADING_TIME = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
const WORD_TIME = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g; // enhanced LRC "<00:01.20>word"

export function parseLrc(lrc) {
  if (!lrc) return [];
  let offset = 0;
  const lines = [];

  for (const raw of lrc.split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) {
      offset = Number(off[1]) / 1000; // positive offset = lyrics appear earlier
      continue;
    }

    const times = [];
    let rest = raw;
    let m;
    while ((m = LEADING_TIME.exec(rest))) {
      times.push(Number(m[1]) * 60 + Number(m[2].replace(":", ".")));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue; // metadata or junk

    const text = rest.replace(WORD_TIME, "").trim();
    for (const t of times) lines.push({ t, text });
  }

  for (const line of lines) line.t = Math.max(0, Math.round((line.t - offset) * 1000) / 1000);
  return lines.sort((a, b) => a.t - b.t);
}
