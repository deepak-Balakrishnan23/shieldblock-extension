// ShieldBlock AI — YouTube Ad Blocker v2.8
// Hybrid approach: strip ad metadata in page context, then use lightweight UI cleanup.

(function () {
  'use strict';

  if (!location.hostname.includes('youtube.com')) return;

  const STYLE_ID = 'shieldblock-youtube';
  const INJECT_ID = 'shieldblock-youtube-hook';
  const state = {
    enabled: true,
    allowlist: [],
  };

  const PLAYER_DECORATION_SELECTORS = [
    '.ytp-ad-overlay-container',
    '.ytp-ad-overlay-slot',
    '.ytp-ad-text-overlay',
    '.ytp-ad-image-overlay',
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-instream-info',
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-preview-container',
    '.ytp-ad-shopping-overlay',
    '.ytp-ad-action-interstitial',
    '.ytp-ad-module',
    '.ytp-ad-message-container',
    '.ytp-ad-survey',
    '.ytp-ad-text',
    '.ytp-ad-button-icon',
    '.ytp-ad-visit-advertiser-button',
    '.ytp-ad-cta-container',
    '.ytp-ad-hover-text-button',
    '#player-ads',
  ];

  const FEED_AD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-companion-slot-renderer',
  ];

  const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '[class*="skip-ad"]',
    '[class*="skipAd"]',
  ];

  const SPONSORED_TEXT = /\b(sponsored|promoted|install|sign up|visit site)\b/i;
  let intervalId = null;
  let pendingAdActions = 0;

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function canRun() {
    return state.enabled && !matchesAllowlist(location.hostname, state.allowlist);
  }

  function ensureHook() {
    if (!canRun()) {
      document.getElementById(INJECT_ID)?.remove();
      return;
    }
    if (document.getElementById(INJECT_ID)) return;

    const script = document.createElement('script');
    script.id = INJECT_ID;
    script.textContent = `(() => {
      const STRIP_KEYS = [
        'adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams',
        'adBreakParams', 'ad3Module', 'adSafetyReason', 'serverAbrStreamingUrl',
        'showPreroll', 'showMidroll', 'showPostroll', 'cueRanges'
      ];

      function sanitize(obj) {
        if (!obj || typeof obj !== 'object') return obj;

        try {
          for (const key of STRIP_KEYS) {
            if (key in obj) {
              if (Array.isArray(obj[key])) obj[key] = [];
              else delete obj[key];
            }
          }

          if (obj.playerResponse && typeof obj.playerResponse === 'object') {
            sanitize(obj.playerResponse);
          }

          if (obj.streamingData && typeof obj.streamingData === 'object') {
            delete obj.streamingData.serverAbrStreamingUrl;
          }

          if (obj.playabilityStatus && typeof obj.playabilityStatus === 'object') {
            delete obj.playabilityStatus.adBreakStatus;
          }
        } catch (_) {}

        return obj;
      }

      const originalParse = JSON.parse;
      JSON.parse = function(...args) {
        const parsed = originalParse.apply(this, args);
        return sanitize(parsed);
      };

      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || response.url || '';
          if (!/youtubei\\/v1\\/(player|next|browse)|get_video_info|player\\?/.test(url)) return response;
          const clone = response.clone();
          const text = await clone.text();
          const data = sanitize(JSON.parse(text));
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (_) {
          return response;
        }
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__sbUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('readystatechange', function() {
          try {
            if (this.readyState !== 4) return;
            if (!/youtubei\\/v1\\/(player|next|browse)|get_video_info|player\\?/.test(this.__sbUrl || '')) return;
            if (!this.responseText) return;
            const sanitized = JSON.stringify(sanitize(JSON.parse(this.responseText)));
            Object.defineProperty(this, 'responseText', { configurable: true, value: sanitized });
            Object.defineProperty(this, 'response', { configurable: true, value: sanitized });
          } catch (_) {}
        });
        return originalSend.apply(this, args);
      };

      let initialPlayerResponse = null;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() { return initialPlayerResponse; },
        set(value) { initialPlayerResponse = sanitize(value); },
      });

      let initialData = null;
      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        get() { return initialData; },
        set(value) { initialData = sanitize(value); },
      });
    })();`;

    (document.documentElement || document.head).appendChild(script);
  }

  function ensureStyle() {
    if (!canRun()) {
      document.getElementById(STYLE_ID)?.remove();
      return;
    }

    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${PLAYER_DECORATION_SELECTORS.join(',\n')} {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      #player-ads,
      .ytp-ad-player-overlay-layout,
      .ad-showing .ytp-ad-player-overlay {
        display: none !important;
      }

      .ad-showing .ytp-chrome-bottom {
        display: flex !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function flushActions(force = false) {
    if (!pendingAdActions) return;
    if (!force && pendingAdActions < 2) return;
    chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', category: 'ads', count: pendingAdActions });
    chrome.runtime.sendMessage({
      type: 'ACTIVITY_EVENT',
      kind: 'blocking',
      title: 'YouTube ads removed',
      detail: `${pendingAdActions} YouTube ad item(s) blocked`,
    });
    pendingAdActions = 0;
  }

  function markAction() {
    pendingAdActions += 1;
    flushActions();
  }

  function hideElement(el) {
    if (!el) return;
    if (el.dataset.shieldblockHidden === '1') return;
    el.dataset.shieldblockHidden = '1';
    el.style.display = 'none';
    el.style.visibility = 'hidden';
    markAction();
  }

  function removeSponsoredSidebarCards() {
    if (!canRun()) return;
    document.querySelectorAll(FEED_AD_SELECTORS.join(',')).forEach((el) => {
      const text = (el.innerText || '').trim();
      const hrefs = Array.from(el.querySelectorAll('a[href]')).map((a) => a.href).join(' ');
      if (
        SPONSORED_TEXT.test(text) ||
        /googleadservices|doubleclick|one\\.google\\.com|adurl=|gclid=/.test(hrefs)
      ) {
        hideElement(el);
      }
    });
  }

  function clickSkipButton() {
    for (const selector of SKIP_SELECTORS) {
      const button = document.querySelector(selector);
      if (button && button.offsetParent !== null) {
        button.click();
        markAction();
        return true;
      }
    }
    return false;
  }

  function blockYouTubeAds() {
    if (!canRun()) return;
    ensureHook();
    ensureStyle();
    removeSponsoredSidebarCards();
    clickSkipButton();
  }

  function refreshState(callback) {
    chrome.storage.local.get(['enabled', 'youtubeEnabled', 'allowlist'], (data) => {
      state.enabled = data.enabled !== false && data.youtubeEnabled !== false;
      state.allowlist = data.allowlist || [];
      ensureHook();
      ensureStyle();
      callback?.();
    });
  }

  const pageObserver = new MutationObserver((mutations) => {
    if (!canRun()) return;
    if (!mutations.some((mutation) => mutation.addedNodes.length > 0)) return;
    blockYouTubeAds();
  });

  pageObserver.observe(document.documentElement, { childList: true, subtree: true });

  function startPolling() {
    clearInterval(intervalId);
    intervalId = setInterval(blockYouTubeAds, 250);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (['TOGGLE_EXTENSION', 'TOGGLE_YOUTUBE', 'ALLOWLIST_UPDATED'].includes(message.type)) {
      refreshState(blockYouTubeAds);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.youtubeEnabled || changes.allowlist) {
      refreshState(blockYouTubeAds);
    }
  });

  refreshState(() => {
    blockYouTubeAds();
    startPolling();
  });

  window.addEventListener('beforeunload', () => flushActions(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushActions(true);
  });
})();
