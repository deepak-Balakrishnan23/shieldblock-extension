import {
  looksLikeYouTubeApiUrl,
  looksLikePlayerPayload,
  parseAndSanitizeJson,
  sanitizeYouTubePayload,
  shouldInspectJsonText,
} from '../shared/youtubeSanitizer';

declare global {
  interface Window {
    ytInitialPlayerResponse?: unknown;
    ytInitialData?: unknown;
    __shieldblockYouTubeHooked?: boolean;
  }
}

(() => {
  if (window.__shieldblockYouTubeHooked) return;
  window.__shieldblockYouTubeHooked = true;

  const originalParse = JSON.parse;
  JSON.parse = function patchedJsonParse(text: string, reviver?: Parameters<typeof JSON.parse>[1]) {
    const parsed = originalParse.call(this, text, reviver);
    if (typeof text === 'string' && shouldInspectJsonText(text) && looksLikePlayerPayload(parsed)) {
      return sanitizeYouTubePayload(parsed);
    }
    return parsed;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const request = args[0];
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request?.url ?? response.url;
      if (!looksLikeYouTubeApiUrl(url)) return response;
      const text = await response.clone().text();
      const sanitized = parseAndSanitizeJson(text);
      if (sanitized === text) return response;
      return new Response(sanitized, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, ...rest: unknown[]) {
    (this as XMLHttpRequest & { __shieldblockUrl?: string }).__shieldblockUrl = String(url);
    return (originalOpen as any).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args: unknown[]) {
    this.addEventListener('readystatechange', function onReadyStateChange(this: XMLHttpRequest & { __shieldblockUrl?: string }) {
      if (this.readyState !== 4 || !looksLikeYouTubeApiUrl(this.__shieldblockUrl ?? '') || typeof this.responseText !== 'string') {
        return;
      }

      const sanitized = parseAndSanitizeJson(this.responseText);
      if (sanitized === this.responseText) return;

      try {
        Object.defineProperty(this, 'responseText', { configurable: true, value: sanitized });
        Object.defineProperty(this, 'response', { configurable: true, value: sanitized });
      } catch {
        // Some browsers lock these accessors; JSON.parse interception still covers many paths.
      }
    });
    return originalSend.apply(this, args as []);
  };

  let initialPlayerResponse: unknown;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    get: () => initialPlayerResponse,
    set: (value) => {
      initialPlayerResponse = sanitizeYouTubePayload(value);
    },
  });

  let initialData: unknown;
  Object.defineProperty(window, 'ytInitialData', {
    configurable: true,
    get: () => initialData,
    set: (value) => {
      initialData = sanitizeYouTubePayload(value);
    },
  });
})();
