// Detects the track playing on this page and reports it to the background.
// Primary source: navigator.mediaSession.metadata. Fallback: DOM (selectors.js).
// Polls every second; sends a NOW_PLAYING message when something changed or
// while playing (so the position stays fresh).

(() => {
  const POLL_MS = 1000;
  // Resend unchanged state now and then, so a restarted service worker relearns it.
  const HEARTBEAT_MS = 10000;

  const source = getSource(location.hostname);
  const sel = SITE_SELECTORS[source] || {};
  const useDomTime = Boolean(sel.position);

  let lastKey = "";
  let lastSentAt = 0;
  let lastPosition = null;
  let hadTrack = false;

  function getSource(host) {
    if (host === "open.spotify.com") return "spotify";
    if (host === "music.youtube.com") return "ytmusic";
    if (host.endsWith("youtube.com")) return "youtube";
    if (host.endsWith("soundcloud.com")) return "soundcloud";
    return "other";
  }

  function text(selector) {
    const el = selector && document.querySelector(selector);
    return el ? el.textContent.trim() : "";
  }

  // "1:23" / "1:02:03" / "-2:31" (remaining time) -> seconds (negative if "-")
  function parseTime(str) {
    const m = /^(-|−)?(\d+(?::\d{1,2}){1,2})$/.exec(str.trim());
    if (!m) return null;
    const secs = m[2].split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
    return m[1] ? -secs : secs;
  }

  // Largest image by "WxH" size; on ties the last one wins.
  function pickArtwork(list) {
    if (!list || !list.length) return "";
    const area = (img) => {
      const m = /(\d+)x(\d+)/.exec(img.sizes || "");
      return m ? m[1] * m[2] : 0;
    };
    return [...list].sort((a, b) => area(a) - area(b)).pop().src || "";
  }

  // The page's <video>/<audio>: prefer one that is playing.
  function findMedia() {
    const els = [...document.querySelectorAll("video, audio")];
    return els.find((e) => !e.paused) || els.find((e) => e.duration > 0) || null;
  }

  function readTrack() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (md && md.title) {
      return { title: md.title, artist: md.artist || "", album: md.album || "", artwork: pickArtwork(md.artwork) };
    }
    const title = text(sel.title);
    if (!title) return null;
    const img = sel.artwork && document.querySelector(sel.artwork);
    return { title, artist: text(sel.artist), album: "", artwork: img ? img.src : "" };
  }

  function readTime(media) {
    if (useDomTime) {
      const position = parseTime(text(sel.position));
      let duration = parseTime(text(sel.duration));
      if (position !== null) {
        if (duration !== null && duration < 0) duration = position - duration; // "-2:31" = remaining
        return { position, duration: duration > 0 ? duration : null };
      }
    }
    if (media) {
      const d = media.duration;
      return { position: media.currentTime, duration: Number.isFinite(d) && d > 0 ? Math.round(d) : null };
    }
    return { position: 0, duration: null };
  }

  function readPlaying(media, position) {
    const state = navigator.mediaSession && navigator.mediaSession.playbackState;
    if (state === "playing") return true;
    if (state === "paused") return false;
    if (media && !useDomTime) return !media.paused;
    // Last resort: the clock is moving.
    return lastPosition !== null && position !== lastPosition;
  }

  function send(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {});
    lastSentAt = Date.now();
  }

  function tick() {
    // After the extension is reloaded this old script can't talk to it anymore.
    if (!chrome.runtime || !chrome.runtime.id) return stop();

    const track = readTrack();
    if (!track) {
      if (hadTrack) send({ type: "NO_TRACK" });
      hadTrack = false;
      lastKey = "";
      return;
    }

    const media = useDomTime ? null : findMedia();
    const { position, duration } = readTime(media);
    const playing = readPlaying(media, position);
    lastPosition = position;
    hadTrack = true;

    const key = JSON.stringify([track.title, track.artist, track.album, track.artwork, duration, playing]);
    if (key === lastKey && !playing && Date.now() - lastSentAt < HEARTBEAT_MS) return;
    lastKey = key;

    send({ type: "NOW_PLAYING", source, ...track, duration, position, playing });
  }

  // Media events don't bubble, but capture-phase listeners on document see them.
  // They make play/pause/track changes show up without waiting for the next poll.
  const EVENTS = ["play", "pause", "loadedmetadata"];
  const timer = setInterval(tick, POLL_MS);
  EVENTS.forEach((e) => document.addEventListener(e, tick, true));

  function stop() {
    clearInterval(timer);
    EVENTS.forEach((e) => document.removeEventListener(e, tick, true));
  }

  tick();
})();
