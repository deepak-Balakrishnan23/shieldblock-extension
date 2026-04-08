// ShieldBlock AI — Annoyance Blocker v2.4
// Live toggles, subdomain-aware allowlist, and safer permission suppression.

(function () {
  'use strict';

  if (location.hostname.includes('youtube.com')) return;

  const STYLE_ID = 'shieldblock-annoyances';
  const state = {
    enabled: true,
    allowlist: [],
  };

  const COOKIE_SELECTORS = [
    '#cookie-banner', '#cookie-notice', '#cookie-consent', '#cookie-bar',
    '#cookie-policy', '#cookie-popup', '#cookie-overlay', '#cookie-modal',
    '#cookies-banner', '#cookies-notice', '#cookies-popup',
    '#gdpr-banner', '#gdpr-notice', '#gdpr-popup', '#gdpr-overlay', '#gdpr-modal',
    '#consent-banner', '#consent-popup', '#consent-notice', '#consent-modal',
    '#privacy-banner', '#privacy-notice', '#privacy-popup',
    '#onetrust-banner-sdk', '#onetrust-pc-sdk', '#onetrust-consent-sdk',
    '#CybotCookiebotDialog', '#cookieConsentDialog',
    '#cc-window', '#cc-banner', '#cc-popup',
    '#ot-sdk-container',
    '#sp-cc', '#sp-message-container',
    '#qc-cmp2-ui', '#qc-cmp2-container',
    '#didomi-popup', '#didomi-notice',
    '#truste-consent-track', '#truste-consent-required',
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-bar',
    '.cookie-popup', '.cookie-overlay', '.cookie-modal', '.cookie-box',
    '.cookies-banner', '.cookies-notice', '.cookies-popup', '.cookies-modal',
    '.gdpr-banner', '.gdpr-notice', '.gdpr-popup', '.gdpr-overlay',
    '.consent-banner', '.consent-popup', '.consent-notice', '.consent-bar',
    '.consent-modal', '.consent-overlay',
    '.privacy-banner', '.privacy-notice', '.privacy-popup',
    '.cc-window', '.cc-banner', '.cc-popup', '.cc-overlay',
    '[class*="cookie-consent"]', '[class*="cookieconsent"]',
    '[class*="cookie-banner"]', '[class*="cookie-notice"]',
    '[class*="gdpr-"]', '[class*="consent-"]',
    '[id*="cookie-consent"]', '[id*="cookieconsent"]',
    '[id*="cookie-banner"]',
    '[aria-label*="cookie"]', '[aria-label*="Cookie"]',
    '[aria-label*="consent"]', '[aria-label*="Consent"]',
    '[data-nosnippet*="cookie"]',
    '[role="dialog"][aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="privacy" i]',
    '.optanon-status-editable', '.optanon-alert-box-wrapper',
    '#optanon', '.optanon-popup-overlay',
    '.evidon-banner', '.evidon-prefdiag-overlay',
    '.cookiefirst-root', '.cookiebot', '#cookiebanner',
    '.quantcast-choice', '.uc-embedding-container',
    '[class*="usercentrics"]', '[id*="usercentrics"]',
  ];

  const NEWSLETTER_SELECTORS = [
    '[class*="newsletter-popup"]', '[class*="newsletter-modal"]',
    '[id*="newsletter-popup"]', '[id*="newsletter-modal"]',
    '[class*="email-popup"]', '[class*="email-capture"]',
    '[class*="subscribe-popup"]', '[class*="subscribe-modal"]',
    '[class*="subscription-popup"]', '[id*="subscribe-popup"]',
    '[class*="signup-popup"]', '[class*="signup-modal"]',
    '[id*="signup-popup"]', '[id*="email-popup"]',
    '.mc-modal', '#mc_embed_popup',
    '.klaviyo-form-overlay', '[data-form-type="popup"]',
    '.gform_wrapper[style*="display: block"]',
    '[class*="popup-overlay"]', '[class*="modal-overlay"]',
    '[class*="interstitial"]',
    '#newsletterSignup', '#newsletterPopup',
    '.email-modal', '.subscribe-overlay',
    '[id*="exit-intent"]', '[class*="exit-intent"]',
    '[class*="exitintent"]', '[id*="exitintent"]',
  ];

  const PUSH_SELECTORS = [
    '[class*="push-notification-prompt"]',
    '[class*="push-prompt"]', '[class*="push-permission"]',
    '[id*="push-prompt"]', '[id*="push-permission"]',
    '[class*="notification-prompt"]', '[class*="notification-permission"]',
    '.push-opt-in', '#push-opt-in',
    '[class*="web-push"]', '[id*="web-push"]',
    '.pn-prompt', '.onesignal-slide-prompt',
    '#onesignal-slidedown-container', '#onesignal-popover-container',
    '[class*="pushcrew"]', '[id*="pushcrew"]',
    '.gravitec-widget-container',
  ];

  const INTERSTITIAL_SELECTORS = [
    '[class*="paywall-overlay"]', '[id*="paywall"]',
    '[class*="metered-content"]', '[class*="meter-paywall"]',
    '[class*="subscription-wall"]', '[class*="article-paywall"]',
    '[id*="piano-id"]', '.tp-modal', '.tp-backdrop',
    '[class*="regwall"]', '[id*="regwall"]',
    '[class*="registration-wall"]',
    '#launcher',
    '.intercom-launcher-frame', '.intercom-messenger-frame',
    '[class*="drift-widget"]', '#drift-frame-controller',
    '[class*="crisp-client"]',
  ];

  const ALL_ANNOYANCES = [
    ...COOKIE_SELECTORS,
    ...NEWSLETTER_SELECTORS,
    ...PUSH_SELECTORS,
    ...INTERSTITIAL_SELECTORS,
  ];

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function canRun() {
    return state.enabled && !matchesAllowlist(location.hostname, state.allowlist);
  }

  function injectCSS() {
    if (!canRun() || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${ALL_ANNOYANCES.join(',\n')} {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        height: 0 !important;
        overflow: hidden !important;
      }

      html.overflow-hidden,
      html[style*="overflow: hidden"],
      html[style*="overflow:hidden"],
      body.overflow-hidden,
      body.modal-open,
      body.no-scroll,
      body[style*="overflow: hidden"],
      body[style*="overflow:hidden"] {
        overflow: auto !important;
        position: static !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeInjectedStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function removeAnnoyances() {
    if (!canRun()) return;
    ALL_ANNOYANCES.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => el.remove());
      } catch (_) {}
    });

    ['overflow', 'position', 'top', 'width'].forEach((prop) => {
      document.documentElement.style.removeProperty(prop);
      document.body?.style.removeProperty(prop);
    });
    document.body?.classList.remove('modal-open', 'no-scroll', 'overflow-hidden', 'noscroll');
    document.documentElement.classList.remove('modal-open', 'no-scroll', 'overflow-hidden', 'noscroll');
  }

  function refreshState(callback) {
    chrome.storage.local.get(['enabled', 'annoyancesEnabled', 'allowlist'], (data) => {
      state.enabled = data.enabled !== false && data.annoyancesEnabled !== false;
      state.allowlist = data.allowlist || [];
      if (!canRun()) removeInjectedStyle();
      else injectCSS();
      callback?.();
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (!canRun()) return;
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
      removeAnnoyances();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  setInterval(() => {
    if (canRun()) removeAnnoyances();
  }, 1500);

  if (window.Notification) {
    const originalRequestPermission = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args) => {
      if (!canRun()) return originalRequestPermission(...args);
      return Promise.resolve('denied');
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (['TOGGLE_ANNOYANCES', 'TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED'].includes(message.type)) {
      refreshState(removeAnnoyances);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.annoyancesEnabled || changes.allowlist) {
      refreshState(removeAnnoyances);
    }
  });

  refreshState(removeAnnoyances);
})();
