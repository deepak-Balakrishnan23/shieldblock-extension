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
        'playerAdsConfig',
        'adPlacements',
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
      const SKIP_SELECTOR = '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern';
      let autoSkipIntervalId = 0;
      let lastSkipAt = 0;
      let lastSkipButton = null;
      let missingPlayerTicks = 0;

      /**
       * Returns true when a value is a traversable object.
       * @param {unknown} value
       * @returns {value is Record<string, unknown>}
       */
      function isObject(value) {
        return value !== null && typeof value === 'object';
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
          // pass through to the previous wrapper (no-fetch-if) normally
          if (!url.includes('/youtubei/') || !url.includes('/player')) {
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

            return new Response(JSON.stringify(json), {
              status: result.status,
              statusText: result.statusText,
              headers: result.headers,
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
       * Fast-forwards ad playback when YouTube flags the player as ad-showing.
       * @returns {boolean}
       */
      function fastForwardAd() {
        const player = getPlayerElement();
        const video = getVideoElement();
        if (!player || !video) {
          return false;
        }

        // Only use reliable, specific signals.
        // '.ad-showing' on the player container is the most reliable signal.
        // '.ytp-ad-player-overlay' is a strong signal (only present during ads).
        // Do NOT use '.video-ads.ytp-ad-module' — it stays in DOM during normal video.
        // Do NOT use '.ytp-ad-text' — too broad.
        const adShowing = player.classList.contains('ad-showing')
          || document.querySelector('.ytp-ad-player-overlay') !== null;

        if (!adShowing) {
          return false;
        }

        // Mute immediately so user doesn't hear the ad
        if (!video.muted) {
          video.muted = true;
          // Restore mute state after ad ends
          video.addEventListener('adend', () => { video.muted = false; }, { once: true });
        }

        // Skip button — click it if visible
        const skipBtn = document.querySelector(
          '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, [class*="skip-button"]'
        );
        if (skipBtn instanceof HTMLElement && skipBtn.offsetParent !== null) {
          skipBtn.click();
          return true;
        }

        // Fast-forward to end
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration;
          video.muted = false;
          return true;
        }

        // Last resort: set playback rate to 16x to burn through the ad
        if (video.playbackRate < 16) {
          video.playbackRate = 16;
          video.addEventListener('ended', () => { video.playbackRate = 1; }, { once: true });
        }

        return false;
      }

      /**
       * Stops the auto-skip loop.
       * @returns {void}
       */
      function stopAutoSkipLoop() {
        if (autoSkipIntervalId !== 0) {
          clearInterval(autoSkipIntervalId);
          autoSkipIntervalId = 0;
        }
        missingPlayerTicks = 0;
      }

      /**
       * Starts the auto-skip loop if a player is present.
       * @returns {void}
       */
      function ensureAutoSkipLoop() {
        if (autoSkipIntervalId !== 0) {
          return;
        }

        let consecutiveNoAdTicks = 0;
        autoSkipIntervalId = setInterval(() => {
          try {
            const player = getPlayerElement();
            if (!player) {
              missingPlayerTicks += 1;
              if (missingPlayerTicks >= 12) {
                stopAutoSkipLoop();
              }
              return;
            }

            missingPlayerTicks = 0;

            // Only act if ad is actually showing — stop the loop if no ad for 3s
            const isAdShowing = player.classList.contains('ad-showing')
              || document.querySelector('.ytp-ad-player-overlay') !== null;

            if (!isAdShowing) {
              consecutiveNoAdTicks += 1;
              if (consecutiveNoAdTicks >= 30) {  // 3 seconds at 100ms
                stopAutoSkipLoop();
              }
              return;
            }

            consecutiveNoAdTicks = 0;
            clickSkipButton();
            fastForwardAd();
          } catch {
            // Ignore loop failures.
          }
        }, 100);
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
              storedValue = sanitizer(value);
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
      installInnertubeFetchInterceptor();

      document.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });

      setTimeout(() => {
        try {
          root.ytInitialPlayerResponse = stripAdData(root.ytInitialPlayerResponse);
          root.ytInitialData = stripInitialData(root.ytInitialData);
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
