(function registerShieldBlockNoAdmiralScriptlet() {
  'use strict';

  function noAdmiralScriptlet() {
    try {
      const root = globalThis;
      const noop = () => undefined;

      const admiralStub = function shieldBlockAdmiral() {
        return undefined;
      };

      const fuseAdTag = (root.FuseAdTag && typeof root.FuseAdTag === 'object')
        ? root.FuseAdTag
        : {};
      if (typeof fuseAdTag.init !== 'function') {
        fuseAdTag.init = noop;
      }
      if (typeof fuseAdTag.createAd !== 'function') {
        fuseAdTag.createAd = noop;
      }

      try {
        Object.defineProperty(root, 'admiral', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: admiralStub,
        });
      } catch {
        root.admiral = admiralStub;
      }

      try {
        Object.defineProperty(root, 'FuseAdTag', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: fuseAdTag,
        });
      } catch {
        root.FuseAdTag = fuseAdTag;
      }
    } catch {
      // Ignore scriptlet failures.
    }
  }

  noAdmiralScriptlet();
})();
