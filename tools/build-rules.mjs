#!/usr/bin/env node
/**
 * Compiles upstream ABP/uBlock filter lists into packaged DNR static rulesets.
 *
 * Chrome's MV3 dynamic-rule quota (5,000 rules shared with session rules) is far
 * too small to hold EasyList-scale coverage, so the network layer is compiled at
 * build time into static rulesets instead. Static rulesets draw from a much
 * larger budget: 30,000 rules are guaranteed to every extension, and additional
 * rules come from a 330,000-rule pool shared across all installed extensions.
 *
 * Output is split into two tiers:
 *   - core     enabled in the manifest, sized to fit the guaranteed 30,000
 *   - extended shipped disabled, enabled at runtime with quota backoff
 *
 * Usage: npm run build:rules
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileRules, parseFilterList } from '../filter-compiler.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_DIR = join(REPO_ROOT, 'rules', 'generated');
const MANIFEST_PATH = join(REPO_ROOT, 'manifest.json');

/** Rules per generated ruleset file. Small chunks let the runtime enable the
 * extended tier partially when the shared static-rule pool is nearly full. */
const CHUNK_SIZE = 5000;
/** Chrome's GUARANTEED_MINIMUM_STATIC_RULES. Everything enabled at install must
 * fit inside it so the baseline can never fail to load, no matter what other
 * extensions have taken from the shared pool. */
const GUARANTEED_STATIC_RULES = 30000;
/** Drawn from the shared GLOBAL_STATIC_RULE_LIMIT pool; best-effort at runtime.
 * Sized to absorb the full deduplicated corpus so nothing is silently dropped. */
const EXTENDED_RULE_BUDGET = 115000;
const FETCH_TIMEOUT_MS = 60000;

/** Curated rulesets that ship by hand and always stay enabled. */
const CURATED_RULESETS = Object.freeze([
  { id: 'ads-core', path: 'rules/ads-core.json' },
  { id: 'trackers', path: 'rules/trackers.json' },
  { id: 'annoyances', path: 'rules/annoyances.json' },
  { id: 'youtube', path: 'rules/youtube-network.json' },
  { id: 'security', path: 'rules/security.json' },
]);

/**
 * Upstream sources, highest-value first. Order decides which rules survive the
 * budget cut when the combined lists exceed CORE + EXTENDED.
 */
const SOURCES = Object.freeze([
  {
    name: 'uBlock Filters',
    url: 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt',
  },
  {
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
  },
  {
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
  },
  {
    name: 'AdGuard Base',
    url: 'https://filters.adtidy.org/extension/chromium/filters/2.txt',
  },
]);

/**
 * Fetches a filter list as text with a timeout.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchListText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Scores a parsed rule so the highest-value rules land in the core tier.
 *
 * Domain-anchored patterns match fastest and misfire least; initiator-scoped and
 * third-party-scoped rules are precise enough to be worth guaranteed slots.
 * @param {{ condition: { urlFilter: string, domainType?: string, initiatorDomains?: string[] } }} rule
 * @returns {number}
 */
function scoreRule(rule) {
  let score = 0;
  if (rule.condition.urlFilter.startsWith('||')) {
    score += 3;
  }
  if (rule.condition.initiatorDomains?.length) {
    score += 2;
  }
  if (rule.condition.domainType === 'thirdParty') {
    score += 1;
  }
  return score;
}

/**
 * Sorts rules by descending score while preserving source order within a score.
 * @param {Array<object>} rules
 * @returns {Array<object>}
 */
function sortByValue(rules) {
  return rules
    .map((rule, index) => ({ rule, index, score: scoreRule(rule) }))
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((entry) => entry.rule);
}

/** The resource types DNR already matches when `resourceTypes` is omitted:
 * everything except main_frame. Rules carrying exactly this set can drop the
 * field, which removes a 14-entry array from most of the 128k packaged rules. */
const IMPLICIT_RESOURCE_TYPES = Object.freeze([
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
const IMPLICIT_RESOURCE_TYPE_SET = new Set(IMPLICIT_RESOURCE_TYPES);

/**
 * Drops a rule's `resourceTypes` when it is redundant with the DNR default.
 * @param {{ condition: { resourceTypes?: string[] } }} rule
 * @returns {object}
 */
function minifyRule(rule) {
  const { resourceTypes } = rule.condition;
  if (
    !Array.isArray(resourceTypes)
    || resourceTypes.length !== IMPLICIT_RESOURCE_TYPE_SET.size
    || !resourceTypes.every((type) => IMPLICIT_RESOURCE_TYPE_SET.has(type))
  ) {
    return rule;
  }

  const condition = { ...rule.condition };
  delete condition.resourceTypes;
  return { ...rule, condition };
}

/**
 * Splits rules into fixed-size chunks.
 * @param {Array<object>} rules
 * @param {number} size
 * @returns {Array<Array<object>>}
 */
function chunk(rules, size) {
  const chunks = [];
  for (let index = 0; index < rules.length; index += size) {
    chunks.push(rules.slice(index, index + size));
  }
  return chunks;
}

/**
 * Writes one tier's chunks to disk and returns their ruleset descriptors.
 * @param {string} tier
 * @param {Array<object>} rules
 * @returns {Promise<Array<{ id: string, path: string, ruleCount: number }>>}
 */
async function writeTier(tier, rules) {
  const descriptors = [];
  const chunks = chunk(rules, CHUNK_SIZE);

  for (const [index, chunkRules] of chunks.entries()) {
    const fileName = `${tier}-${String(index + 1).padStart(2, '0')}.json`;
    await writeFile(join(GENERATED_DIR, fileName), `${JSON.stringify(chunkRules.map(minifyRule))}\n`);
    descriptors.push({
      id: `gen-${tier}-${String(index + 1).padStart(2, '0')}`,
      path: `rules/generated/${fileName}`,
      ruleCount: chunkRules.length,
    });
  }

  return descriptors;
}

/**
 * Emits the module background.js imports to learn the generated ruleset layout.
 * @param {Array<{ id: string, ruleCount: number }>} core
 * @param {Array<{ id: string, ruleCount: number }>} extended
 * @param {object} meta
 * @returns {Promise<void>}
 */
async function writeIndexModule(exceptions, core, extended, meta) {
  const sum = (descriptors) => descriptors.reduce((total, entry) => total + entry.ruleCount, 0);
  const contents = `// Generated by tools/build-rules.mjs. Do not edit by hand.
// Built ${meta.builtAt} from: ${meta.sources.join(', ')}.

/** Exception (\`@@\`) ruleset IDs. These must stay enabled whenever any block
 * ruleset is enabled, otherwise blocks apply without their overrides. */
export const GENERATED_EXCEPTION_RULESETS = Object.freeze(${JSON.stringify(exceptions.map((entry) => entry.id))});

/** Ruleset IDs enabled unconditionally; sized to fit the guaranteed static budget. */
export const GENERATED_CORE_RULESETS = Object.freeze(${JSON.stringify(core.map((entry) => entry.id))});

/** Ruleset IDs enabled best-effort; they draw from the shared static-rule pool. */
export const GENERATED_EXTENDED_RULESETS = Object.freeze(${JSON.stringify(extended.map((entry) => entry.id))});

/** Rule count per generated ruleset ID, for reporting enabled coverage. */
export const GENERATED_RULE_COUNTS = Object.freeze(${JSON.stringify(
    Object.fromEntries(
      [...exceptions, ...core, ...extended].map((entry) => [entry.id, entry.ruleCount]),
    ),
  )});

/** Rules in the hand-maintained rulesets, which are always enabled. */
export const CURATED_RULE_COUNT = ${meta.curatedRuleCount};

/** Epoch milliseconds when the packaged rules were compiled. */
export const GENERATED_BUILT_AT = ${meta.builtAtMs};

/** Total rules across every generated tier. */
export const GENERATED_RULE_TOTAL = ${sum(exceptions) + sum(core) + sum(extended)};
`;

  await writeFile(join(GENERATED_DIR, 'index.js'), contents);
}

/**
 * Rewrites the manifest's rule_resources to match the generated layout.
 * @param {Array<{ id: string, path: string }>} core
 * @param {Array<{ id: string, path: string }>} extended
 * @returns {Promise<void>}
 */
async function updateManifest(exceptions, core, extended) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  manifest.declarative_net_request.rule_resources = [
    ...CURATED_RULESETS.map((entry) => ({ id: entry.id, enabled: true, path: entry.path })),
    ...exceptions.map((entry) => ({ id: entry.id, enabled: true, path: entry.path })),
    ...core.map((entry) => ({ id: entry.id, enabled: true, path: entry.path })),
    ...extended.map((entry) => ({ id: entry.id, enabled: false, path: entry.path })),
  ];

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Removes previously generated files so deleted chunks never linger.
 * @returns {Promise<void>}
 */
async function cleanGeneratedDir() {
  await mkdir(GENERATED_DIR, { recursive: true });
  const entries = await readdir(GENERATED_DIR);
  await Promise.all(entries.map((entry) => rm(join(GENERATED_DIR, entry), { force: true })));
}

/**
 * Counts the rules in the hand-maintained rulesets, which also stay enabled and
 * therefore consume part of the guaranteed budget.
 * @returns {Promise<number>}
 */
async function countCuratedRules() {
  let total = 0;
  for (const ruleset of CURATED_RULESETS) {
    const rules = JSON.parse(await readFile(join(REPO_ROOT, ruleset.path), 'utf8'));
    total += rules.length;
  }
  return total;
}

async function main() {
  const parsedRules = [];
  const sourceSummaries = [];

  for (const source of SOURCES) {
    process.stdout.write(`Fetching ${source.name}... `);
    const text = await fetchListText(source.url);
    const rules = parseFilterList(text);
    for (const rule of rules) {
      parsedRules.push(rule);
    }
    sourceSummaries.push(`${source.name} (${rules.length})`);
    process.stdout.write(`${rules.length} rules\n`);
  }

  // One compile pass across every source so deduplication is global and rule IDs
  // stay unique across the whole generated set.
  const compiled = compileRules(sortByValue(parsedRules), 1);
  const curatedRuleCount = await countCuratedRules();

  // Exceptions are never truncated and never shipped disabled. An `@@` rule only
  // exists to override a block, so a block that outlives its exception is worse
  // than having neither: it breaks logins, checkouts, and shared CDNs.
  const exceptions = compiled.filter((rule) => rule.action.type !== 'block');
  const blocks = compiled.filter((rule) => rule.action.type === 'block');

  const coreBudget = GUARANTEED_STATIC_RULES - curatedRuleCount - exceptions.length;
  if (coreBudget <= 0) {
    throw new Error(
      `Curated (${curatedRuleCount}) and exception (${exceptions.length}) rules already fill the `
      + `${GUARANTEED_STATIC_RULES} guaranteed static-rule budget`,
    );
  }

  const core = blocks.slice(0, coreBudget);
  const extended = blocks.slice(coreBudget, coreBudget + EXTENDED_RULE_BUDGET);
  const dropped = blocks.length - core.length - extended.length;

  await cleanGeneratedDir();
  const exceptionDescriptors = await writeTier('exc', exceptions);
  const coreDescriptors = await writeTier('core', core);
  const extendedDescriptors = await writeTier('ext', extended);

  const builtAtMs = Date.now();
  await writeIndexModule(exceptionDescriptors, coreDescriptors, extendedDescriptors, {
    builtAt: new Date(builtAtMs).toISOString(),
    builtAtMs,
    curatedRuleCount,
    sources: SOURCES.map((source) => source.name),
  });
  await updateManifest(exceptionDescriptors, coreDescriptors, extendedDescriptors);

  const rulesetTotal = CURATED_RULESETS.length
    + exceptionDescriptors.length
    + coreDescriptors.length
    + extendedDescriptors.length;
  const documentExceptions = exceptions.filter((rule) => rule.action.type === 'allowAllRequests').length;
  console.log([
    '',
    `Parsed         ${parsedRules.length}`,
    `Deduplicated   ${compiled.length}`,
    `Curated        ${curatedRuleCount} rules (hand-maintained, always enabled)`,
    `Exceptions     ${exceptions.length} rules across ${exceptionDescriptors.length} rulesets `
      + `(${documentExceptions} document-level, always enabled)`,
    `Core tier      ${core.length} rules across ${coreDescriptors.length} rulesets (enabled)`,
    `Extended tier  ${extended.length} rules across ${extendedDescriptors.length} rulesets (runtime)`,
    `Dropped        ${dropped}`,
    `Rulesets       ${rulesetTotal} total (Chrome allows 50)`,
  ].join('\n'));

  if (rulesetTotal > 50) {
    throw new Error(`Ruleset count ${rulesetTotal} exceeds Chrome's 50-ruleset manifest limit`);
  }
}

await main();
