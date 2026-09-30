(function registerShieldBlockNoFetchIfScriptlet() {
  'use strict';

  function noFetchIfScriptlet() {
    try {
      const root = globalThis;
      if (typeof root.fetch !== 'function' || root.fetch.__shieldblockWrapped === true) {
        return;
      }

      const originalFetch = root.fetch;

      // Store original unwrapped fetch so other scriptlets can bypass this wrapper
      if (!root.__sbOriginalFetch) {
        root.__sbOriginalFetch = originalFetch;
      }
      const blockPattern = /(adserver|pagefair|sourcepoint\.com\/api|amazon-adsystem|doubleclick\.net\/activity|imasdk\.googleapis\.com|\/api\/stats\/ads\?|get_midroll_info|\/ptracking|pagead2\.googlesyndication\.com\/pagead)/i;

      const wrappedFetch = function shieldBlockFetch(resource, init) {
        try {
          const requestUrl = typeof resource === 'string'
            ? resource
            : String(resource?.url ?? resource?.toString?.() ?? '');

          if (blockPattern.test(requestUrl)) {
            return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
          }
        } catch {
          // Fall through to original fetch.
        }

        return Reflect.apply(originalFetch, this, [resource, init]);
      };

      Object.defineProperty(wrappedFetch, '__shieldblockWrapped', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: true,
      });

      root.fetch = wrappedFetch;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  noFetchIfScriptlet();
})();
