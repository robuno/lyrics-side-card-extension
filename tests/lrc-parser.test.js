import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLrc } from "../lib/lrc-parser.js";

test("parses basic lines", () => {
  assert.deepEqual(parseLrc("[00:01.50] Hello\n[00:03.25]World"), [
    { t: 1.5, text: "Hello" },
    { t: 3.25, text: "World" },
  ]);
});

test("skips metadata lines", () => {
  const lrc = "[ar:Adele]\n[ti:Hello]\n[al:25]\n[length: 04:55]\n[00:05.00] Hello, it's me";
  assert.deepEqual(parseLrc(lrc), [{ t: 5, text: "Hello, it's me" }]);
});

test("multiple timestamps on one line, sorted output", () => {
  const lrc = "[00:10.00][01:20.00] Chorus\n[00:30.00] Verse";
  assert.deepEqual(parseLrc(lrc), [
    { t: 10, text: "Chorus" },
    { t: 30, text: "Verse" },
    { t: 80, text: "Chorus" },
  ]);
});

test("keeps empty lines (instrumental gaps)", () => {
  assert.deepEqual(parseLrc("[00:01.00] A\n[00:05.00]\n[00:09.00] B"), [
    { t: 1, text: "A" },
    { t: 5, text: "" },
    { t: 9, text: "B" },
  ]);
});

test("accepts mm:ss, mm:ss.xxx and mm:ss:xx", () => {
  assert.deepEqual(parseLrc("[01:02] a\n[01:02.345] b\n[01:03:50] c"), [
    { t: 62, text: "a" },
    { t: 62.345, text: "b" },
    { t: 63.5, text: "c" },
  ]);
});

test("applies [offset:] in milliseconds", () => {
  assert.deepEqual(parseLrc("[offset:+500]\n[00:02.00] a"), [{ t: 1.5, text: "a" }]);
  assert.deepEqual(parseLrc("[offset:-1000]\n[00:02.00] a"), [{ t: 3, text: "a" }]);
});

test("strips enhanced-LRC word timestamps", () => {
  assert.deepEqual(parseLrc("[00:01.00] <00:01.00>Hello <00:01.50>world"), [{ t: 1, text: "Hello world" }]);
});

test("handles CRLF, blank and junk lines", () => {
  assert.deepEqual(parseLrc("\r\n[00:01.00] a\r\nnot a lyric line\r\n\r\n"), [{ t: 1, text: "a" }]);
});

test("empty input", () => {
  assert.deepEqual(parseLrc(""), []);
  assert.deepEqual(parseLrc(null), []);
});
