(function registerShieldBlockYouTubePlayerScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['yt-player']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function ytPlayerScriptlet() {
    try {
      const root = globalThis;
      const AD_KEYS = [
        'adSlots',
        'playerAds',
        'playerAdsConfig',
        'adPlacements',
        'adPlacementsConfig',
        'auxiliaryUi',
        'adBreakHeartbeatParams',
        'adBreaks',
        'adPreroll',
        'adPostroll',
        'externalVideoId',
        'paidContentOverlay',
        'survey',
      ];
      const PROTECTED_KEYS = new Set([
        'videoDetails',
        'playabilityStatus',
        'streamingData',
      ]);
      const SKIP_SELECTOR = '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, button.ytp-ad-skip-button-modern, [class*="ytp-ad-skip-button"]';
      let autoSkipIntervalId = 0;
      let lastSkipAt = 0;
      let lastSkipButton = null;
      let adMuted = false;

      /**
       * Returns true when a value is a traversable object.
       * @param {unknown} value
       * @returns {value is Record<string, unknown>}
       */
      function isObject(value) {
        return value !== null && typeof value === 'object';
      }

      /**
       * Returns true when ShieldBlock should actively block on this page.
       * content.js (isolated world) publishes the master enabled state and the
       * allowlist state as attributes on <html>; when protection is paused or
       * the site is allowlisted, every YouTube hook below becomes a no-op so the
       * pause toggle actually works. Defaults to active before content.js has
       * published the flag (document_start), which is the safe blocking default.
       * @returns {boolean}
       */
      function isActive() {
        try {
          const el = document.documentElement;
          if (!el) {
            return true;
          }
          if (el.getAttribute('data-shieldblock-enabled') === 'false') {
            return false;
          }
          if (el.getAttribute('data-shieldblock-allowlisted') === 'true') {
            return false;
          }
          return true;
        } catch {
          return true;
        }
      }

      /**
       * Removes known ad keys from a player response tree while preserving the
       * actual video payload branches required for playback.
       * @param {unknown} input
       * @returns {unknown}
       */
      function stripAdData(input) {
        if (!isObject(input)) {
          return input;
        }

        const visit = (node) => {
          if (!isObject(node)) {
            return node;
          }

          if (Array.isArray(node)) {
            for (const item of node) {
              visit(item);
            }
            return node;
          }

          for (const key of AD_KEYS) {
            if (key in node) {
              delete node[key];
            }
          }

          for (const [key, value] of Object.entries(node)) {
            if (!isObject(value) || PROTECTED_KEYS.has(key)) {
              continue;
            }
            visit(value);
          }

          return node;
        };

        return visit(input);
      }

      /**
       * Removes nested adSlot entries from ytInitialData.contents trees.
       * @param {unknown} input
       * @returns {unknown}
       */
      function stripInitialData(input) {
        if (!isObject(input)) {
          return input;
        }

        const visit = (node) => {
          if (!isObject(node)) {
            return node;
          }

          if (Array.isArray(node)) {
            for (const item of node) {
              visit(item);
            }
            return node;
          }

          if ('adSlot' in node) {
            delete node.adSlot;
          }

          for (const value of Object.values(node)) {
            visit(value);
          }

          return node;
        };

        if (isObject(input.contents)) {
          visit(input.contents);
        }

        return input;
      }


      /**
       * Intercepts YouTube's Innertube /youtubei/v1/player fetch calls and strips
       * ad data from the response before YouTube's player processes it.
       * This is the primary ad delivery mechanism in 2026.
       * @returns {void}
       */
      function installInnertubeFetchInterceptor() {
        if (root.__sb_innertube_hooked === true) return;
        root.__sb_innertube_hooked = true;

        // Use the stored original fetch if no-fetch-if already wrapped it.
        // This prevents double-wrapping and the cascade of ERR_BLOCKED_BY_CLIENT
        // on legitimate YouTube stats calls.
        const originalFetch = root.__sbOriginalFetch || root.fetch;
        if (typeof originalFetch !== 'function') return;

        // Store the truly-original fetch for our use
        if (!root.__sbOriginalFetch) {
          root.__sbOriginalFetch = originalFetch;
        }

        const previousFetch = root.fetch; // May already be no-fetch-if wrapper

        root.fetch = async function shieldBlockYtFetch(resource, init) {
          const url = typeof resource === 'string'
            ? resource
            : (resource instanceof Request ? resource.url : String(resource));

          // Only intercept the Innertube player endpoint — let everything else
          // pass through to the previous wrapper (no-fetch-if) normally.
          // Also pass through untouched when protection is paused/allowlisted.
          if (!url.includes('/youtubei/') || !url.includes('/player') || !isActive()) {
            return Reflect.apply(previousFetch, this, [resource, init]);
          }

          // For player calls, use the original unwrapped fetch to avoid
          // no-fetch-if blocking the /youtubei/v1/player response
          try {
            const result = await Reflect.apply(originalFetch, this, [resource, init]);
            const clone = result.clone();
            const json = await clone.json();

            if (isObject(json)) {
              stripAdData(json);
            }

            // Rebuild headers from the original response but drop entity headers
            // that no longer describe our re-serialized body. The upstream body
            // arrives compressed (content-encoding: gzip/br) with its own
            // content-length; our JSON string is plain and a different size, so
            // reusing those headers makes the browser fail to decode the body
            // (ERR_CONTENT_DECODING_FAILED) or hit a length mismatch — both of
            // which intermittently break video playback.
            const cleanHeaders = new Headers();
            result.headers.forEach((value, key) => {
              const name = key.toLowerCase();
              if (name === 'content-encoding' || name === 'content-length') {
                return;
              }
              cleanHeaders.set(key, value);
            });
            cleanHeaders.set('content-type', 'application/json; charset=utf-8');

            return new Response(JSON.stringify(json), {
              status: result.status,
              statusText: result.statusText,
              headers: cleanHeaders,
            });
          } catch {
            // Fallback: pass through normally
            return Reflect.apply(previousFetch, this, [resource, init]);
          }
        };

        try {
          Object.defineProperty(root.fetch, '__sbYtWrapped', {
            value: true, configurable: true, enumerable: false, writable: false
          });
        } catch { /* ignore */ }
      }

      /**
       * Intercepts YouTube's Innertube /youtubei/v1/player XHR calls and strips
       * ad data from the response. Some YouTube clients still deliver the player
       * response over XHR rather than fetch; this complements the fetch path.
       * Sanitization is best-effort — on any failure the original response is
       * left untouched so playback is never broken.
       * @returns {void}
       */
      function installInnertubeXhrInterceptor() {
        if (root.__sb_innertube_xhr_hooked === true) return;
        const XHR = root.XMLHttpRequest;
        if (typeof XHR !== 'function' || !XHR.prototype) return;
        root.__sb_innertube_xhr_hooked = true;

        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;

        XHR.prototype.open = function shieldBlockYtXhrOpen(method, url, ...rest) {
          try {
            const requestUrl = typeof url === 'string' ? url : String(url || '');
            this.__sb_yt_player = requestUrl.includes('/youtubei/') && requestUrl.includes('/player');
          } catch {
            this.__sb_yt_player = false;
          }
          return Reflect.apply(originalOpen, this, [method, url, ...rest]);
        };

        XHR.prototype.send = function shieldBlockYtXhrSend(...args) {
          if (this.__sb_yt_player === true) {
            this.addEventListener('readystatechange', function sbYtXhrReady() {
              if (this.readyState !== 4 || !isActive()) return;
              try {
                const responseType = this.responseType;
                if (responseType !== '' && responseType !== 'text' && responseType !== 'json') {
                  return;
                }

                const parsed = responseType === 'json'
                  ? this.response
                  : JSON.parse(this.responseText);

                if (!isObject(parsed)) return;
                stripAdData(parsed);

                const serialized = JSON.stringify(parsed);
                Object.defineProperty(this, 'responseText', {
                  configurable: true,
                  get() { return serialized; },
                });
                Object.defineProperty(this, 'response', {
                  configurable: true,
                  get() { return responseType === 'json' ? parsed : serialized; },
                });
              } catch {
                // Leave the original response untouched on any failure.
              }
            });
          }
          return Reflect.apply(originalSend, this, args);
        };
      }

      /**
       * Returns true when running on a YouTube surface.
       * @returns {boolean}
       */
      function isYouTubeHost() {
        try {
          const host = location.hostname.replace(/^www\./, '').toLowerCase();
          return host === 'youtube.com'
            || host.endsWith('.youtube.com')
            || host === 'youtu.be'
            || host === 'youtube-nocookie.com'
            || host.endsWith('.youtube-nocookie.com');
        } catch {
          return false;
        }
      }

      /**
       * Returns true when an object looks like a YouTube player response.
       * @param {Record<string, unknown>} value
       * @returns {boolean}
       */
      function looksLikePlayerResponse(value) {
        return 'adPlacements' in value
          || 'playerAds' in value
          || 'adSlots' in value
          || 'adPlacementsConfig' in value
          || ('streamingData' in value && 'videoDetails' in value);
      }

      /**
       * Hooks JSON.parse and Response.prototype.json so ad data is stripped from
       * the player response no matter which transport delivers it. Modern
       * YouTube parses the player/next payloads from text in code paths the
       * fetch and XHR wrappers never observe, so this is the catch-all that
       * actually removes the ads the targeted hooks miss. Installed only on
       * YouTube surfaces to avoid touching JSON parsing on the wider web.
       * @returns {void}
       */
      function installJsonHooks() {
        if (root.__sb_yt_json_hooked === true || !isYouTubeHost()) return;
        root.__sb_yt_json_hooked = true;

        try {
          const originalParse = root.JSON.parse;
          root.JSON.parse = function shieldBlockJsonParse(text, reviver) {
            const result = Reflect.apply(originalParse, this, [text, reviver]);
            try {
              if (isObject(result) && isActive()) {
                if (looksLikePlayerResponse(result)) {
                  stripAdData(result);
                } else if ('contents' in result) {
                  stripInitialData(result);
                }
              }
            } catch { /* ignore prune failures */ }
            return result;
          };
        } catch { /* ignore */ }

        try {
          const proto = root.Response && root.Response.prototype;
          if (proto && typeof proto.json === 'function' && proto.json.__sbWrapped !== true) {
            const originalJson = proto.json;
            const wrappedJson = async function shieldBlockResponseJson() {
              const data = await Reflect.apply(originalJson, this, arguments);
              try {
                if (isObject(data) && isActive() && looksLikePlayerResponse(data)) {
                  stripAdData(data);
                }
              } catch { /* ignore prune failures */ }
              return data;
            };
            Object.defineProperty(wrappedJson, '__sbWrapped', {
              value: true, configurable: true, enumerable: false, writable: false,
            });
            proto.json = wrappedJson;
          }
        } catch { /* ignore */ }
      }

      /**
       * Returns the current YouTube player container if it exists.
       * @returns {Element | null}
       */
      function getPlayerElement() {
        return document.querySelector('#movie_player, .html5-video-player, ytd-player, ytm-player');
      }

      /**
       * Returns the active HTML5 video element.
       * @returns {HTMLVideoElement | null}
       */
      function getVideoElement() {
        const video = document.querySelector('video');
        return video instanceof HTMLVideoElement ? video : null;
      }

      /**
       * Returns true when an element is visible enough to click.
       * @param {Element | null} element
       * @returns {element is HTMLElement}
       */
      function isVisible(element) {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        return !element.hasAttribute('disabled') && (
          element.offsetParent !== null
          || element.getClientRects().length > 0
        );
      }

      /**
       * Clicks the active skip button once per second.
       * @returns {boolean}
       */
      function clickSkipButton() {
        if (!isActive()) {
          return false;
        }
        const button = document.querySelector(SKIP_SELECTOR);
        if (!isVisible(button)) {
          return false;
        }

        const now = Date.now();
        if (button === lastSkipButton && now - lastSkipAt < 1000) {
          return false;
        }

        lastSkipButton = button;
        lastSkipAt = now;
        button.click();
        return true;
      }

      /**
       * Returns true when the player is currently showing an ad.
       * @param {Element} player
       * @returns {boolean}
       */
      function isAdShowing(player) {
        return player.classList.contains('ad-showing')
          || player.classList.contains('ad-interrupting')
          || document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-overlay-slot') !== null
          || document.querySelector('.video-ads .ad-showing') !== null;
      }

      /**
       * Skips or fast-forwards the current ad, and restores playback state when
       * no ad is present. Designed to be called repeatedly from a persistent
       * loop so pre-roll, mid-roll, and back-to-back ads are all handled — not
       * just the first ad on page load.
       * @returns {boolean}
       */
      function fastForwardAd() {
        if (!isActive()) {
          return false;
        }
        const player = getPlayerElement();
        const video = getVideoElement();
        if (!player || !video) {
          return false;
        }

        if (!isAdShowing(player)) {
          // Ad finished — undo the changes we made for the ad.
          if (adMuted) {
            video.muted = false;
            adMuted = false;
          }
          if (video.playbackRate > 8) {
            video.playbackRate = 1;
          }
          return false;
        }

        // Mute the ad audio. Remember that *we* muted so we can safely restore.
        if (!video.muted) {
          video.muted = true;
          adMuted = true;
        }

        // Prefer an explicit skip button when YouTube offers one.
        const skipBtn = document.querySelector(SKIP_SELECTOR);
        if (skipBtn instanceof HTMLElement && skipBtn.offsetParent !== null) {
          skipBtn.click();
        }

        // Seek the ad to its end. This ends skippable and unskippable ads alike
        // because the ad plays in the same <video> element with its own short
        // duration. Re-applied every tick so back-to-back ads are burned through.
        if (Number.isFinite(video.duration) && video.duration > 0) {
          try {
            video.currentTime = video.duration;
          } catch {
            // Some ad states briefly reject seeking; the next tick retries.
          }
        } else if (video.playbackRate < 16) {
          // Duration not yet known — burn through at max rate until it is.
          try {
            video.playbackRate = 16;
          } catch {
            // Ignore rate rejection.
          }
        }

        return true;
      }

      /**
       * Starts a persistent loop that skips ads for the lifetime of the page.
       * Unlike the previous implementation it never self-terminates, so mid-roll
       * and late pre-roll ads are caught instead of slipping through after the
       * loop shut itself off.
       * @returns {void}
       */
      function ensureAutoSkipLoop() {
        if (autoSkipIntervalId !== 0 || !isYouTubeHost()) {
          return;
        }

        autoSkipIntervalId = setInterval(() => {
          try {
            if (!isActive()) {
              // Protection paused/allowlisted — undo any ad-state changes and idle.
              const video = getVideoElement();
              if (video) {
                if (adMuted) {
                  video.muted = false;
                  adMuted = false;
                }
                if (video.playbackRate > 8) {
                  video.playbackRate = 1;
                }
              }
              return;
            }
            clickSkipButton();
            fastForwardAd();
          } catch {
            // Ignore loop failures; the next tick retries.
          }
        }, 250);
      }

      /**
       * Defines a sanitizing accessor on window for a YouTube bootstrap object.
       * @param {string} propertyName
       * @param {(value: unknown) => unknown} sanitizer
       * @returns {void}
       */
      function installSanitizedProperty(propertyName, sanitizer) {
        let storedValue;

        try {
          storedValue = sanitizer(root[propertyName]);
        } catch {
          storedValue = undefined;
        }

        const descriptor = Object.getOwnPropertyDescriptor(root, propertyName);
        if (descriptor && descriptor.configurable === false) {
          try {
            root[propertyName] = sanitizer(root[propertyName]);
          } catch {
            // Ignore non-configurable assignment failures.
          }
          return;
        }

        try {
          Object.defineProperty(root, propertyName, {
            configurable: true,
            enumerable: true,
            get() {
              return storedValue;
            },
            set(value) {
              storedValue = isActive() ? sanitizer(value) : value;
              if (propertyName === 'ytInitialPlayerResponse') {
                ensureAutoSkipLoop();
              }
            },
          });
        } catch {
          try {
            root[propertyName] = storedValue;
          } catch {
            // Ignore fallback failures.
          }
        }
      }

      /**
       * Reapplies YouTube cleanup after SPA navigation.
       * @returns {void}
       */
      function handleNavigation() {
        if (isActive()) {
          try {
            root.ytInitialPlayerResponse = stripAdData(root.ytInitialPlayerResponse);
          } catch {
            // Ignore navigation cleanup failures.
          }

          try {
            root.ytInitialData = stripInitialData(root.ytInitialData);
          } catch {
            // Ignore navigation cleanup failures.
          }
        }

        setTimeout(() => {
          try {
            clickSkipButton();
            fastForwardAd();
            ensureAutoSkipLoop();
          } catch {
            // Ignore delayed cleanup failures.
          }
        }, 100);
      }

      if (root.__sb_yt_hooked === true) {
        handleNavigation();
        return;
      }

      root.__sb_yt_hooked = true;

      installSanitizedProperty('ytInitialPlayerResponse', stripAdData);
      installSanitizedProperty('ytInitialData', stripInitialData);
      installJsonHooks();
      installInnertubeFetchInterceptor();
      installInnertubeXhrInterceptor();

      document.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });

      setTimeout(() => {
        try {
          if (isActive()) {
            root.ytInitialPlayerResponse = stripAdData(root.ytInitialPlayerResponse);
            root.ytInitialData = stripInitialData(root.ytInitialData);
          }
          clickSkipButton();
          fastForwardAd();
          ensureAutoSkipLoop();
        } catch {
          // Ignore startup cleanup failures.
        }
      }, 100);
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['yt-player'] = ytPlayerScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Also self-execute immediately — yt-player.js is loaded directly via manifest
  // at document_start in MAIN world, so it must run now, not wait for index.js
  ytPlayerScriptlet();
})();
