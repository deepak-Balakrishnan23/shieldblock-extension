(function initializeShieldBlockSponsorSkip() {
  'use strict';

  if (globalThis.__shieldblockSponsorInitialized === true) {
    return;
  }
  globalThis.__shieldblockSponsorInitialized = true;

  // In-video sponsor reads, self-promos, and interaction reminders are baked
  // into the uploaded video stream — they are NOT YouTube ads and cannot be
  // removed by network/cosmetic blocking. SponsorBlock's crowdsourced timestamp
  // database is the only way to skip them. We query it with a 4-char SHA-256
  // hash *prefix* of the video ID (k-anonymity), so the API never learns which
  // exact video is being watched.
  const API_BASE = 'https://sponsor.ajay.app/api/skipSegments';
  const REQUESTED_CATEGORIES = Object.freeze([
    'sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic',
  ]);
  const SKIP_CATEGORIES = new Set(['sponsor', 'selfpromo', 'interaction']);
  const POLL_INTERVAL_MS = 400;
  const NAV_POLL_INTERVAL_MS = 1000;

  let currentVideoId = '';
  let segments = [];
  let pollIntervalId = 0;
  let allowlisted = false;
  let protectionEnabled = true;
  let featureEnabled = true;

  // Respect the master pause toggle and the SponsorBlock feature toggle live.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('enabled' in changes) {
        protectionEnabled = changes.enabled.newValue !== false;
      }
      if ('sponsorBlockEnabled' in changes) {
        featureEnabled = changes.sponsorBlockEnabled.newValue !== false;
        // Force a re-fetch when the feature is switched back on mid-video.
        if (featureEnabled) {
          currentVideoId = '';
          void refresh();
        } else {
          segments = [];
        }
      }
    });
  } catch {
    protectionEnabled = true;
  }

  /**
   * Returns the current YouTube video ID, or '' when not on a video surface.
   * @returns {string}
   */
  function getVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname === '/watch') {
        return url.searchParams.get('v') || '';
      }
      const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  /**
   * Computes the lowercase hex SHA-256 of a string.
   * @param {string} value
   * @returns {Promise<string>}
   */
  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Loads the allowlist state for the current host.
   * @returns {Promise<void>}
   */
  async function loadAllowlistState() {
    try {
      const result = await chrome.storage.local.get(['allowlistedDomains', 'enabled', 'sponsorBlockEnabled']);
      protectionEnabled = result.enabled !== false;
      featureEnabled = result.sponsorBlockEnabled !== false;
      const domains = Array.isArray(result.allowlistedDomains) ? result.allowlistedDomains : [];
      const host = location.hostname.replace(/^www\./, '').toLowerCase();
      allowlisted = domains.some((domain) => {
        const normalized = String(domain).replace(/^www\./, '').toLowerCase();
        return host === normalized || host.endsWith(`.${normalized}`);
      });
    } catch {
      allowlisted = false;
    }
  }

  /**
   * Fetches skippable segments for a video via the hash-prefix endpoint.
   * @param {string} videoId
   * @returns {Promise<Array<{ start: number, end: number, category: string }>>}
   */
  async function fetchSegments(videoId) {
    const hashPrefix = (await sha256Hex(videoId)).slice(0, 4);
    const params = new URLSearchParams();
    for (const category of REQUESTED_CATEGORIES) {
      params.append('category', category);
    }

    const response = await fetch(`${API_BASE}/${hashPrefix}?${params.toString()}`, {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const entry = Array.isArray(data) ? data.find((item) => item?.videoID === videoId) : null;
    if (!entry || !Array.isArray(entry.segments)) {
      return [];
    }

    return entry.segments
      .filter((segment) => (
        segment?.actionType === 'skip'
        && SKIP_CATEGORIES.has(segment.category)
        && Array.isArray(segment.segment)
      ))
      .map((segment) => ({
        start: Number(segment.segment[0]),
        end: Number(segment.segment[1]),
        category: segment.category,
      }))
      .filter((segment) => (
        Number.isFinite(segment.start)
        && Number.isFinite(segment.end)
        && segment.end > segment.start
      ));
  }

  /**
   * Starts the persistent loop that seeks past skippable segments.
   * @returns {void}
   */
  function startPoll() {
    if (pollIntervalId !== 0) {
      return;
    }

    pollIntervalId = setInterval(() => {
      try {
        if (!segments.length || !protectionEnabled || !featureEnabled) {
          return;
        }
        const video = document.querySelector('video');
        if (!(video instanceof HTMLVideoElement) || video.paused || !Number.isFinite(video.currentTime)) {
          return;
        }

        const time = video.currentTime;
        for (const segment of segments) {
          // Leave a small margin so we don't fight YouTube's own seek handling
          // at the very edge of a segment.
          if (time >= segment.start && time < segment.end - 0.4) {
            video.currentTime = segment.end;
            break;
          }
        }
      } catch {
        // Ignore transient seek failures; the next tick retries.
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Refreshes the segment list when the active video changes.
   * @returns {Promise<void>}
   */
  async function refresh() {
    const videoId = getVideoId();
    if (!videoId) {
      return;
    }

    // Don't fetch (or record the video) while paused/allowlisted/disabled, so
    // the nav poll keeps retrying and segments load as soon as it resumes.
    if (allowlisted || !protectionEnabled || !featureEnabled) {
      return;
    }

    if (videoId === currentVideoId) {
      return;
    }

    currentVideoId = videoId;
    segments = [];
    try {
      segments = await fetchSegments(videoId);
    } catch {
      segments = [];
    }
  }

  /**
   * Boots the sponsor-skip engine on YouTube surfaces.
   * @returns {Promise<void>}
   */
  async function init() {
    await loadAllowlistState();
    if (allowlisted) {
      return;
    }

    await refresh();
    startPoll();

    window.addEventListener('yt-navigate-finish', () => { void refresh(); }, { passive: true });
    // Fallback for navigations that don't emit yt-navigate-finish.
    setInterval(() => {
      if (getVideoId() !== currentVideoId) {
        void refresh();
      }
    }, NAV_POLL_INTERVAL_MS);
  }

  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
    void init();
  }
})();
