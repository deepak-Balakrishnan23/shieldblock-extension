(function initializeShieldBlockScriptletEngine() {
  'use strict';

  if (globalThis.__shieldblockScriptletEngineInitialized === true) {
    return;
  }

  globalThis.__shieldblockScriptletEngineInitialized = true;

  const registry = globalThis.__shieldblockScriptletDefinitions || {};
  const SCRIPTLET_MAP = Object.freeze({
    'google-tag': registry['google-tag'],
    'yt-player': registry['yt-player'],
    'no-sourcepoint': registry['no-sourcepoint'],
    'no-admiral': registry['no-admiral'],
    'no-confiant': registry['no-confiant'],
    'prevent-setTimeout': registry['prevent-setTimeout'],
    'prevent-addEventListener': registry['prevent-addEventListener'],
    'set-constant': registry['set-constant'],
    'abort-on-property-read': registry['abort-on-property-read'],
    'no-xhr-if': registry['no-xhr-if'],
    'no-fetch-if': registry['no-fetch-if'],
  });
  const SCRIPTLET_DISABLED_HOSTS = Object.freeze([]);
  const DOMAIN_SCRIPTLETS = Object.freeze({
    '*': Object.freeze(['google-tag', 'set-constant', 'abort-on-property-read']),
    'youtube.com': Object.freeze(['google-tag', 'yt-player', 'no-fetch-if', 'no-xhr-if']),
    'forbes.com': Object.freeze(['no-sourcepoint', 'prevent-setTimeout']),
    'wired.com': Object.freeze(['no-sourcepoint']),
    'theatlantic.com': Object.freeze(['no-admiral']),
    'bloomberg.com': Object.freeze(['no-sourcepoint', 'prevent-setTimeout']),
    'wsj.com': Object.freeze(['no-sourcepoint']),
  });

  try {
    delete globalThis.__shieldblockScriptletDefinitions;
  } catch {
    // Ignore cleanup failures.
  }

  /**
   * Checks whether a hostname matches a configured domain pattern.
   * @param {string} hostname
   * @param {string} pattern
   * @returns {boolean}
   */
  function matchesPattern(hostname, pattern) {
    if (pattern === '*') {
      return true;
    }

    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`) || hostname.endsWith(pattern.slice(1));
    }

    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  }

  /**
   * Resolves the scriptlets that should run for the current hostname.
   * @param {string} hostname
   * @returns {string[]}
   */
  function getApplicableScriptlets(hostname) {
    const normalizedHostname = String(hostname || '').toLowerCase();
    if (SCRIPTLET_DISABLED_HOSTS.some((domain) => matchesPattern(normalizedHostname, domain))) {
      return [];
    }
    const applicable = [];

    for (const [pattern, scriptlets] of Object.entries(DOMAIN_SCRIPTLETS)) {
      if (matchesPattern(normalizedHostname, pattern)) {
        applicable.push(...scriptlets);
      }
    }

    return [...new Set(applicable)];
  }

  /**
   * Injects a scriptlet by name into the page and falls back to direct execution when inline
   * script execution is restricted by page CSP.
   * @param {string} name
   * @param {unknown[]} [args=[]]
   * @returns {boolean}
   */
  function injectScriptlet(name, args = []) {
    // All scriptlets are already loaded via manifest "world": "MAIN" and self-execute.
    // This function is only called for scriptlets that need to be re-run on navigation.
    // We call them directly — no <script> element injection needed (avoids CSP violations).
    const scriptlet = SCRIPTLET_MAP[name];
    if (typeof scriptlet !== 'function') {
      return false;
    }
    try {
      const normalizedArgs = Array.isArray(args) ? args : [args];
      scriptlet.apply(globalThis, normalizedArgs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Boots the scriptlet engine at document_start.
   * @returns {void}
   */
  function init() {
    const scriptlets = getApplicableScriptlets(location.hostname);
    for (const name of scriptlets) {
      injectScriptlet(name);
    }
  }

  init();
})();
