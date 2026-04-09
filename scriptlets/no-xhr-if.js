(function registerShieldBlockNoXhrIfScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['no-xhr-if']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function noXhrIfScriptlet() {
    try {
      const xhrPrototype = globalThis.XMLHttpRequest?.prototype;
      if (!xhrPrototype || typeof xhrPrototype.open !== 'function' || typeof xhrPrototype.send !== 'function' || xhrPrototype.open.__shieldblockWrapped === true) {
        return;
      }

      const originalOpen = xhrPrototype.open;
      const originalSend = xhrPrototype.send;
      const blockPattern = /(adserver|pagefair|sourcepoint\.com\/api|amazon-adsystem|doubleclick\.net\/activity)/i;

      const wrappedOpen = function shieldBlockXhrOpen(method, url, ...rest) {
        try {
          const requestUrl = typeof url === 'string'
            ? url
            : String(url?.toString?.() ?? '');
          this.__shieldblockBlockedXhr = blockPattern.test(requestUrl);
        } catch {
          this.__shieldblockBlockedXhr = false;
        }

        return Reflect.apply(originalOpen, this, [method, url, ...rest]);
      };

      const wrappedSend = function shieldBlockXhrSend(...args) {
        if (this.__shieldblockBlockedXhr === true) {
          globalThis.__sb_xhrBlocked = Number(globalThis.__sb_xhrBlocked || 0) + 1;
          try {
            this.abort();
          } catch {
            // Ignore abort errors.
          }
          return undefined;
        }

        return Reflect.apply(originalSend, this, args);
      };

      Object.defineProperty(wrappedOpen, '__shieldblockWrapped', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: true,
      });

      xhrPrototype.open = wrappedOpen;
      xhrPrototype.send = wrappedSend;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['no-xhr-if'] = noXhrIfScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  noXhrIfScriptlet();
})();
