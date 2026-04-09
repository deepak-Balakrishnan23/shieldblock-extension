(function registerShieldBlockSetConstantScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['set-constant']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function setConstantScriptlet(propertyPath, value) {
    try {
      const root = globalThis;

      const defineConstant = (path, constantValue) => {
        if (typeof path !== 'string' || path.length === 0) {
          return;
        }

        const segments = path.split('.');
        const propertyName = segments.pop();
        let target = root;

        for (const segment of segments) {
          if (!segment) {
            return;
          }

          if (!target[segment] || typeof target[segment] !== 'object') {
            target[segment] = {};
          }
          target = target[segment];
        }

        if (!propertyName) {
          return;
        }

        Object.defineProperty(target, propertyName, {
          configurable: false,
          enumerable: true,
          writable: false,
          value: constantValue,
        });
      };

      if (typeof propertyPath === 'string') {
        defineConstant(propertyPath, value);
        return;
      }

      defineConstant('canRunAds', true);
      defineConstant('isAdBlockActive', false);
      defineConstant('adBlockEnabled', false);
      defineConstant('adblockDetector', undefined);
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['set-constant'] = setConstantScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  setConstantScriptlet();
})();
