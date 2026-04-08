export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const YOUTUBE_FAMILY_HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
] as const;

export type BlockEntryType = 'hostname' | 'keyword' | 'regex';

export interface BlockEntry {
  id: string;
  label: string;
  value: string;
  type: BlockEntryType;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FocusSchedule {
  enabled: boolean;
  days: number[];
  startMinutes: number;
  endMinutes: number;
}

export interface BlockStats {
  totalBlocked: number;
  blockedToday: number;
  lastBlockedAt: number;
  lastResetDay: string;
}

export interface AppState {
  enabled: boolean;
  strictMode: boolean;
  redirectMode: 'block-page' | 'close-tab';
  blockEntries: BlockEntry[];
  allowlist: string[];
  temporaryUnlocks: Record<string, number>;
  focusSchedule: FocusSchedule;
  stats: BlockStats;
}

export interface MatchResult {
  matched: boolean;
  entryId?: string;
  reason?: string;
  displayValue?: string;
}

export interface PopupSnapshot {
  state: AppState;
  activeTab: {
    id?: number;
    url: string;
    hostname: string;
    blocked: boolean;
    match: MatchResult;
    allowlisted: boolean;
  };
}

export interface RuntimeMessageMap {
  GET_POPUP_SNAPSHOT: { response: PopupSnapshot };
  GET_STATE: { response: AppState };
  UPSERT_BLOCK_ENTRY: { payload: { input: string }; response: { ok: boolean; error?: string } };
  DELETE_BLOCK_ENTRY: { payload: { id: string }; response: { ok: boolean } };
  TOGGLE_ENABLED: { payload: { enabled: boolean }; response: { ok: boolean } };
  SAVE_SCHEDULE: {
    payload: { enabled: boolean; days: number[]; startMinutes: number; endMinutes: number };
    response: { ok: boolean; error?: string };
  };
  SET_STRICT_MODE: { payload: { strictMode: boolean }; response: { ok: boolean } };
  TOGGLE_ALLOWLIST_FOR_ACTIVE_TAB: { response: { ok: boolean; allowlisted: boolean } };
  TEMPORARY_UNLOCK_HOST: { payload: { hostname: string; minutes: number }; response: { ok: boolean; expiresAt?: number } };
  CHECK_URL: { payload: { url: string }; response: { blocked: boolean; allowlisted: boolean; match: MatchResult } };
  GET_BLOCK_REASON: { response: { blocked: boolean; allowlisted: boolean; match: MatchResult } };
}

export const BLOCKED_PAGE = '/blocked.html';

export const DEFAULT_STATE: AppState = {
  enabled: true,
  strictMode: true,
  redirectMode: 'block-page',
  blockEntries: [],
  allowlist: [],
  temporaryUnlocks: {},
  focusSchedule: {
    enabled: false,
    days: [1, 2, 3, 4, 5],
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
  },
  stats: {
    totalBlocked: 0,
    blockedToday: 0,
    lastBlockedAt: 0,
    lastResetDay: '',
  },
};

export const DYNAMIC_RULE_OFFSET = 10_000;
export const PAGE_EVENT_NAME = 'shieldblock:url-change';
export const PAGE_POLICY_EVENT = 'shieldblock:policy-change';

export const YOUTUBE_INITIATOR_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
] as const;
