import {
  SPONSORED_TEXT_RE,
  YOUTUBE_API_RE,
  YOUTUBE_STRIP_KEYS,
} from './constants';

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function looksLikeYouTubeApiUrl(url: string): boolean {
  return YOUTUBE_API_RE.test(url);
}

export function shouldInspectJsonText(text: string): boolean {
  return /adPlacements|playerAds|adBreak|cueRanges|playerResponse|streamingData|playabilityStatus/.test(text);
}

export function looksLikePlayerPayload(input: unknown): boolean {
  if (!isObject(input)) return false;
  return [
    'playerResponse',
    'playabilityStatus',
    'streamingData',
    'videoDetails',
    'responseContext',
    'contents',
    'currentVideoEndpoint',
  ].some((key) => key in input);
}

export function sanitizeYouTubePayload<T>(input: T): T {
  const seen = new WeakSet<object>();

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as UnknownRecord;
    for (const key of YOUTUBE_STRIP_KEYS) {
      if (key in record) {
        if (Array.isArray(record[key])) record[key] = [];
        else delete record[key];
      }
    }

    if (isObject(record.streamingData)) {
      delete record.streamingData.serverAbrStreamingUrl;
    }
    if (isObject(record.playabilityStatus)) {
      delete record.playabilityStatus.adBreakStatus;
      delete record.playabilityStatus.playerLegacyDesktopYpcOfferRenderer;
    }

    Object.values(record).forEach(visit);
  }

  if (looksLikePlayerPayload(input)) {
    visit(input);
  }
  return input;
}

export function parseAndSanitizeJson(text: string): string {
  if (!shouldInspectJsonText(text)) return text;
  try {
    const parsed = JSON.parse(text);
    if (!looksLikePlayerPayload(parsed)) return text;
    return JSON.stringify(sanitizeYouTubePayload(parsed));
  } catch {
    return text;
  }
}

export function isSponsoredCandidate(text: string, hrefs: string): boolean {
  return SPONSORED_TEXT_RE.test(text) || /googleadservices|doubleclick|one\.google\.com|adurl=|gclid=/.test(hrefs);
}
