(function registerShieldBlockAbortOnPropertyReadScriptlet() {
  'use strict';

  function abortOnPropertyReadScriptlet(propertyName) {
    try {
      const root = globalThis;

      const installTrap = (name) => {
        if (typeof name !== 'string' || !name) {
          return;
        }

        Object.defineProperty(root, name, {
          configurable: true,
          enumerable: false,
          get() {
            throw new ReferenceError(`ShieldBlock aborted access to ${name}`);
          },
          set() {
            return true;
          },
        });
      };

      if (typeof propertyName === 'string') {
        installTrap(propertyName);
        return;
      }

      installTrap('BlockAdBlock');
      installTrap('FuckAdBlock');
      installTrap('SniffAdBlock');
    } catch {
      // Ignore scriptlet failures.
    }
  }

  abortOnPropertyReadScriptlet();
})();
