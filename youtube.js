// ShieldBlock AI — YouTube ad cleanup
// Keeps YouTube playable while removing ad UI and skipping ad interruptions.

(function () {
  'use strict';

  if (!location.hostname.includes('youtube.com')) return;

  const STYLE_ID = 'shieldblock-youtube';
  const state = {
    enabled: true,
    allowlist: [],
  };

  const PLAYER_DECORATION_SELECTORS = [
    '.ytp-ad-overlay-container',
    '.ytp-ad-overlay-slot',
    '.ytp-ad-text-overlay',
    '.ytp-ad-image-overlay',
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-instream-info',
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-preview-container',
    '.ytp-ad-shopping-overlay',
    '.ytp-ad-action-interstitial',
    '.ytp-ad-module',
    '.ytp-ad-message-container',
    '.ytp-ad-survey',
    '.ytp-ad-text',
    '.ytp-ad-button-icon',
    '.ytp-ad-visit-advertiser-button',
    '.ytp-ad-cta-container',
    '.ytp-ad-hover-text-button',
    '#player-ads',
  ];

  const FEED_AD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-companion-slot-renderer',
  ];

  const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '[class*="skip-ad"]',
    '[class*="skipAd"]',
  ];

  const SPONSORED_TEXT = /\b(sponsored|promoted|install|sign up|visit site)\b/i;
  let intervalId = null;
  let pendingAdActions = 0;

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function canRun() {
    return state.enabled && !matchesAllowlist(location.hostname, state.allowlist);
  }

  function ensureStyle() {
    if (!canRun()) {
      document.getElementById(STYLE_ID)?.remove();
      return;
    }

    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${PLAYER_DECORATION_SELECTORS.join(',\n')} {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      #player-ads,
      .ytp-ad-player-overlay-layout,
      .ad-showing .ytp-ad-player-overlay {
        display: none !important;
      }

      .ad-showing .ytp-chrome-bottom {
        display: flex !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function flushActions(force = false) {
    if (!pendingAdActions) return;
    if (!force && pendingAdActions < 2) return;

    chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', category: 'ads', count: pendingAdActions });
    chrome.runtime.sendMessage({
      type: 'ACTIVITY_EVENT',
      kind: 'blocking',
      title: 'YouTube ads removed',
      detail: `${pendingAdActions} YouTube ad item(s) blocked`,
    });
    pendingAdActions = 0;
  }

  function markAction() {
    pendingAdActions += 1;
    flushActions();
  }

  function hideElement(element) {
    if (!element || element.dataset.shieldblockHidden === '1') return;
    element.dataset.shieldblockHidden = '1';
    element.style.display = 'none';
    element.style.visibility = 'hidden';
    markAction();
  }

  function removeSponsoredSidebarCards() {
    if (!canRun()) return;

    document.querySelectorAll(FEED_AD_SELECTORS.join(',')).forEach((element) => {
      const text = (element.innerText || '').trim();
      const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) => link.href).join(' ');
      if (
        SPONSORED_TEXT.test(text) ||
        /googleadservices|doubleclick|one\.google\.com|adurl=|gclid=/.test(hrefs)
      ) {
        hideElement(element);
      }
    });
  }

  function clickSkipButton() {
    for (const selector of SKIP_SELECTORS) {
      const button = document.querySelector(selector);
      if (button && button.offsetParent !== null) {
        button.click();
        markAction();
        return true;
      }
    }
    return false;
  }

  function speedPastAdBreak() {
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) return false;
    if (!document.documentElement.classList.contains('ad-showing')) return false;

    try {
      video.muted = true;
      video.playbackRate = 16;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, video.duration - 0.2);
      }
      markAction();
      return true;
    } catch {
      return false;
    }
  }

  function cleanupYoutubeAds() {
    if (!canRun()) return;
    ensureStyle();
    removeSponsoredSidebarCards();
    clickSkipButton();
    speedPastAdBreak();
  }

  function refreshState(callback) {
    chrome.storage.local.get(['enabled', 'youtubeEnabled', 'allowlist'], (data) => {
      state.enabled = data.enabled !== false && data.youtubeEnabled !== false;
      state.allowlist = data.allowlist || [];
      ensureStyle();
      callback?.();
    });
  }

  const pageObserver = new MutationObserver((mutations) => {
    if (!canRun()) return;
    if (!mutations.some((mutation) => mutation.addedNodes.length > 0)) return;
    cleanupYoutubeAds();
  });

  pageObserver.observe(document.documentElement, { childList: true, subtree: true });

  function startPolling() {
    clearInterval(intervalId);
    intervalId = setInterval(cleanupYoutubeAds, 250);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (['TOGGLE_EXTENSION', 'TOGGLE_YOUTUBE', 'ALLOWLIST_UPDATED'].includes(message.type)) {
      refreshState(cleanupYoutubeAds);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.youtubeEnabled || changes.allowlist) {
      refreshState(cleanupYoutubeAds);
    }
  });

  refreshState(() => {
    cleanupYoutubeAds();
    startPolling();
  });

  window.addEventListener('beforeunload', () => flushActions(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushActions(true);
  });
})();
