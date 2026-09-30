import { compileRules, parseFilterList } from './filter-compiler.js';
import {
  CURATED_RULE_COUNT,
  GENERATED_CORE_RULESETS,
  GENERATED_EXCEPTION_RULESETS,
  GENERATED_EXTENDED_RULESETS,
  GENERATED_RULE_COUNTS,
} from './rules/generated/index.js';

const CURATED_RULESET_IDS = ['ads-core', 'trackers', 'annoyances', 'youtube', 'security'];
// Curated rulesets, the `@@` exception rules, and the generated core tier.
// Together these fit Chrome's guaranteed static-rule budget, so enabling them
// can never fail. Exceptions belong here rather than in the best-effort tier:
// they exist to override block rules, and a block that outlives its exception
// breaks logins, checkouts, and CDNs shared between ads and site assets.
const BASE_STATIC_RULESET_IDS = [
  ...CURATED_RULESET_IDS,
  ...GENERATED_EXCEPTION_RULESETS,
  ...GENERATED_CORE_RULESETS,
];
const ALL_STATIC_RULESET_IDS = [...BASE_STATIC_RULESET_IDS, ...GENERATED_EXTENDED_RULESETS];
const FILTER_UPDATE_ALARM = 'filterUpdate';
const FETCH_TIMEOUT_MS = 20000;
const FILTER_PARSE_CHUNK_SIZE = 4000;
// Chrome caps dynamic + session rules at 5,000 combined. These budgets stay
// under that with headroom, because dynamic slots are now a freshness
// supplement over the packaged static rulesets rather than the whole engine.
const ADS_CORE_DYNAMIC_BUDGET = 2500;
const TRACKERS_DYNAMIC_BUDGET = 800;
const CUSTOM_DYNAMIC_BUDGET = 500;
const ALLOWLIST_DYNAMIC_BUDGET = 500;
const ADS_CORE_START_ID = 1;
const TRACKERS_START_ID = 200000;
const CUSTOM_RULES_START_ID = 260000;
const ALLOWLIST_RULE_START_ID = 280000;
const FILTER_LISTS = Object.freeze([
  {
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    ruleset: 'ads-core',
  },
  {
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    ruleset: 'trackers',
  },
  {
    name: 'uBlock Filters',
    url: 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt',
    ruleset: 'ads-core',
  },
  {
    name: 'AdGuard Base',
    url: 'https://filters.adtidy.org/extension/chromium/filters/2.txt',
    ruleset: 'ads-core',
  },
]);
const DEFAULT_FILTER_LIST_CONFIG = Object.freeze(Object.fromEntries(
  FILTER_LISTS.map((filterList) => [filterList.name, true]),
));
/**
 * Blocked-item counters: storage key to the field that tracks today's count.
 * Content scripts report stats by the daily field name.
 */
const COUNTERS = Object.freeze({
  adsBlocked: 'ads',
  trackersBlocked: 'trackers',
  cosmeticBlocked: 'cosmetic',
  heuristicBlocked: 'heuristic',
  phishingBlocked: 'phishing',
});
const COUNTER_KEY_BY_FIELD = Object.freeze(Object.fromEntries(
  Object.entries(COUNTERS).map(([key, field]) => [field, key]),
));
/** Storage keys earlier versions wrote that nothing reads any more. */
const RETIRED_STORAGE_KEYS = Object.freeze(['blockedCount', 'ruleCount', 'mlBlocked']);

/**
 * Returns a zeroed daily-stats record.
 * @param {string} [day='']
 * @returns {Record<string, string | number>}
 */
function emptyDailyStats(day = '') {
  return { day, ...Object.fromEntries(Object.values(COUNTERS).map((field) => [field, 0])) };
}

/**
 * Returns a finite number, or 0.
 * @param {unknown} value
 * @returns {number}
 */
function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

const STORAGE_DEFAULTS = {
  enabled: true,
  installedAt: 0,
  lastUpdated: 0,
  filterListStatus: [],
  filterListConfig: { ...DEFAULT_FILTER_LIST_CONFIG },
  debug: false,
  // Off by default: the packaged static rulesets are compiled from these same
  // lists at build time, so scheduled re-fetching would spend the scarce dynamic
  // quota re-adding rules that are already active. Manual refresh still works.
  liveFilterUpdates: false,
  sponsorBlockEnabled: true,
  ...Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, 0])),
  dailyStats: emptyDailyStats(),
  'compiledRules_ads-core': [],
  'compiledRules_trackers': [],
  customDynamicRules: [],
  customCosmeticRules: [],
  customRuleLines: [],
  allowlistedDomains: [],
  allowlistRules: [],
};
/**
 * MAIN-world scriptlets, each scoped to the sites it was written for.
 *
 * Registered at runtime rather than in the manifest so pausing protection and
 * allowlisting a site can actually keep them off the page: these stubs and
 * fetch/XHR/timer wrappers are installed at document_start, before any page
 * flag could tell them to stand down. Files within a group run in order, which
 * matters for YouTube, where yt-player builds on no-fetch-if's fetch wrapper.
 */
const SCRIPTLET_GROUPS = Object.freeze([
  {
    id: 'scriptlets-all',
    matches: ['<all_urls>'],
    js: ['scriptlets/google-tag.js', 'scriptlets/set-constant.js', 'scriptlets/abort-on-property-read.js'],
  },
  {
    id: 'scriptlets-youtube',
    matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://youtu.be/*'],
    js: ['scriptlets/no-xhr-if.js', 'scriptlets/no-fetch-if.js', 'scriptlets/yt-player.js'],
  },
  {
    id: 'scriptlets-sourcepoint',
    matches: ['*://*.forbes.com/*', '*://*.bloomberg.com/*', '*://*.wired.com/*', '*://*.wsj.com/*'],
    js: ['scriptlets/no-sourcepoint.js'],
  },
  {
    id: 'scriptlets-timers',
    matches: ['*://*.forbes.com/*', '*://*.bloomberg.com/*'],
    js: ['scriptlets/prevent-setTimeout.js'],
  },
  {
    id: 'scriptlets-admiral',
    matches: ['*://*.theatlantic.com/*'],
    js: ['scriptlets/no-admiral.js'],
  },
]);
/** Hostnames that can be dropped into a match pattern as-is. */
const MATCH_PATTERN_HOST = /^[a-z0-9.-]+$/;
/**
 * Actions a content script may send. Everything else changes settings or
 * rules, so it is accepted only from the extension's own pages: a content
 * script runs inside whatever site it is on, and must not be able to pause
 * protection or allowlist domains on the user's behalf.
 */
const CONTENT_SCRIPT_ACTIONS = new Set(['getPageRules', 'incrementStats']);

/**
 * Returns today's date as a stable YYYY-MM-DD key (UTC).
 * @returns {string}
 */
function currentDayString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sanitizes a persisted daily-stats record.
 * @param {unknown} value
 * @returns {Record<string, string | number>}
 */
function sanitizeDailyStats(value) {
  const result = emptyDailyStats();
  if (value && typeof value === 'object') {
    result.day = typeof value.day === 'string' ? value.day : '';
    for (const field of Object.values(COUNTERS)) {
      result[field] = finiteOrZero(value[field]);
    }
  }
  return result;
}

/**
 * Returns the daily-stats record for the current day, resetting it when the
 * stored record is from a previous day.
 * @param {{ day: string }} dailyStats
 * @returns {Record<string, string | number>}
 */
function resolveTodayStats(dailyStats) {
  const today = currentDayString();
  return dailyStats && dailyStats.day === today ? dailyStats : emptyDailyStats(today);
}

/**
 * Lightweight background logger with debug gating for verbose output.
 */
const logger = {
  /**
   * Emits a debug log only when the persisted debug flag is enabled.
   * @param {string} message
   * @param {unknown} [details]
   * @returns {Promise<void>}
   */
  async debug(message, details) {
    try {
      const result = await chrome.storage.local.get('debug');
      if (!result.debug) {
        return;
      }
      console.info('[ShieldBlock AI]', message, details ?? '');
    } catch {
      // Ignore debug logging failures.
    }
  },

  /**
   * Emits an informational service worker log.
   * @param {string} message
   * @param {unknown} [details]
   * @returns {void}
   */
  info(message, details) {
    console.info('[ShieldBlock AI]', message, details ?? '');
  },

  /**
   * Emits a service worker error log.
   * @param {string} message
   * @param {unknown} [details]
   * @returns {void}
   */
  error(message, details) {
    console.error('[ShieldBlock AI]', message, details ?? '');
  },
};

/**
 * Normalizes a hostname-like string.
 * @param {string} value
 * @returns {string}
 */
function normalizeDomain(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return trimmed.replace(/^www\./, '').replace(/\.$/, '');
  }
}

/**
 * Returns true when a hostname matches a stored domain rule.
 * @param {string} hostname
 * @param {string} ruleDomain
 * @returns {boolean}
 */
function matchesDomain(hostname, ruleDomain) {
  const normalizedHost = normalizeDomain(hostname);
  const normalizedRule = normalizeDomain(ruleDomain);
  if (!normalizedHost || !normalizedRule) {
    return false;
  }

  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }

  return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`);
}

/**
 * Returns true when a hostname matches any allowlisted domain entry.
 * @param {string} hostname
 * @param {string[]} domains
 * @returns {boolean}
 */
function isAllowlistedHostname(hostname, domains) {
  return domains.some((domain) => matchesDomain(hostname, domain));
}

/**
 * Sanitizes persisted filter list toggles.
 * @param {unknown} config
 * @returns {Record<string, boolean>}
 */
function sanitizeFilterListConfig(config) {
  const nextConfig = { ...DEFAULT_FILTER_LIST_CONFIG };
  if (!config || typeof config !== 'object') {
    return nextConfig;
  }

  for (const filterList of FILTER_LISTS) {
    if (typeof config[filterList.name] === 'boolean') {
      nextConfig[filterList.name] = config[filterList.name];
    }
  }

  return nextConfig;
}

/**
 * Returns a stored array, or an empty one.
 * @param {unknown} rules
 * @returns {Array}
 */
function sanitizeRuleArray(rules) {
  return Array.isArray(rules) ? rules : [];
}

/**
 * Reads persisted extension state with defaults.
 * @returns {Promise<typeof STORAGE_DEFAULTS>}
 */
async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_DEFAULTS);
  return {
    enabled: stored.enabled !== false,
    installedAt: finiteOrZero(stored.installedAt),
    lastUpdated: finiteOrZero(stored.lastUpdated),
    filterListStatus: Array.isArray(stored.filterListStatus) ? stored.filterListStatus : [],
    filterListConfig: sanitizeFilterListConfig(stored.filterListConfig),
    debug: stored.debug === true,
    liveFilterUpdates: stored.liveFilterUpdates === true,
    sponsorBlockEnabled: stored.sponsorBlockEnabled !== false,
    ...Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, finiteOrZero(stored[key])])),
    dailyStats: sanitizeDailyStats(stored.dailyStats),
    'compiledRules_ads-core': sanitizeRuleArray(stored['compiledRules_ads-core']),
    'compiledRules_trackers': sanitizeRuleArray(stored['compiledRules_trackers']),
    customDynamicRules: sanitizeRuleArray(stored.customDynamicRules),
    customCosmeticRules: sanitizeRuleArray(stored.customCosmeticRules),
    customRuleLines: sanitizeRuleArray(stored.customRuleLines),
    allowlistedDomains: Array.isArray(stored.allowlistedDomains)
      ? stored.allowlistedDomains.map(normalizeDomain).filter(Boolean)
      : [],
    allowlistRules: sanitizeRuleArray(stored.allowlistRules),
  };
}

/**
 * Returns the currently active browsing hostname.
 * @returns {Promise<string>}
 */
async function resolveCurrentDomain() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTab = tabs[0];
    if (!activeTab?.url || !/^https?:/i.test(activeTab.url)) {
      return '';
    }
    return normalizeDomain(new URL(activeTab.url).hostname);
  } catch {
    return '';
  }
}

/**
 * Computes the active block rule count for UI display.
 * @param {Pick<typeof STORAGE_DEFAULTS, 'compiledRules_ads-core' | 'compiledRules_trackers' | 'customDynamicRules'>} state
 * @returns {number}
 */
function computeRuleCount(state) {
  return state['compiledRules_ads-core'].length
    + state['compiledRules_trackers'].length
    + state.customDynamicRules.length;
}

/**
 * Enables as much of the generated extended tier as the shared static-rule pool
 * allows.
 *
 * Extended rulesets draw from Chrome's global static-rule limit, which is shared
 * with every other installed extension, so the full set may not fit.
 * `updateEnabledRulesets` is atomic — an over-quota call applies nothing — so on
 * failure we retry with progressively smaller prefixes instead of giving up.
 * @returns {Promise<number>} Count of extended rulesets successfully enabled.
 */
async function enableExtendedRulesets() {
  const ids = [...GENERATED_EXTENDED_RULESETS];

  for (let count = ids.length; count > 0; count = Math.floor(count / 2)) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ids.slice(0, count),
        disableRulesetIds: ids.slice(count),
      });
      if (count < ids.length) {
        logger.info('Extended ruleset tier partially enabled', { enabled: count, total: ids.length });
      }
      return count;
    } catch (error) {
      await logger.debug('Extended ruleset tier did not fit; backing off', { attempted: count, error });
    }
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ids });
  } catch (error) {
    logger.error('Failed to disable extended rulesets', error);
  }
  logger.error('No extended rulesets could be enabled; core tier still active');
  return 0;
}

/**
 * Applies the enabled state to packaged static rulesets.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
async function applyStaticRulesetState(enabled) {
  if (!enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: [...ALL_STATIC_RULESET_IDS],
    });
    return;
  }

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: [...BASE_STATIC_RULESET_IDS],
  });
  await enableExtendedRulesets();
}

/**
 * Counts the rules carried by the currently enabled static rulesets.
 * @returns {Promise<number>}
 */
async function computeStaticRuleCount() {
  try {
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    let total = 0;
    for (const rulesetId of enabledRulesets) {
      total += GENERATED_RULE_COUNTS[rulesetId] ?? 0;
    }
    if (enabledRulesets.some((rulesetId) => CURATED_RULESET_IDS.includes(rulesetId))) {
      total += CURATED_RULE_COUNT;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Replaces all current dynamic rules with the provided set.
 * @param {chrome.declarativeNetRequest.Rule[]} rules
 * @returns {Promise<void>}
 */
async function replaceDynamicRules(rules) {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: rules,
  });
}

/**
 * Builds allowlist DNR rules from a set of domains.
 * @param {string[]} domains
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
function buildAllowlistRules(domains) {
  return [...new Set(domains.map(normalizeDomain).filter(Boolean))]
    .slice(0, ALLOWLIST_DYNAMIC_BUDGET)
    .map((domain, index) => ({
      id: ALLOWLIST_RULE_START_ID + index,
      // Above every generated rule, including `$important` blocks: an explicit
      // user allowlist entry is the strongest signal there is.
      priority: 1000,
      // `allowAllRequests` on the navigation itself is what actually allowlists
      // a site. A plain `allow` keyed on requestDomains would only permit
      // requests *to* the allowlisted domain, leaving third-party ads and
      // trackers on that page still blocked — which is not what allowlisting a
      // site means.
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: [domain],
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    }));
}

/**
 * Splits custom rule lines into network and cosmetic subsets.
 * @param {string[]} lines
 * @returns {{ ruleLines: string[], networkLines: string[], cosmeticLines: string[] }}
 */
function splitCustomRuleLines(lines) {
  const seen = new Set();
  const ruleLines = [];
  const networkLines = [];
  const cosmeticLines = [];

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('!')) {
      continue;
    }
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    ruleLines.push(line);
    if (line.includes('##') || line.includes('#?#')) {
      cosmeticLines.push(line);
    } else {
      networkLines.push(line);
    }
  }

  return {
    ruleLines,
    networkLines,
    cosmeticLines,
  };
}

/**
 * Compiles custom ABP rules into DNR and cosmetic subsets.
 * @param {string[]} lines
 * @returns {{ customRuleLines: string[], customCosmeticRules: string[], customDynamicRules: chrome.declarativeNetRequest.Rule[] }}
 */
function compileCustomRuleState(lines) {
  const split = splitCustomRuleLines(lines);
  const parsedNetworkRules = split.networkLines.length
    ? parseFilterList(split.networkLines.join('\n'))
    : [];
  const compiledNetworkRules = parsedNetworkRules.length
    ? compileRules(parsedNetworkRules, CUSTOM_RULES_START_ID)
    : [];

  return {
    customRuleLines: split.ruleLines,
    customCosmeticRules: split.cosmeticLines,
    customDynamicRules: compiledNetworkRules.slice(0, CUSTOM_DYNAMIC_BUDGET),
  };
}

/**
 * Extracts custom cosmetic selectors applicable to a hostname.
 * @param {string} hostname
 * @param {string[]} cosmeticRules
 * @returns {string[]}
 */
function getCustomCosmeticSelectors(hostname, cosmeticRules) {
  const normalizedHostname = normalizeDomain(hostname);
  const selectors = new Set();

  for (const rawRule of cosmeticRules) {
    const separator = rawRule.includes('#?#') ? '#?#' : '##';
    const parts = rawRule.split(separator);
    if (parts.length < 2) {
      continue;
    }

    const domainPart = parts[0].trim();
    const selector = parts.slice(1).join(separator).trim();
    if (!selector) {
      continue;
    }

    if (!domainPart) {
      selectors.add(selector);
      continue;
    }

    const domains = domainPart.split(',').map((domain) => domain.trim()).filter(Boolean);
    if (domains.some((domain) => !domain.startsWith('~') && matchesDomain(normalizedHostname, domain))) {
      selectors.add(selector);
    }
  }

  return [...selectors];
}

/**
 * Yields control back to the service worker event loop.
 * @returns {Promise<void>}
 */
async function yieldToServiceWorker() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Parses a raw filter list in chunks to avoid long service-worker stalls.
 * @param {string} text
 * @returns {Promise<ReturnType<typeof parseFilterList>>}
 */
async function parseFilterListChunked(text) {
  const lines = text.split(/\r?\n/);
  const parsedRules = [];

  for (let index = 0; index < lines.length; index += FILTER_PARSE_CHUNK_SIZE) {
    const chunkText = lines.slice(index, index + FILTER_PARSE_CHUNK_SIZE).join('\n');
    const chunkRules = parseFilterList(chunkText);
    // Avoid spreading very large rule arrays into push(...), which can overflow
    // the service worker call stack on large upstream lists such as AdGuard Base.
    for (const rule of chunkRules) {
      parsedRules.push(rule);
    }

    if (index + FILTER_PARSE_CHUNK_SIZE < lines.length) {
      await yieldToServiceWorker();
    }
  }

  return parsedRules;
}

/**
 * Fetches a remote filter list with timeout handling.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchListText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Builds the currently stored dynamic rule snapshot.
 * @returns {Promise<chrome.declarativeNetRequest.Rule[]>}
 */
async function getStoredDynamicRules() {
  const state = await getState();
  return [
    ...state['compiledRules_ads-core'],
    ...state['compiledRules_trackers'],
    ...state.customDynamicRules,
    ...state.allowlistRules,
  ];
}

/**
 * Registers the MAIN-world scriptlets for the current state: none while
 * protection is paused, and never on allowlisted sites.
 * @returns {Promise<void>}
 */
async function registerScriptlets() {
  const state = await getState();
  await chrome.scripting.unregisterContentScripts();
  if (!state.enabled) {
    return;
  }

  // `*.example.com` also matches example.com itself.
  const excludeMatches = state.allowlistedDomains
    .filter((domain) => MATCH_PATTERN_HOST.test(domain))
    .map((domain) => `*://*.${domain}/*`);
  await chrome.scripting.registerContentScripts(SCRIPTLET_GROUPS.map((group) => ({
    ...group,
    js: [...group.js],
    matches: [...group.matches],
    excludeMatches,
    runAt: 'document_start',
    world: 'MAIN',
  })));
}

let scriptletSync = Promise.resolve();

/**
 * Re-registers scriptlets, one run at a time. Startup, activation, and a user
 * toggle can all reconcile at once, and overlapping unregister/register pairs
 * would fail on duplicate script IDs.
 * @returns {Promise<void>}
 */
function syncScriptlets() {
  scriptletSync = scriptletSync
    .then(registerScriptlets)
    .catch((error) => logger.error('Failed to register scriptlets', error));
  return scriptletSync;
}

/**
 * Reconciles storage state with static and dynamic DNR state.
 * @returns {Promise<void>}
 */
async function reconcileRulesetState() {
  try {
    const state = await getState();
    await syncScriptlets();
    await applyStaticRulesetState(state.enabled);
    await replaceDynamicRules(state.enabled ? await getStoredDynamicRules() : []);
    await logger.debug('Ruleset state reconciled', {
      enabled: state.enabled,
      dynamicRules: computeRuleCount(state),
      allowlistRules: state.allowlistRules.length,
    });
  } catch (error) {
    logger.error('Failed to reconcile ruleset state', error);
  }
}

/**
 * Ensures recurring alarms exist for filter refresh.
 * @returns {Promise<void>}
 */
async function ensureAlarms() {
  try {
    const filterUpdate = await chrome.alarms.get(FILTER_UPDATE_ALARM);
    if (!filterUpdate) {
      await chrome.alarms.create(FILTER_UPDATE_ALARM, { periodInMinutes: 5760 });
    }
  } catch (error) {
    logger.error('Failed to ensure alarms', error);
  }
}

/**
 * Broadcasts a page-rule refresh signal to open tabs.
 * @returns {Promise<void>}
 */
async function broadcastPageRuleRefresh() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(async (tab) => {
      if (!tab.id || !tab.url || !/^https?:/i.test(tab.url)) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'refreshPageRules' });
      } catch {
        // Ignore tabs without matching content scripts.
      }
    }));
  } catch (error) {
    logger.error('Failed to broadcast page-rule refresh', error);
  }
}

/**
 * Creates the shared popup stats response payload.
 * @returns {Promise<object>}
 */
async function buildStatsResponse() {
  const state = await getState();
  const currentDomain = await resolveCurrentDomain();
  const today = resolveTodayStats(state.dailyStats);
  const staticRuleCount = state.enabled ? await computeStaticRuleCount() : 0;
  return {
    enabled: state.enabled,
    blockedCount: state.adsBlocked,
    trackerCount: state.trackersBlocked,
    cosmeticCount: state.cosmeticBlocked,
    heuristicCount: state.heuristicBlocked,
    phishingCount: state.phishingBlocked,
    todayAds: today.ads,
    todayTrackers: today.trackers,
    todayPhishing: today.phishing,
    // Packaged static rules carry the bulk of network coverage; dynamic rules
    // hold only the live-update supplement, custom rules, and allowlist.
    ruleCount: staticRuleCount + computeRuleCount(state),
    lastUpdated: state.lastUpdated,
    currentDomain,
    isCurrentSiteAllowlisted: currentDomain
      ? isAllowlistedHostname(currentDomain, state.allowlistedDomains)
      : false,
  };
}

/**
 * Creates the options/settings payload.
 * @returns {Promise<object>}
 */
async function buildSettingsResponse() {
  const state = await getState();
  return {
    ...(await buildStatsResponse()),
    debug: state.debug,
    filterListStatus: state.filterListStatus,
    filterListConfig: state.filterListConfig,
    customRulesText: state.customRuleLines.join('\n'),
    allowlistedDomains: state.allowlistedDomains,
    sponsorBlockEnabled: state.sponsorBlockEnabled,
    liveFilterUpdates: state.liveFilterUpdates,
  };
}

/**
 * Returns the custom page-rule payload for a specific hostname.
 * @param {string} hostname
 * @returns {Promise<{ selectors: string[], allowlisted: boolean }>}
 */
async function buildPageRulesResponse(hostname) {
  const state = await getState();
  const normalizedHostname = normalizeDomain(hostname);
  return {
    selectors: getCustomCosmeticSelectors(normalizedHostname, state.customCosmeticRules),
    allowlisted: normalizedHostname
      ? isAllowlistedHostname(normalizedHostname, state.allowlistedDomains)
      : false,
  };
}

/**
 * Fetches, compiles, stores, and applies live filter lists.
 * @returns {Promise<object>}
 */
async function fetchAndCompileFilters() {
  const state = await getState();
  const config = sanitizeFilterListConfig(state.filterListConfig);
  const previousStatusByName = new Map(
    state.filterListStatus.map((status) => [status.name, status]),
  );
  const parsedByRuleset = {
    'ads-core': [],
    trackers: [],
  };
  const filterListStatus = [];
  let anyFetchSucceeded = false;
  let enabledListCount = 0;

  for (const filterList of FILTER_LISTS) {
    const previousStatus = previousStatusByName.get(filterList.name);
    const enabled = config[filterList.name] !== false;
    if (!enabled) {
      filterListStatus.push({
        name: filterList.name,
        ruleset: filterList.ruleset,
        enabled: false,
        ok: previousStatus?.ok ?? true,
        fetchedAt: previousStatus?.fetchedAt ?? 0,
        parsedRules: previousStatus?.parsedRules ?? 0,
      });
      continue;
    }

    enabledListCount += 1;
    const fetchedAt = Date.now();
    logger.info(`Fetching filter list: ${filterList.name}`);

    try {
      const rawText = await fetchListText(filterList.url);
      const parsedRules = await parseFilterListChunked(rawText);
      // Same stack-safety guard here for merged list accumulation.
      for (const rule of parsedRules) {
        parsedByRuleset[filterList.ruleset].push(rule);
      }
      anyFetchSucceeded = true;

      filterListStatus.push({
        name: filterList.name,
        ruleset: filterList.ruleset,
        enabled: true,
        ok: true,
        fetchedAt,
        parsedRules: parsedRules.length,
      });

      await logger.debug(`Parsed ${filterList.name}`, { rules: parsedRules.length });
    } catch (error) {
      filterListStatus.push({
        name: filterList.name,
        ruleset: filterList.ruleset,
        enabled: true,
        ok: false,
        fetchedAt,
        parsedRules: previousStatus?.parsedRules ?? 0,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(`Failed to fetch ${filterList.name}`, error);
    }
  }

  let compiledAdsRules = state['compiledRules_ads-core'];
  let compiledTrackerRules = state['compiledRules_trackers'];

  if (FILTER_LISTS.some((filterList) => filterList.ruleset === 'ads-core' && config[filterList.name] !== false)) {
    await yieldToServiceWorker();
    compiledAdsRules = parsedByRuleset['ads-core'].length > 0
      ? compileRules(parsedByRuleset['ads-core'], ADS_CORE_START_ID).slice(0, ADS_CORE_DYNAMIC_BUDGET)
      : [];
  }

  if (FILTER_LISTS.some((filterList) => filterList.ruleset === 'trackers' && config[filterList.name] !== false)) {
    await yieldToServiceWorker();
    compiledTrackerRules = parsedByRuleset.trackers.length > 0
      ? compileRules(parsedByRuleset.trackers, TRACKERS_START_ID).slice(0, TRACKERS_DYNAMIC_BUDGET)
      : [];
  }

  if (!anyFetchSucceeded && enabledListCount > 0 && compiledAdsRules.length === 0 && compiledTrackerRules.length === 0) {
    await chrome.storage.local.set({ filterListStatus });
    logger.error('All filter list fetches failed; packaged fallback rules remain active');
    return buildStatsResponse();
  }

  const lastUpdated = anyFetchSucceeded ? Date.now() : state.lastUpdated;

  await chrome.storage.local.set({
    'compiledRules_ads-core': compiledAdsRules,
    'compiledRules_trackers': compiledTrackerRules,
    filterListStatus,
    lastUpdated,
  });

  if (state.enabled) {
    await replaceDynamicRules([
      ...compiledAdsRules,
      ...compiledTrackerRules,
      ...state.customDynamicRules,
      ...state.allowlistRules,
    ]);
  }

  logger.info('Filter pipeline refresh complete');
  return buildStatsResponse();
}

/**
 * Persists compiled custom-rule state and re-applies DNR.
 * @param {string[]} lines
 * @returns {Promise<object>}
 */
async function saveCustomRules(lines) {
  await chrome.storage.local.set(compileCustomRuleState(lines));

  await reconcileRulesetState();
  await broadcastPageRuleRefresh();
  return buildSettingsResponse();
}

/**
 * Persists a new allowlisted domain and corresponding dynamic allow rules.
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function addAllowlistedDomain(domain) {
  const state = await getState();
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return buildStatsResponse();
  }

  const allowlistedDomains = [...new Set([...state.allowlistedDomains, normalizedDomain])];
  const allowlistRules = buildAllowlistRules(allowlistedDomains);
  await chrome.storage.local.set({
    allowlistedDomains,
    allowlistRules,
  });

  await reconcileRulesetState();
  await broadcastPageRuleRefresh();
  return buildStatsResponse();
}

/**
 * Removes an allowlisted domain and rebuilds dynamic allow rules.
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function removeAllowlistedDomain(domain) {
  const state = await getState();
  const normalizedDomain = normalizeDomain(domain);
  const allowlistedDomains = state.allowlistedDomains.filter((entry) => entry !== normalizedDomain);
  const allowlistRules = buildAllowlistRules(allowlistedDomains);
  await chrome.storage.local.set({
    allowlistedDomains,
    allowlistRules,
  });

  await reconcileRulesetState();
  await broadcastPageRuleRefresh();
  return buildStatsResponse();
}

/**
 * Applies a batch of counter increments in a single storage round trip.
 *
 * Content scripts report blocked elements and requests in batches, so this reads
 * only the counter keys rather than the full state — a plain `getState()` here
 * would pull the compiled rule arrays into memory for every batch.
 * @param {Record<string, number>} deltas
 * @returns {Promise<object>}
 */
async function applyStatDeltas(deltas) {
  const resolved = new Map();

  for (const [field, rawCount] of Object.entries(deltas || {})) {
    const key = COUNTER_KEY_BY_FIELD[field];
    const count = Number(rawCount);
    if (!key || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    resolved.set(key, (resolved.get(key) || 0) + Math.floor(count));
  }

  if (!resolved.size) {
    return { ok: false };
  }

  const stored = await chrome.storage.local.get([...Object.keys(COUNTERS), 'dailyStats']);
  const today = resolveTodayStats(sanitizeDailyStats(stored.dailyStats));
  const payload = { dailyStats: today };

  for (const [key, count] of resolved) {
    payload[key] = finiteOrZero(stored[key]) + count;
    today[COUNTERS[key]] += count;
  }

  await chrome.storage.local.set(payload);
  return { ok: true };
}

/**
 * Resets all stored stat counters.
 * @returns {Promise<object>}
 */
async function resetStats() {
  await chrome.storage.local.set({
    ...Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, 0])),
    dailyStats: emptyDailyStats(currentDayString()),
  });
  return buildStatsResponse();
}

/**
 * Updates the enabled state for a filter list and refreshes compiled rules.
 * @param {string} name
 * @param {boolean} enabled
 * @returns {Promise<object>}
 */
async function setFilterListEnabled(name, enabled) {
  const state = await getState();
  const config = sanitizeFilterListConfig(state.filterListConfig);
  if (!(name in config)) {
    return buildSettingsResponse();
  }

  config[name] = enabled;
  await chrome.storage.local.set({
    filterListConfig: config,
  });
  await fetchAndCompileFilters();
  return buildSettingsResponse();
}

/**
 * Toggles debug mode.
 * @param {boolean} enabled
 * @returns {Promise<object>}
 */
async function setDebugMode(enabled) {
  await chrome.storage.local.set({
    debug: Boolean(enabled),
  });
  return buildSettingsResponse();
}

/**
 * Enables or disables the SponsorBlock segment-skipping feature.
 * @param {boolean} enabled
 * @returns {Promise<object>}
 */
async function setSponsorBlock(enabled) {
  await chrome.storage.local.set({
    sponsorBlockEnabled: Boolean(enabled),
  });
  return buildSettingsResponse();
}

/**
 * Imports a JSON settings payload and rebuilds derived state.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<object>}
 */
async function importSettings(payload) {
  const currentState = await getState();
  const customRuleLines = Array.isArray(payload?.customRuleLines)
    ? payload.customRuleLines
    : typeof payload?.customRulesText === 'string'
      ? payload.customRulesText.split(/\r?\n/)
      : currentState.customRuleLines;
  const customRuleState = compileCustomRuleState(customRuleLines);
  const allowlistedDomains = Array.isArray(payload?.allowlistedDomains)
    ? [...new Set(payload.allowlistedDomains.map(normalizeDomain).filter(Boolean))]
    : currentState.allowlistedDomains;
  const nextState = {
    enabled: payload?.enabled !== false,
    installedAt: Number.isFinite(payload?.installedAt) ? payload.installedAt : currentState.installedAt || Date.now(),
    lastUpdated: currentState.lastUpdated,
    filterListStatus: currentState.filterListStatus,
    filterListConfig: sanitizeFilterListConfig(payload?.filterListConfig ?? currentState.filterListConfig),
    debug: payload?.debug === true,
    liveFilterUpdates: payload?.liveFilterUpdates === true,
    sponsorBlockEnabled: payload?.sponsorBlockEnabled !== false,
    ...Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, finiteOrZero(payload?.[key])])),
    'compiledRules_ads-core': currentState['compiledRules_ads-core'],
    'compiledRules_trackers': currentState['compiledRules_trackers'],
    customDynamicRules: customRuleState.customDynamicRules,
    customCosmeticRules: customRuleState.customCosmeticRules,
    customRuleLines: customRuleState.customRuleLines,
    allowlistedDomains,
    allowlistRules: buildAllowlistRules(allowlistedDomains),
  };

  await chrome.storage.local.set(nextState);
  await reconcileRulesetState();
  if (nextState.liveFilterUpdates) {
    await fetchAndCompileFilters();
  }
  await broadcastPageRuleRefresh();
  return buildSettingsResponse();
}

/**
 * Resets the extension back to defaults and refetches live filters.
 * @returns {Promise<object>}
 */
async function resetToDefaults() {
  const defaults = {
    ...STORAGE_DEFAULTS,
    installedAt: Date.now(),
    filterListConfig: { ...DEFAULT_FILTER_LIST_CONFIG },
  };
  await chrome.storage.local.set(defaults);
  await reconcileRulesetState();
  if (defaults.liveFilterUpdates) {
    await fetchAndCompileFilters();
  }
  await broadcastPageRuleRefresh();
  return buildSettingsResponse();
}

/**
 * Initializes storage and kicks off the initial live filter compilation.
 * @returns {Promise<void>}
 */
async function initializeOnInstall() {
  try {
    const current = await getState();
    await chrome.storage.local.remove([...RETIRED_STORAGE_KEYS]);
    // Custom and allowlist rules are recompiled so an update that changes the
    // compiler also refreshes rules stored by the previous version.
    await chrome.storage.local.set({
      installedAt: current.installedAt > 0 ? current.installedAt : Date.now(),
      ...compileCustomRuleState(current.customRuleLines),
      allowlistRules: buildAllowlistRules(current.allowlistedDomains),
    });

    await applyStaticRulesetState(current.enabled);
    await ensureAlarms();
    logger.info('ShieldBlock AI v3 installed');
    if (current.liveFilterUpdates) {
      await fetchAndCompileFilters();
    }
  } catch (error) {
    logger.error('Install initialization failed', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeOnInstall();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await ensureAlarms();
    await reconcileRulesetState();
  })());
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureAlarms();
    await reconcileRulesetState();
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FILTER_UPDATE_ALARM) {
    return;
  }
  void (async () => {
    const state = await getState();
    if (!state.liveFilterUpdates) {
      return;
    }
    await fetchAndCompileFilters();
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromExtensionPage = typeof sender?.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage && !CONTENT_SCRIPT_ACTIONS.has(message?.action)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }

  void (async () => {
    try {
      if (message?.action === 'getStats') {
        sendResponse(await buildStatsResponse());
        return;
      }

      if (message?.action === 'getSettings') {
        sendResponse(await buildSettingsResponse());
        return;
      }

      if (message?.action === 'getPageRules') {
        sendResponse(await buildPageRulesResponse(message.hostname));
        return;
      }

      if (message?.action === 'toggle') {
        const enabled = Boolean(message.enabled);
        await chrome.storage.local.set({ enabled });
        await reconcileRulesetState();
        sendResponse(await buildStatsResponse());
        return;
      }

      if (message?.action === 'refreshLists') {
        sendResponse(await fetchAndCompileFilters());
        return;
      }

      if (message?.action === 'allowlistDomain') {
        sendResponse(await addAllowlistedDomain(message.domain));
        return;
      }

      if (message?.action === 'removeAllowlistDomain') {
        sendResponse(await removeAllowlistedDomain(message.domain));
        return;
      }

      if (message?.action === 'saveCustomRules') {
        const lines = typeof message.rulesText === 'string'
          ? message.rulesText.split(/\r?\n/)
          : [];
        sendResponse(await saveCustomRules(lines));
        return;
      }

      if (message?.action === 'incrementStats') {
        sendResponse(await applyStatDeltas(message.counts));
        return;
      }

      if (message?.action === 'resetStats') {
        sendResponse(await resetStats());
        return;
      }

      if (message?.action === 'setFilterListEnabled') {
        sendResponse(await setFilterListEnabled(message.name, Boolean(message.enabled)));
        return;
      }

      if (message?.action === 'setDebug') {
        sendResponse(await setDebugMode(Boolean(message.enabled)));
        return;
      }

      if (message?.action === 'setSponsorBlock') {
        sendResponse(await setSponsorBlock(Boolean(message.enabled)));
        return;
      }

      if (message?.action === 'importSettings') {
        sendResponse(await importSettings(message.payload || {}));
        return;
      }

      if (message?.action === 'resetToDefaults') {
        sendResponse(await resetToDefaults());
        return;
      }

      sendResponse({ ok: false });
    } catch (error) {
      logger.error('Message handler failed', error);
      sendResponse({ ok: false, error: 'background-error' });
    }
  })();

  return true;
});

void ensureAlarms();
void reconcileRulesetState();
