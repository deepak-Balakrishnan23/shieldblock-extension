(function registerShieldBlockNoSourcepointScriptlet() {
  'use strict';

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

      root._sp_ = root._sp_ && typeof root._sp_ === 'object' ? root._sp_ : spStub;

      root._sp_v1 = root._sp_v1 && typeof root._sp_v1 === 'object' ? root._sp_v1 : { ...spStub };

      // Answers "GDPR applies, nothing consented to". Reporting that GDPR does
      // not apply would tell any vendor script still on the page that it may
      // track without consent.
      const noConsent = { gdprApplies: true, tcString: '' };
      const tcfApi = function shieldBlockTcfApi(_command, _version, callback) {
        if (typeof callback === 'function') {
          callback({ ...noConsent }, true);
        }
        return { ...noConsent };
      };

      const cmpApi = function shieldBlockCmpApi(_command, callback) {
        if (typeof callback === 'function') {
          callback({}, true);
        }
        return {};
      };

      root.__tcfapi = tcfApi;
      root.__cmp = cmpApi;
    } catch {
      // Ignore scriptlet failures.
    }
  }

  noSourcepointScriptlet();
})();
