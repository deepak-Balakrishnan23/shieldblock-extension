import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../src/shared/constants';
import { createEntry, evaluateUrl, isScheduleActive } from '../src/shared/matcher';

describe('matcher', () => {
  it('blocks youtube family from a youtube.com entry', () => {
    const entry = createEntry('youtube.com');
    expect(entry).not.toBeNull();

    const state = {
      ...DEFAULT_STATE,
      blockEntries: entry ? [entry] : [],
    };

    expect(evaluateUrl(state, 'https://www.youtube.com/watch?v=abc').blocked).toBe(true);
    expect(evaluateUrl(state, 'https://m.youtube.com/shorts/abc').blocked).toBe(true);
    expect(evaluateUrl(state, 'https://www.youtube-nocookie.com/embed/abc').blocked).toBe(true);
    expect(evaluateUrl(state, 'https://youtu.be/abc').blocked).toBe(true);
  });

  it('supports path specific keyword rules', () => {
    const entry = createEntry('https://news.ycombinator.com/newest');
    expect(entry).not.toBeNull();

    const state = {
      ...DEFAULT_STATE,
      blockEntries: entry ? [entry] : [],
    };

    expect(evaluateUrl(state, 'https://news.ycombinator.com/newest').blocked).toBe(true);
    expect(evaluateUrl(state, 'https://news.ycombinator.com/front').blocked).toBe(false);
  });

  it('honors the allowlist', () => {
    const entry = createEntry('reddit.com');
    expect(entry).not.toBeNull();

    const state = {
      ...DEFAULT_STATE,
      blockEntries: entry ? [entry] : [],
      allowlist: ['reddit.com'],
    };

    expect(evaluateUrl(state, 'https://www.reddit.com').allowlisted).toBe(true);
    expect(evaluateUrl(state, 'https://www.reddit.com').blocked).toBe(false);
  });
});

describe('schedule', () => {
  it('supports same day ranges', () => {
    expect(isScheduleActive({
      enabled: true,
      days: [3],
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    }, new Date('2026-04-08T10:30:00'))).toBe(true);

    expect(isScheduleActive({
      enabled: true,
      days: [3],
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    }, new Date('2026-04-08T18:30:00'))).toBe(false);
  });

  it('supports overnight ranges', () => {
    expect(isScheduleActive({
      enabled: true,
      days: [3],
      startMinutes: 22 * 60,
      endMinutes: 6 * 60,
    }, new Date('2026-04-08T23:00:00'))).toBe(true);

    expect(isScheduleActive({
      enabled: true,
      days: [3],
      startMinutes: 22 * 60,
      endMinutes: 6 * 60,
    }, new Date('2026-04-09T01:00:00'))).toBe(true);
  });
});
