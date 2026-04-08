import { describe, expect, it } from 'vitest';
import {
  isSponsoredCandidate,
  looksLikeYouTubeApiUrl,
  parseAndSanitizeJson,
  sanitizeYouTubePayload,
} from '../src/shared/youtubeSanitizer';

describe('youtubeSanitizer', () => {
  it('removes ad placements and cue ranges from player payloads', () => {
    const payload = {
      playabilityStatus: { status: 'OK', adBreakStatus: 'ACTIVE' },
      streamingData: { formats: [], serverAbrStreamingUrl: 'https://example.com/ad' },
      adPlacements: [{ adPlacementRenderer: true }],
      cueRanges: [{ start: 0 }],
      videoDetails: { title: 'Demo' },
    };

    const sanitized = sanitizeYouTubePayload(payload);

    expect(sanitized.adPlacements).toEqual([]);
    expect(sanitized.cueRanges).toEqual([]);
    expect(sanitized.streamingData.serverAbrStreamingUrl).toBeUndefined();
    expect(sanitized.playabilityStatus.adBreakStatus).toBeUndefined();
  });

  it('sanitizes matching JSON text payloads', () => {
    const text = JSON.stringify({
      playerResponse: {
        adPlacements: [{ adPlacementRenderer: true }],
        videoDetails: { title: 'Demo' },
      },
    });
    const sanitized = JSON.parse(parseAndSanitizeJson(text));
    expect(sanitized.playerResponse.adPlacements).toEqual([]);
  });

  it('recognizes youtube API URLs and sponsored cards', () => {
    expect(looksLikeYouTubeApiUrl('https://www.youtube.com/youtubei/v1/player')).toBe(true);
    expect(isSponsoredCandidate('Sponsored install now', '')).toBe(true);
    expect(isSponsoredCandidate('Regular video', 'https://googleadservices.com/pagead/aclk')).toBe(true);
  });
});
