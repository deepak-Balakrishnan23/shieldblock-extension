import {
  AppState,
  BLOCKED_PAGE,
  DYNAMIC_RULE_OFFSET,
  YOUTUBE_FAMILY_HOSTS,
  YOUTUBE_INITIATOR_DOMAINS,
} from './constants';
import { isScheduleActive } from './matcher';
import { safeUrl, expandHostnameAliases, escapeRegex } from './utils';

type DynamicRule = chrome.declarativeNetRequest.Rule;

function makeMainFrameRule(id: number, regexFilter: string): DynamicRule {
  return {
    id,
    priority: 100,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: BLOCKED_PAGE,
      },
    },
    condition: {
      regexFilter,
      resourceTypes: ['main_frame'],
    },
  };
}

function makeSubFrameRule(id: number, regexFilter: string): DynamicRule {
  return {
    id,
    priority: 90,
    action: { type: 'block' },
    condition: {
      regexFilter,
      resourceTypes: ['sub_frame'],
    },
  };
}

function makeAllowRule(id: number, regexFilter: string): DynamicRule {
  return {
    id,
    priority: 1000,
    action: { type: 'allow' },
    condition: {
      regexFilter,
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
}

function hostnameRegex(hostname: string): string {
  return `^https?:\\/\\/([^.]+\\.)*${escapeRegex(hostname)}(?::\\d+)?(?:[\\/?#]|$)`;
}

function keywordRegex(value: string): string {
  if (value.includes('/')) {
    const [hostname, ...pathParts] = value.split('/');
    const path = pathParts.join('/');
    return `^https?:\\/\\/([^.]+\\.)*${escapeRegex(hostname)}(?::\\d+)?\\/${escapeRegex(path)}(?:[\\/?#]|$)`;
  }

  const parsed = safeUrl(value);
  if (parsed) {
    return `^${escapeRegex(parsed.href)}`;
  }

  return escapeRegex(value);
}

function includesYoutubeRule(state: AppState): boolean {
  return state.blockEntries.some((entry) => {
    if (!entry.enabled) return false;
    if (entry.type === 'hostname') {
      return YOUTUBE_FAMILY_HOSTS.some((hostname) => entry.value === hostname || entry.value.endsWith(`.${hostname}`));
    }
    return /youtube|youtu\.be|googlevideo/i.test(entry.value);
  });
}

function youtubeRequestRules(id: number): DynamicRule[] {
  return [
    {
      id,
      priority: 150,
      action: { type: 'block' },
      condition: {
        regexFilter: '^https?:\\/\\/([^.]+\\.)*googlevideo\\.com\\/.*',
        initiatorDomains: [...YOUTUBE_INITIATOR_DOMAINS],
        resourceTypes: ['media', 'xmlhttprequest'],
      },
    },
    {
      id: id + 1,
      priority: 150,
      action: { type: 'block' },
      condition: {
        regexFilter: '^https?:\\/\\/([^.]+\\.)*youtube\\.com\\/youtubei\\/v1\\/.*',
        resourceTypes: ['xmlhttprequest'],
      },
    },
  ];
}

export function buildDynamicRules(state: AppState): DynamicRule[] {
  if (!state.enabled) return [];
  if (!isScheduleActive(state.focusSchedule)) return [];

  const rules: DynamicRule[] = [];
  let id = DYNAMIC_RULE_OFFSET;

  for (const hostname of [...state.allowlist, ...Object.keys(state.temporaryUnlocks)]) {
    for (const alias of expandHostnameAliases(hostname)) {
      rules.push(makeAllowRule(id++, hostnameRegex(alias)));
    }
  }

  for (const entry of state.blockEntries) {
    if (!entry.enabled) continue;

    if (entry.type === 'hostname') {
      for (const hostname of expandHostnameAliases(entry.value)) {
        const regexFilter = hostnameRegex(hostname);
        rules.push(makeMainFrameRule(id++, regexFilter));
        rules.push(makeSubFrameRule(id++, regexFilter));
      }
      continue;
    }

    const regexFilter = entry.type === 'regex' ? entry.value : keywordRegex(entry.value);
    rules.push(makeMainFrameRule(id++, regexFilter));
    rules.push(makeSubFrameRule(id++, regexFilter));
  }

  if (includesYoutubeRule(state)) {
    rules.push(...youtubeRequestRules(id));
  }

  return rules;
}
