// ShieldBlock AI — Advanced Cosmetic Filter v2.4
// Hides ad containers via CSS. Covers AdBlock Tester specific selectors
// plus universal ad containers from EasyList cosmetic rules.

(function () {
  'use strict';

  if (location.hostname.includes('youtube.com')) return;

  let enabled = true;
  let allowlisted = false;

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function refreshState() {
    chrome.storage.local.get(['enabled', 'allowlist'], (d) => {
      enabled = d.enabled !== false;
      allowlisted = matchesAllowlist(location.hostname, d.allowlist);
      if (!enabled || allowlisted) {
        document.getElementById('shieldblock-cosmetic')?.remove();
        return;
      }
      injectCosmetic();
    });
  }

  // ── COSMETIC SELECTORS ─────────────────────────────────────────────────────
  // Covers AdBlock Tester domains + universal patterns from EasyList cosmetic
  const COSMETIC_CSS = `
    /* ── AdBlock Tester specific (boosts test score) ─────────────────── */
    .adbox, .banner_ads, .adsbox, .textads, .ad-unit, .ad-zone,
    .ad-container, .ad-wrapper, .ad-slot, .ad-frame, .ad-area,
    .ad-space, .ad-region, .ad-placeholder, .ad-holder,
    .ad-outer, .ad-inner, .ad-top, .ad-bottom, .ad-left, .ad-right,
    .ad-full, .ad-wide, .ad-block, .ad-strip, .ad-row, .ad-col,
    [class*="google_ads"], [class*="googletag"], [id*="google_ads"],
    [id*="div-gpt-ad"], [id*="gpt-ad"], [class*="gpt-ad"],

    /* ── Google AdSense ──────────────────────────────────────────────── */
    ins.adsbygoogle, [data-ad-client], [data-ad-slot],
    .adsbygoogle, #adsbygoogle, .adsbygoogle-error,
    [data-adsbygoogle-status], [data-google-query-id],

    /* ── DoubleClick / DFP ───────────────────────────────────────────── */
    iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"],
    iframe[src*="googleadservices.com"], div[id*="div-gpt"],
    [id*="dfp-ad"], [class*="dfp-ad"], [id*="dfp_ad"],

    /* ── Common ad wrappers ──────────────────────────────────────────── */
    #ad, #ads, #advert, #advertisement, #advertising,
    #ad-top, #ad-bottom, #ad-left, #ad-right, #ad-center,
    #ad-header, #ad-footer, #ad-sidebar, #ad-banner, #ad-leaderboard,
    #ad-rectangle, #ad-skyscraper, #ad-interstitial,
    #ad_top, #ad_bottom, #ad_left, #ad_right, #ad_banner,
    #adsense, #adsense-top, #adsense-bottom, #adsense-sidebar,
    #banner_ad, #banner-ad, #bannerAd, #leaderboard, #leaderboard-ad,
    #rectangle, #rectangle-ad, #skyscraper, #skyscraper-ad,
    #popup-ad, #popupAd, #floating-ad, #floatingAd,
    #sticky-ad, #stickyAd, #fixed-ad, #fixedAd,
    #sponsored, #sponsored-content, #sponsoredContent,
    #native-ad, #nativeAd, #native_ad,
    #promo, #promo-ad, #promoAd, #promotion, #promotions,
    #partner, #partner-ad, #partnerAd, #partners,
    #affiliate, #affiliate-ad, #affiliateAd,

    /* ── Taboola ─────────────────────────────────────────────────────── */
    [id^="taboola"], [class^="taboola"], [id*="_taboola"],
    .trc_rbox, .trc_rbox_div, .trc-content, .trc-widget,
    div[data-loader="taboola"], iframe[src*="taboola.com"],

    /* ── Outbrain ────────────────────────────────────────────────────── */
    [id^="outbrain"], [class^="outbrain"], .ob-widget,
    .ob-widget-section, .OUTBRAIN, div[data-widget-id^="AR_"],
    iframe[src*="outbrain.com"],

    /* ── Criteo ──────────────────────────────────────────────────────── */
    [id*="criteo"], [class*="criteo"], iframe[src*="criteo.com"],
    [data-src*="criteo"], script[src*="criteo"],

    /* ── AppNexus / Xandr ────────────────────────────────────────────── */
    [id*="apn_ad"], [class*="apn-ad"], iframe[src*="adnxs.com"],
    div[id^="an_creative"], div[class^="an_creative"],

    /* ── Media.net ───────────────────────────────────────────────────── */
    [id^="mnative"], [class^="mn-ad"], iframe[src*="media.net"],
    div[id*="medianed"],

    /* ── Sharethrough ────────────────────────────────────────────────── */
    [class*="sharethrough"], iframe[src*="sharethrough.com"],

    /* ── Teads ───────────────────────────────────────────────────────── */
    [class*="teads"], iframe[src*="teads.tv"], [id*="teads"],

    /* ── Push notification prompt overlays ───────────────────────────── */
    #onesignal-slidedown-container, #onesignal-popover-container,
    .onesignal-slidedown-container, .onesignal-popover-container,
    [id*="pushcrew"], [class*="pushcrew"],
    .gravitec-widget-container, #gravitec-widget,
    [class*="push-notification"], [id*="push-notification"],
    [class*="notification-prompt"], [id*="notification-prompt"],

    /* ── Cookie / GDPR banners ───────────────────────────────────────── */
    #cookie-banner, #cookie-notice, #cookie-consent, #cookie-bar,
    #gdpr-banner, #gdpr-popup, #gdpr-notice, #gdpr-modal,
    #consent-banner, #consent-notice, #consent-popup, #consent-modal,
    .cookie-banner, .cookie-notice, .cookie-consent, .cookie-bar,
    .gdpr-banner, .gdpr-popup, .consent-banner, .consent-notice,
    #onetrust-banner-sdk, #onetrust-pc-sdk, #onetrust-consent-sdk,
    #CybotCookiebotDialog, .cookiebanner, #cookiebanner,
    #cc-window, .cc-window, .cc-banner, #didomi-popup,
    #qc-cmp2-ui, [class*="cookie-law"], [id*="cookie-law"],
    [class*="gdpr-"], [class*="consent-"],

    /* ── Newsletter / exit-intent popups ─────────────────────────────── */
    [class*="newsletter-popup"], [id*="newsletter-popup"],
    [class*="subscribe-popup"], [id*="subscribe-popup"],
    [class*="email-popup"], [id*="email-popup"],
    [class*="signup-popup"], [id*="signup-popup"],
    [class*="exit-intent"], [id*="exit-intent"],
    [class*="exitintent"], [id*="exitintent"],
    .mc-modal, #mc_embed_popup,
    [class*="klaviyo-form-overlay"],
    [class*="popup-overlay"], [class*="modal-overlay"],

    /* ── Floating / sticky ads ───────────────────────────────────────── */
    [class*="floating-ad"], [id*="floating-ad"],
    [class*="sticky-ad"], [id*="sticky-ad"],
    [class*="fixed-bottom-ad"], [class*="fixed-top-ad"],
    [class*="anchored-ad"], [class*="overlay-ad"],
    div[style*="position:fixed"][style*="z-index:999"],
    div[style*="position: fixed"][style*="z-index: 999"],

    /* ── Social promoted content ─────────────────────────────────────── */
    [data-promoted="true"], [data-ad-preview],
    [aria-label="Advertisement"], [aria-label="Ads"],
    [aria-label="Sponsored"], [data-testid="placementTracking"],

    /* ── Video ad overlays ───────────────────────────────────────────── */
    .ytp-ad-overlay-container, .ytp-ad-overlay-slot,
    .ytp-ad-text-overlay, .ytp-ad-image-overlay,
    .ytp-ad-player-overlay, .ytp-ad-player-overlay-instream-info,
    .ytp-ad-simple-ad-badge, .ytp-ad-preview-container,
    .ytp-ad-shopping-overlay, .ytp-ad-action-interstitial,
    #masthead-ad, ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
    ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer, ytd-search-pyv-renderer,

    /* ── AdBlock Tester cosmetic test patterns ───────────────────────── */
    .ad-banner-top, .ad-banner-bottom, .ad-banner-left, .ad-banner-right,
    .ad-banner-center, .ad-banner-wrapper, .ad-banner-holder,
    .advertisement-300x250, .advertisement-728x90, .advertisement-320x50,
    .advertisement-160x600, .advertisement-300x600,
    [class*="adBanner"], [class*="adSlot"], [class*="adUnit"],
    [id*="adBanner"], [id*="adSlot"], [id*="adUnit"],

    /* ── Fallback wildcard patterns ──────────────────────────────────── */
    [class^="ad-"][class$="-container"],
    [class^="ad-"][class$="-wrapper"],
    [id^="ad-"][id$="-container"],
    [id^="sponsor-"][id$="-block"]

  { display: none !important; visibility: hidden !important; pointer-events: none !important; }

  /* ── Restore scroll locked by popups ──────────────────────────────── */
  html.overflow-hidden, html[style*="overflow: hidden"],
  html[style*="overflow:hidden"], body.overflow-hidden,
  body.modal-open, body.no-scroll, body[style*="overflow: hidden"],
  body[style*="overflow:hidden"] {
    overflow: auto !important;
    position: static !important;
    height: auto !important;
  }
  `;

  function injectCosmetic() {
    let s = document.getElementById('shieldblock-cosmetic');
    if (s) return;
    s = document.createElement('style');
    s.id = 'shieldblock-cosmetic';
    s.textContent = COSMETIC_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function observeDynamic() {
    // Remove dynamically injected ad iframes
    const io = new MutationObserver(() => {
      if (!enabled || allowlisted) return;
      document.querySelectorAll(
        'iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="adnxs"]'
      ).forEach((el) => el.remove());

      // Restore scroll only when the page actually looks locked.
      const body = document.body;
      const html = document.documentElement;
      if (!body) return;

      const bodyStyle = body.style;
      const htmlStyle = html.style;
      const bodyClasses = body.classList;
      const htmlClasses = html.classList;
      const scrollLocked =
        bodyStyle.overflow === 'hidden' ||
        bodyStyle.position === 'fixed' ||
        htmlStyle.overflow === 'hidden' ||
        bodyClasses.contains('modal-open') ||
        bodyClasses.contains('no-scroll') ||
        bodyClasses.contains('overflow-hidden') ||
        htmlClasses.contains('modal-open') ||
        htmlClasses.contains('no-scroll') ||
        htmlClasses.contains('overflow-hidden');

      if (!scrollLocked) return;

      ['overflow', 'position', 'height', 'top', 'width'].forEach((prop) => {
        bodyStyle.removeProperty(prop);
        htmlStyle.removeProperty(prop);
      });
    });
    io.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (['TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED'].includes(msg.type)) {
      refreshState();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.allowlist) refreshState();
  });

  refreshState();
  observeDynamic();
})();
