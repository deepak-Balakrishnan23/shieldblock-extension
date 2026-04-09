const MAX_COMPILED_RULES = 295000;
const MAX_RULESET_CHUNK = 29500;
const DEFAULT_RESOURCE_TYPES = Object.freeze([
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
  'sub_frame',
  'font',
]);
const RESOURCE_TYPE_MAP = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  beacon: 'ping',
  media: 'media',
  websocket: 'websocket',
  webtransport: 'webtransport',
  webbundle: 'webbundle',
  other: 'other',
  subdocument: 'sub_frame',
  sub_frame: 'sub_frame',
  font: 'font',
  document: 'main_frame',
});
const NO_OP_MODIFIERS = new Set([
  'important',
  'match-case',
]);

let lastCompilerStats = {
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

/**
 * Returns the most recent compiler stats snapshot.
 * @returns {{ parsed: number, skippedComments: number, skippedCosmetic: number, skippedExceptions: number, skippedRegex: number, skippedUnsupported: number, skippedUnknownModifiers: number, deduplicated: number, capped: boolean }}
 */
export function getCompilerStats() {
  return { ...lastCompilerStats };
}

/**
 * Normalizes a raw ABP/uBlock pattern into a DNR-compatible urlFilter.
 * @param {string} pattern
 * @returns {string|null}
 */
function normalizeUrlFilter(pattern) {
  const normalized = pattern.trim();
  if (!normalized) {
    return null;
  }

  if (/^\/.*\/$/.test(normalized)) {
    return null;
  }

  if (normalized.startsWith('||')) {
    return normalized;
  }

  if (normalized.startsWith('|http://') || normalized.startsWith('|https://')) {
    return normalized.slice(1);
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  if (normalized.startsWith('*') || normalized.includes('^')) {
    return normalized.startsWith('||') ? normalized : `||${normalized.replace(/^\|+/, '')}`;
  }

  if (/^[\w.-]+\.[a-z]{2,}/i.test(normalized)) {
    return `||${normalized.replace(/^\|+/, '')}`;
  }

  return null;
}

/**
 * Parses a domain= modifier into DNR initiator domain constraints.
 * @param {string} modifier
 * @returns {{ initiatorDomains?: string[], excludedInitiatorDomains?: string[] }}
 */
function parseDomainModifier(modifier) {
  const value = modifier.slice('domain='.length);
  const include = [];
  const exclude = [];

  for (const rawToken of value.split('|')) {
    const token = rawToken.trim().toLowerCase();
    if (!token) {
      continue;
    }

    if (token.startsWith('~')) {
      exclude.push(token.slice(1));
    } else {
      include.push(token);
    }
  }

  const constraint = {};
  if (include.length) {
    constraint.initiatorDomains = include;
  }
  if (exclude.length) {
    constraint.excludedInitiatorDomains = exclude;
  }
  return constraint;
}

/**
 * Applies supported ABP/uBlock modifiers to a DNR condition.
 * @param {{ urlFilter: string, resourceTypes: string[] }} condition
 * @param {string} modifiersText
 * @returns {{ ok: boolean, condition?: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }}
 */
function applyModifiers(condition, modifiersText) {
  const includeTypes = new Set();
  const excludeTypes = new Set();
  const nextCondition = { ...condition };

  for (const rawModifier of modifiersText.split(',')) {
    const modifier = rawModifier.trim();
    if (!modifier) {
      continue;
    }

    if (NO_OP_MODIFIERS.has(modifier)) {
      continue;
    }

    if (modifier === 'third-party') {
      nextCondition.domainType = 'thirdParty';
      continue;
    }

    if (modifier === '~third-party') {
      nextCondition.domainType = 'firstParty';
      continue;
    }

    if (modifier.startsWith('domain=')) {
      Object.assign(nextCondition, parseDomainModifier(modifier));
      continue;
    }

    const isNegatedType = modifier.startsWith('~') && RESOURCE_TYPE_MAP[modifier.slice(1)];
    if (isNegatedType) {
      excludeTypes.add(RESOURCE_TYPE_MAP[modifier.slice(1)]);
      continue;
    }

    if (RESOURCE_TYPE_MAP[modifier]) {
      includeTypes.add(RESOURCE_TYPE_MAP[modifier]);
      continue;
    }

    return { ok: false };
  }

  const finalTypes = includeTypes.size
    ? [...includeTypes].filter((type) => !excludeTypes.has(type))
    : DEFAULT_RESOURCE_TYPES.filter((type) => !excludeTypes.has(type));

  if (!finalTypes.length) {
    return { ok: false };
  }

  nextCondition.resourceTypes = finalTypes;
  return { ok: true, condition: nextCondition };
}

/**
 * Parses a raw ABP/uBlock filter list into DNR-ready rule objects without IDs.
 * @param {string} text
 * @returns {Array<{ priority: number, action: { type: 'block' }, condition: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }>}
 */
export function parseFilterList(text) {
  const stats = {
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
  const parsedRules = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('#') || line.startsWith('[')) {
      stats.skippedComments += 1;
      continue;
    }

    if (line.startsWith('@@')) {
      stats.skippedExceptions += 1;
      continue;
    }

    if (line.includes('##') || line.includes('#?#')) {
      stats.skippedCosmetic += 1;
      continue;
    }

    if (/^\/.*\/$/.test(line)) {
      stats.skippedRegex += 1;
      continue;
    }

    const modifierIndex = line.indexOf('$');
    const pattern = modifierIndex === -1 ? line : line.slice(0, modifierIndex);
    const modifiers = modifierIndex === -1 ? '' : line.slice(modifierIndex + 1);
    const urlFilter = normalizeUrlFilter(pattern);

    if (!urlFilter) {
      stats.skippedUnsupported += 1;
      continue;
    }

    let condition = {
      urlFilter,
      resourceTypes: [...DEFAULT_RESOURCE_TYPES],
    };

    if (modifiers) {
      const result = applyModifiers(condition, modifiers);
      if (!result.ok || !result.condition) {
        stats.skippedUnknownModifiers += 1;
        continue;
      }
      condition = result.condition;
    }

    parsedRules.push({
      priority: 100,
      action: { type: 'block' },
      condition,
    });
    stats.parsed += 1;
  }

  lastCompilerStats = stats;
  return parsedRules;
}

/**
 * Compiles parsed rules into final DNR rules with unique IDs and deduplication.
 * @param {Array<{ priority: number, action: { type: 'block' }, condition: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }>} parsedRules
 * @param {number} startId
 * @returns {Array<{ id: number, priority: number, action: { type: 'block' }, condition: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }>}
 */
export function compileRules(parsedRules, startId) {
  const uniqueRules = new Map();
  const compiledRules = [];
  let nextId = startId;

  for (const rule of parsedRules) {
    const key = JSON.stringify({
      urlFilter: rule.condition.urlFilter,
      resourceTypes: [...rule.condition.resourceTypes].sort(),
      domainType: rule.condition.domainType ?? '',
      initiatorDomains: rule.condition.initiatorDomains ?? [],
      excludedInitiatorDomains: rule.condition.excludedInitiatorDomains ?? [],
    });

    if (uniqueRules.has(key)) {
      lastCompilerStats.deduplicated += 1;
      continue;
    }

    if (compiledRules.length >= MAX_COMPILED_RULES) {
      lastCompilerStats.capped = true;
      break;
    }

    const compiledRule = {
      id: nextId,
      priority: rule.priority ?? 100,
      action: { type: 'block' },
      condition: { ...rule.condition, resourceTypes: [...rule.condition.resourceTypes] },
    };

    uniqueRules.set(key, true);
    compiledRules.push(compiledRule);
    nextId += 1;
  }

  return compiledRules;
}

/**
 * Splits a compiled rule array into 29,500-rule chunks.
 * @param {Array<{ id: number, priority: number, action: { type: 'block' }, condition: object }>} allRules
 * @returns {Array<Array<{ id: number, priority: number, action: { type: 'block' }, condition: object }>>}
 */
export function splitRulesets(allRules) {
  const chunks = [];
  for (let index = 0; index < allRules.length; index += MAX_RULESET_CHUNK) {
    chunks.push(allRules.slice(index, index + MAX_RULESET_CHUNK));
  }
  return chunks;
}
