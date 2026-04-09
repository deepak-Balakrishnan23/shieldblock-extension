(function registerShieldBlockPreventSetTimeoutScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['prevent-setTimeout']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function preventSetTimeoutScriptlet() {
    try {
      const root = globalThis;
      if (typeof root.setTimeout !== 'function' || root.setTimeout.__shieldblockWrapped === true) {
        return;
      }

      const originalSetTimeout = root.setTimeout;
      const blockedPatterns = [
        'adblock',
        'adblocker',
        'adBlocker',
        'BlockAdBlock',
        'fuckadblock',
        'admiral',
        '_sp_',
        'sourcepoint',
      ].map((pattern) => pattern.toLowerCase());

      const wrappedSetTimeout = function shieldBlockSetTimeout(callback, delay, ...rest) {
        try {
          const callbackSource = typeof callback === 'function'
            ? Function.prototype.toString.call(callback)
            : String(callback ?? '');
          const lowerSource = callbackSource.toLowerCase();
          if (blockedPatterns.some((pattern) => lowerSource.includes(pattern.toLowerCase()))) {
            return 0;
          }
        } catch {
          // Fall through to the original timer.
        }

        return Reflect.apply(originalSetTimeout, this, [callback, delay, ...rest]);
      };

      Object.defineProperty(wrappedSetTimeout, '__shieldblockWrapped', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: true,
      });

      root.setTimeout = wrappedSetTimeout;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['prevent-setTimeout'] = preventSetTimeoutScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  preventSetTimeoutScriptlet();
})();
