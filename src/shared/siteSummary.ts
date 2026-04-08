import { clamp } from './utils';

export function computePageSummary(documentLike: Document, hostname: string, enabled: boolean, allowlisted: boolean) {
  const candidateSignals = documentLike.querySelectorAll('[data-shieldblock-signal]').length;
  const blockedHints = documentLike.querySelectorAll('[data-shieldblock-hidden]').length;
  const sponsoredHints = documentLike.querySelectorAll(
    '[aria-label="Sponsored"], [aria-label="Advertisement"], [data-promoted="true"], [data-ad-preview]'
  ).length;
  const iframeHints = documentLike.querySelectorAll('iframe').length;

  const intrusionScore = clamp(
    candidateSignals * 5 + blockedHints * 12 + sponsoredHints * 10 + Math.min(iframeHints, 10),
    0,
    100
  );

  const status = allowlisted
    ? 'Allowlisted'
    : !enabled
      ? 'Paused'
      : intrusionScore >= 70
        ? 'High ad pressure'
        : intrusionScore >= 35
          ? 'Moderate ad pressure'
          : 'Low ad pressure';

  return {
    hostname,
    title: documentLike.title,
    status,
    intrusionScore,
    candidateSignals,
    blockedHints,
    sponsoredHints,
  };
}
