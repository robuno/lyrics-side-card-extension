import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, cleanChannel, cleanTrack, splitArtists } from "../lib/clean-title.js";

// [input, expected { title, primaryArtist, artistCandidates? , feat? }]
const cases = [
  [
    { title: "Rick Astley - Never Gonna Give You Up (Official Music Video)", artist: "Rick Astley", source: "youtube" },
    { title: "Never Gonna Give You Up", primaryArtist: "Rick Astley" },
  ],
  [
    { title: "Adele - Hello (Official Music Video)", artist: "AdeleVEVO", source: "youtube" },
    { title: "Hello", primaryArtist: "Adele" },
  ],
  [
    { title: "Shake It Off", artist: "TaylorSwiftVEVO", source: "youtube" },
    { title: "Shake It Off", primaryArtist: "Taylor Swift" },
  ],
  [
    { title: "Bohemian Rhapsody (Remastered 2011)", artist: "Queen - Topic", source: "youtube" },
    { title: "Bohemian Rhapsody", primaryArtist: "Queen" },
  ],
  [
    { title: "Queen – Don't Stop Me Now [HD]", artist: "Queen Official", source: "youtube" },
    { title: "Don't Stop Me Now", primaryArtist: "Queen" },
  ],
  [
    { title: "Here Comes The Sun - Remastered 2009", artist: "The Beatles", source: "spotify" },
    { title: "Here Comes The Sun", primaryArtist: "The Beatles" },
  ],
  [
    { title: "Wonderwall - Remastered", artist: "Oasis", source: "spotify" },
    { title: "Wonderwall", primaryArtist: "Oasis" },
  ],
  [
    { title: "Hotel California - Live On MTV, 1994", artist: "Eagles", source: "spotify" },
    { title: "Hotel California", primaryArtist: "Eagles" },
  ],
  [
    { title: "Stay (with Justin Bieber)", artist: "The Kid LAROI, Justin Bieber", source: "spotify" },
    { title: "Stay", primaryArtist: "The Kid LAROI", artistCandidates: ["The Kid LAROI", "The Kid LAROI, Justin Bieber"], feat: ["Justin Bieber"] },
  ],
  [
    { title: "Señorita", artist: "Shawn Mendes & Camila Cabello", source: "ytmusic" },
    { title: "Señorita", primaryArtist: "Shawn Mendes", artistCandidates: ["Shawn Mendes", "Shawn Mendes & Camila Cabello"] },
  ],
  [
    { title: "Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars", artist: "Mark Ronson", source: "youtube" },
    { title: "Uptown Funk", primaryArtist: "Mark Ronson", feat: ["Bruno Mars"] },
  ],
  [
    { title: "Eminem ft. Rihanna - Love The Way You Lie", artist: "EminemVEVO", source: "youtube" },
    { title: "Love The Way You Lie", primaryArtist: "Eminem", feat: ["Rihanna"] },
  ],
  [
    { title: "Billie Eilish - bad guy (Lyrics)", artist: "7clouds", source: "youtube" },
    { title: "bad guy", primaryArtist: "Billie Eilish" },
  ],
  [
    { title: "The Weeknd - Blinding Lights (Official Audio)", artist: "The Weeknd", source: "youtube" },
    { title: "Blinding Lights", primaryArtist: "The Weeknd" },
  ],
  [
    { title: "Love Story (Taylor's Version)", artist: "Taylor Swift", source: "spotify" },
    { title: "Love Story (Taylor's Version)", primaryArtist: "Taylor Swift" },
  ],
  [
    { title: "(I Can't Get No) Satisfaction - Mono Version", artist: "The Rolling Stones", source: "spotify" },
    { title: "(I Can't Get No) Satisfaction", primaryArtist: "The Rolling Stones" },
  ],
  [
    { title: "Numb [Official Music Video] - Linkin Park", artist: "Linkin Park", source: "ytmusic" },
    { title: "Numb", primaryArtist: "Linkin Park" },
  ],
  [
    { title: "Levitating (feat. DaBaby)", artist: "Dua Lipa", source: "spotify" },
    { title: "Levitating", primaryArtist: "Dua Lipa", feat: ["DaBaby"] },
  ],
  [
    { title: "Smells Like Teen Spirit | Official Video", artist: "Nirvana", source: "youtube" },
    { title: "Smells Like Teen Spirit", primaryArtist: "Nirvana" },
  ],
  [
    { title: "Hello", artist: "Adele", source: "ytmusic" },
    { title: "Hello", primaryArtist: "Adele", artistCandidates: ["Adele"] },
  ],
];

for (const [input, expected] of cases) {
  test(`cleanTrack: ${input.title} / ${input.artist}`, () => {
    const out = cleanTrack(input);
    assert.equal(out.title, expected.title);
    assert.equal(out.primaryArtist, expected.primaryArtist);
    if (expected.artistCandidates) assert.deepEqual(out.artistCandidates, expected.artistCandidates);
    if (expected.feat) assert.deepEqual(out.feat, expected.feat);
  });
}

test("cleanTitle keeps non-noise brackets and collects feat", () => {
  assert.deepEqual(cleanTitle("Old Town Road (Remix) [feat. Billy Ray Cyrus]"), {
    title: "Old Town Road (Remix)",
    feat: ["Billy Ray Cyrus"],
  });
});

test("cleanChannel", () => {
  assert.deepEqual(cleanChannel("Adele - Topic"), { name: "Adele", isChannel: true });
  assert.deepEqual(cleanChannel("ImagineDragonsVEVO"), { name: "Imagine Dragons", isChannel: true });
  assert.deepEqual(cleanChannel("ADELEVEVO"), { name: "ADELE", isChannel: true });
  assert.deepEqual(cleanChannel("Coldplay"), { name: "Coldplay", isChannel: false });
});

test("splitArtists", () => {
  assert.deepEqual(splitArtists("A, B & C"), ["A", "B", "C"]);
  assert.deepEqual(splitArtists("Calvin Harris feat. Rihanna"), ["Calvin Harris", "Rihanna"]);
  assert.deepEqual(splitArtists(""), []);
});

// Live/session uploads: the venue text stays out of the title, and a short
// fallback title is offered for the LRCLIB lookup.
const liveCases = [
  ["Arctic Monkeys - Do I Wanna Know? Acoustic LIVE | Radio X", "Do I Wanna Know?"],
  ["Arctic Monkeys - Why'd You Only Call Me When You're High (acoustic) - FM 94/9", "Why'd You Only Call Me When You're High"],
  ["Arctic Monkeys - 505 BBC Radio 1 Live (Maida Vale Sessions)", "505"],
  ["Arctic Monkeys - Snap Out of It (acoustic) - FM 94/9", "Snap Out of It"],
  ["Arctic Monkeys - I Wanna Be Yours - Session Acoustique OÜI FM", "I Wanna Be Yours"],
];

for (const [title, song] of liveCases) {
  test(`live upload: ${title}`, () => {
    const out = cleanTrack({ title, artist: "Radio X", source: "youtube" });
    assert.equal(out.primaryArtist, "Arctic Monkeys");
    assert.ok(out.titleCandidates.includes(song), JSON.stringify(out.titleCandidates));
  });
}

test("real titles containing live-ish words are tried in full first", () => {
  const out = cleanTrack({ title: "The Buggles - Video Killed The Radio Star (Official Video)", artist: "The Buggles" });
  assert.equal(out.titleCandidates[0], "Video Killed The Radio Star");
  assert.equal(cleanTrack({ title: "Live Forever", artist: "Oasis" }).titleCandidates[0], "Live Forever");
});
