#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');

const sources = {
  easylist: process.env.EASYLIST_PATH || '/tmp/easylist.txt',
  easyprivacy: process.env.EASYPRIVACY_PATH || '/tmp/easyprivacy.txt',
  annoyances: process.env.FANBOY_ANNOYANCE_PATH || '/tmp/fanboy-annoyance.txt',
};

const RESOURCE_MAP = {
  script: 'script',
  image: 'image',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  document: 'main_frame',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  ping: 'ping',
  beacon: 'ping',
  stylesheet: 'stylesheet',
  object: 'object',
  other: 'other',
};

const DEFAULT_RESOURCES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'ping', 'object'];
const PATTERN_RESOURCES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'ping'];
const POPUP_RESOURCES = ['script', 'image', 'xmlhttprequest', 'sub_frame'];
const YOUTUBE_INITIATORS = [
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'studio.youtube.com',
];

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function normalizePattern(raw) {
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith('|') && !value.startsWith('||')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value || null;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[') || trimmed.startsWith('@@')) return null;
  if (trimmed.includes('##') || trimmed.includes('#@#') || trimmed.includes('#?#') || trimmed.includes('#$#')) return null;
  if (trimmed.startsWith('/') && trimmed.endsWith('/')) return null;

  const [patternPart, optionPart] = trimmed.split('$', 2);
  const pattern = normalizePattern(patternPart);
  if (!pattern) return null;

  const options = optionPart ? optionPart.split(',').map((opt) => opt.trim()).filter(Boolean) : [];
  if (options.some((opt) => opt.startsWith('domain='))) return null;
  if (options.some((opt) => opt.startsWith('sitekey=') || opt.startsWith('important'))) return null;

  const resourceTypes = [];
  let thirdParty = null;

  for (const option of options) {
    if (option === 'third-party') {
      thirdParty = 'thirdParty';
      continue;
    }
    if (option === '~third-party') {
      thirdParty = 'firstParty';
      continue;
    }
    if (option.startsWith('~')) continue;

    const mapped = RESOURCE_MAP[option];
    if (mapped) resourceTypes.push(mapped);
  }

  return {
    pattern,
    thirdParty,
    resourceTypes: [...new Set(resourceTypes)],
  };
}

function looksLikeDomainRule(pattern) {
  return pattern.startsWith('||') && pattern.includes('^') && !pattern.includes('*') && !pattern.includes('/');
}

function looksLikePopupPattern(pattern) {
  return /popup|popunder|overlay|modal|newsletter|scroll|exit|consent|cookie|devtools|right-click|snow/i.test(pattern);
}

function looksLikeTrackingPattern(pattern) {
  return /track|pixel|analytics|metric|telemetry|beacon|sentry|log|rum|session|heatmap|insight|monitor/i.test(pattern);
}

function looksLikeAdPattern(pattern) {
  return /(^\|\|)|ad[sx]?|banner|sponsor|bid|doubleclick|taboola|outbrain|prebid|promoted/i.test(pattern);
}

function buildRule(id, parsed, fallbackResources, options = {}) {
  const condition = {
    urlFilter: parsed.pattern,
    resourceTypes: parsed.resourceTypes.length ? parsed.resourceTypes : fallbackResources,
  };
  if (parsed.thirdParty) condition.domainType = parsed.thirdParty;
  if (options.excludeYouTube) condition.excludedInitiatorDomains = YOUTUBE_INITIATORS;

  return {
    id,
    priority: 1,
    action: { type: 'block' },
    condition,
  };
}

function collectRules(lines, predicate, fallbackResources, maxRules, options = {}) {
  const seen = new Set();
  const rules = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (!predicate(parsed.pattern, parsed)) continue;

    const key = `${parsed.pattern}|${parsed.thirdParty || ''}|${(parsed.resourceTypes.length ? parsed.resourceTypes : fallbackResources).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rules.push(buildRule(rules.length + 1, parsed, fallbackResources, options));
    if (rules.length >= maxRules) break;
  }

  return rules;
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(rulesDir, fileName), JSON.stringify(data));
}

function main() {
  for (const sourcePath of Object.values(sources)) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing source list: ${sourcePath}`);
    }
  }

  const easylistLines = readLines(sources.easylist);
  const easyprivacyLines = readLines(sources.easyprivacy);
  const annoyanceLines = readLines(sources.annoyances);

  const ads = collectRules(
    easylistLines,
    (pattern) => looksLikeDomainRule(pattern) || (looksLikeAdPattern(pattern) && !looksLikeTrackingPattern(pattern)),
    DEFAULT_RESOURCES,
    12000,
    { excludeYouTube: true }
  );

  const trackers = collectRules(
    easyprivacyLines,
    (pattern) => looksLikeDomainRule(pattern) || looksLikeTrackingPattern(pattern),
    PATTERN_RESOURCES,
    9000,
    { excludeYouTube: true }
  );

  const patterns = collectRules(
    [...easylistLines, ...easyprivacyLines],
    (pattern) => !looksLikeDomainRule(pattern) && (looksLikeAdPattern(pattern) || looksLikeTrackingPattern(pattern)),
    PATTERN_RESOURCES,
    8000,
    { excludeYouTube: true }
  );

  const popups = collectRules(
    annoyanceLines,
    (pattern) => looksLikePopupPattern(pattern),
    POPUP_RESOURCES,
    5000,
    { excludeYouTube: true }
  );

  writeJson('ads.json', ads);
  writeJson('trackers.json', trackers);
  writeJson('patterns.json', patterns);
  writeJson('popups.json', popups);
  writeJson('metadata.json', {
    generatedAt: new Date().toISOString(),
    sources,
    counts: {
      ads: ads.length,
      trackers: trackers.length,
      patterns: patterns.length,
      popups: popups.length,
      youtube: 10,
      malware: 48,
    },
  });

  console.log(JSON.stringify({
    ads: ads.length,
    trackers: trackers.length,
    patterns: patterns.length,
    popups: popups.length,
  }, null, 2));
}

main();
