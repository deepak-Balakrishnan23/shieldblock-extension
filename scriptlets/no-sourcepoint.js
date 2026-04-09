(function registerShieldBlockNoSourcepointScriptlet() {
  'use strict';

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  if (registry['no-sourcepoint']) {
    globalThis.__shieldblockScriptletDefinitions = registry;
    return;
  }

  function noSourcepointScriptlet() {
    try {
      const root = globalThis;
      const queueStub = {
        push() {
          return 0;
        },
      };
      const spStub = {
        config: {},
        nq() {
          return 0;
        },
        cmd: queueStub,
      };

      try {
        Object.defineProperty(root, '_sp_', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: root._sp_ && typeof root._sp_ === 'object' ? root._sp_ : spStub,
        });
      } catch {
        root._sp_ = spStub;
      }

      try {
        Object.defineProperty(root, '_sp_v1', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: root._sp_v1 && typeof root._sp_v1 === 'object' ? root._sp_v1 : {
            config: {},
            nq() {
              return 0;
            },
            cmd: { push() { return 0; } },
          },
        });
      } catch {
        root._sp_v1 = {
          config: {},
          nq() {
            return 0;
          },
          cmd: { push() { return 0; } },
        };
      }

      const tcfApi = function shieldBlockTcfApi(_command, _version, callback) {
        if (typeof callback === 'function') {
          callback({
            gdprApplies: false,
            tcString: '',
          }, true);
        }
        return {
          gdprApplies: false,
          tcString: '',
        };
      };

      const cmpApi = function shieldBlockCmpApi(_command, callback) {
        if (typeof callback === 'function') {
          callback({}, true);
        }
        return {};
      };

      try {
        Object.defineProperty(root, '__tcfapi', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: tcfApi,
        });
      } catch {
        root.__tcfapi = tcfApi;
      }

      try {
        Object.defineProperty(root, '__cmp', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: cmpApi,
        });
      } catch {
        root.__cmp = cmpApi;
      }
    } catch {
      // Ignore scriptlet failures.
    }
  }

  registry['no-sourcepoint'] = noSourcepointScriptlet;
  globalThis.__shieldblockScriptletDefinitions = registry;

  // Self-execute immediately when loaded directly via manifest at document_start
  noSourcepointScriptlet();
})();
