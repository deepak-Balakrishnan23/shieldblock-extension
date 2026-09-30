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

      root.admiral = admiralStub;

      root.FuseAdTag = fuseAdTag;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  noAdmiralScriptlet();
})();
