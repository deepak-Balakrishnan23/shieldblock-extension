(function initializeShieldBlockContent() {
  'use strict';

  if (globalThis.__shieldblockContentInitialized === true) {
    return;
  }

  globalThis.__shieldblockContentInitialized = true;

  const CUSTOM_STYLE_ID = 'shieldblock-custom-cosmetics';
  const PICKER_STYLE_ID = 'shieldblock-picker-style';
  const PICKER_HOVER_ATTRIBUTE = 'data-shieldblock-picker-hover';
  const INITIAL_HIDDEN_DELAY_MS = 500;
  const HIDDEN_MARKER_MAP = Object.freeze({
    'data-shieldblock-hidden': 'cosmetic',
    'data-shieldblock-heuristic-hidden': 'heuristic',
    'data-shieldblock-ml-hidden': 'ml',
  });
  const AD_RESOURCE_PATTERN = /doubleclick|googlesyndication|pagead2|amazon-adsystem|adnxs|outbrain|taboola|mgid|revcontent|rubiconproject|2mdn\.net/i;
  const TRACKER_RESOURCE_PATTERN = /google-analytics|googletagmanager|facebook\.net\/tr|clarity\.ms|mixpanel|segment\.io|heap\.io|amplitude|fullstory|logrocket|mouseflow|crazyegg|inspectlet|scorecardresearch|quantserve/i;

  let currentPageRules = {
    selectors: [],
    allowlisted: false,
  };
  let pickerActive = false;
  let highlightedElement = null;
  let countedElements = new WeakSet();
  const countedPerformanceEntries = new Set();

  /**
   * Sends a message to the background worker and swallows wake-up failures.
   * @param {object} payload
   * @returns {Promise<any>}
   */
  async function sendMessage(payload) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch {
      return null;
    }
  }

  /**
   * Delays work briefly when the tab is initially hidden.
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
   * Escapes a token for safe CSS selector use.
   * @param {string} value
   * @returns {string}
   */
  function escapeToken(value) {
    if (globalThis.CSS?.escape) {
      return globalThis.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  /**
   * Builds the CSS text for custom cosmetic rules.
   * @param {string[]} selectors
   * @returns {string}
   */
  function buildCustomCss(selectors) {
    if (!selectors.length) {
      return '';
    }
    return `${selectors.join(', ')} { display: none !important; }`;
  }

  /**
   * Updates the custom cosmetic style tag for the current page.
   * @param {string[]} selectors
   * @returns {void}
   */
  function applyCustomCosmeticRules(selectors) {
    const styleParent = document.head || document.documentElement;
    if (!styleParent) {
      return;
    }

    const existing = document.getElementById(CUSTOM_STYLE_ID);
    if (currentPageRules.allowlisted || !selectors.length) {
      existing?.remove();
      return;
    }

    const cssText = buildCustomCss(selectors);
    let style = existing;
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = CUSTOM_STYLE_ID;
      style.textContent = cssText;
      styleParent.appendChild(style);
      return;
    }

    if (style.textContent !== cssText) {
      style.textContent = cssText;
    }
    if (style.parentNode !== styleParent) {
      styleParent.appendChild(style);
    }
  }

  /**
   * Requests the current page-specific custom rules from the background worker.
   * @returns {Promise<void>}
   */
  async function loadPageRules() {
    const response = await sendMessage({
      action: 'getPageRules',
      hostname: location.hostname,
    });

    currentPageRules = {
      selectors: Array.isArray(response?.selectors) ? response.selectors : [],
      allowlisted: response?.allowlisted === true,
    };

    if (currentPageRules.allowlisted) {
      document.documentElement?.setAttribute('data-shieldblock-allowlisted', 'true');
    } else {
      document.documentElement?.removeAttribute('data-shieldblock-allowlisted');
    }

    applyCustomCosmeticRules(currentPageRules.selectors);
  }

  /**
   * Sends a lightweight page-load ping to the background worker.
   * @returns {Promise<void>}
   */
  async function notifyPageLoad() {
    await sendMessage({
      action: 'pageLoad',
      hostname: location.hostname,
      timestamp: Date.now(),
    });
  }

  /**
   * Counts a hidden marker exactly once.
   * @param {Element} element
   * @returns {void}
   */
  function countHiddenElement(element) {
    if (!(element instanceof Element) || countedElements.has(element)) {
      return;
    }

    for (const [attributeName, stat] of Object.entries(HIDDEN_MARKER_MAP)) {
      if (element.hasAttribute(attributeName)) {
        countedElements.add(element);
        void sendMessage({
          action: 'incrementStat',
          stat,
        });
        break;
      }
    }
  }

  /**
   * Scans a root for existing heuristic/cosmetic markers.
   * @param {Document | Element} [root=document]
   * @returns {void}
   */
  function scanForHiddenMarkers(root = document) {
    if ('querySelectorAll' in root) {
      const selector = Object.keys(HIDDEN_MARKER_MAP).map((attribute) => `[${attribute}]`).join(', ');
      for (const element of root.querySelectorAll(selector)) {
        countHiddenElement(element);
      }
    }
  }

  /**
   * Installs a mutation observer to count future cosmetic/heuristic hides.
   * @returns {void}
   */
  function installHiddenMarkerObserver() {
    const observerRoot = document.documentElement;
    if (!observerRoot) {
      return;
    }

    const attributeFilter = Object.keys(HIDDEN_MARKER_MAP);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          countHiddenElement(record.target);
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            countHiddenElement(node);
            scanForHiddenMarkers(node);
          }
        }
      }
    });

    observer.observe(observerRoot, {
      attributes: true,
      attributeFilter,
      childList: true,
      subtree: true,
    });

    scanForHiddenMarkers();
  }

  /**
   * Returns the stat bucket for a blocked-looking resource timing entry.
   * @param {PerformanceResourceTiming} entry
   * @returns {'ads' | 'trackers' | ''}
   */
  function classifyBlockedResource(entry) {
    const url = entry.name || '';
    if (TRACKER_RESOURCE_PATTERN.test(url)) {
      return 'trackers';
    }
    if (AD_RESOURCE_PATTERN.test(url)) {
      return 'ads';
    }
    return '';
  }

  /**
   * Returns true when a timing entry looks like a blocked request.
   * @param {PerformanceResourceTiming} entry
   * @returns {boolean}
   */
  function looksBlocked(entry) {
    const duration = Number(entry.duration || 0);
    const transferSize = Number(entry.transferSize || 0);
    const encodedBodySize = Number(entry.encodedBodySize || 0);
    const decodedBodySize = Number(entry.decodedBodySize || 0);
    return transferSize === 0 && (duration < 5 || (encodedBodySize === 0 && decodedBodySize === 0));
  }

  /**
   * Installs the approximate network-block stats observer.
   * @returns {void}
   */
  function installPerformanceObserver() {
    if (currentPageRules.allowlisted || typeof PerformanceObserver !== 'function') {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry instanceof PerformanceResourceTiming)) {
            continue;
          }

          const signature = `${entry.name}|${entry.startTime}`;
          if (countedPerformanceEntries.has(signature)) {
            continue;
          }

          const stat = classifyBlockedResource(entry);
          if (!stat || !looksBlocked(entry)) {
            continue;
          }

          countedPerformanceEntries.add(signature);
          if (countedPerformanceEntries.size > 4000) {
            countedPerformanceEntries.clear();
          }

          void sendMessage({
            action: 'incrementStat',
            stat,
          });
        }
      });

      observer.observe({
        type: 'resource',
        buffered: true,
      });
    } catch {
      // Ignore unsupported observer environments.
    }
  }

  /**
   * Returns a stable nth-child index for an element.
   * @param {Element} element
   * @returns {number}
   */
  function getNthChildIndex(element) {
    if (!element.parentElement) {
      return 1;
    }
    return [...element.parentElement.children].indexOf(element) + 1;
  }

  /**
   * Builds a reasonably stable CSS selector for a picked element.
   * @param {Element} element
   * @returns {string}
   */
  function buildSelector(element) {
    if (element.id) {
      return `#${escapeToken(element.id)}`;
    }

    const segments = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let segment = current.localName || current.tagName.toLowerCase();
      const classNames = [...current.classList]
        .filter((className) => className && className.length < 48)
        .slice(0, 2);

      if (classNames.length > 0) {
        segment += classNames.map((className) => `.${escapeToken(className)}`).join('');
      } else {
        segment += `:nth-child(${getNthChildIndex(current)})`;
      }

      segments.unshift(segment);
      const selector = segments.join(' > ');
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch {
        // Ignore malformed intermediate selectors.
      }

      current = current.parentElement;
    }

    return segments.join(' > ');
  }

  /**
   * Clears the currently highlighted picker element.
   * @returns {void}
   */
  function clearHighlight() {
    highlightedElement?.removeAttribute(PICKER_HOVER_ATTRIBUTE);
    highlightedElement = null;
  }

  /**
   * Exits element-picker mode.
   * @returns {void}
   */
  function stopPicker() {
    if (!pickerActive) {
      return;
    }

    pickerActive = false;
    clearHighlight();
    document.getElementById(PICKER_STYLE_ID)?.remove();
    window.removeEventListener('mousemove', handlePickerMove, true);
    window.removeEventListener('click', handlePickerClick, true);
    window.removeEventListener('keydown', handlePickerKeydown, true);
  }

  /**
   * Handles picker hover state.
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handlePickerMove(event) {
    if (!pickerActive || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.id === PICKER_STYLE_ID || event.target.closest(`#${PICKER_STYLE_ID}`)) {
      return;
    }

    if (highlightedElement === event.target) {
      return;
    }

    clearHighlight();
    highlightedElement = event.target;
    highlightedElement.setAttribute(PICKER_HOVER_ATTRIBUTE, 'true');
  }

  /**
   * Handles picker cancellation.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function handlePickerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      stopPicker();
    }
  }

  /**
   * Handles picker element selection.
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handlePickerClick(event) {
    if (!pickerActive || !(event.target instanceof Element)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const selector = buildSelector(event.target);
    stopPicker();
    void sendMessage({
      action: 'saveRule',
      rule: `${location.hostname}##${selector}`,
    });
  }

  /**
   * Starts element-picker mode.
   * @returns {void}
   */
  function startPicker() {
    if (pickerActive) {
      return;
    }

    pickerActive = true;
    const parent = document.head || document.documentElement;
    if (parent && !document.getElementById(PICKER_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = PICKER_STYLE_ID;
      style.textContent = `
        [${PICKER_HOVER_ATTRIBUTE}] {
          outline: 2px solid #00B4D8 !important;
          outline-offset: 2px !important;
          cursor: crosshair !important;
        }
      `;
      parent.appendChild(style);
    }

    window.addEventListener('mousemove', handlePickerMove, true);
    window.addEventListener('click', handlePickerClick, true);
    window.addEventListener('keydown', handlePickerKeydown, true);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'startPicker') {
      startPicker();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.action === 'refreshPageRules') {
      void (async () => {
        await loadPageRules();
        sendResponse({ ok: true });
      })();
      return true;
    }

    return false;
  });

  void (async () => {
    await waitForVisibleStart();
    await loadPageRules();
    await notifyPageLoad();
    installHiddenMarkerObserver();
    installPerformanceObserver();
  })();
})();
