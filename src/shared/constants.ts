export const RULESET_IDS = ['ads', 'trackers', 'patterns', 'popups', 'youtube', 'malware'] as const;

export type RulesetId = typeof RULESET_IDS[number];

export const RULESET_COUNTS: Record<RulesetId, number> = {
  ads: 12000,
  trackers: 9000,
  patterns: 8000,
  popups: 1226,
  youtube: 10,
  malware: 48,
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  adsEnabled: true,
  trackersEnabled: true,
  patternsEnabled: true,
  popupsEnabled: true,
  youtubeEnabled: true,
  malwareEnabled: true,
  smartBlockingEnabled: true,
  annoyancesEnabled: true,
  totalBlocked: 0,
  adsBlocked: 0,
  trackersBlocked: 0,
  smartBlocked: 0,
  phishingDetected: 0,
  sessionBlocked: 0,
  allowlist: [] as string[],
  customRulesByDomain: {} as Record<string, string[]>,
  lastActivities: [] as ActivityEvent[],
  debugMode: false,
  remoteUpdateUrl: '',
  lastUpdateCheck: 0,
  lastAppliedUpdate: '',
};

export interface ActivityEvent {
  kind: 'blocking' | 'security' | 'learning' | 'info';
  title: string;
  detail?: string;
  timestamp: number;
}

export interface PageSummary {
  hostname: string;
  title: string;
  status: string;
  intrusionScore: number;
  candidateSignals: number;
  blockedHints: number;
  sponsoredHints: number;
}

export interface RemoteRuleManifest {
  version: string;
  generatedAt: string;
  payload: {
    dynamicRules: Record<string, unknown>[];
    siteFixes: {
      youtubeExtraSelectors?: string[];
      sponsoredKeywords?: string[];
    };
  };
  integrity: {
    algorithm: 'SHA-256';
    sha256: string;
  };
}

export const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$/i;
export const YOUTUBE_API_RE = /youtubei\/v1\/(player|next|browse)|get_video_info|player\?/i;
export const SPONSORED_TEXT_RE = /\b(sponsored|promoted|install|sign up|visit site|shop now)\b/i;
export const YOUTUBE_STRIP_KEYS = [
  'adPlacements',
  'adBreakHeartbeatParams',
  'adBreakParams',
  'adSlots',
  'ad3Module',
  'playerAds',
  'playerAdsRenderer',
  'serverAbrStreamingUrl',
  'showPreroll',
  'showMidroll',
  'showPostroll',
  'cueRanges',
  'adSafetyReason',
  'adReasons',
  'adLoggingData',
];
