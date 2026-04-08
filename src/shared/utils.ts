import { YOUTUBE_FAMILY_HOSTS } from './constants';

export function normalizeHostname(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
}

export function safeUrl(input: string): URL | null {
  try {
    if (/^[a-z]+:\/\//i.test(input)) {
      return new URL(input);
    }
    return new URL(`https://${input}`);
  } catch {
    return null;
  }
}

export function todayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return 0;
  }
  return (hours * 60) + minutes;
}

export function minutesToClock(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function hostMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function isExpired(expiresAt: number, now = Date.now()): boolean {
  return expiresAt <= now;
}

export function expandHostnameAliases(hostname: string): string[] {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return [];

  if (YOUTUBE_FAMILY_HOSTS.some((familyHost) => normalized === familyHost || normalized.endsWith(`.${familyHost}`))) {
    return [...YOUTUBE_FAMILY_HOSTS];
  }

  return [normalized];
}
