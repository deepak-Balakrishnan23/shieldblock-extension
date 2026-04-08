(function () {
  'use strict';

  const PLAYER_API_RE = /youtubei\/v1\/player|get_video_info|player\?/i;
  const STRIP_KEYS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adBreakParams',
    'ad3Module',
    'adSafetyReason',
    'serverAbrStreamingUrl',
    'showPreroll',
    'showMidroll',
    'showPostroll',
    'cueRanges',
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

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || response.url || '';
      if (!PLAYER_API_RE.test(url)) return response;
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

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__sbUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('readystatechange', function () {
      try {
        if (this.readyState !== 4) return;
        if (!PLAYER_API_RE.test(this.__sbUrl || '')) return;
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

  // Avoid patching ytInitialData to reduce the risk of breaking YouTube UI render trees.
})();
