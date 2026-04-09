(function registerShieldBlockNoConfiantScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['no-confiant']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function noConfiantScriptlet() {
    try {
      const root = globalThis;
      const noop = () => undefined;

      const confiant = (root.confiant && typeof root.confiant === 'object')
        ? root.confiant
        : {};
      confiant.cmd = Array.isArray(confiant.cmd) ? confiant.cmd : [];
      Object.defineProperty(confiant.cmd, 'push', {
        configurable: true,
        writable: true,
        value() {
          return 0;
        },
      });
      if (typeof confiant.renderAd !== 'function') {
        confiant.renderAd = noop;
      }
      if (typeof confiant.enableBlocking !== 'function') {
        confiant.enableBlocking = noop;
      }
      if (!confiant.settings || typeof confiant.settings !== 'object') {
        confiant.settings = {};
      }

      try {
        Object.defineProperty(root, 'confiant', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: confiant,
        });
      } catch {
        root.confiant = confiant;
      }
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['no-confiant'] = noConfiantScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  noConfiantScriptlet();
})();
