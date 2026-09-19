(function initializeShieldBlockCosmeticEngine() {
  'use strict';

  if (globalThis.__shieldblockCosmeticInitialized === true) {
    return;
  }

  globalThis.__shieldblockCosmeticInitialized = true;

  const GENERIC_STYLE_ID = 'shieldblock-generic';
  const DOMAIN_STYLE_PREFIX = 'shieldblock-domain-';
  const OBSERVER_ATTRIBUTE = 'data-shieldblock-cosmetic-observing';
  const INITIAL_HIDDEN_DELAY_MS = 500;
  const BAIT_CLASS_EXCEPTIONS = new Set([
    'adsbox',
    'ad-placeholder',
    'ad-detect',
    'adblocker-test',
  ]);
  const BAIT_NOT_SUFFIX = [...BAIT_CLASS_EXCEPTIONS]
    .map((className) => `:not(.${className}):not([class~="${className}"])`)
    .join('');
  const GENERIC_CLASS_NAMES = Object.freeze([
    'ad',
    'ads',
    'adsbygoogle',
    'ad-unit',
    'ad-container',
    'ad-wrapper',
    'ad-banner',
    'ad-slot',
    'ad-block',
    'advertisement',
    'advertising',
    'advert',
    'sponsor',
    'sponsored',
    'sponsored-content',
    'sponsored-post',
    'promoted',
    'promo',
    'native-ad',
    'native-ads',
    'dfp-ad',
    'gpt-ad',
    'gpt-slot',
    'outbrain-widget',
    'taboola-widget',
    'mgid-widget',
    'revcontent-widget',
    'adfox-block',
    'yandex-rtb',
    'banner-ad',
    'google-ad',
    'adbox',
    'adzone',
    'adframe',
    'adspace',
    'adlabel',
    'adholder',
    'ad-rail',
    'adbreak',
    'admarker',
    'ad-leaderboard',
    'ad-sidebar',
    'ad-inline',
    'ad-native',
    'ad-tile',
    'ad-callout',
    'promo-block',
    'promo-unit',
    'sponsor-card',
    'partner-content',
    'partner-banner',
    'commercial-unit',
    'brand-studio',
    'brand-post',
    'paid-content',
    'paid-post',
  ]);
  const GENERIC_ID_NAMES = Object.freeze([
    'ad',
    'ads',
    'advertisement',
    'ad-container',
    'ad-banner',
    'ad-slot',
    'google-ads',
    'dfp-ad',
    'sponsored',
    'promo-slot',
    'outbrain',
    'taboola',
  ]);
  const GENERIC_ATTRIBUTE_SELECTORS = Object.freeze([
    '[data-ad]',
    '[data-ads]',
    '[data-adunit]',
    '[data-slot]',
    '[data-google-query-id]',
    '[data-ad-client]',
    '[data-ad-slot]',
    '[data-ad-container]',
    '[data-ad-name]',
    '[data-ad-label]',
    '[data-sponsored]',
    '[data-native-ad]',
    '[data-promoted]',
    '[data-ad-placement]',
    '[data-ad-format]',
    '[data-testid="ad"]',
    '[data-test-id="ad"]',
    '[aria-label="Advertisement"]',
    '[aria-label="Sponsored"]',
    '[role="complementary"][aria-label*="ad"]',
  ]);
  const IFRAME_PATTERNS = Object.freeze([
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adnxs"]',
    'iframe[src*="taboola"]',
    'iframe[src*="outbrain"]',
    'iframe[src*="pubmatic"]',
    'iframe[src*="rubiconproject"]',
    'iframe[src*="criteo"]',
    'iframe[src*="openx"]',
    'iframe[src*="moatads"]',
  ]);
  const DIRECT_HIDE_SELECTORS = Object.freeze([
    '.adsbygoogle',
    '.ad-slot',
    '.ad-banner',
    '.advertisement',
    '.sponsored-content',
    '.promoted',
    '[data-ad]',
    '[data-ad-slot]',
    '[data-google-query-id]',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adnxs"]',
  ]);
  /**
   * Expands a generic class token into the selector shapes it contributes.
   * @param {string} className
   * @returns {string[]}
   */
  function classSelectorsFor(className) {
    return [
      `.${className}`,
      `[class~="${className}"]`,
      `[class^="${className}-"]`,
      `[class*=" ${className}-"]`,
    ];
  }

  /**
   * Expands a generic id token into the selector shapes it contributes.
   * @param {string} idName
   * @returns {string[]}
   */
  function idSelectorsFor(idName) {
    return [
      `#${idName}`,
      `[id="${idName}"]`,
      `[id^="${idName}-"]`,
      `[id*="-${idName}"]`,
    ];
  }

  const GENERIC_COSMETICS = Object.freeze(Array.from(new Set([
    ...GENERIC_CLASS_NAMES.flatMap(classSelectorsFor),
    ...GENERIC_ID_NAMES.flatMap(idSelectorsFor),
    ...GENERIC_ATTRIBUTE_SELECTORS,
    ...IFRAME_PATTERNS,
  ])));
  // Some web apps ship obfuscated class names that collide with the generic ad
  // tokens above. Gmail wraps every message in <div class="adn ads">, so the
  // generic `.ads` rule hides the entire conversation body. Drop only the
  // colliding tokens on those hosts rather than disabling generic cosmetics.
  const GENERIC_TOKEN_EXCEPTIONS = Object.freeze({
    'mail.google.com': Object.freeze({
      classNames: Object.freeze(['ad', 'ads']),
      idNames: Object.freeze(['ad', 'ads']),
    }),
  });
  const DOMAIN_COSMETICS = Object.freeze({
    'youtube.com': Object.freeze([
      /* --- Video player ad elements --- */
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
      '.ytp-ad-skip-button-container',
      '.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button',
      '.ytp-skip-ad-button',
      '.ytp-ad-module',
      '.ytp-ad-player-overlay',
      '.ytp-ad-player-overlay-instream-info',
      '.ytp-ad-visit-advertiser-button',
      '.ytp-ad-button-icon',
      '.video-ads',
      /* --- 2026 updated selectors --- */
      'ytd-ad-slot-renderer',
      'yt-mealbar-promo-renderer',
      '.ytd-mealbar-promo-renderer',
      'ytd-statement-banner-renderer',
      'ytd-primetime-promo-renderer',
      'ytd-brand-video-shelf-renderer',
      'ytd-brand-video-singleton-renderer',
      'ytd-action-companion-ad-renderer',
      'ytd-display-ad-renderer',
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',

      /* --- Companion / display / overlay ads on video player --- */
      '.ytp-ce-element',
      '.ytp-ce-covering-overlay',
      '.ytp-ce-element-shadow',
      '.ytp-cards-teaser',
      '.ytp-cards-button',
      '#player-ads',
      '#masthead-ad',
      '.ytd-banner-promo-renderer',
      'ytd-banner-promo-renderer',
      '#ad-container',
      '.ad-container',
      '.ytd-companion-slot-renderer',
      'ytd-companion-slot-renderer',
      '#companion',
      '#companion-slot',
      '.iv-branding',
      '.ytp-iv-video-content',
      '.video-ads',
      '#movie_player .ytp-ad-module',
      '.ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-sparkles-web-renderer',
      '.ytd-promoted-video-renderer',
      'ytd-promoted-video-renderer',
      'ytd-search-pyv-renderer',
      'ytd-promoted-sparkles-text-search-renderer',
      '[class*="sparkles-light-cta"]',
      '#panel-pages ytd-banner-promo-renderer',
      'ytd-in-feed-ad-layout-renderer',
      '#contents ytd-ad-slot-renderer',
      '#masthead-ad',
      'ytd-ad-slot-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-video-renderer',
      'ytd-display-ad-renderer',
      'ytd-in-feed-ad-layout-renderer',
      '.ytd-promoted-sparkles-text-search-renderer',
      '#player-ads',
      '.ytp-ad-progress',
      '.ytp-ad-progress-list',
      '.video-ads.ytp-ad-module',
      'tp-yt-paper-dialog:has(yt-upsell-dialog-renderer)',
      'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
      'tp-yt-paper-dialog:has(yt-playability-error-supported-renderers)',
      'tp-yt-iron-overlay-backdrop',
      'yt-playability-error-supported-renderers',
      'ytd-enforcement-message-view-model',
      '.ytd-enforcement-message-view-model',
      'yt-mealbar-promo-renderer',
      'ytd-rich-item-renderer:has(ytd-display-ad-renderer)',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
      'ytm-promoted-sparkles-web-renderer',

      /* --- Renderers the JSON prune targets, hidden here as a backstop for
             payloads that reach the DOM before the scriptlet sees them --- */
      'ytd-carousel-ad-renderer',
      'ytd-video-masthead-ad-v3-renderer',
      'ytd-video-masthead-ad-advertiser-info-renderer',
      'ytd-player-legacy-desktop-watch-ads-renderer',
      'ytd-ad-inline-playback-meta-block',
      'ytd-compact-promoted-video-renderer',
      'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)',
      'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
      'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)',

      /* --- Shorts --- */
      'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)',
      'ytm-promoted-video-renderer',
      'ytm-companion-slot',

      /* --- Player promos that are not part of the video --- */
      '.ytp-suggested-action',
      '.ytp-paid-content-overlay',
    ]),
    'facebook.com': Object.freeze([
      '[data-pagelet*="ad"]',
      'div[aria-label="Sponsored"]',
      'a[aria-label="Sponsored"]',
      '[data-testid="placementTracking"]',
      'div[data-pagelet*="FeedUnit"][role="article"]:has([aria-label="Sponsored"])',
      '._5u5j',
    ]),
    'twitter.com': Object.freeze([
      '[data-testid="placementTracking"]',
      '[data-testid="trend"] [aria-label="Promoted"]',
      'article:has([data-testid="placementTracking"])',
      'section[aria-label*="Who to follow"]',
    ]),
    'x.com': Object.freeze([
      '[data-testid="placementTracking"]',
      '[data-testid="trend"] [aria-label="Promoted"]',
      'article:has([data-testid="placementTracking"])',
      'section[aria-label*="Who to follow"]',
    ]),
    'reddit.com': Object.freeze([
      'shreddit-ad-post',
      '[data-testid="post-container"]:has([data-click-id="ad"])',
      '[data-promoted="true"]',
      '.promotedlink',
      'div[id^="adblocktest"]',
    ]),
    'instagram.com': Object.freeze([
      'article:has(span[aria-label="Sponsored"])',
      'article:has(a[href*="/ads/"])',
      'div[role="dialog"] article:has(span[aria-label="Sponsored"])',
      'section main article:has(header span[dir="auto"]:is(:first-child))',
    ]),
    'linkedin.com': Object.freeze([
      '.ad-banner-container',
      '.sponsored-content',
      '[data-ad-banner]',
      '.feed-shared-update-v2:has([aria-label="Promoted"])',
      '.ad-feedback-container',
      '.sponsored-update',
    ]),
    'cnn.com': Object.freeze([
      '.ad-slot-header',
      '.ad-slot',
      '.zn-ad-container',
      '[data-purpose="ad-slot"]',
      '.ad-smart-wrap',
    ]),
    'forbes.com': Object.freeze([
      '.top-ad-container',
      '.fbs-ad--top-wrapper',
      '.fbs-ad--recirculation',
      '[data-ad-unit]',
      '.ntv-ad',
    ]),
    'wired.com': Object.freeze([
      '.PersistentBottomWrapper',
      '.AdSlot',
      '[data-testid="GenericAd"]',
      '.ad__slot',
      '.ad__container',
    ]),
  });
  const PROCEDURAL_RULES = Object.freeze([
    { type: 'has', base: 'article', child: '.adsbygoogle, [data-ad], [data-ad-slot], iframe[src*="doubleclick"]' },
    { type: 'has', base: 'section', child: '.adsbygoogle, [data-ad], [data-ad-slot], iframe[src*="doubleclick"]' },
    { type: 'has', base: 'div', child: '.outbrain-widget, .taboola-widget, .mgid-widget, .revcontent-widget' },
    { type: 'has', base: 'aside', child: '.sponsored, .promoted, [aria-label="Sponsored"]' },
    { type: 'has', base: 'li', child: '.sponsored, .promoted, [aria-label="Sponsored"]' },
    { type: 'has', base: '[role="complementary"]', child: '.adsbygoogle, [data-ad], iframe[src*="googlesyndication"]' },
    { type: 'has', base: '[role="region"]', child: '.sponsored, .promoted' },
    { type: 'has', base: '.feed-shared-update-v2', child: '[aria-label="Promoted"], .sponsored-content' },
    { type: 'has', base: '.ytd-rich-item-renderer', child: 'ytd-ad-slot-renderer, ytd-display-ad-renderer' },
    { type: 'has', base: 'ytd-rich-item-renderer', child: 'ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer' },
    { type: 'upward', child: '.adsbygoogle', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: '[data-ad]', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: '[data-ad-slot]', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: 'iframe[src*="doubleclick"]', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: 'iframe[src*="googlesyndication"]', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: 'iframe[src*="adnxs"]', ancestor: 'div, aside, section, article' },
    { type: 'upward', child: '[aria-label="Sponsored"]', ancestor: 'article, li, div' },
    { type: 'upward', child: '.sponsored-content', ancestor: 'article, li, div' },
    { type: 'upward', child: '.promoted', ancestor: 'article, li, div' },
    { type: 'upward', child: 'ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer', ancestor: 'ytd-rich-item-renderer, div' },
  ]);

  let mutationObserver = null;
  const pendingMutationRoots = new Set();
  let currentPageAllowlisted = false;
  let mutationFrameId = 0;
  let protectionEnabled = true;

  // Track the master enabled toggle so YouTube cleanup respects "pause".
  try {
    chrome.storage.local.get('enabled').then((result) => {
      protectionEnabled = result.enabled !== false;
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'enabled' in changes) {
        protectionEnabled = changes.enabled.newValue !== false;
        if (!protectionEnabled) {
          removeManagedStyles();
        } else if (!currentPageAllowlisted) {
          rerunAllCosmetics();
        }
      }
    });
  } catch {
    protectionEnabled = true;
  }

  /**
   * Returns true when the current page is a YouTube surface where only curated
   * domain-specific cosmetics should run.
   * @returns {boolean}
   */
  function isYouTubeSurface() {
    const hostname = location.hostname.replace(/^www\./, '').toLowerCase();
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
  }

  /**
   * Returns true when the current hostname is allowlisted.
   * @returns {Promise<boolean>}
   */
  async function loadAllowlistState() {
    try {
      const result = await chrome.storage.local.get(['allowlistedDomains', 'enabled']);
      protectionEnabled = result.enabled !== false;
      const allowlistedDomains = Array.isArray(result.allowlistedDomains)
        ? result.allowlistedDomains
        : [];
      const hostname = location.hostname.replace(/^www\./, '').toLowerCase();
      currentPageAllowlisted = allowlistedDomains.some((domain) => (
        hostname === String(domain).replace(/^www\./, '').toLowerCase()
        || hostname.endsWith(`.${String(domain).replace(/^www\./, '').toLowerCase()}`)
      ));
    } catch {
      currentPageAllowlisted = false;
    }

    if (currentPageAllowlisted) {
      document.documentElement?.setAttribute('data-shieldblock-allowlisted', 'true');
    }

    return currentPageAllowlisted;
  }

  /**
   * Delays initial work briefly when the tab starts hidden.
   * @returns {Promise<void>}
   */
  async function waitForVisibleStart() {
    if (document.hidden !== true) {
      return;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, INITIAL_HIDDEN_DELAY_MS);
    });
  }

  /**
   * Returns true when an element is an ad-bait probe that should remain visible.
   * @param {Element | null} element
   * @returns {boolean}
   */
  function isBaitElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    for (const className of BAIT_CLASS_EXCEPTIONS) {
      if (element.classList.contains(className)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Appends bait exclusions to a selector string.
   * @param {string} selector
   * @returns {string}
   */
  function withBaitExclusions(selector) {
    return `${selector}${BAIT_NOT_SUFFIX}`;
  }

  /**
   * Creates or updates a style node in the document.
   * @param {string} styleId
   * @param {string} cssText
   * @returns {HTMLStyleElement | null}
   */
  function upsertStyle(styleId, cssText) {
    const parent = document.head || document.documentElement;
    if (!parent) {
      return null;
    }

    let style = document.getElementById(styleId);
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = styleId;
      style.type = 'text/css';
      style.textContent = cssText;
      parent.appendChild(style);
      return style;
    }

    if (style.textContent !== cssText) {
      style.textContent = cssText;
    }

    if (style.parentNode !== parent) {
      parent.appendChild(style);
    }

    return style;
  }

  /**
   * Builds a CSS rule string from a selector list.
   * @param {string[]} selectors
   * @returns {string}
   */
  function buildCssRule(selectors) {
    if (!selectors.length) {
      return '';
    }

    return `${selectors.map(withBaitExclusions).join(', ')} { display: none !important; }`;
  }

  /**
   * Returns the generic selectors that must not run on the current hostname.
   * @param {string} hostname
   * @returns {Set<string>}
   */
  function getExceptedGenericSelectors(hostname) {
    const excepted = new Set();

    for (const [domain, tokens] of Object.entries(GENERIC_TOKEN_EXCEPTIONS)) {
      if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
        continue;
      }

      for (const className of tokens.classNames) {
        for (const selector of classSelectorsFor(className)) {
          excepted.add(selector);
        }
      }

      for (const idName of tokens.idNames) {
        for (const selector of idSelectorsFor(idName)) {
          excepted.add(selector);
        }
      }
    }

    return excepted;
  }

  /**
   * Injects the global generic cosmetic stylesheet.
   * @returns {void}
   */
  function injectGenericCSS() {
    if (currentPageAllowlisted || isYouTubeSurface() || !protectionEnabled) {
      return;
    }
    const hostname = location.hostname.replace(/^www\./, '').toLowerCase();
    const excepted = getExceptedGenericSelectors(hostname);
    const selectors = excepted.size === 0
      ? GENERIC_COSMETICS
      : GENERIC_COSMETICS.filter((selector) => !excepted.has(selector));
    const cssText = buildCssRule(selectors);
    if (cssText) {
      upsertStyle(GENERIC_STYLE_ID, cssText);
    }
  }

  /**
   * Looks up the current domain-specific selector set.
   * @param {string} hostname
   * @returns {string[]}
   */
  function getDomainSelectors(hostname) {
    if (DOMAIN_COSMETICS[hostname]) {
      return DOMAIN_COSMETICS[hostname];
    }

    for (const [domain, selectors] of Object.entries(DOMAIN_COSMETICS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return selectors;
      }
    }

    return [];
  }

  /**
   * Removes stale per-domain style tags when the current hostname changes.
   * @param {string} activeStyleId
   * @returns {void}
   */
  function pruneDomainStyles(activeStyleId) {
    const domainStyles = document.querySelectorAll(`style[id^="${DOMAIN_STYLE_PREFIX}"]`);
    for (const style of domainStyles) {
      if (style.id !== activeStyleId) {
        style.remove();
      }
    }
  }

  /**
   * Removes all cosmetic style tags this engine manages. Used when the user
   * pauses protection so hidden ad slots reappear without a reload.
   * @returns {void}
   */
  function removeManagedStyles() {
    document.getElementById(GENERIC_STYLE_ID)?.remove();
    const domainStyles = document.querySelectorAll(`style[id^="${DOMAIN_STYLE_PREFIX}"]`);
    for (const style of domainStyles) {
      style.remove();
    }
  }

  /**
   * Injects domain-specific cosmetic CSS for the current hostname.
   * @returns {void}
   */
  function injectDomainCSS() {
    if (currentPageAllowlisted || !protectionEnabled) {
      return;
    }
    const hostname = location.hostname.toLowerCase();
    const selectors = getDomainSelectors(hostname);
    const styleId = `${DOMAIN_STYLE_PREFIX}${hostname}`;
    pruneDomainStyles(styleId);

    if (!selectors.length) {
      const staleStyle = document.getElementById(styleId);
      if (staleStyle) {
        staleStyle.remove();
      }
      return;
    }

    const cssText = buildCssRule(selectors);
    if (cssText) {
      upsertStyle(styleId, cssText);
    }
  }

  /**
   * Collects scoped matches for a selector from a root element or document.
   * @param {ParentNode | Element | Document} root
   * @param {string} selector
   * @returns {Element[]}
   */
  function collectScopedMatches(root, selector) {
    const matches = [];
    if (root instanceof Element && root.matches(selector)) {
      matches.push(root);
    }

    if ('querySelectorAll' in root) {
      matches.push(...root.querySelectorAll(selector));
    }

    return matches;
  }

  /**
   * Hides an element with inline styles unless it is a bait probe.
   * @param {Element | null} element
   * @returns {void}
   */
  function hideElement(element) {
    if (currentPageAllowlisted || !protectionEnabled || !(element instanceof HTMLElement) || isBaitElement(element)) {
      return;
    }

    element.style.setProperty('display', 'none', 'important');
    element.setAttribute('data-shieldblock-hidden', 'true');
  }

  /**
   * Finds parent elements matching a selector that contain an ad child.
   * @param {string} baseSelector
   * @param {string} childSelector
   * @param {ParentNode | Element | Document} root
   * @returns {void}
   */
  function handleHasSelector(baseSelector, childSelector, root) {
    const baseElements = collectScopedMatches(root, baseSelector);
    for (const baseElement of baseElements) {
      if (baseElement.querySelector(childSelector)) {
        hideElement(baseElement);
      }
    }
  }

  /**
   * Walks upward from an ad marker to the nearest matching ancestor selector.
   * @param {string} childSelector
   * @param {string} ancestorSelector
   * @param {ParentNode | Element | Document} root
   * @returns {void}
   */
  function handleUpwardSelector(childSelector, ancestorSelector, root) {
    const childElements = collectScopedMatches(root, childSelector);
    for (const childElement of childElements) {
      const ancestor = childElement.closest(ancestorSelector);
      if (ancestor) {
        hideElement(ancestor);
      }
    }
  }

  /**
   * Applies a conservative inline hide pass for high-confidence ad markers.
   * @param {ParentNode | Element | Document} root
   * @returns {void}
   */
  function hideDirectAdMatches(root) {
    const matches = collectScopedMatches(root, DIRECT_HIDE_SELECTORS.join(', '));
    for (const element of matches) {
      hideElement(element);
    }
  }

  /**
   * Executes the procedural engine against the supplied DOM roots.
   * @param {Array<ParentNode | Element | Document> | ParentNode | Element | Document} [roots=document]
   * @returns {void}
   */
  function runProceduralRules(roots = document) {
    if (isYouTubeSurface()) {
      return;
    }

    const normalizedRoots = Array.isArray(roots) ? roots : [roots];
    for (const root of normalizedRoots) {
      if (!(root instanceof Document) && !(root instanceof Element)) {
        continue;
      }

      hideDirectAdMatches(root);

      for (const rule of PROCEDURAL_RULES) {
        if (rule.type === 'has') {
          handleHasSelector(rule.base, rule.child, root);
          continue;
        }

        handleUpwardSelector(rule.child, rule.ancestor, root);
      }
    }
  }

  /**
   * Flushes pending mutation roots through the procedural engine.
   * @returns {void}
   */
  function flushPendingMutations() {
    if (pendingMutationRoots.size === 0) {
      return;
    }

    const roots = [...pendingMutationRoots];
    pendingMutationRoots.clear();
    injectDomainCSS();
    runProceduralRules(roots);
  }

  /**
   * Schedules mutation processing on the next animation frame.
   * @returns {void}
   */
  function scheduleMutationProcessing() {
    if (mutationFrameId !== 0) {
      return;
    }

    const scheduler = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 16);

    mutationFrameId = scheduler(() => {
      mutationFrameId = 0;
      flushPendingMutations();
    });
  }

  /**
   * Starts the mutation observer once the body exists.
   * @returns {void}
   */
  function installMutationObserver() {
    if (currentPageAllowlisted || mutationObserver) {
      return;
    }

    if (!document.body) {
      window.requestAnimationFrame(installMutationObserver);
      return;
    }

    mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            pendingMutationRoots.add(node);
          } else if (node instanceof Text && node.parentElement) {
            pendingMutationRoots.add(node.parentElement);
          }
        }
      }

      if (pendingMutationRoots.size > 0) {
        scheduleMutationProcessing();
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    globalThis.__sb_cosmeticObserving = true;
    document.documentElement?.setAttribute(OBSERVER_ATTRIBUTE, 'true');
  }

  /**
   * Dispatches the internal navigation event used for SPA refreshes.
   * @param {string} reason
   * @returns {void}
   */
  function dispatchNavigationEvent(reason) {
    window.dispatchEvent(new CustomEvent('shieldblock-navigate', {
      detail: {
        reason,
        url: location.href,
      },
    }));
  }

  /**
   * Wraps history methods to emit a navigation event after SPA transitions.
   * @param {'pushState' | 'replaceState'} methodName
   * @returns {void}
   */
  function wrapHistoryMethod(methodName) {
    const original = history[methodName];
    if (typeof original !== 'function' || original.__shieldblockWrapped === true) {
      return;
    }

    const wrapped = function shieldblockWrappedHistory(...args) {
      const result = Reflect.apply(original, this, args);
      dispatchNavigationEvent(methodName);
      return result;
    };

    wrapped.__shieldblockWrapped = true;
    try {
      history[methodName] = wrapped;
    } catch {
      // Some pages harden history methods; popstate and native events remain as fallback.
    }
  }

  /**
   * Reapplies cosmetic rules after SPA navigation.
   * @returns {void}
   */
  function rerunAllCosmetics() {
    injectGenericCSS();
    injectDomainCSS();
    runProceduralRules(document);
  }

  /**
   * Installs SPA navigation hooks for history and YouTube custom events.
   * @returns {void}
   */
  function installNavigationHooks() {
    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');

    window.addEventListener('shieldblock-navigate', rerunAllCosmetics, { passive: true });
    window.addEventListener('popstate', rerunAllCosmetics, { passive: true });
    window.addEventListener('yt-navigate-finish', rerunAllCosmetics, { passive: true });
  }

  /**
   * Boots the cosmetic engine.
   * @returns {void}
   */
  async function init() {
    await waitForVisibleStart();
    if (await loadAllowlistState()) {
      return;
    }

    injectGenericCSS();
    injectDomainCSS();
    installMutationObserver();
    installNavigationHooks();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        rerunAllCosmetics();
      }, { once: true });
      return;
    }

    rerunAllCosmetics();
  }

  /**
   * Aggressively removes companion/display ads that appear INSIDE the video player.
   * These are overlay cards that appear over the video while it's playing.
   */
  function removeCompanionAds() {
    const COMPANION_SELECTORS = [
      '.ytp-ce-element',           // Info card overlays on video
      '.ytp-cards-teaser',          // Card teasers (corner popup)
      '.ytp-cards-button',
      '#companion',                 // Right-side companion panel
      '#companion-slot',
      '.ytd-companion-slot-renderer',
      'ytd-companion-slot-renderer',
      '#panel-pages',               // Panel with display ads
      '.ytd-action-companion-ad-renderer',
      'ytd-action-companion-ad-renderer',
      '.iv-branding',               // In-video branding overlay
      '.ytp-iv-video-content',
      '#player-ads',
      '#masthead-ad',
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
    ];

    for (const sel of COMPANION_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (el instanceof HTMLElement) {
            el.style.setProperty('display', 'none', 'important');
            el.setAttribute('data-sb-hidden', '1');
          }
        });
      } catch { /* ignore bad selectors */ }
    }
  }

  /**
   * Neutralizes YouTube's "ad blockers violate Terms" enforcement popup.
   * Hiding the dialog via CSS is not enough — YouTube also locks page scrolling
   * by opening a modal backdrop, leaving the page frozen. This removes the
   * dialog/backdrop nodes and restores scrolling so the video stays usable.
   * @returns {void}
   */
  function dismissYouTubeAdBlockWall() {
    const ENFORCEMENT_SELECTORS = [
      'ytd-enforcement-message-view-model',
      'ytd-popup-container tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
      'tp-yt-paper-dialog:has(yt-playability-error-supported-renderers)',
    ];

    let found = false;
    for (const sel of ENFORCEMENT_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const dialog = el.closest('tp-yt-paper-dialog') || el;
          if (dialog instanceof HTMLElement) {
            dialog.remove();
            found = true;
          }
        });
      } catch { /* ignore bad selectors */ }
    }

    if (found) {
      try {
        document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((node) => node.remove());
      } catch { /* ignore */ }
      // YouTube freezes scrolling while the modal is open; unlock it.
      for (const node of [document.documentElement, document.body]) {
        if (node instanceof HTMLElement) {
          node.style.removeProperty('overflow');
          node.removeAttribute('scroll-locked');
        }
      }
      // Resume playback if the wall paused the video.
      try {
        const video = document.querySelector('video');
        if (video instanceof HTMLVideoElement && video.paused) {
          void video.play().catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }

  /**
   * Runs the YouTube-specific cleanup passes (companion ads + ad-block wall).
   * @returns {void}
   */
  function runYouTubeCleanup() {
    if (!protectionEnabled || currentPageAllowlisted) {
      return;
    }
    removeCompanionAds();
    dismissYouTubeAdBlockWall();
  }

  // Run companion ad removal on YouTube pages via a fast interval
  if (isYouTubeSurface()) {
    // Initial run
    setTimeout(runYouTubeCleanup, 500);
    setTimeout(runYouTubeCleanup, 1500);
    setTimeout(runYouTubeCleanup, 3000);

    // Watch for dynamically injected companion ads
    const companionObserver = new MutationObserver(() => {
      runYouTubeCleanup();
    });

    const startCompanionObserver = () => {
      const target = document.getElementById('player') || document.body;
      if (target) {
        companionObserver.observe(target, { childList: true, subtree: true });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startCompanionObserver, { once: true });
    } else {
      startCompanionObserver();
    }

    // Also re-run on YouTube navigation
    window.addEventListener('yt-navigate-finish', () => {
      runYouTubeCleanup();
      setTimeout(runYouTubeCleanup, 800);
    }, { passive: true });
  }

  void init();
})();
