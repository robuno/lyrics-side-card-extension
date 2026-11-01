// Side panel UI: renders STATE messages from the background, runs a local
// playback clock between updates, and highlights/scrolls the active synced line.

const $ = (id) => document.getElementById(id);

const TICK_MS = 100;
const MANUAL_SCROLL_PAUSE_MS = 5000;
const OFFSET_STEP = 0.5;
const FONT = { min: 12, max: 32, step: 2, default: 18 };

let port = null;
let state = null; // last STATE from the background
let settings = { offset: 0, fontSize: FONT.default }; // chrome.storage.sync
let mode = "synced"; // "synced" | "plain"
let lyricsId = ""; // identifies the lyrics currently rendered
let lines = []; // rendered synced lines: [{ t, el }]
let activeIndex = -1;
let scrolledIndex = -1; // line last centered by auto-scroll
let autoScrollPausedUntil = 0;
let trackKey = "";
const clock = { position: 0, at: 0, playing: false };

// ---------- Playback clock ----------

function nowPosition() {
  return clock.playing ? clock.position + (Date.now() - clock.at) / 1000 : clock.position;
}

// Spotify/SoundCloud report whole seconds: "1:23" means the real time is
// somewhere in 83..84. Keep our running estimate inside that window instead of
// snapping back to 83 every second; jumps (seeks, new track) resync.
function syncClock(s, trackChanged) {
  const now = Date.now();
  const elapsed = s.playing ? (now - (s.positionAt || now)) / 1000 : 0;
  const lo = s.position + elapsed;
  let pos = lo;
  if (s.playing && Number.isInteger(s.position)) {
    const est = nowPosition();
    const close = !trackChanged && clock.playing && est > lo - 1 && est < lo + 2;
    pos = close ? Math.min(Math.max(est, lo), lo + 1) : lo + 0.5;
  }
  Object.assign(clock, { position: pos, at: now, playing: s.playing });
}

// ---------- Rendering ----------

function formatTime(sec) {
  if (sec == null) return "–:––";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderTrack() {
  const { track } = state;
  $("title").textContent = track.title;
  $("artist").textContent = track.artist;

  const art = $("artwork");
  if (art.getAttribute("src") !== track.artwork) {
    art.hidden = !track.artwork;
    if (track.artwork) art.src = track.artwork;
    else art.removeAttribute("src");
  }
}

function renderProgress() {
  if (!state || !state.track) return;
  $("progress").textContent =
    `${clock.playing ? "▶" : "❚❚"} ${formatTime(nowPosition())} / ${formatTime(state.track.duration)}`;
}

const MESSAGES = {
  loading: "Loading lyrics…",
  not_found: "Lyrics not found",
  error: "Couldn't reach the lyrics server.",
};

const ASK_BACKUP =
  "LRCLIB (lyrics source 1) is still unreachable. Search lyrics source 2 (lyrics.ovh) instead? It has plain lyrics only, no karaoke sync.";

function renderLyrics() {
  const { lyrics } = state;
  const hasSynced = Boolean(lyrics.synced);
  const plain = lyrics.plain ?? (hasSynced ? lyrics.synced.map((l) => l.text).join("\n") : null);
  const showSynced = mode === "synced" && hasSynced;

  $("mode-synced").disabled = !hasSynced;
  $("mode-synced").setAttribute("aria-pressed", String(showSynced));
  $("mode-plain").setAttribute("aria-pressed", String(!showSynced));

  const message = lyrics.instrumental
    ? "Instrumental track"
    : plain
      ? ""
      : lyrics.askBackup
        ? ASK_BACKUP
        : MESSAGES[lyrics.status] || "";
  $("lyrics-status").hidden = !message;
  $("lyrics-message").textContent = message;
  $("retry").hidden = lyrics.status !== "error";
  $("use-source-2").hidden = !lyrics.askBackup;

  const box = $("lyrics");
  box.hidden = !plain;
  box.classList.toggle("synced", showSynced);
  lines = [];
  activeIndex = -1;
  scrolledIndex = -1;

  if (showSynced) {
    box.replaceChildren(
      ...lyrics.synced.map(({ t, text }) => {
        const el = document.createElement("p");
        el.className = "line";
        el.textContent = text || "♪"; // instrumental gap
        lines.push({ t, el });
        return el;
      }),
    );
    tick(true);
  } else {
    box.replaceChildren(
      ...(plain || "").split("\n").map((text) => {
        const el = document.createElement("p");
        el.className = "line";
        el.textContent = text || " ";
        return el;
      }),
    );
    $("scroller").scrollTop = 0;
  }
}

function render(next) {
  const prevKey = trackKey;
  if (state && state.source !== next.source) closeSearch(); // search results belong to one source
  state = next;
  const { track, lyrics } = state;
  trackKey = track ? `${track.title}|${track.artist}` : "";
  const trackChanged = trackKey !== prevKey;
  syncClock(state, trackChanged);

  $("waiting").hidden = Boolean(track);
  $("header").hidden = !track;
  if (!track) {
    $("lyrics-status").hidden = true;
    $("lyrics").hidden = true;
    lines = [];
    lyricsId = "";
    return;
  }

  if (trackChanged) closeSearch();
  renderTrack();
  renderProgress();

  if (lyrics) {
    const id = `${trackKey}|${state.source}|${lyrics.status}|${lyrics.id ?? ""}|${Boolean(lyrics.askBackup)}`;
    if (id !== lyricsId) {
      lyricsId = id;
      mode = lyrics.synced ? "synced" : "plain";
      if (lyrics.status === "not_found") openSearch();
      renderLyrics();
    }
  }
  renderSource();
}

// Source 2 (lyrics.ovh) has no timestamps: show the source and turn off karaoke controls.
function renderSource() {
  const backup = state.source === 2;
  $("source-box").hidden = !backup;
  $("controls").classList.toggle("backup", backup);
  for (const id of ["mode-plain", "offset-down", "offset-up"]) $(id).disabled = backup;
  if (backup) $("mode-synced").disabled = true;
}

// ---------- Synced highlight and auto-scroll ----------

// Index of the last line whose time has come (binary search), -1 before the first.
function findActive(t) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function tick(jump = false) {
  renderProgress();
  if (!lines.length) return;

  const idx = findActive(nowPosition() + settings.offset);
  if (idx !== activeIndex) {
    lines[activeIndex]?.el.classList.remove("active");
    lines[idx]?.el.classList.add("active");
    activeIndex = idx;
  }

  // Paused music keeps the highlight but doesn't scroll.
  const canScroll = (clock.playing || jump) && Date.now() >= autoScrollPausedUntil;
  if (canScroll && idx !== scrolledIndex) {
    const target = lines[Math.max(idx, 0)].el;
    target.scrollIntoView({ block: "center", behavior: jump ? "auto" : "smooth" });
    scrolledIndex = idx;
  }
}

// User scrolling (wheel, touch, scrollbar drag, keys) pauses auto-scroll for 5 s.
// Listening to input events, not "scroll", so our own scrolling doesn't count.
function pauseAutoScroll() {
  autoScrollPausedUntil = Date.now() + MANUAL_SCROLL_PAUSE_MS;
  scrolledIndex = -2; // recenter once the pause ends
}
["wheel", "touchmove", "pointerdown", "keydown"].forEach((e) =>
  $("scroller").addEventListener(e, pauseAutoScroll, { passive: true }),
);

setInterval(tick, TICK_MS);

// ---------- Settings: offset and font size (chrome.storage.sync) ----------

function applySettings() {
  const o = settings.offset;
  $("offset-value").textContent = `${o > 0 ? "+" : o < 0 ? "−" : ""}${Math.abs(o).toFixed(1)}s`;
  document.documentElement.style.setProperty("--lyrics-size", `${settings.fontSize}px`);
  $("font-down").disabled = settings.fontSize <= FONT.min;
  $("font-up").disabled = settings.fontSize >= FONT.max;
}

function saveSetting(name, value) {
  settings[name] = value;
  applySettings();
  chrome.storage.sync.set({ [name]: value });
}

chrome.storage.sync.get(settings).then((stored) => {
  settings = { ...settings, ...stored };
  applySettings();
});
// Keeps panels in several windows in step.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const [name, { newValue }] of Object.entries(changes)) if (name in settings) settings[name] = newValue;
  applySettings();
});

const round1 = (x) => Math.round(x * 10) / 10;
$("offset-down").addEventListener("click", () => saveSetting("offset", round1(settings.offset - OFFSET_STEP)));
$("offset-up").addEventListener("click", () => saveSetting("offset", round1(settings.offset + OFFSET_STEP)));
$("font-down").addEventListener("click", () => saveSetting("fontSize", Math.max(FONT.min, settings.fontSize - FONT.step)));
$("font-up").addEventListener("click", () => saveSetting("fontSize", Math.min(FONT.max, settings.fontSize + FONT.step)));

// ---------- Mode toggle and retry ----------

function setMode(next) {
  if (!state?.lyrics || mode === next) return;
  mode = next;
  renderLyrics();
}
$("mode-synced").addEventListener("click", () => setMode("synced"));
$("mode-plain").addEventListener("click", () => setMode("plain"));
$("retry").addEventListener("click", () => port.postMessage({ type: "RETRY" }));
$("use-source-2").addEventListener("click", () => port.postMessage({ type: "SET_SOURCE", source: 2 }));
$("use-source-1").addEventListener("click", () => {
  closeSearch();
  port.postMessage({ type: "SET_SOURCE", source: 1 });
});
$("artwork").addEventListener("error", (e) => (e.target.hidden = true));

// ---------- Manual search ----------

function openSearch() {
  $("search").hidden = false;
  $("search-toggle").setAttribute("aria-expanded", "true");
  $("search-title").value = state.track.title;
  $("search-artist").value = state.track.artist;
}

function closeSearch() {
  $("search").hidden = true;
  $("search-status").hidden = true;
  $("results").hidden = true;
  $("search-toggle").setAttribute("aria-expanded", "false");
}

function setSearchStatus(text) {
  $("search-status").hidden = !text;
  $("search-status").textContent = text;
}

$("search-toggle").addEventListener("click", () => ($("search").hidden ? openSearch() : closeSearch()));

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  $("results").hidden = true;
  setSearchStatus("Searching…");
  port.postMessage({ type: "SEARCH", title: $("search-title").value, artist: $("search-artist").value });
});

function renderResults({ results, error }) {
  if (error) return setSearchStatus("Search failed. Check your connection and try again.");
  setSearchStatus(results.length ? "" : "No results.");
  $("results").hidden = !results.length;
  $("results").replaceChildren(
    ...results.map((r) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = `${r.artist} — ${r.title}`;
      const info = document.createElement("span");
      info.className = "result-info";
      info.textContent = [formatTime(r.duration), r.instrumental ? "instrumental" : r.synced ? "synced" : "plain"].join(" · ");
      btn.append(name, info);
      btn.addEventListener("click", () => {
        port.postMessage({ type: "CHOOSE", id: r.id });
        closeSearch();
      });
      li.append(btn);
      return li;
    }),
  );
}

// ---------- Connection ----------

// Reconnect if the service worker restarts (MV3 workers sleep when idle).
function connect() {
  port = chrome.runtime.connect({ name: "panel" });
  port.onMessage.addListener((msg) => {
    if (msg.type === "STATE") render(msg);
    else if (msg.type === "SEARCH_RESULTS") renderResults(msg);
  });
  port.onDisconnect.addListener(() => setTimeout(connect, 500));
}

applySettings();
connect();
