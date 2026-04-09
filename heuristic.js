(function initializeShieldBlockHeuristicEngine() {
  'use strict';

  if (globalThis.__shieldblockHeuristicInitialized === true) {
    return;
  }

  globalThis.__shieldblockHeuristicInitialized = true;

  const SKIP_TAGS = new Set([
    'HTML',
    'HEAD',
    'BODY',
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'NOSCRIPT',
    'SVG',
    'PATH',
    'BR',
    'HR',
  ]);
  const BAIT_EXCEPTIONS = new Set([
    'adsbox',
    'ad-placeholder',
    'adsbygoogle-noablate',
  ]);
  const IAB_SIZES = Object.freeze([
    [300, 250],
    [728, 90],
    [160, 600],
    [320, 50],
    [970, 90],
    [300, 600],
    [468, 60],
  ]);
  const AD_TEXT_PATTERN = /\b(ad|ads|advert|advertisement|sponsor|sponsored|promo|promoted|native-ad|dfp|gpt|outbrain|taboola|mgid|revcontent|adfox)\b/i;
  const SPONSORED_PATTERN = /\b(sponsored|promoted|advertisement|paid partner|paid post|paid content)\b/i;
  const IFRAME_AD_PATTERN = /doubleclick|googlesyndication|adnxs|moatads/i;
  const SCRIPT_AD_PATTERN = /doubleclick|googlesyndication|amazon-adsystem|pagead/i;
  const ADCHOICES_PATTERN = /aboutads\.info|adchoices|youronlinechoices/i;
  const ARIA_AD_PATTERN = /advertisement|sponsored/i;
  const VIEWABILITY_ATTRIBUTES = Object.freeze([
    'data-viewable',
    'data-viewability',
    'data-impression-id',
  ]);
  const DATA_AD_ATTRIBUTES = Object.freeze([
    'data-ad',
    'data-adunit',
    'data-slot',
    'data-google-query-id',
    'data-ad-client',
    'data-ad-slot',
    'data-ad-format',
  ]);
  const PROCESSED_ATTRIBUTE = 'data-shieldblock-heuristic-processed';
  const HIDDEN_ATTRIBUTE = 'data-shieldblock-heuristic-hidden';
  const ML_HIDDEN_ATTRIBUTE = 'data-shieldblock-ml-hidden';
  const SCAN_ELEMENT_BUDGET = 500;
  const SCAN_TIME_BUDGET_MS = 100;
  const INITIAL_HIDDEN_DELAY_MS = 500;
  const HEURISTIC_EXCLUDED_HOSTS = Object.freeze([
    'youtube.com',
    'youtu.be',
  ]);

  let processedElements = new WeakSet();
  let pendingRoots = new Set();
  let mutationObserver = null;
  let videoRects = [];
  let currentPageAllowlisted = false;
  let scheduleFlush = () => {};

  /**
   * Returns true when the current hostname is allowlisted.
   * @returns {Promise<boolean>}
   */
  async function loadAllowlistState() {
    try {
      const result = await chrome.storage.local.get('allowlistedDomains');
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
   * Delays expensive work briefly when the page starts hidden.
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
   * Returns true when heuristic blocking should be disabled for the current site.
   * @returns {boolean}
   */
  function isExcludedHostname() {
    const hostname = location.hostname.replace(/^www\./, '').toLowerCase();
    return HEURISTIC_EXCLUDED_HOSTS.some((domain) => (
      hostname === domain || hostname.endsWith(`.${domain}`)
    ));
  }

  /**
   * Safely returns text content for an element.
   * @param {Element} element
   * @returns {string}
   */
  function getElementText(element) {
    try {
      return String(element.innerText || element.textContent || '').trim();
    } catch {
      return '';
    }
  }

  /**
   * Normalizes class or id values to plain strings.
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeTokenValue(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && typeof value.baseVal === 'string') {
      return value.baseVal;
    }
    return '';
  }

  /**
   * Returns true when the element should never be scored.
   * @param {Element} element
   * @returns {boolean}
   */
  function shouldSkipElement(element) {
    if (SKIP_TAGS.has(element.tagName)) {
      return true;
    }

    for (const className of BAIT_EXCEPTIONS) {
      if (element.classList.contains(className)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Safely returns the layout rectangle for an element.
   * @param {Element} element
   * @returns {{ width: number, height: number, top: number, left: number, right: number, bottom: number }}
   */
  function getRect(element) {
    try {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width || 0,
        height: rect.height || 0,
        top: rect.top || 0,
        left: rect.left || 0,
        right: rect.right || 0,
        bottom: rect.bottom || 0,
      };
    } catch {
      return {
        width: Number(element.offsetWidth || 0),
        height: Number(element.offsetHeight || 0),
        top: 0,
        left: 0,
        right: Number(element.offsetWidth || 0),
        bottom: Number(element.offsetHeight || 0),
      };
    }
  }

  /**
   * Returns the computed style for an element.
   * @param {Element} element
   * @returns {CSSStyleDeclaration | null}
   */
  function getStyle(element) {
    try {
      return getComputedStyle(element);
    } catch {
      return null;
    }
  }

  /**
   * Returns true when the element is visibly rendered.
   * @param {Element} element
   * @returns {boolean}
   */
  function isVisibleElement(element) {
    const rect = getRect(element);
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = getStyle(element);
    if (!style) {
      return true;
    }

    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Returns true when the element roughly matches a standard IAB ad size.
   * @param {Element} element
   * @returns {boolean}
   */
  function matchesAdSize(element) {
    const rect = getRect(element);
    return IAB_SIZES.some(([width, height]) => {
      const widthWithin = Math.abs(rect.width - width) <= width * 0.1;
      const heightWithin = Math.abs(rect.height - height) <= height * 0.1;
      return widthWithin && heightWithin;
    });
  }

  /**
   * Returns true when the element matches common banner aspect ratios.
   * @param {Element} element
   * @returns {boolean}
   */
  function looksLikeBanner(element) {
    const rect = getRect(element);
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const ratio = rect.width / rect.height;
    const bannerRatios = [728 / 90, 970 / 90, 320 / 50];
    return bannerRatios.some((target) => Math.abs(ratio - target) <= target * 0.15);
  }

  /**
   * Returns true when the element contains a matching descendant resource.
   * @param {Element} element
   * @param {string} selector
   * @param {RegExp} pattern
   * @returns {boolean}
   */
  function containsResourceMatch(element, selector, pattern) {
    try {
      const resources = element.querySelectorAll(selector);
      for (const resource of resources) {
        const value = resource.getAttribute('src') || resource.getAttribute('href') || '';
        if (pattern.test(value)) {
          return true;
        }
      }
    } catch {
      // Ignore traversal failures.
    }

    return false;
  }

  /**
   * Returns true when all links inside the element are third-party.
   * @param {Element} element
   * @returns {boolean}
   */
  function hasExternalLinkDensity(element) {
    if (element.closest('nav, header, footer')) {
      return false;
    }

    const links = [
      ...(element.matches('a[href]') ? [element] : []),
      ...element.querySelectorAll('a[href]'),
    ];
    if (links.length === 0) {
      return false;
    }

    const pageHost = location.hostname.replace(/^www\./, '');
    for (const link of links) {
      try {
        const target = new URL(link.href, location.href);
        const host = target.hostname.replace(/^www\./, '');
        if (!host || host === pageHost) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the number of external links inside the element.
   * @param {Element} element
   * @returns {number}
   */
  function countExternalLinks(element) {
    let count = 0;
    const pageHost = location.hostname.replace(/^www\./, '');
    const links = [
      ...(element.matches('a[href]') ? [element] : []),
      ...element.querySelectorAll('a[href]'),
    ];

    for (const link of links) {
      try {
        const target = new URL(link.href, location.href);
        const host = target.hostname.replace(/^www\./, '');
        if (host && host !== pageHost) {
          count += 1;
        }
      } catch {
        // Ignore invalid link URLs.
      }
    }

    return count;
  }

  /**
   * Returns true when an element overlaps a visible video region.
   * @param {Element} element
   * @returns {boolean}
   */
  function overlapsVideo(element) {
    const style = getStyle(element);
    if (!style || (style.position !== 'absolute' && style.position !== 'fixed')) {
      return false;
    }

    const rect = getRect(element);
    return videoRects.some((videoRect) => (
      rect.left < videoRect.right
      && rect.right > videoRect.left
      && rect.top < videoRect.bottom
      && rect.bottom > videoRect.top
    ));
  }

  /**
   * Returns true when every child is a media shell and there is no text.
   * @param {Element} element
   * @returns {boolean}
   */
  function hasSuspiciousChildren(element) {
    const children = [...element.children];
    if (children.length < 1 || children.length > 3) {
      return false;
    }

    if (getElementText(element).length > 0) {
      return false;
    }

    return children.every((child) => child.tagName === 'IMG' || child.tagName === 'IFRAME');
  }

  /**
   * Returns the current element depth in the DOM tree.
   * @param {Element} element
   * @returns {number}
   */
  function getDepthInDom(element) {
    let depth = 0;
    let current = element.parentElement;
    while (current && depth < 20) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  /**
   * Returns true when an element or its descendants contain ad-manager markers.
   * @param {Element} element
   * @returns {boolean}
   */
  function hasGoogleAdManagerMarkers(element) {
    try {
      const attributeNames = element.getAttributeNames();
      for (const attributeName of attributeNames) {
        const value = `${attributeName}=${element.getAttribute(attributeName) || ''}`;
        if (/google_ad_client|googletag\.cmd/i.test(value)) {
          return true;
        }
      }

      const scripts = element.querySelectorAll('script');
      for (const script of scripts) {
        if (/googletag\.cmd|google_ad_client/i.test(script.textContent || '')) {
          return true;
        }
      }
    } catch {
      // Ignore marker extraction failures.
    }

    return false;
  }

  /**
   * Refreshes the cached set of visible video rectangles for overlap checks.
   * @returns {void}
   */
  function refreshVideoRects() {
    videoRects = [];
    try {
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        const rect = getRect(video);
        if (rect.width > 0 && rect.height > 0) {
          videoRects.push(rect);
        }
      }
    } catch {
      videoRects = [];
    }
  }

  const SIGNALS = Object.freeze([
    {
      name: 'classNameMatch',
      weight: 20,
      test(element) {
        return AD_TEXT_PATTERN.test(normalizeTokenValue(element.className));
      },
    },
    {
      name: 'idMatch',
      weight: 20,
      test(element) {
        return AD_TEXT_PATTERN.test(normalizeTokenValue(element.id));
      },
    },
    {
      name: 'adSizeRatio',
      weight: 25,
      test(element) {
        return matchesAdSize(element);
      },
    },
    {
      name: 'iframeAdSrc',
      weight: 30,
      test(element) {
        return containsResourceMatch(element, 'iframe[src]', IFRAME_AD_PATTERN);
      },
    },
    {
      name: 'sponsoredText',
      weight: 20,
      test(element) {
        return SPONSORED_PATTERN.test(getElementText(element));
      },
    },
    {
      name: 'fixedStickyPosition',
      weight: 15,
      test(element) {
        const style = getStyle(element);
        const rect = getRect(element);
        return Boolean(style && (style.position === 'fixed' || style.position === 'sticky') && rect.height < 120);
      },
    },
    {
      name: 'highZIndex',
      weight: 20,
      test(element) {
        const style = getStyle(element);
        const rect = getRect(element);
        const zIndex = Number.parseInt(style?.zIndex || '0', 10);
        return Number.isFinite(zIndex) && zIndex > 9000 && rect.width > 200;
      },
    },
    {
      name: 'dataAdAttribute',
      weight: 25,
      test(element) {
        return DATA_AD_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute));
      },
    },
    {
      name: 'scriptAdCdn',
      weight: 35,
      test(element) {
        return containsResourceMatch(element, 'script[src]', SCRIPT_AD_PATTERN);
      },
    },
    {
      name: 'adChoicesLink',
      weight: 40,
      test(element) {
        return containsResourceMatch(element, 'a[href]', ADCHOICES_PATTERN);
      },
    },
    {
      name: 'lowTextDensity',
      weight: 10,
      test(element) {
        const rect = getRect(element);
        return rect.width * rect.height > 40000 && getElementText(element).length < 20;
      },
    },
    {
      name: 'externalLinkDensity',
      weight: 10,
      test(element) {
        return hasExternalLinkDensity(element);
      },
    },
    {
      name: 'ariaLabelAd',
      weight: 50,
      test(element) {
        return ARIA_AD_PATTERN.test(element.getAttribute('aria-label') || '');
      },
    },
    {
      name: 'viewabilityTracking',
      weight: 15,
      test(element) {
        return VIEWABILITY_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute));
      },
    },
    {
      name: 'overlaysVideo',
      weight: 30,
      test(element) {
        return overlapsVideo(element);
      },
    },
    {
      name: 'suspiciousChildCount',
      weight: 10,
      test(element) {
        return hasSuspiciousChildren(element);
      },
    },
    {
      name: 'animatesRepeatedly',
      weight: 15,
      test(element) {
        const style = getStyle(element);
        const rect = getRect(element);
        return Boolean(style && style.animationIterationCount === 'infinite' && rect.width * rect.height < 90000);
      },
    },
    {
      name: 'looksLikeBanner',
      weight: 20,
      test(element) {
        return looksLikeBanner(element);
      },
    },
    {
      name: 'thirdPartyOrigin',
      weight: 20,
      test(element) {
        const pageHost = location.hostname.replace(/^www\./, '');
        const frames = element.querySelectorAll('iframe[src]');
        for (const frame of frames) {
          try {
            const target = new URL(frame.src, location.href);
            const host = target.hostname.replace(/^www\./, '');
            if (host && host !== pageHost) {
              return true;
            }
          } catch {
            // Ignore invalid frame URLs.
          }
        }
        return false;
      },
    },
    {
      name: 'googleAdManagerMarkers',
      weight: 45,
      test(element) {
        return hasGoogleAdManagerMarkers(element);
      },
    },
  ]);

  /**
   * Scores an element against the 20-signal heuristic model.
   * @param {Element} element
   * @returns {{ score: number, signals: string[] }}
   */
  function scoreElement(element) {
    let score = 0;
    const signals = [];

    for (const signal of SIGNALS) {
      let passed = false;
      try {
        passed = signal.test(element) === true;
      } catch {
        passed = false;
      }

      if (passed) {
        score += signal.weight;
        signals.push(signal.name);
      }
    }

    return {
      score: Math.min(score, 100),
      signals,
    };
  }

  /**
   * Hides a detected element exactly once.
   * @param {Element} element
   * @param {'heuristic' | 'ml'} source
   * @returns {void}
   */
  function hideElement(element, source) {
    if (currentPageAllowlisted || !(element instanceof HTMLElement)) {
      return;
    }

    if (element.hasAttribute(HIDDEN_ATTRIBUTE) || element.hasAttribute(ML_HIDDEN_ATTRIBUTE)) {
      return;
    }

    element.style.setProperty('display', 'none', 'important');
    if (source === 'heuristic') {
      element.setAttribute(HIDDEN_ATTRIBUTE, 'true');
      globalThis.__sb_heuristicBlocked = Number(globalThis.__sb_heuristicBlocked || 0) + 1;
      return;
    }

    element.setAttribute(ML_HIDDEN_ATTRIBUTE, 'true');
    globalThis.__sb_mlBlocked = Number(globalThis.__sb_mlBlocked || 0) + 1;
  }

  /**
   * Collects scorable elements within a subtree.
   * @param {Document | Element} root
   * @returns {Element[]}
   */
  function collectCandidates(root) {
    const candidates = [];
    if (root instanceof Element) {
      candidates.push(root);
    }

    try {
      candidates.push(...root.querySelectorAll('*'));
    } catch {
      // Ignore invalid subtree roots.
    }

    return candidates;
  }

  /**
   * Scans the DOM or a subtree for ad-like elements.
   * @param {Document | Element} [root=document]
   * @returns {void}
   */
  function scanDOM(root = document) {
    if (currentPageAllowlisted) {
      return;
    }

    refreshVideoRects();
    const scanStart = typeof performance?.now === 'function' ? performance.now() : Date.now();
    let scannedCount = 0;
    let budgetExceeded = false;

    for (const element of collectCandidates(root)) {
      const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
      if (scannedCount >= SCAN_ELEMENT_BUDGET || now - scanStart >= SCAN_TIME_BUDGET_MS) {
        budgetExceeded = true;
        break;
      }

      if (!(element instanceof Element) || processedElements.has(element)) {
        continue;
      }

      scannedCount += 1;
      processedElements.add(element);
      element.setAttribute(PROCESSED_ATTRIBUTE, 'true');

      if (shouldSkipElement(element) || !isVisibleElement(element)) {
        continue;
      }

      const result = scoreElement(element);
      if (result.score >= 70) {
        hideElement(element, 'heuristic');
        continue;
      }

      if (result.score >= 40 && typeof globalThis.__sb_classify === 'function') {
        let probability = 0;
        try {
          probability = Number(globalThis.__sb_classify(element, result.score));
        } catch {
          probability = 0;
        }

        if (probability > 0.65) {
          hideElement(element, 'ml');
        }
      }
    }

    if (budgetExceeded) {
      if (root instanceof Document && root.documentElement) {
        pendingRoots.add(root.documentElement);
      } else if (root instanceof Element) {
        pendingRoots.add(root);
      }
      scheduleFlush();
    }
  }

  /**
   * Debounces expensive rescans.
   * @param {() => void} callback
   * @param {number} waitMs
   * @returns {() => void}
   */
  function debounce(callback, waitMs) {
    let timeoutId = 0;
    return () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        callback();
      }, waitMs);
    };
  }

  /**
   * Flushes queued mutation roots through the heuristic scanner.
   * @returns {void}
   */
  function flushPendingRoots() {
    if (pendingRoots.size === 0) {
      return;
    }

    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) {
      scanDOM(root);
    }
  }

  scheduleFlush = debounce(flushPendingRoots, 120);

  /**
   * Starts observing dynamic DOM additions.
   * @returns {void}
   */
  function installObserver() {
    if (currentPageAllowlisted || mutationObserver || !document.body) {
      return;
    }

    mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            pendingRoots.add(node);
          }
        }
      }

      if (pendingRoots.size > 0) {
        scheduleFlush();
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Reboots the scan state on SPA navigation.
   * @returns {void}
   */
  function handleNavigation() {
    processedElements = new WeakSet();
    scanDOM();
  }

  /**
   * Boots the heuristic engine after the DOM is ready.
   * @returns {void}
   */
  async function init() {
    await waitForVisibleStart();
    if (isExcludedHostname()) {
      return;
    }
    if (await loadAllowlistState()) {
      return;
    }

    globalThis.__sb_heuristicBlocked = Number(globalThis.__sb_heuristicBlocked || 0);
    globalThis.__sb_mlBlocked = Number(globalThis.__sb_mlBlocked || 0);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        scanDOM();
        installObserver();
      }, { once: true });
    } else {
      scanDOM();
      installObserver();
    }

    globalThis.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });
  }

  void init();
})();
