// Service worker: keeps per-tab "now playing" state, picks the active tab,
// fetches lyrics from LRCLIB (cached) and pushes STATE messages to the side panel.

import { cleanTrack } from "../lib/clean-title.js";
import { findLyrics, searchLyrics, getById } from "../lib/lrclib.js";
import { parseLrc } from "../lib/lrc-parser.js";
import { findLyricsOvh, getOvh } from "../lib/lyricsovh.js";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("setPanelBehavior failed:", err));

const SUPPORTED_HOSTS = /^https:\/\/(open\.spotify\.com|music\.youtube\.com|www\.youtube\.com|soundcloud\.com)\//;

// ---------- Tab state ----------

// tabId -> last NOW_PLAYING data + { tabId, audible, activeSince, positionAt }
// activeSince = when this tab last started playing or changed track.
// positionAt = when `position` was received (the panel extrapolates from it).
const tabs = new Map();
// Open side panels (one per window).
const panels = new Set();

function trackKey(s) {
  return `${s.title}|${s.artist}|${s.album}`;
}

// Prefer audible tabs; among candidates, the one that most recently started a track.
function pickActive() {
  const all = [...tabs.values()];
  const audible = all.filter((s) => s.audible);
  const pool = audible.length ? audible : all;
  return pool.reduce((best, s) => (!best || s.activeSince > best.activeSince ? s : best), null);
}

// ---------- Lyrics: memory -> storage cache -> LRCLIB (or lyrics.ovh) ----------

// Lyrics source: 1 = LRCLIB (default), 2 = lyrics.ovh backup (plain lyrics only).
// The user picks it in the panel; it stays until they switch back.
let lyricsSource = 1;
const sourceReady = chrome.storage.local
  .get("lyricsSource")
  .then(({ lyricsSource: stored }) => (lyricsSource = stored === 2 ? 2 : 1))
  .catch(() => {});

const CACHE_PREFIX = "lyrics:";
const CACHE_MAX = 200;
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX = 20;

const LOADING = { status: "loading", synced: null, plain: null };

const lyricsByKey = new Map(); // cache key -> lyrics state, for this worker's lifetime
const inFlight = new Set(); // cache keys being looked up right now

// Source 2 results get their own keys, so they never replace LRCLIB's synced lyrics.
const retriedKeys = new Set(); // keys whose lookup failed again after Retry

const cacheKeyOf = (clean, source = lyricsSource) =>
  `${CACHE_PREFIX}${source === 2 ? "ovh:" : ""}${clean.primaryArtist}|${clean.title}`.toLowerCase();

function toLyricsState(record) {
  if (!record) return { status: "not_found", synced: null, plain: null };
  const id = record.id ?? null;
  if (record.instrumental) return { status: "found", id, instrumental: true, synced: null, plain: null };
  const synced = parseLrc(record.syncedLyrics);
  return { status: "found", id, synced: synced.length ? synced : null, plain: record.plainLyrics || null };
}

async function readCache(key) {
  const { [key]: entry } = await chrome.storage.local.get(key);
  if (!entry) return null;
  if (entry.lyrics.status === "not_found" && Date.now() - entry.savedAt > NOT_FOUND_TTL_MS) return null;
  return entry.lyrics;
}

// Keeps at most CACHE_MAX entries; the oldest saved ones go first.
async function writeCache(key, lyrics) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX) && k !== key);
  if (keys.length >= CACHE_MAX) {
    keys.sort((a, b) => all[a].savedAt - all[b].savedAt);
    await chrome.storage.local.remove(keys.slice(0, keys.length - CACHE_MAX + 1));
  }
  await chrome.storage.local.set({ [key]: { lyrics, savedAt: Date.now() } });
}

// After an install/update/reload the matching code may have improved, so
// earlier "not found" verdicts are dropped and looked up again.
chrome.runtime.onInstalled.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX) && all[k].lyrics?.status === "not_found");
  if (stale.length) await chrome.storage.local.remove(stale);
});

function remember(key, lyrics) {
  lyricsByKey.delete(key);
  lyricsByKey.set(key, lyrics);
  if (lyricsByKey.size > MEMORY_MAX) lyricsByKey.delete(lyricsByKey.keys().next().value);
}

// Starts a lookup unless one for the same track is already running.
async function loadLyrics(key, clean, duration, source) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  let lyrics;
  try {
    lyrics = await readCache(key);
    if (!lyrics) {
      const record = source === 2 ? await findLyricsOvh(clean) : await findLyrics({ ...clean, duration });
      lyrics = toLyricsState(record);
      writeCache(key, lyrics).catch((err) => console.warn("Lyrics cache write failed:", err));
    }
  } catch (err) {
    console.warn("Lyrics lookup failed:", err);
    // Not cached, so Retry asks again. If LRCLIB still fails after a Retry,
    // the panel offers source 2.
    lyrics = { status: "error", synced: null, plain: null, askBackup: source === 1 && retriedKeys.has(key) };
  }
  inFlight.delete(key);
  remember(key, lyrics);
  broadcast();
}

// ---------- Panel state ----------

function buildState() {
  const s = pickActive();
  if (!s) return { type: "STATE", track: null, lyrics: null, position: 0, positionAt: Date.now(), playing: false };

  const clean = cleanTrack(s);
  const key = cacheKeyOf(clean);
  let lyrics = lyricsByKey.get(key);
  if (!lyrics) {
    lyrics = LOADING;
    loadLyrics(key, clean, s.duration, lyricsSource);
  }

  return {
    type: "STATE",
    track: { title: clean.title, artist: clean.artist, album: s.album, artwork: s.artwork, duration: s.duration },
    lyrics,
    position: s.position,
    positionAt: s.positionAt,
    playing: s.playing,
    source: lyricsSource,
  };
}

// Lyrics are only looked up while a panel is open (buildState runs only then).
async function broadcast() {
  await sourceReady;
  if (!panels.size) return;
  const state = buildState();
  panels.forEach((port) => port.postMessage(state));
}

// Forget a failed lookup for the current track and try again.
function retry() {
  const s = pickActive();
  if (!s) return;
  const key = cacheKeyOf(cleanTrack(s));
  if (lyricsByKey.get(key)?.status === "error") {
    lyricsByKey.delete(key);
    retriedKeys.add(key);
  }
  broadcast();
}

// Switch lyrics source; failed lookups are forgotten so they run again.
function setSource(source) {
  lyricsSource = source === 2 ? 2 : 1;
  chrome.storage.local.set({ lyricsSource });
  for (const [key, lyrics] of lyricsByKey) if (lyrics.status === "error") lyricsByKey.delete(key);
  retriedKeys.clear();
  broadcast();
}

// ---------- Manual search (from the panel) ----------

const searchResults = new Map(); // record id -> record, from the last manual search

// Source 2 has no search endpoint, only exact artist/title lookups.
async function searchOvh({ title = "", artist = "" }) {
  if (!title.trim() || !artist.trim()) return [];
  const record = await getOvh(artist.trim(), title.trim());
  return record ? [record] : [];
}

async function manualSearch(port, query) {
  let msg;
  try {
    const results = lyricsSource === 2 ? await searchOvh(query) : await searchLyrics(query);
    searchResults.clear();
    results.forEach((r) => searchResults.set(r.id, r));
    msg = {
      type: "SEARCH_RESULTS",
      results: results.map((r) => ({
        id: r.id,
        title: r.trackName,
        artist: r.artistName,
        album: r.albumName,
        duration: r.duration,
        synced: Boolean(r.syncedLyrics),
        instrumental: Boolean(r.instrumental),
      })),
    };
  } catch (err) {
    console.warn("Manual search failed:", err);
    msg = { type: "SEARCH_RESULTS", error: true, results: [] };
  }
  try {
    port.postMessage(msg);
  } catch {
    // panel closed meanwhile
  }
}

// Use the chosen search result for the current track (and remember it).
async function choose(id) {
  const s = pickActive();
  if (!s) return;
  let record = searchResults.get(id);
  try {
    // The worker may have restarted since the search (source 2 ids can't be refetched).
    if (!record && typeof id === "number") record = await getById(id);
  } catch (err) {
    console.warn("Fetching chosen lyrics failed:", err);
  }
  if (!record) return;
  const key = cacheKeyOf(cleanTrack(s));
  const lyrics = toLyricsState(record);
  remember(key, lyrics);
  writeCache(key, lyrics).catch((err) => console.warn("Lyrics cache write failed:", err));
  broadcast();
}

// ---------- Events ----------

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tab = sender.tab;
  if (!tab || tab.id == null) return;

  if (msg.type === "NOW_PLAYING") {
    const prev = tabs.get(tab.id);
    const changed = !prev || trackKey(prev) !== trackKey(msg) || (msg.playing && !prev.playing);
    tabs.set(tab.id, {
      ...msg,
      tabId: tab.id,
      audible: Boolean(tab.audible),
      activeSince: changed ? Date.now() : prev.activeSince,
      positionAt: Date.now(),
    });
    broadcast();
  } else if (msg.type === "NO_TRACK") {
    tabs.delete(tab.id);
    broadcast();
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  const s = tabs.get(tabId);
  if (!s) return;
  if (info.url && !SUPPORTED_HOSTS.test(info.url)) {
    tabs.delete(tabId); // navigated away from the music site
  } else if ("audible" in info) {
    s.audible = info.audible;
  } else {
    return;
  }
  broadcast();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.delete(tabId)) broadcast();
});

// The panel connects on open; send it the current state right away.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  panels.add(port);
  port.onDisconnect.addListener(() => panels.delete(port));
  port.onMessage.addListener((msg) => {
    if (msg.type === "RETRY") retry();
    else if (msg.type === "SEARCH") manualSearch(port, msg);
    else if (msg.type === "CHOOSE") choose(msg.id);
    else if (msg.type === "SET_SOURCE") setSource(msg.source);
  });
  sourceReady.then(() => port.postMessage(buildState()));
});
