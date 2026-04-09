(function registerShieldBlockGoogleTagScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['google-tag']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function googleTagScriptlet() {
    try {
      const root = globalThis;

      const noop = () => undefined;
      const slotApi = {
        addService() {
          return this;
        },
        defineSizeMapping() {
          return this;
        },
        setTargeting() {
          return this;
        },
        setCollapseEmptyDiv() {
          return this;
        },
      };
      const pubadsApi = {
        addEventListener: noop,
        clearTargeting: noop,
        collapseEmptyDivs: noop,
        disableInitialLoad: noop,
        enableAsyncRendering: noop,
        enableSingleRequest: noop,
        refresh: noop,
        removeEventListener: noop,
        setCentering: noop,
        setForceSafeFrame: noop,
        setPrivacySettings: noop,
        setRequestNonPersonalizedAds: noop,
        setTargeting: noop,
      };
      const commandQueue = Array.isArray(root.googletag?.cmd) ? root.googletag.cmd : [];
      if (typeof commandQueue.push !== 'function') {
        Object.defineProperty(commandQueue, 'push', {
          configurable: true,
          writable: true,
          value() {
            return 0;
          },
        });
      } else {
        commandQueue.push = () => 0;
      }

      const googletag = (root.googletag && typeof root.googletag === 'object')
        ? root.googletag
        : {};
      googletag.cmd = commandQueue;
      if (typeof googletag.defineSlot !== 'function') {
        googletag.defineSlot = () => slotApi;
      }
      if (typeof googletag.pubads !== 'function') {
        googletag.pubads = () => pubadsApi;
      }
      if (typeof googletag.enableServices !== 'function') {
        googletag.enableServices = noop;
      }
      if (typeof googletag.display !== 'function') {
        googletag.display = noop;
      }
      if (typeof googletag.destroySlots !== 'function') {
        googletag.destroySlots = () => true;
      }

      try {
        Object.defineProperty(root, 'googletag', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: googletag,
        });
      } catch {
        root.googletag = googletag;
      }

      const adsbygoogle = Array.isArray(root.adsbygoogle) ? root.adsbygoogle : [];
      Object.defineProperty(adsbygoogle, 'push', {
        configurable: true,
        writable: true,
        value() {
          return adsbygoogle.length;
        },
      });
      try {
        Object.defineProperty(root, 'adsbygoogle', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: adsbygoogle,
        });
      } catch {
        root.adsbygoogle = adsbygoogle;
      }

      const googleTagManager = (root.google_tag_manager && typeof root.google_tag_manager === 'object')
        ? root.google_tag_manager
        : {};
      try {
        Object.defineProperty(root, 'google_tag_manager', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: googleTagManager,
        });
      } catch {
        root.google_tag_manager = googleTagManager;
      }

      const googlefc = (root.googlefc && typeof root.googlefc === 'object')
        ? root.googlefc
        : {};
      googlefc.callbackQueue = googlefc.callbackQueue && typeof googlefc.callbackQueue === 'object'
        ? googlefc.callbackQueue
        : {};
      googlefc.callbackQueue.push = () => 0;
      try {
        Object.defineProperty(root, 'googlefc', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: googlefc,
        });
      } catch {
        root.googlefc = googlefc;
      }
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['google-tag'] = googleTagScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  googleTagScriptlet();
})();
