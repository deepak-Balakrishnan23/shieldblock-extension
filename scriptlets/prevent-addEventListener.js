(function registerShieldBlockPreventAddEventListenerScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['prevent-addEventListener']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function preventAddEventListenerScriptlet() {
    try {
      const prototype = globalThis.EventTarget?.prototype;
      if (!prototype || typeof prototype.addEventListener !== 'function' || prototype.addEventListener.__shieldblockWrapped === true) {
        return;
      }

      const originalAddEventListener = prototype.addEventListener;
      const blockedEvents = new Set(['adblockdetected', 'adsblocked', 'noad']);
      const blockedPatterns = /(wall|overlay|disable\s+your\s+ad\s*block|blocker|subscribe)/i;

      const wrappedAddEventListener = function shieldBlockAddEventListener(type, listener, options) {
        try {
          const normalizedType = String(type ?? '').toLowerCase();
          const source = typeof listener === 'function'
            ? Function.prototype.toString.call(listener)
            : String(listener ?? '');

          if (blockedEvents.has(normalizedType) && blockedPatterns.test(source)) {
            return undefined;
          }
        } catch {
          // Fall through to the original listener registration.
        }

        return Reflect.apply(originalAddEventListener, this, [type, listener, options]);
      };

      Object.defineProperty(wrappedAddEventListener, '__shieldblockWrapped', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: true,
      });

      prototype.addEventListener = wrappedAddEventListener;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['prevent-addEventListener'] = preventAddEventListenerScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  preventAddEventListenerScriptlet();
})();
