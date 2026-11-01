import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { findLyrics, pickBest, searchLyrics } from "../lib/lrclib.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

// Fake fetch: `handler(url)` returns [status, body]. Records requested URLs.
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    const [status, body] = handler(new URL(url));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return calls;
}

const rec = (duration, synced = true) => ({
  duration,
  instrumental: false,
  plainLyrics: "x",
  syncedLyrics: synced ? "[00:01.00] x" : null,
});

test("pickBest prefers within ±3 s, then synced, then closest", () => {
  const a = rec(200, false);
  const b = rec(202, true);
  const c = rec(199.5, false);
  assert.equal(pickBest([a, b, c], 200), b); // synced within 3 s beats closer plain
  assert.equal(pickBest([rec(260), c], 200), c);
  assert.equal(pickBest([rec(260)], 200, 10), null);
  assert.equal(pickBest([{ duration: 200, instrumental: false, plainLyrics: null, syncedLyrics: null }], 200), null);
});

test("first request is /get with album and duration", async () => {
  const calls = mockFetch(() => [200, rec(295)]);
  const r = await findLyrics({ title: "Hello", artistCandidates: ["Adele"], album: "25", duration: 295.4 });
  assert.ok(r);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/get");
  assert.equal(calls[0].searchParams.get("album_name"), "25");
  assert.equal(calls[0].searchParams.get("duration"), "295");
});

test("falls back: get -> get without album -> search -> q search", async () => {
  const calls = mockFetch((url) => (url.searchParams.has("q") ? [200, [rec(180)]] : url.pathname.endsWith("/search") ? [200, []] : [404, {}]));
  const r = await findLyrics({ title: "Song", artistCandidates: ["A", "A & B"], album: "X", duration: 182 });
  assert.ok(r);
  assert.deepEqual(
    calls.map((u) => `${u.pathname} ${[...u.searchParams.keys()].join(",")}`),
    [
      "/api/get track_name,artist_name,album_name,duration",
      "/api/get track_name,artist_name",
      "/api/get track_name,artist_name",
      "/api/search track_name,artist_name",
      "/api/search track_name,artist_name",
      "/api/search q",
    ],
  );
  assert.equal(calls[2].searchParams.get("artist_name"), "A & B");
});

test("returns null when nothing matches", async () => {
  mockFetch((url) => (url.pathname.endsWith("/search") ? [200, []] : [404, {}]));
  assert.equal(await findLyrics({ title: "Nope", artistCandidates: ["Nobody"], album: "", duration: null }), null);
});

test("retries once when the server is busy (503)", async () => {
  let n = 0;
  mockFetch(() => (n++ === 0 ? [503, {}] : [200, rec(100)]));
  assert.ok(await findLyrics({ title: "a", artistCandidates: ["b"], album: "", duration: 100 }));
  assert.equal(n, 2);
});

test("server errors and network errors throw (not 'not found')", async () => {
  mockFetch(() => [500, {}]);
  await assert.rejects(findLyrics({ title: "a", artistCandidates: ["b"], album: "", duration: 100 }));
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(findLyrics({ title: "a", artistCandidates: ["b"], album: "", duration: 100 }));
});

test("searchLyrics falls back to free text and drops empty records", async () => {
  const calls = mockFetch((url) =>
    url.searchParams.has("q") ? [200, [rec(100), { duration: 1, instrumental: false, plainLyrics: null, syncedLyrics: null }]] : [200, []],
  );
  const results = await searchLyrics({ title: "Song", artist: "A" });
  assert.equal(results.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("q"), "A Song");
  assert.deepEqual(await searchLyrics({ title: " ", artist: "" }), []);
});
