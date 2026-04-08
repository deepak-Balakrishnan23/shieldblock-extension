import {
  AppState,
  BlockEntry,
  BlockEntryType,
  FocusSchedule,
  MatchResult,
} from './constants';
import {
  escapeRegex,
  expandHostnameAliases,
  hostMatches,
  isExpired,
  normalizeHostname,
  safeUrl,
} from './utils';

function classifyInput(raw: string): { type: BlockEntryType; value: string; label: string } | null {
  const input = raw.trim();
  if (!input) return null;

  if (input.startsWith('/') && input.endsWith('/') && input.length > 2) {
    try {
      const value = input.slice(1, -1);
      new RegExp(value, 'i');
      return { type: 'regex', value, label: input };
    } catch {
      return null;
    }
  }

  const parsed = safeUrl(input);
  if (parsed) {
    const hostname = normalizeHostname(parsed.hostname);
    const path = parsed.pathname !== '/' ? parsed.pathname : '';
    return {
      type: path ? 'keyword' : 'hostname',
      value: path ? `${hostname}${path}${parsed.search}` : hostname,
      label: input,
    };
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizeHostname(input))) {
    return {
      type: 'hostname',
      value: normalizeHostname(input),
      label: input,
    };
  }

  return {
    type: 'keyword',
    value: input.toLowerCase(),
    label: input,
  };
}

export function createEntry(input: string, now = Date.now()): BlockEntry | null {
  const parsed = classifyInput(input);
  if (!parsed) return null;

  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `entry-${now}`,
    label: parsed.label,
    value: parsed.value,
    type: parsed.type,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function isAllowlisted(url: URL, allowlist: string[]): boolean {
  return allowlist.some((item) => hostMatches(url.hostname, normalizeHostname(item)));
}

export function hasTemporaryUnlock(url: URL, temporaryUnlocks: Record<string, number>): boolean {
  return Object.entries(temporaryUnlocks).some(([hostname, expiresAt]) => {
    if (isExpired(expiresAt)) return false;
    return hostMatches(url.hostname, normalizeHostname(hostname));
  });
}

export function isScheduleActive(schedule: FocusSchedule, now = new Date()): boolean {
  if (!schedule.enabled) return true;
  if (!schedule.days.length) return false;

  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const { startMinutes, endMinutes } = schedule;

  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    const currentDay = now.getDay();
    if (!schedule.days.includes(currentDay)) return false;
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  if (currentMinutes >= startMinutes) {
    return schedule.days.includes(now.getDay());
  }

  const previousDay = (now.getDay() + 6) % 7;
  return schedule.days.includes(previousDay);
}

function matchesEntry(url: URL, entry: BlockEntry): MatchResult {
  if (!entry.enabled) return { matched: false };

  if (entry.type === 'hostname') {
    const aliases = expandHostnameAliases(entry.value);
    const match = aliases.some((hostname) => hostMatches(url.hostname, hostname));
    return match
      ? { matched: true, entryId: entry.id, reason: 'hostname', displayValue: entry.value }
      : { matched: false };
  }

  const fullUrl = url.href.toLowerCase();

  if (entry.type === 'keyword') {
    const keyword = entry.value.toLowerCase();
    const hostPathPattern = keyword.includes('/')
      ? new RegExp(`(^https?:\\/\\/)?([^.]+\\.)*${escapeRegex(keyword).replace('/', '\\/')}`, 'i')
      : null;
    const match = hostPathPattern ? hostPathPattern.test(fullUrl) : fullUrl.includes(keyword);
    return match
      ? { matched: true, entryId: entry.id, reason: 'keyword', displayValue: entry.value }
      : { matched: false };
  }

  try {
    const match = new RegExp(entry.value, 'i').test(url.href);
    return match
      ? { matched: true, entryId: entry.id, reason: 'regex', displayValue: entry.value }
      : { matched: false };
  } catch {
    return { matched: false };
  }
}

export function evaluateUrl(state: AppState, input: string): {
  blocked: boolean;
  allowlisted: boolean;
  match: MatchResult;
} {
  const url = safeUrl(input);
  if (!url || !state.enabled) {
    return { blocked: false, allowlisted: false, match: { matched: false } };
  }

  const allowlisted = isAllowlisted(url, state.allowlist);
  const temporarilyUnlocked = hasTemporaryUnlock(url, state.temporaryUnlocks);
  if (allowlisted || temporarilyUnlocked) {
    return { blocked: false, allowlisted: true, match: { matched: false } };
  }

  if (!isScheduleActive(state.focusSchedule)) {
    return { blocked: false, allowlisted: false, match: { matched: false } };
  }

  for (const entry of state.blockEntries) {
    const match = matchesEntry(url, entry);
    if (match.matched) {
      return { blocked: true, allowlisted: false, match };
    }
  }

  return { blocked: false, allowlisted: false, match: { matched: false } };
}
