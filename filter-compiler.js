const MAX_COMPILED_RULES = 295000;
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
  frame: 'sub_frame',
  font: 'font',
  css: 'stylesheet',
  doc: 'main_frame',
  document: 'main_frame',
  'object-subrequest': 'object',
});
const NO_OP_MODIFIERS = new Set([
  'match-case',
]);
/** uBlock/AdGuard shorthands for party scoping. */
const FIRST_PARTY_MODIFIERS = new Set(['~third-party', '1p', '~3p']);
const THIRD_PARTY_MODIFIERS = new Set(['third-party', '3p', '~1p']);
/**
 * Exception modifiers that scope cosmetic filtering or AdGuard-only features
 * rather than network requests.
 *
 * They carry no DNR meaning, but they must be recognized rather than treated as
 * unknown: `@@||site^$document,elemhide` still contains a real network
 * exception, and discarding the whole line over `elemhide` would keep the site
 * broken. A line whose modifiers are *only* from this set is not a network
 * exception at all and is skipped.
 */
const NON_NETWORK_EXCEPTION_MODIFIERS = new Set([
  'elemhide',
  'ehide',
  'generichide',
  'ghide',
  'specifichide',
  'shide',
  'genericblock',
  'urlblock',
  'jsinject',
  'content',
  'extension',
  'stealth',
]);
/** Exception modifiers that lift blocking for a whole document and its frames. */
const DOCUMENT_EXCEPTION_MODIFIERS = new Set(['document', 'all']);
/**
 * Priority ladder mirroring ABP precedence.
 *
 * DNR picks the highest-priority match, breaking ties by action
 * (`allowAllRequests` > `allow` > `block`). Ordinary exceptions therefore
 * outrank ordinary blocks, while `$important` blocks — which list authors mark
 * precisely so exceptions cannot override them — outrank both. User allowlist
 * rules sit above all of these at priority 1000.
 */
const BLOCK_PRIORITY = 100;
const EXCEPTION_PRIORITY = 200;
const DOCUMENT_EXCEPTION_PRIORITY = 300;
const IMPORTANT_BLOCK_PRIORITY = 400;
const IMPORTANT_EXCEPTION_PRIORITY = 500;
const IMPORTANT_DOCUMENT_EXCEPTION_PRIORITY = 600;
/** `allowAllRequests` is only valid for these resource types. */
const DOCUMENT_RESOURCE_TYPES = Object.freeze(['main_frame', 'sub_frame']);
/**
 * Every non-network separator in the ABP/uBlock/AdGuard dialects:
 * `##` `#@#` cosmetic, `#?#` `#@?#` procedural, `#%#` `#@%#` scriptlet,
 * `#$#` `#@$#` `#$?#` `#@$?#` CSS injection.
 *
 * These lines must never reach the network compiler. A scriptlet body compiled
 * as a urlFilter yields a junk rule, and an AdGuard HTML filter (`$$`) would
 * split at its `$` and block the entire domain.
 */
const NON_NETWORK_SEPARATOR = /#@?[?%$]*#/;
const HTML_FILTER_SEPARATOR = /\$@?\$/;
// Kept separate: a /g regex carries lastIndex state across .test() calls.
const NON_ASCII = /[^\x00-\x7F]/;
const NON_ASCII_GLOBAL = /[^\x00-\x7F]/g;
/** DNR requires initiator domains to be plain lowercase ASCII hostnames. */
const VALID_DOMAIN = /^[a-z0-9.-]+$/;
/** Shortest substring pattern worth compiling; below this a rule overblocks. */
const MIN_SUBSTRING_FILTER_LENGTH = 4;

/**
 * Percent-encodes non-ASCII characters so the pattern satisfies DNR's
 * ASCII-only `urlFilter` requirement while still matching canonicalized URLs.
 * @param {string} urlFilter
 * @returns {string}
 */
function toAsciiUrlFilter(urlFilter) {
  if (!NON_ASCII.test(urlFilter)) {
    return urlFilter;
  }
  return urlFilter.replace(NON_ASCII_GLOBAL, (character) => encodeURIComponent(character));
}

/**
 * Returns true when every entry is a DNR-acceptable hostname.
 *
 * Wildcard and regex domain syntax (`domain=/re/`, `domain=*.foo`) has no DNR
 * equivalent, and a single malformed entry makes Chrome reject the entire
 * ruleset it lives in, so such rules are dropped instead.
 * @param {string[]|undefined} domains
 * @returns {boolean}
 */
function hasValidDomains(domains) {
  if (!domains) {
    return true;
  }
  return domains.length > 0 && domains.every((domain) => VALID_DOMAIN.test(domain));
}

let lastCompilerStats = {
  parsed: 0,
  parsedExceptions: 0,
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

  // DNR rejects any pattern beginning with `||*`, and a leading wildcard is
  // already implicit for substring matching, so strip it rather than anchoring.
  if (normalized.startsWith('*')) {
    const stripped = normalized.replace(/^\*+/, '');
    return stripped.length >= MIN_SUBSTRING_FILTER_LENGTH ? stripped : null;
  }

  // Only domain-anchor when the pattern really does start with a hostname;
  // `||` followed by a path fragment would never match anything.
  if (/^[\w-]+(\.[\w-]+)+/.test(normalized)) {
    return `||${normalized}`;
  }

  // Path and keyword fragments such as `/adserver^` match as plain substrings,
  // which is the semantics the source lists intend for them.
  if (
    (normalized.startsWith('/') || normalized.includes('^'))
    && normalized.length >= MIN_SUBSTRING_FILTER_LENGTH
  ) {
    return normalized;
  }

  return null;
}

/**
 * Returns true when a urlFilter satisfies DNR's pattern grammar.
 *
 * `|` is only meaningful at the very start or end of a pattern, and Chrome
 * rejects the whole ruleset when a rule violates that.
 * @param {string} urlFilter
 * @returns {boolean}
 */
function isValidUrlFilter(urlFilter) {
  if (!urlFilter || urlFilter.startsWith('||*')) {
    return false;
  }
  const body = urlFilter
    .replace(/^(\|\||\|)/, '')
    .replace(/\|$/, '');
  return !body.includes('|');
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
 * @returns {{ ok: boolean, important?: boolean, condition?: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }}
 */
function applyModifiers(condition, modifiersText) {
  const includeTypes = new Set();
  const excludeTypes = new Set();
  const nextCondition = { ...condition };
  let important = false;

  for (const rawModifier of modifiersText.split(',')) {
    const modifier = rawModifier.trim();
    if (!modifier) {
      continue;
    }

    if (NO_OP_MODIFIERS.has(modifier)) {
      continue;
    }

    if (modifier === 'important') {
      important = true;
      continue;
    }

    if (THIRD_PARTY_MODIFIERS.has(modifier)) {
      nextCondition.domainType = 'thirdParty';
      continue;
    }

    if (FIRST_PARTY_MODIFIERS.has(modifier)) {
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
  return { ok: true, important, condition: nextCondition };
}

/**
 * Builds the DNR rule for an `@@` exception line.
 *
 * Exceptions are what keep filter lists from breaking payment flows, logins, and
 * CDNs shared between ads and site assets, so they map to `allow` rules that
 * outrank the block rules they override. `$document`/`$all` exceptions become
 * `allowAllRequests`, which lifts blocking for the page and everything in it.
 * @param {string} pattern
 * @param {string} modifiersText
 * @returns {{ priority: number, action: object, condition: object }|null}
 */
function buildExceptionRule(pattern, modifiersText) {
  const urlFilter = normalizeUrlFilter(pattern);
  if (!urlFilter) {
    return null;
  }

  const modifiers = modifiersText
    .split(',')
    .map((modifier) => modifier.trim())
    .filter(Boolean);
  const networkModifiers = [];
  let isDocumentException = false;
  let sawNonNetworkModifier = false;
  let isImportant = false;

  for (const modifier of modifiers) {
    if (modifier === 'important') {
      isImportant = true;
      continue;
    }

    if (DOCUMENT_EXCEPTION_MODIFIERS.has(modifier)) {
      isDocumentException = true;
      continue;
    }
    // `stealth` also appears as `stealth=value`.
    if (NON_NETWORK_EXCEPTION_MODIFIERS.has(modifier) || modifier.startsWith('stealth=')) {
      sawNonNetworkModifier = true;
      continue;
    }
    networkModifiers.push(modifier);
  }

  if (isDocumentException) {
    const condition = { urlFilter, resourceTypes: [...DOCUMENT_RESOURCE_TYPES] };
    for (const modifier of networkModifiers) {
      if (modifier.startsWith('domain=')) {
        Object.assign(condition, parseDomainModifier(modifier));
      }
    }
    return {
      priority: isImportant ? IMPORTANT_DOCUMENT_EXCEPTION_PRIORITY : DOCUMENT_EXCEPTION_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition,
    };
  }

  // Nothing left to express: the line only disabled cosmetic filtering.
  if (!networkModifiers.length && sawNonNetworkModifier) {
    return null;
  }

  let condition = { urlFilter, resourceTypes: [...DEFAULT_RESOURCE_TYPES] };
  if (networkModifiers.length) {
    const result = applyModifiers(condition, networkModifiers.join(','));
    if (!result.ok || !result.condition) {
      return null;
    }
    condition = result.condition;
  }

  return {
    priority: isImportant ? IMPORTANT_EXCEPTION_PRIORITY : EXCEPTION_PRIORITY,
    action: { type: 'allow' },
    condition,
  };
}

/**
 * Parses a raw ABP/uBlock filter list into DNR-ready rule objects without IDs.
 * @param {string} text
 * @returns {Array<{ priority: number, action: { type: 'block' }, condition: { urlFilter: string, resourceTypes: string[], domainType?: string, initiatorDomains?: string[], excludedInitiatorDomains?: string[] } }>}
 */
export function parseFilterList(text) {
  const stats = {
    parsed: 0,
    parsedExceptions: 0,
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

    if (NON_NETWORK_SEPARATOR.test(line) || HTML_FILTER_SEPARATOR.test(line)) {
      stats.skippedCosmetic += 1;
      continue;
    }

    const isException = line.startsWith('@@');
    const body = isException ? line.slice(2) : line;

    if (/^\/.*\/$/.test(body)) {
      stats.skippedRegex += 1;
      continue;
    }

    const modifierIndex = body.indexOf('$');
    const pattern = modifierIndex === -1 ? body : body.slice(0, modifierIndex);
    const modifiers = modifierIndex === -1 ? '' : body.slice(modifierIndex + 1);
    let rule;

    if (isException) {
      rule = buildExceptionRule(pattern, modifiers);
      if (!rule) {
        stats.skippedExceptions += 1;
        continue;
      }
    } else {
      const urlFilter = normalizeUrlFilter(pattern);
      if (!urlFilter) {
        stats.skippedUnsupported += 1;
        continue;
      }

      let condition = {
        urlFilter,
        resourceTypes: [...DEFAULT_RESOURCE_TYPES],
      };
      let important = false;

      if (modifiers) {
        const result = applyModifiers(condition, modifiers);
        if (!result.ok || !result.condition) {
          stats.skippedUnknownModifiers += 1;
          continue;
        }
        condition = result.condition;
        important = result.important === true;
      }

      rule = {
        priority: important ? IMPORTANT_BLOCK_PRIORITY : BLOCK_PRIORITY,
        action: { type: 'block' },
        condition,
      };
    }

    rule.condition.urlFilter = toAsciiUrlFilter(rule.condition.urlFilter);

    // A single malformed condition makes Chrome reject the whole ruleset, so
    // anything that survived parsing but can't be represented is dropped here.
    if (
      NON_ASCII.test(rule.condition.urlFilter)
      || !isValidUrlFilter(rule.condition.urlFilter)
      || !hasValidDomains(rule.condition.initiatorDomains)
      || !hasValidDomains(rule.condition.excludedInitiatorDomains)
    ) {
      stats.skippedUnsupported += 1;
      continue;
    }

    parsedRules.push(rule);
    stats.parsed += 1;
    if (isException) {
      stats.parsedExceptions += 1;
    }
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
    const action = rule.action ?? { type: 'block' };
    const priority = rule.priority ?? 100;
    // Action and priority belong in the key: a block and the exception that
    // overrides it share a condition, and collapsing them would silently drop
    // the exception.
    const key = JSON.stringify({
      action: action.type,
      priority,
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
      priority,
      action: { ...action },
      condition: { ...rule.condition, resourceTypes: [...rule.condition.resourceTypes] },
    };

    uniqueRules.set(key, true);
    compiledRules.push(compiledRule);
    nextId += 1;
  }

  return compiledRules;
}

