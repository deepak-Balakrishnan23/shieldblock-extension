import {
  compileRules,
  getCompilerStats,
  parseFilterList,
} from './filter-compiler.js';

const STATIC_RULESET_IDS = ['ads-core', 'trackers', 'annoyances', 'youtube'];
const FILTER_UPDATE_ALARM = 'filterUpdate';
const FETCH_TIMEOUT_MS = 20000;
const FILTER_PARSE_CHUNK_SIZE = 4000;
const ADS_CORE_DYNAMIC_BUDGET = 3000;
const TRACKERS_DYNAMIC_BUDGET = 1000;
const CUSTOM_DYNAMIC_BUDGET = 500;
const ALLOWLIST_DYNAMIC_BUDGET = 500;
const ADS_CORE_START_ID = 1;
const TRACKERS_START_ID = 200000;
const CUSTOM_RULES_START_ID = 260000;
const ALLOWLIST_RULE_START_ID = 280000;
const FALLBACK_RULE_COUNT = 130;
const ALL_RESOURCE_TYPES = Object.freeze([
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
  'main_frame',
  'sub_frame',
  'font',
]);
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
const COUNTER_STORAGE_KEYS = Object.freeze([
  'adsBlocked',
  'trackersBlocked',
  'cosmeticBlocked',
  'heuristicBlocked',
  'mlBlocked',
  'phishingBlocked',
]);
const STORAGE_DEFAULTS = {
  enabled: true,
  installedAt: 0,
  lastUpdated: 0,
  ruleCount: FALLBACK_RULE_COUNT,
  filterListStatus: [],
  filterListConfig: { ...DEFAULT_FILTER_LIST_CONFIG },
  debug: false,
  blockedCount: 0,
  adsBlocked: 0,
  trackersBlocked: 0,
  cosmeticBlocked: 0,
  heuristicBlocked: 0,
  mlBlocked: 0,
  phishingBlocked: 0,
  'compiledRules_ads-core': [],
  'compiledRules_trackers': [],
  customDynamicRules: [],
  customCosmeticRules: [],
  customRuleLines: [],
  allowlistedDomains: [],
  allowlistRules: [],
};

/**
 * Lightweight background logger with debug gating for verbose output.
 */
export const logger = {
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
 * Sanitizes a stored rule array.
 * @param {unknown} rules
 * @returns {chrome.declarativeNetRequest.Rule[]}
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
    installedAt: Number.isFinite(stored.installedAt) ? stored.installedAt : 0,
    lastUpdated: Number.isFinite(stored.lastUpdated) ? stored.lastUpdated : 0,
    ruleCount: Number.isFinite(stored.ruleCount) ? stored.ruleCount : FALLBACK_RULE_COUNT,
    filterListStatus: Array.isArray(stored.filterListStatus) ? stored.filterListStatus : [],
    filterListConfig: sanitizeFilterListConfig(stored.filterListConfig),
    debug: stored.debug === true,
    blockedCount: Number.isFinite(stored.blockedCount) ? stored.blockedCount : 0,
    adsBlocked: Number.isFinite(stored.adsBlocked) ? stored.adsBlocked : 0,
    trackersBlocked: Number.isFinite(stored.trackersBlocked) ? stored.trackersBlocked : 0,
    cosmeticBlocked: Number.isFinite(stored.cosmeticBlocked) ? stored.cosmeticBlocked : 0,
    heuristicBlocked: Number.isFinite(stored.heuristicBlocked) ? stored.heuristicBlocked : 0,
    mlBlocked: Number.isFinite(stored.mlBlocked) ? stored.mlBlocked : 0,
    phishingBlocked: Number.isFinite(stored.phishingBlocked) ? stored.phishingBlocked : 0,
    'compiledRules_ads-core': sanitizeRuleArray(stored['compiledRules_ads-core']),
    'compiledRules_trackers': sanitizeRuleArray(stored['compiledRules_trackers']),
    customDynamicRules: sanitizeRuleArray(stored.customDynamicRules),
    customCosmeticRules: Array.isArray(stored.customCosmeticRules) ? stored.customCosmeticRules : [],
    customRuleLines: Array.isArray(stored.customRuleLines) ? stored.customRuleLines : [],
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
 * Applies the enabled state to packaged static rulesets.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
async function applyStaticRulesetState(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [...STATIC_RULESET_IDS] : [],
    disableRulesetIds: enabled ? [] : [...STATIC_RULESET_IDS],
  });
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
 * Trims a compiled ruleset to a specific dynamic-rule budget.
 * @param {chrome.declarativeNetRequest.Rule[]} compiledRules
 * @param {number} budget
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
function selectDynamicRules(compiledRules, budget) {
  if (compiledRules.length <= budget) {
    return compiledRules;
  }
  return compiledRules.slice(0, budget);
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
      priority: 1000,
      action: { type: 'allow' },
      condition: {
        requestDomains: [domain],
        resourceTypes: [...ALL_RESOURCE_TYPES],
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
    customDynamicRules: selectDynamicRules(compiledNetworkRules, CUSTOM_DYNAMIC_BUDGET),
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
 * Aggregates compiler statistics across chunked parses.
 * @param {ReturnType<typeof getCompilerStats>} target
 * @param {ReturnType<typeof getCompilerStats>} source
 * @returns {ReturnType<typeof getCompilerStats>}
 */
function mergeCompilerStats(target, source) {
  return {
    parsed: target.parsed + source.parsed,
    skippedComments: target.skippedComments + source.skippedComments,
    skippedCosmetic: target.skippedCosmetic + source.skippedCosmetic,
    skippedExceptions: target.skippedExceptions + source.skippedExceptions,
    skippedRegex: target.skippedRegex + source.skippedRegex,
    skippedUnsupported: target.skippedUnsupported + source.skippedUnsupported,
    skippedUnknownModifiers: target.skippedUnknownModifiers + source.skippedUnknownModifiers,
    deduplicated: target.deduplicated + source.deduplicated,
    capped: target.capped || source.capped,
  };
}

/**
 * Parses a raw filter list in chunks to avoid long service-worker stalls.
 * @param {string} text
 * @returns {Promise<{ parsedRules: ReturnType<typeof parseFilterList>, stats: ReturnType<typeof getCompilerStats> }>}
 */
async function parseFilterListChunked(text) {
  const lines = text.split(/\r?\n/);
  const parsedRules = [];
  let aggregateStats = {
    parsed: 0,
    skippedComments: 0,
    skippedCosmetic: 0,
    skippedExceptions: 0,
    skippedRegex: 0,
    skippedUnsupported: 0,
    skippedUnknownModifiers: 0,
    deduplicated: 0,
    capped: false,
  };

  for (let index = 0; index < lines.length; index += FILTER_PARSE_CHUNK_SIZE) {
    const chunkText = lines.slice(index, index + FILTER_PARSE_CHUNK_SIZE).join('\n');
    const chunkRules = parseFilterList(chunkText);
    // Avoid spreading very large rule arrays into push(...), which can overflow
    // the service worker call stack on large upstream lists such as AdGuard Base.
    for (const rule of chunkRules) {
      parsedRules.push(rule);
    }
    aggregateStats = mergeCompilerStats(aggregateStats, getCompilerStats());

    if (index + FILTER_PARSE_CHUNK_SIZE < lines.length) {
      await yieldToServiceWorker();
    }
  }

  return {
    parsedRules,
    stats: aggregateStats,
  };
}

/**
 * Fetches a remote filter list with timeout handling.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchListText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
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
 * Reconciles storage state with static and dynamic DNR state.
 * @returns {Promise<void>}
 */
async function reconcileRulesetState() {
  try {
    const state = await getState();
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
  return {
    enabled: state.enabled,
    blockedCount: state.blockedCount,
    trackerCount: state.trackersBlocked,
    cosmeticCount: state.cosmeticBlocked,
    heuristicCount: state.heuristicBlocked,
    mlCount: state.mlBlocked,
    phishingCount: state.phishingBlocked,
    ruleCount: state.ruleCount,
    lastUpdated: state.lastUpdated,
    currentDomain,
    isCurrentSiteAllowlisted: currentDomain
      ? isAllowlistedHostname(currentDomain, state.allowlistedDomains)
      : false,
    filterListStatus: state.filterListStatus,
    debug: state.debug,
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
    filterListStatus: state.filterListStatus,
    filterListConfig: state.filterListConfig,
    customRulesText: state.customRuleLines.join('\n'),
    allowlistedDomains: state.allowlistedDomains,
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
      const parseResult = await parseFilterListChunked(rawText);
      // Same stack-safety guard here for merged list accumulation.
      for (const rule of parseResult.parsedRules) {
        parsedByRuleset[filterList.ruleset].push(rule);
      }
      anyFetchSucceeded = true;

      filterListStatus.push({
        name: filterList.name,
        ruleset: filterList.ruleset,
        enabled: true,
        ok: true,
        fetchedAt,
        parsedRules: parseResult.parsedRules.length,
      });

      await logger.debug(`Parsed ${filterList.name}`, parseResult.stats);
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
      ? selectDynamicRules(compileRules(parsedByRuleset['ads-core'], ADS_CORE_START_ID), ADS_CORE_DYNAMIC_BUDGET)
      : [];
  }

  if (FILTER_LISTS.some((filterList) => filterList.ruleset === 'trackers' && config[filterList.name] !== false)) {
    await yieldToServiceWorker();
    compiledTrackerRules = parsedByRuleset.trackers.length > 0
      ? selectDynamicRules(compileRules(parsedByRuleset.trackers, TRACKERS_START_ID), TRACKERS_DYNAMIC_BUDGET)
      : [];
  }

  if (!anyFetchSucceeded && enabledListCount > 0 && compiledAdsRules.length === 0 && compiledTrackerRules.length === 0) {
    await chrome.storage.local.set({
      filterListStatus,
      ruleCount: FALLBACK_RULE_COUNT + state.customDynamicRules.length,
    });
    logger.error('All filter list fetches failed; packaged fallback rules remain active');
    return buildStatsResponse();
  }

  const lastUpdated = anyFetchSucceeded ? Date.now() : state.lastUpdated;
  const ruleCount = compiledAdsRules.length + compiledTrackerRules.length + state.customDynamicRules.length;

  await chrome.storage.local.set({
    'compiledRules_ads-core': compiledAdsRules,
    'compiledRules_trackers': compiledTrackerRules,
    filterListStatus,
    lastUpdated,
    ruleCount,
  });

  if (state.enabled) {
    await replaceDynamicRules([
      ...compiledAdsRules,
      ...compiledTrackerRules,
      ...state.customDynamicRules,
      ...state.allowlistRules,
    ]);
  }

  logger.info('Filter pipeline refresh complete', { ruleCount });
  return buildStatsResponse();
}

/**
 * Persists compiled custom-rule state and re-applies DNR.
 * @param {string[]} lines
 * @returns {Promise<object>}
 */
async function saveCustomRules(lines) {
  const state = await getState();
  const compiledCustomState = compileCustomRuleState(lines);
  const ruleCount = state['compiledRules_ads-core'].length
    + state['compiledRules_trackers'].length
    + compiledCustomState.customDynamicRules.length;

  await chrome.storage.local.set({
    customRuleLines: compiledCustomState.customRuleLines,
    customCosmeticRules: compiledCustomState.customCosmeticRules,
    customDynamicRules: compiledCustomState.customDynamicRules,
    ruleCount,
  });

  await reconcileRulesetState();
  await broadcastPageRuleRefresh();
  return buildSettingsResponse();
}

/**
 * Adds a single picker-generated rule to the custom rule set.
 * @param {string} rule
 * @returns {Promise<object>}
 */
async function savePickerRule(rule) {
  const state = await getState();
  const nextLines = [...state.customRuleLines, rule];
  return saveCustomRules(nextLines);
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
 * Increments one of the persisted stats counters.
 * @param {string} stat
 * @returns {Promise<object>}
 */
async function incrementStat(stat) {
  const state = await getState();
  const statMap = {
    ads: 'adsBlocked',
    adsBlocked: 'adsBlocked',
    trackers: 'trackersBlocked',
    tracker: 'trackersBlocked',
    trackersBlocked: 'trackersBlocked',
    cosmetic: 'cosmeticBlocked',
    cosmeticBlocked: 'cosmeticBlocked',
    heuristic: 'heuristicBlocked',
    heuristicBlocked: 'heuristicBlocked',
    ml: 'mlBlocked',
    mlBlocked: 'mlBlocked',
    phishing: 'phishingBlocked',
    phishingBlocked: 'phishingBlocked',
  };
  const key = statMap[String(stat || '').trim()];
  if (!key) {
    return { ok: false };
  }

  const nextValue = state[key] + 1;
  const payload = {
    [key]: nextValue,
  };
  if (key === 'adsBlocked') {
    payload.blockedCount = nextValue;
  }

  await chrome.storage.local.set(payload);
  return { ok: true, value: nextValue };
}

/**
 * Resets all stored stat counters.
 * @returns {Promise<object>}
 */
async function resetStats() {
  const payload = {
    blockedCount: 0,
  };
  for (const key of COUNTER_STORAGE_KEYS) {
    payload[key] = 0;
  }
  await chrome.storage.local.set(payload);
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
    ruleCount: currentState.ruleCount,
    filterListStatus: currentState.filterListStatus,
    filterListConfig: sanitizeFilterListConfig(payload?.filterListConfig ?? currentState.filterListConfig),
    debug: payload?.debug === true,
    blockedCount: Number.isFinite(payload?.blockedCount) ? payload.blockedCount : (Number.isFinite(payload?.adsBlocked) ? payload.adsBlocked : 0),
    adsBlocked: Number.isFinite(payload?.adsBlocked) ? payload.adsBlocked : 0,
    trackersBlocked: Number.isFinite(payload?.trackersBlocked) ? payload.trackersBlocked : 0,
    cosmeticBlocked: Number.isFinite(payload?.cosmeticBlocked) ? payload.cosmeticBlocked : 0,
    heuristicBlocked: Number.isFinite(payload?.heuristicBlocked) ? payload.heuristicBlocked : 0,
    mlBlocked: Number.isFinite(payload?.mlBlocked) ? payload.mlBlocked : 0,
    phishingBlocked: Number.isFinite(payload?.phishingBlocked) ? payload.phishingBlocked : 0,
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
  await fetchAndCompileFilters();
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
  await fetchAndCompileFilters();
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
    const customRuleState = compileCustomRuleState(current.customRuleLines);
    const allowlistRules = buildAllowlistRules(current.allowlistedDomains);
    await chrome.storage.local.set({
      enabled: current.enabled,
      installedAt: current.installedAt > 0 ? current.installedAt : Date.now(),
      lastUpdated: current.lastUpdated,
      ruleCount: current.ruleCount,
      filterListStatus: current.filterListStatus,
      filterListConfig: current.filterListConfig,
      debug: current.debug,
      blockedCount: current.blockedCount,
      adsBlocked: current.adsBlocked,
      trackersBlocked: current.trackersBlocked,
      cosmeticBlocked: current.cosmeticBlocked,
      heuristicBlocked: current.heuristicBlocked,
      mlBlocked: current.mlBlocked,
      phishingBlocked: current.phishingBlocked,
      'compiledRules_ads-core': current['compiledRules_ads-core'],
      'compiledRules_trackers': current['compiledRules_trackers'],
      customDynamicRules: customRuleState.customDynamicRules,
      customCosmeticRules: customRuleState.customCosmeticRules,
      customRuleLines: customRuleState.customRuleLines,
      allowlistedDomains: current.allowlistedDomains,
      allowlistRules,
    });

    await applyStaticRulesetState(current.enabled);
    await ensureAlarms();
    logger.info('ShieldBlock AI v3 installed');
    await fetchAndCompileFilters();
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
  if (alarm.name === FILTER_UPDATE_ALARM) {
    void fetchAndCompileFilters();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

      if (message?.action === 'pageLoad') {
        await logger.debug('Page load observed', {
          hostname: typeof message.hostname === 'string' ? message.hostname : '',
          timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
        });
        sendResponse({ ok: true });
        return;
      }

      if (message?.action === 'refreshLists' || message?.action === 'refreshList') {
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

      if (message?.action === 'saveRule') {
        sendResponse(await savePickerRule(message.rule));
        return;
      }

      if (message?.action === 'saveCustomRules') {
        const lines = typeof message.rulesText === 'string'
          ? message.rulesText.split(/\r?\n/)
          : [];
        sendResponse(await saveCustomRules(lines));
        return;
      }

      if (message?.action === 'incrementStat') {
        sendResponse(await incrementStat(message.stat));
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
