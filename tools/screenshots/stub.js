// Minimal chrome.* stand-in so popup.html and options.html render outside the
// extension for store screenshots. Values are representative of real usage.
(function installChromeStub() {
  const stats = {
    enabled: true,
    blockedCount: 48213,
    trackerCount: 31097,
    cosmeticCount: 9142,
    heuristicCount: 2874,
    mlCount: 1163,
    phishingCount: 87,
    todayAds: 1284,
    todayTrackers: 903,
    todayCosmetic: 271,
    todayHeuristic: 64,
    todayMl: 28,
    todayPhishing: 3,
    staticRuleCount: 133022,
    dynamicRuleCount: 0,
    ruleCount: 133022,
    rulesBuiltAt: Date.now() - 36 * 60 * 60 * 1000,
    lastUpdated: Date.now() - 36 * 60 * 60 * 1000,
    currentDomain: 'youtube.com',
    isCurrentSiteAllowlisted: false,
    debug: false,
    filterListStatus: [
      { name: 'EasyList', ruleset: 'ads-core', enabled: true, ok: true, fetchedAt: Date.now() - 36e5, parsedRules: 56912 },
      { name: 'EasyPrivacy', ruleset: 'trackers', enabled: true, ok: true, fetchedAt: Date.now() - 36e5, parsedRules: 55234 },
      { name: 'uBlock Filters', ruleset: 'ads-core', enabled: true, ok: true, fetchedAt: Date.now() - 36e5, parsedRules: 1592 },
      { name: 'AdGuard Base', ruleset: 'ads-core', enabled: true, ok: true, fetchedAt: Date.now() - 36e5, parsedRules: 75285 },
    ],
    filterListConfig: {
      EasyList: true, EasyPrivacy: true, 'uBlock Filters': true, 'AdGuard Base': true,
    },
    customRulesText: [
      '! Hide a leftover promo rail',
      'example.com##.promo-rail',
      '! Block a first-party beacon',
      '||metrics.example.com/collect^$xhr',
    ].join('\n'),
    allowlistedDomains: ['news.ycombinator.com', 'wikipedia.org'],
    sponsorBlockEnabled: true,
    liveFilterUpdates: false,
  };

  globalThis.chrome = {
    runtime: {
      sendMessage: async () => structuredClone(stats),
      openOptionsPage: () => {},
      lastError: null,
      getURL: (path) => path,
    },
    storage: {
      local: {
        get: async () => ({ enabled: true }),
        set: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=demo' }],
      sendMessage: async () => ({}),
      create: () => {},
    },
  };

  // Frames select an options panel with `options.html#tab=allowlist`; the page's
  // own tab handler does the rest.
  const requestedTab = /tab=([a-z]+)/.exec(location.hash || '');
  if (requestedTab) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        document.querySelector(`.tab-button[data-tab="${requestedTab[1]}"]`)?.click();
      }, 120);
    });
  }
})();
