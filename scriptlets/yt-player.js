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

      /**
       * Keys deleted wherever they appear in an Innertube payload. These carry
       * the ad *schedule* — remove them and the player never asks for a break.
       */
      const AD_KEYS = new Set([
        'adSlots',
        'playerAds',
        'playerAdsConfig',
        'adPlacements',
        'adPlacementsConfig',
        'adBreakHeartbeatParams',
        'adBreaks',
        'adPreroll',
        'adPostroll',
        'adParams',
        'adSafetyReason',
        'adServingDataEntity',
        'auxiliaryUi',
        'paidContentOverlay',
        'survey',
      ]);
      // `externalVideoId` was deliberately left out of the list above. It is a
      // video identifier, not an ad key, and this walk deletes keys at every
      // depth — so it was being stripped from legitimate branches of the player
      // response as well as ad ones. Removing it bought nothing, because the ad
      // subtrees that contain it (adPlacements, playerAds, adSlots) are deleted
      // wholesale anyway, and a player response missing video ids is a plausible
      // cause of the player failing to start on its own.

      /**
       * Renderer keys that *are* an ad. Feed, search, Shorts, and watch-page
       * ads all arrive as one of these inside `contents` arrays, so deleting
       * the key empties the entry and the array prune below drops the husk.
       */
      const AD_RENDERER_KEYS = new Set([
        'actionCompanionAdRenderer',
        'adDurationRemaining',
        'adIntroRenderer',
        'adShelfRenderer',
        'adSlot',
        'adSlotAndLayoutMetadata',
        'adSlotRenderer',
        'adsEngagementPanelRenderer',
        'bannerPromoRenderer',
        'brandVideoShelfRenderer',
        'brandVideoSingletonRenderer',
        'carouselAdRenderer',
        'compactPromotedItemRenderer',
        'compactPromotedVideoRenderer',
        'displayAdRenderer',
        'inFeedAdLayoutRenderer',
        'instreamAdPlayerOverlayRenderer',
        'instreamVideoAdRenderer',
        'linearAdSequenceRenderer',
        'mealbarPromoRenderer',
        'playerLegacyDesktopWatchAdsRenderer',
        'primetimePromoRenderer',
        'promotedSparklesTextSearchRenderer',
        'promotedSparklesWebRenderer',
        'promotedVideoRenderer',
        'searchPyvRenderer',
        'sparklesLightCtaRenderer',
        'statementBannerRenderer',
        'videoMastheadAdV3Renderer',
      ]);

      /**
       * Branches that must never be walked. They hold the playable video and
       * nothing ad-shaped, and a mistaken deletion inside them breaks playback.
       */
      const PROTECTED_KEYS = new Set([
        'videoDetails',
        'playabilityStatus',
        'streamingData',
      ]);

      /**
       * Keys that carry no content of their own. An entry left holding only
       * these after an ad renderer was deleted is an empty husk, not a video.
       */
      const METADATA_KEYS = new Set([
        'clickTrackingParams',
        'identifier',
        'layout',
        'loggingDirectives',
        'style',
        'targetId',
        'trackingParams',
      ]);

      /**
       * Top-level keys that mark a payload as worth walking. Used to keep the
       * JSON.parse hook off the rest of the JSON a YouTube page parses.
       */
      const INNERTUBE_MARKERS = [
        'adPlacements',
        'playerAds',
        'adSlots',
        'adPlacementsConfig',
        'playerAdsConfig',
        'contents',
        'continuationContents',
        'onResponseReceivedActions',
        'onResponseReceivedCommands',
        'onResponseReceivedEndpoints',
        'engagementPanels',
        'playerOverlays',
        'overlay',
        'streamingData',
        'playerResponse',
        'frameworkUpdates',
        'items',
      ];

      // Recursion bounds. YouTube payloads nest deeply but not unboundedly;
      // the caps make a malformed or hostile payload cheap to bail out of.
      const MAX_PRUNE_DEPTH = 64;
      const MAX_EMPTY_CHECK_DEPTH = 8;

      const SKIP_SELECTOR = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button-container button',
        'button.ytp-ad-skip-button-modern',
        '[class*="ytp-ad-skip-button"]',
      ].join(', ');
      const OVERLAY_CLOSE_SELECTOR = [
        '.ytp-ad-overlay-close-button',
        '.ytp-ad-overlay-close-container',
        '.ytp-ad-feedback-dialog-close-button',
      ].join(', ');
      // How long after burning an ad we will try to resume playback.
      const AD_RESUME_WINDOW_MS = 4000;
      const AD_PASS_INTERVAL_MS = 200;
      const CLICK_THROTTLE_MS = 700;

      // Captured before the hooks below replace it. The interceptors parse with
      // this so what they see is the payload as the server sent it: parsing
      // through the hooked JSON.parse would strip the ads first, and the
      // interceptor would conclude there had been nothing to strip.
      const nativeJsonParse = root.JSON && root.JSON.parse;

      let autoSkipIntervalId = 0;
      let playerObserver = null;
      let observedPlayer = null;
      const clickedAt = new WeakMap();
      let adMuted = false;
      let burnedAdAt = 0;
      let autoplayAttemptedSrc = '';
      // The viewer's own playback rate, saved while an ad is burned at 16x.
      let preAdPlaybackRate = 0;
      // The media source the player was holding the last time it was not
      // showing an ad — i.e. the video the viewer actually asked for.
      let mainVideoSrc = '';

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
       * Returns true when an entry has been reduced to a husk — nothing left
       * but empty containers and tracking metadata. That is what an array entry
       * looks like once its ad renderer has been deleted, and dropping it is
       * what keeps an empty slot from rendering in the feed.
       * @param {unknown} node
       * @param {number} depth
       * @returns {boolean}
       */
      function isEmptyHusk(node, depth) {
        if (depth >= MAX_EMPTY_CHECK_DEPTH || !isObject(node)) {
          return false;
        }

        if (Array.isArray(node)) {
          return node.every((item) => isEmptyHusk(item, depth + 1));
        }

        for (const [key, value] of Object.entries(node)) {
          if (METADATA_KEYS.has(key)) {
            continue;
          }
          if (!isObject(value) || !isEmptyHusk(value, depth + 1)) {
            return false;
          }
        }

        return true;
      }

      /**
       * Strips every ad payload from an Innertube response, in place.
       *
       * One walk handles all of them: the watch page's ad schedule, the feed
       * and search ad renderers, and the Shorts ad slots. Previously the player
       * response and `ytInitialData` had separate, narrower walks — the feed
       * walk only looked under `contents` and only knew one key — so ads in
       * `/youtubei/v1/next`, `/browse`, `/search`, and `/reel` responses were
       * left in the payload for the cosmetic layer to chase by selector.
       * @param {unknown} input
       * @param {{removed: number}} [stats] Counts what was taken out, so a
       *   caller can tell an untouched payload from a cleaned one.
       * @returns {unknown}
       */
      function pruneAds(input, stats) {
        if (!isObject(input)) {
          return input;
        }

        const seen = new WeakSet();
        const count = () => {
          if (stats) stats.removed += 1;
        };

        const visit = (node, depth) => {
          if (!isObject(node) || depth > MAX_PRUNE_DEPTH || seen.has(node)) {
            return node;
          }
          seen.add(node);

          if (Array.isArray(node)) {
            for (const item of node) {
              visit(item, depth + 1);
            }

            // Walk backwards so removals do not shift the pending indices.
            for (let index = node.length - 1; index >= 0; index -= 1) {
              if (isEmptyHusk(node[index], 0)) {
                node.splice(index, 1);
                count();
              }
            }

            return node;
          }

          for (const key of Object.keys(node)) {
            if (AD_KEYS.has(key) || AD_RENDERER_KEYS.has(key)) {
              delete node[key];
              count();
            }
          }

          for (const [key, value] of Object.entries(node)) {
            if (!isObject(value) || PROTECTED_KEYS.has(key)) {
              continue;
            }
            visit(value, depth + 1);
          }

          return node;
        };

        return visit(input, 0);
      }

      /**
       * Returns true when a parsed value looks like an Innertube payload worth
       * walking. Keeps the JSON.parse hook from touching unrelated JSON.
       * @param {unknown} value
       * @returns {boolean}
       */
      function looksLikeInnertubePayload(value) {
        if (!isObject(value) || Array.isArray(value)) {
          return false;
        }
        return INNERTUBE_MARKERS.some((marker) => marker in value);
      }

      /**
       * Returns true for the Innertube endpoints that can carry ads.
       * @param {string} url
       * @returns {boolean}
       */
      function isInnertubeUrl(url) {
        return typeof url === 'string' && url.includes('/youtubei/');
      }

      /**
       * Intercepts YouTube's Innertube fetch calls and strips ad data from the
       * response before YouTube's player or renderer processes it. This is the
       * primary ad delivery mechanism, and it covers every endpoint rather than
       * only `/player` — feed, search, watch-next, and Shorts ads arrive on
       * `/browse`, `/search`, `/next`, and `/reel` respectively.
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

          // Let everything that is not an Innertube call pass through to the
          // previous wrapper (no-fetch-if) normally. Same when protection is
          // paused or the site is allowlisted.
          if (!isInnertubeUrl(url) || !isActive()) {
            return Reflect.apply(previousFetch, this, [resource, init]);
          }

          // For Innertube calls, use the original unwrapped fetch so no-fetch-if
          // cannot blank a response the page needs.
          const response = await Reflect.apply(originalFetch, this, [resource, init]);

          try {
            // .text() rather than .json(): Response.prototype.json is hooked
            // below, and going through it would prune the payload before the
            // count above could see that anything had been pruned.
            const json = nativeJsonParse(await response.clone().text());
            if (!isObject(json)) {
              return response;
            }

            const stats = { removed: 0 };
            pruneAds(json, stats);

            // Most Innertube responses carry no ads at all. Handing those back
            // untouched keeps re-serialization — and everything a rebuilt
            // Response quietly loses — off every call but the ones that
            // actually needed cleaning.
            if (stats.removed === 0) {
              return response;
            }

            // Rebuild headers from the original response but drop entity headers
            // that no longer describe our re-serialized body. The upstream body
            // arrives compressed (content-encoding: gzip/br) with its own
            // content-length; our JSON string is plain and a different size, so
            // reusing those headers makes the browser fail to decode the body
            // (ERR_CONTENT_DECODING_FAILED) or hit a length mismatch — both of
            // which intermittently break video playback.
            const cleanHeaders = new Headers();
            response.headers.forEach((value, key) => {
              const name = key.toLowerCase();
              if (name === 'content-encoding' || name === 'content-length') {
                return;
              }
              cleanHeaders.set(key, value);
            });
            cleanHeaders.set('content-type', 'application/json; charset=utf-8');

            const sanitized = new Response(JSON.stringify(json), {
              status: response.status,
              statusText: response.statusText,
              headers: cleanHeaders,
            });

            // A constructed Response has an empty `url`. Carry the real one
            // over so callers that read it off the response still see it.
            try {
              Object.defineProperty(sanitized, 'url', { value: response.url });
            } catch { /* ignore */ }

            return sanitized;
          } catch {
            // Sanitization failed (non-JSON body, stream error). Hand back the
            // untouched response — re-issuing the request here would double
            // every Innertube call the page makes.
            return response;
          }
        };

        try {
          Object.defineProperty(root.fetch, '__sbYtWrapped', {
            value: true, configurable: true, enumerable: false, writable: false
          });
        } catch { /* ignore */ }
      }

      /**
       * Sanitizes a finished Innertube XHR in place.
       *
       * Registered from `open()` rather than `send()` on purpose: a page's own
       * `onreadystatechange`/`onload` handler is attached between those two
       * calls, and listeners fire in registration order. Registering at send
       * time — as this did before — put our listener *after* YouTube's, so
       * YouTube read the unsanitized body and the rewritten getters below
       * arrived too late to matter.
       * @this {XMLHttpRequest}
       * @returns {void}
       */
      function sanitizeInnertubeXhr() {
        if (this.readyState !== 4 || this.__sb_yt_innertube !== true || !isActive()) {
          return;
        }

        try {
          const responseType = this.responseType;
          if (responseType !== '' && responseType !== 'text' && responseType !== 'json') {
            return;
          }

          const parsed = responseType === 'json'
            ? this.response
            : nativeJsonParse(this.responseText);

          if (!isObject(parsed)) return;

          const stats = { removed: 0 };
          pruneAds(parsed, stats);
          if (stats.removed === 0) {
            return;
          }

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
      }

      /**
       * Intercepts YouTube's Innertube XHR calls and strips ad data from the
       * response. Some YouTube clients still deliver payloads over XHR rather
       * than fetch; this complements the fetch path. Sanitization is
       * best-effort — on any failure the original response is left untouched so
       * playback is never broken.
       * @returns {void}
       */
      function installInnertubeXhrInterceptor() {
        if (root.__sb_innertube_xhr_hooked === true) return;
        const XHR = root.XMLHttpRequest;
        if (typeof XHR !== 'function' || !XHR.prototype) return;
        root.__sb_innertube_xhr_hooked = true;

        const originalOpen = XHR.prototype.open;

        XHR.prototype.open = function shieldBlockYtXhrOpen(method, url, ...rest) {
          try {
            const requestUrl = typeof url === 'string' ? url : String(url || '');
            this.__sb_yt_innertube = isInnertubeUrl(requestUrl);
          } catch {
            this.__sb_yt_innertube = false;
          }

          if (this.__sb_yt_innertube === true && this.__sb_yt_listening !== true) {
            this.__sb_yt_listening = true;
            this.addEventListener('readystatechange', sanitizeInnertubeXhr);
          }

          return Reflect.apply(originalOpen, this, [method, url, ...rest]);
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
       * Hooks JSON.parse and Response.prototype.json so ad data is stripped no
       * matter which transport delivers it. Modern YouTube parses the player,
       * next, and browse payloads from text in code paths the fetch and XHR
       * wrappers never observe, so this is the catch-all that actually removes
       * the ads the targeted hooks miss. Installed only on YouTube surfaces to
       * avoid touching JSON parsing on the wider web.
       * @returns {void}
       */
      function installJsonHooks() {
        if (root.__sb_yt_json_hooked === true || !isYouTubeHost()) return;
        root.__sb_yt_json_hooked = true;

        try {
          const originalParse = nativeJsonParse;
          root.JSON.parse = function shieldBlockJsonParse(text, reviver) {
            const result = Reflect.apply(originalParse, this, [text, reviver]);
            try {
              if (isActive() && looksLikeInnertubePayload(result)) {
                pruneAds(result);
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
                if (isActive() && looksLikeInnertubePayload(data)) {
                  pruneAds(data);
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
       * Returns the video element belonging to a player.
       *
       * Scoped to the player rather than the document: a YouTube feed page can
       * hold several <video> elements, and the first one in the document is not
       * necessarily the one the player is driving.
       * @param {Element | null} player
       * @returns {HTMLVideoElement | null}
       */
      function getVideoElement(player) {
        const scoped = player ? player.querySelector('video') : null;
        if (scoped instanceof HTMLVideoElement) {
          return scoped;
        }
        const fallback = document.querySelector('video');
        return fallback instanceof HTMLVideoElement ? fallback : null;
      }

      /**
       * Clicks every skip/close control matching a selector, throttled per
       * element.
       *
       * Visibility is deliberately not required. ShieldBlock's own cosmetic
       * layer hides `.ytp-ad-skip-button*` and the overlay containers, which
       * made the previous `offsetParent !== null` check fail for every button
       * on the page — the skip path could never fire, leaving the seek fallback
       * to do all the work. `HTMLElement.click()` dispatches fine on a hidden
       * element, so the control still works with the cosmetic rules in place.
       * @param {string} selector
       * @returns {boolean}
       */
      function clickControls(selector) {
        let clicked = false;
        const now = Date.now();

        for (const control of document.querySelectorAll(selector)) {
          if (!(control instanceof HTMLElement) || control.hasAttribute('disabled')) {
            continue;
          }

          const last = clickedAt.get(control) || 0;
          if (now - last < CLICK_THROTTLE_MS) {
            continue;
          }

          clickedAt.set(control, now);
          control.click();
          clicked = true;
        }

        return clicked;
      }

      /**
       * Returns true when a video ad is playing in the player element itself.
       *
       * The player's own class is the only signal precise enough to justify
       * seeking, since seeking on a false positive would send the real video to
       * its end. Overlay containers are not consulted: YouTube leaves them in
       * the DOM when empty, and a banner overlay over the real video is not a
       * reason to mute or seek anything.
       * @param {Element} player
       * @returns {boolean}
       */
      function isVideoAdPlaying(player) {
        return player.classList.contains('ad-showing')
          || player.classList.contains('ad-interrupting');
      }

      /**
       * Starts playback once per video when the player loaded it but never
       * started it.
       *
       * Removing the pre-roll is what exposes this: YouTube's own autoplay is
       * driven by the ad/playback sequence, so with the ad gone the real video
       * can sit ready at 0:00 and wait for a manual click.
       *
       * Deliberately conservative — one attempt per media source, only while the
       * video is loaded, paused, and still untouched at 0:00. A video the viewer
       * paused themselves has `currentTime > 0` and is left alone.
       * @param {HTMLVideoElement} video
       * @returns {void}
       */
      function restoreAutoplay(video) {
        const source = video.currentSrc || video.src || '';
        if (!source || autoplayAttemptedSrc === source) {
          return;
        }

        // HAVE_CURRENT_DATA or better; before that `paused` is not meaningful.
        if (video.readyState < 2) {
          return;
        }

        autoplayAttemptedSrc = source;
        if (!video.paused || video.currentTime > 0 || video.ended) {
          return;
        }

        const started = video.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => {
            // Autoplay refused by the browser; the viewer can still press play.
          });
        }
      }

      /**
       * Undoes the mute and rate changes made for an ad.
       * @param {HTMLVideoElement | null} video
       * @returns {void}
       */
      function restorePlaybackState(video) {
        if (!video) {
          return;
        }
        if (adMuted) {
          video.muted = false;
          adMuted = false;
        }
        // Restore the rate the viewer chose, not a hardcoded 1x — someone
        // watching at 1.5x should still be at 1.5x once the ad is gone.
        if (preAdPlaybackRate !== 0) {
          if (video.playbackRate > 8) {
            video.playbackRate = preAdPlaybackRate;
          }
          preAdPlaybackRate = 0;
        }
      }

      /**
       * Skips or fast-forwards the current ad, and restores playback state when
       * no ad is present. Called from a persistent loop and from the player's
       * class mutations, so pre-roll, mid-roll, and back-to-back ads are all
       * handled — not just the first ad on page load.
       * @param {Element | null} player
       * @param {HTMLVideoElement | null} video
       * @returns {boolean}
       */
      function burnVideoAd(player, video) {
        if (!player || !video) {
          return false;
        }

        if (!isVideoAdPlaying(player)) {
          restorePlaybackState(video);

          // Remember what the viewer is watching, so the ad state below can
          // tell the ad's media from theirs. Skipped while the element is
          // empty, and while it sits at the end of an ad we just burned, since
          // neither is the video they asked for. Readiness is deliberately not
          // required: a source that is still buffering is theirs too.
          if (!video.ended) {
            const current = video.currentSrc || video.src || '';
            if (current !== '') {
              mainVideoSrc = current;
            }
          }

          // Seeking an ad to its end fires `ended` on the player, and the real
          // video that follows often stays paused — leaving the user to press
          // play manually. Resume it, but only in a short window after we
          // actually burned an ad, so a deliberate pause is never overridden.
          if (burnedAdAt !== 0) {
            if (!video.paused) {
              burnedAdAt = 0;
            } else if (Date.now() - burnedAdAt > AD_RESUME_WINDOW_MS) {
              burnedAdAt = 0;
            } else if (!video.ended) {
              const resumed = video.play();
              if (resumed && typeof resumed.catch === 'function') {
                resumed.catch(() => {
                  // Autoplay refused; the user can still start it manually.
                });
              }
            }
          }

          restoreAutoplay(video);
          return false;
        }

        // Wait for the player to actually swap in the ad's media.
        //
        // `ad-showing` goes on the player before that swap, and in that window
        // the element is still holding the video the viewer asked for — with
        // *its* duration. Seeking then sends their video to its end and leaves
        // a blank player. The class observer fires at exactly that instant, so
        // this window is hit often rather than rarely.
        const source = video.currentSrc || video.src || '';
        if (source !== '' && source === mainVideoSrc) {
          return true;
        }

        // Mute the ad audio. Remember that *we* muted so we can safely restore.
        if (!video.muted) {
          video.muted = true;
          adMuted = true;
        }

        // Seek the ad to its end. This ends skippable and unskippable ads alike
        // because the ad plays in the same <video> element with its own short
        // duration. Re-applied every pass so back-to-back ads are burned through.
        if (Number.isFinite(video.duration) && video.duration > 0) {
          try {
            video.currentTime = video.duration;
            burnedAdAt = Date.now();
          } catch {
            // Some ad states briefly reject seeking; the next pass retries.
          }
        }

        // Run the rate up as well. When a seek is rejected — or the duration is
        // not known yet — this still drains the ad in a fraction of the time.
        if (video.playbackRate < 16) {
          try {
            if (preAdPlaybackRate === 0) {
              preAdPlaybackRate = video.playbackRate || 1;
            }
            video.playbackRate = 16;
            burnedAdAt = Date.now();
          } catch {
            // Ignore rate rejection.
          }
        }

        return true;
      }

      /**
       * Runs one full ad pass: skip controls, overlay ads, then the video ad.
       * @returns {void}
       */
      function runAdPass() {
        const player = getPlayerElement();
        const video = getVideoElement(player);

        if (!isActive()) {
          // Protection paused/allowlisted — undo any ad-state changes and idle.
          burnedAdAt = 0;
          restorePlaybackState(video);
          return;
        }

        ensurePlayerObserver(player);

        // Skip controls are only touched while the player reports an ad. They
        // linger in the DOM after an ad finishes, and clicking a leftover
        // control would put a click into the real video's player chrome.
        if (player && isVideoAdPlaying(player)) {
          clickControls(SKIP_SELECTOR);
        }

        // Overlay closers are not gated: a banner ad over the real video sets
        // no class on the player, and its close button exists only for the ad.
        clickControls(OVERLAY_CLOSE_SELECTOR);

        burnVideoAd(player, video);
      }

      /**
       * Watches the player's class list so an ad is caught the moment YouTube
       * flips `ad-showing`, instead of up to one poll interval later. The
       * polling loop stays as the backstop for states that change no class.
       * @param {Element | null} player
       * @returns {void}
       */
      function ensurePlayerObserver(player) {
        if (!player || player === observedPlayer || typeof MutationObserver !== 'function') {
          return;
        }

        if (playerObserver) {
          playerObserver.disconnect();
        }

        playerObserver = new MutationObserver(() => {
          try {
            runAdPass();
          } catch {
            // Ignore observer failures; the polling loop retries.
          }
        });
        playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
        observedPlayer = player;
      }

      /**
       * Starts a persistent loop that skips ads for the lifetime of the page.
       * It never self-terminates, so mid-roll and late pre-roll ads are caught
       * instead of slipping through after the loop shut itself off.
       * @returns {void}
       */
      function ensureAutoSkipLoop() {
        if (autoSkipIntervalId !== 0 || !isYouTubeHost()) {
          return;
        }

        autoSkipIntervalId = setInterval(() => {
          try {
            runAdPass();
          } catch {
            // Ignore loop failures; the next tick retries.
          }
        }, AD_PASS_INTERVAL_MS);
      }

      /**
       * Defines a sanitizing accessor on window for a YouTube bootstrap object.
       * @param {string} propertyName
       * @returns {void}
       */
      function installSanitizedProperty(propertyName) {
        let storedValue;

        try {
          storedValue = pruneAds(root[propertyName]);
        } catch {
          storedValue = undefined;
        }

        const descriptor = Object.getOwnPropertyDescriptor(root, propertyName);
        if (descriptor && descriptor.configurable === false) {
          try {
            root[propertyName] = pruneAds(root[propertyName]);
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
              storedValue = isActive() ? pruneAds(value) : value;
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
        // New video: allow one autoplay attempt for it.
        autoplayAttemptedSrc = '';
        burnedAdAt = 0;
        mainVideoSrc = '';
        // The watch page swaps the player element on some navigations.
        observedPlayer = null;

        if (isActive()) {
          try {
            root.ytInitialPlayerResponse = pruneAds(root.ytInitialPlayerResponse);
          } catch {
            // Ignore navigation cleanup failures.
          }

          try {
            root.ytInitialData = pruneAds(root.ytInitialData);
          } catch {
            // Ignore navigation cleanup failures.
          }
        }

        setTimeout(() => {
          try {
            runAdPass();
            ensureAutoSkipLoop();
          } catch {
            // Ignore delayed cleanup failures.
          }
        }, 100);
      }

      // Exposed for the unit tests, which exercise the payload walk without a
      // browser. Non-enumerable so it does not show up in a page's own scans.
      try {
        Object.defineProperty(root, '__shieldblockYtInternals', {
          value: Object.freeze({ pruneAds, looksLikeInnertubePayload, isEmptyHusk }),
          configurable: true,
          enumerable: false,
          writable: false,
        });
      } catch { /* ignore */ }

      // Nothing below applies off YouTube, and the manifest loads this file on
      // every page. Bailing out here keeps the window accessors, the fetch
      // wrapper, and the XHR wrapper off the rest of the web entirely.
      // Embedded players count: a youtube.com/youtube-nocookie.com iframe runs
      // its own copy of this scriptlet with its own hostname.
      if (!isYouTubeHost()) {
        return;
      }

      if (root.__sb_yt_hooked === true) {
        handleNavigation();
        return;
      }

      root.__sb_yt_hooked = true;

      installSanitizedProperty('ytInitialPlayerResponse');
      installSanitizedProperty('ytInitialData');
      installJsonHooks();
      installInnertubeFetchInterceptor();
      installInnertubeXhrInterceptor();

      document.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });

      setTimeout(() => {
        try {
          if (isActive()) {
            root.ytInitialPlayerResponse = pruneAds(root.ytInitialPlayerResponse);
            root.ytInitialData = pruneAds(root.ytInitialData);
          }
          runAdPass();
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
