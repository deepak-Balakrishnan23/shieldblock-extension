// ShieldBlock AI — Base Cosmetic Layer
// Keeps a lightweight baseline separate from the advanced cosmetic engine.

(function () {
  'use strict';

  const STYLE_ID = 'shieldblock-base-cosmetic';
  const AD_SELECTORS = [
    '[id^="ad-"]',
    '[id^="ads-"]',
    '[id^="advert"]',
    '[class^="ad-"]',
    '[class^="ads-"]',
    '[class*=" ad-"]',
    '[class*="advert"]',
    '[class*="advertisement"]',
    '[class*="ad-banner"]',
    '[class*="ad-slot"]',
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[class*="ad-unit"]',
    '[class*="adsbygoogle"]',
    'ins.adsbygoogle',
    '[data-ad-client]',
    '[data-ad-slot]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adnxs.com"]',
    'iframe[src*="advertising.com"]',
    '[class*="sponsored-"]',
    '[data-testid*="ad"]',
    '[aria-label="Advertisement"]',
    '[aria-label="Ads"]',
    '[data-promoted="true"]',
    '[data-ad-preview]',
  ];

  let enabled = true;
  let allowlisted = false;

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function applyState() {
    const styleEl = document.getElementById(STYLE_ID);
    if (location.hostname.includes('youtube.com')) {
      styleEl?.remove();
      return;
    }
    if (!enabled || allowlisted) {
      styleEl?.remove();
      return;
    }

    if (styleEl) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${AD_SELECTORS.join(',\n')} {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function refreshState() {
    chrome.storage.local.get(['enabled', 'allowlist'], (data) => {
      enabled = data.enabled !== false;
      allowlisted = matchesAllowlist(location.hostname, data.allowlist);
      applyState();
    });
  }

  const observer = new MutationObserver(() => {
    if (!enabled || allowlisted) return;
    document.querySelectorAll('iframe[src*="doubleclick"], iframe[src*="googlesyndication"]').forEach((el) => {
      el.style.display = 'none';
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (['TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED'].includes(message.type)) {
      refreshState();
    }

    if (message.type === 'GET_PAGE_SUMMARY') {
      const heuristicBlocked = document.querySelectorAll('[data-shieldblock-score]').length;
      const mlBlocked = document.querySelectorAll('[data-shieldblock-ml]').length;
      const candidateSignals = document.querySelectorAll('[data-shieldblock-hscore]').length;
      const iframes = document.querySelectorAll('iframe').length;
      const sponsoredHints = document.querySelectorAll(
        '[aria-label="Sponsored"], [aria-label="Advertisement"], [data-promoted="true"], [data-ad-preview]'
      ).length;

      const intrusionScore = Math.min(
        100,
        (heuristicBlocked * 12) + (mlBlocked * 16) + (candidateSignals * 2) + (sponsoredHints * 8) + Math.min(iframes, 10)
      );

      const status = allowlisted
        ? 'Allowlisted'
        : !enabled
          ? 'Paused'
          : intrusionScore >= 65
            ? 'High ad pressure'
            : intrusionScore >= 30
              ? 'Moderate ad pressure'
              : 'Low ad pressure';

      sendResponse({
        hostname: location.hostname,
        title: document.title,
        heuristicBlocked,
        mlBlocked,
        candidateSignals,
        iframes,
        sponsoredHints,
        intrusionScore,
        status,
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.allowlist) {
      refreshState();
    }
  });

  refreshState();
})();
