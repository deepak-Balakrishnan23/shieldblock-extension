#!/usr/bin/env node
/**
 * Validates every packaged DNR ruleset against the constraints Chrome enforces
 * at load time.
 *
 * Chrome rejects an entire ruleset file when a single rule inside it is
 * malformed, so one bad pattern silently removes thousands of rules from the
 * running extension. This runs in CI to make that failure loud instead.
 *
 * Usage: npm run validate:rules
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(REPO_ROOT, 'manifest.json');

/** Chrome's MV3 declarativeNetRequest limits. */
const MAX_RULESETS = 50;
const MAX_ENABLED_RULESETS = 50;
const GUARANTEED_STATIC_RULES = 30000;

const VALID_RESOURCE_TYPES = new Set([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
]);
const VALID_DOMAIN = /^[a-z0-9.-]+$/;
const NON_ASCII = /[^\x00-\x7F]/;

/**
 * Collects every constraint violation in one rule.
 * @param {object} rule
 * @returns {string[]}
 */
function findRuleProblems(rule) {
  const problems = [];

  if (!Number.isInteger(rule.id) || rule.id < 1) {
    problems.push(`id must be a positive integer, got ${JSON.stringify(rule.id)}`);
  }
  if (!rule.action?.type) {
    problems.push('missing action.type');
  }

  // Chrome only accepts allowAllRequests on navigation requests.
  if (rule.action?.type === 'allowAllRequests') {
    const types = rule.condition?.resourceTypes ?? [];
    const invalid = types.filter((type) => type !== 'main_frame' && type !== 'sub_frame');
    if (!types.length) {
      problems.push('allowAllRequests requires explicit main_frame/sub_frame resourceTypes');
    }
    if (invalid.length) {
      problems.push(`allowAllRequests does not allow resourceTypes: ${invalid.join(', ')}`);
    }
  }

  const condition = rule.condition ?? {};
  const urlFilter = condition.urlFilter;

  if (typeof urlFilter !== 'string' || !urlFilter) {
    if (!condition.regexFilter) {
      problems.push('missing urlFilter');
    }
  } else {
    if (NON_ASCII.test(urlFilter)) {
      problems.push(`urlFilter is not ASCII: ${urlFilter}`);
    }
    if (urlFilter.startsWith('||*')) {
      problems.push(`urlFilter may not begin with "||*": ${urlFilter}`);
    }
    const body = urlFilter.replace(/^(\|\||\|)/, '').replace(/\|$/, '');
    if (body.includes('|')) {
      problems.push(`"|" is only allowed at pattern boundaries: ${urlFilter}`);
    }
  }

  for (const key of ['initiatorDomains', 'excludedInitiatorDomains', 'requestDomains']) {
    const domains = condition[key];
    if (domains === undefined) {
      continue;
    }
    if (!Array.isArray(domains) || domains.length === 0) {
      problems.push(`${key} must be a non-empty array`);
      continue;
    }
    for (const domain of domains) {
      if (typeof domain !== 'string' || !VALID_DOMAIN.test(domain)) {
        problems.push(`${key} contains an invalid host: ${JSON.stringify(domain)}`);
      }
    }
  }

  for (const type of condition.resourceTypes ?? []) {
    if (!VALID_RESOURCE_TYPES.has(type)) {
      problems.push(`unknown resourceType: ${type}`);
    }
  }

  return problems;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const rulesets = manifest.declarative_net_request?.rule_resources ?? [];
  const failures = [];
  const seenRulesetIds = new Set();
  let enabledRuleTotal = 0;
  let ruleTotal = 0;

  if (rulesets.length > MAX_RULESETS) {
    failures.push(`manifest declares ${rulesets.length} rulesets; Chrome allows ${MAX_RULESETS}`);
  }

  const enabledCount = rulesets.filter((ruleset) => ruleset.enabled).length;
  if (enabledCount > MAX_ENABLED_RULESETS) {
    failures.push(`${enabledCount} rulesets enabled in the manifest; Chrome allows ${MAX_ENABLED_RULESETS}`);
  }

  for (const ruleset of rulesets) {
    if (seenRulesetIds.has(ruleset.id)) {
      failures.push(`duplicate ruleset id: ${ruleset.id}`);
    }
    seenRulesetIds.add(ruleset.id);

    const rules = JSON.parse(await readFile(join(REPO_ROOT, ruleset.path), 'utf8'));
    const seenRuleIds = new Set();
    let problemCount = 0;

    for (const rule of rules) {
      if (seenRuleIds.has(rule.id)) {
        failures.push(`${ruleset.path}: duplicate rule id ${rule.id}`);
      }
      seenRuleIds.add(rule.id);

      for (const problem of findRuleProblems(rule)) {
        problemCount += 1;
        // Cap per-file output so one systemic mistake stays readable.
        if (problemCount <= 5) {
          failures.push(`${ruleset.path}: rule ${rule.id}: ${problem}`);
        }
      }
    }

    if (problemCount > 5) {
      failures.push(`${ruleset.path}: ...and ${problemCount - 5} more problems`);
    }

    ruleTotal += rules.length;
    if (ruleset.enabled) {
      enabledRuleTotal += rules.length;
    }
  }

  console.log(`Rulesets   ${rulesets.length} (${enabledCount} enabled in manifest)`);
  console.log(`Rules      ${ruleTotal} total, ${enabledRuleTotal} enabled at install`);

  if (enabledRuleTotal > GUARANTEED_STATIC_RULES) {
    failures.push(
      `${enabledRuleTotal} rules enabled at install exceeds the ${GUARANTEED_STATIC_RULES} guaranteed `
      + 'static-rule budget, so enabling them can fail when other extensions are installed',
    );
  }

  if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll rulesets valid.');
}

await main();
