import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanOvhLyrics, findLyricsOvh, getOvh } from "../lib/lyricsovh.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(decodeURIComponent(new URL(url).pathname));
    const [status, body] = handler(calls.at(-1));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return calls;
}

test("cleanOvhLyrics normalizes line breaks and drops the French header", () => {
  assert.equal(cleanOvhLyrics("Paroles de la chanson Hello par Adele\r\nHello\r\n\r\n\r\n\r\nIt's me"), "Hello\n\nIt's me");
  assert.equal(cleanOvhLyrics("I'm  going  back to 505"), "I'm going back to 505");
  assert.equal(cleanOvhLyrics(null), "");
});

test("getOvh returns an LRCLIB-like plain record, null on 404", async () => {
  mockFetch((path) => (path.endsWith("/Hello") ? [200, { lyrics: "Hello, it's me" }] : [404, { error: "No lyrics found" }]));
  const r = await getOvh("Adele", "Hello");
  assert.equal(r.plainLyrics, "Hello, it's me");
  assert.equal(r.syncedLyrics, null);
  assert.equal(r.id, "ovh:Adele|Hello");
  assert.equal(await getOvh("Adele", "Nope"), null);
});

test("findLyricsOvh tries candidates in order and encodes special characters", async () => {
  const calls = mockFetch((path) => (path === "/v1/Arctic Monkeys/505" ? [200, { lyrics: "x" }] : [404, {}]));
  const r = await findLyricsOvh({ titleCandidates: ["505 BBC Radio 1 Live", "505"], artistCandidates: ["Arctic Monkeys"] });
  assert.ok(r);
  assert.deepEqual(calls, ["/v1/Arctic Monkeys/505 BBC Radio 1 Live", "/v1/Arctic Monkeys/505"]);
});

test("server errors throw so the panel can show an error", async () => {
  mockFetch(() => [503, {}]);
  await assert.rejects(findLyricsOvh({ titleCandidates: ["a"], artistCandidates: ["b"] }));
});
