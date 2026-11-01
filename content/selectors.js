// Per-site DOM selectors, kept in one place. Sites change their markup over
// time; when detection breaks, this is the file to update.
// Content scripts listed together in the manifest share one scope, so
// detector.js can read SITE_SELECTORS directly.
//
// position/duration: player-bar time labels ("1:23"), used when the page's
//   <audio>/<video> element can't be reached (Spotify, SoundCloud).
// title/artist/artwork: fallback only, used when the site doesn't set
//   navigator.mediaSession.metadata.
const SITE_SELECTORS = {
  spotify: {
    position: '[data-testid="playback-position"]',
    duration: '[data-testid="playback-duration"]',
    title: '[data-testid="context-item-info-title"]',
    artist: '[data-testid="context-item-info-artist"]',
    artwork: '[data-testid="now-playing-widget"] img',
  },
  ytmusic: {
    title: "ytmusic-player-bar .title",
    artist: "ytmusic-player-bar .byline a",
    artwork: "ytmusic-player-bar img.image",
  },
  // YouTube always sets mediaSession; its DOM keeps old video titles around
  // after navigation, so a DOM fallback would report stale tracks.
  youtube: {},
  soundcloud: {
    // SoundCloud's <audio> element is not attached to the page.
    position: '.playbackTimeline__timePassed span[aria-hidden="true"]',
    duration: '.playbackTimeline__duration span[aria-hidden="true"]',
    title: ".playbackSoundBadge__titleLink",
    artist: ".playbackSoundBadge__lightLink",
  },
};
