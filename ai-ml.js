// ShieldBlock AI — ML Classifier v2.4
// Uses domain-adaptive thresholds and candidate gating to reduce CPU and noise.

(function () {
  'use strict';

  if (location.hostname.includes('youtube.com')) return;

  const DOMAIN = location.hostname.toLowerCase();
  const TAGS = ['div', 'section', 'aside', 'article', 'ins', 'iframe', 'figure', 'li'];

  const state = {
    model: null,
    ready: false,
    enabled: true,
    allowlist: [],
    domainProfiles: {},
    threshold: 0.88,
    pendingBlocks: 0,
  };

  const classified = new WeakSet();
  let queue = [];
  let scanTimer = null;

  const IAB = [[300, 250], [728, 90], [320, 50], [160, 600], [300, 600], [970, 250], [336, 280], [468, 60], [320, 100]];
  const AD_CLS = ['ad', 'ads', 'advert', 'sponsored', 'promoted', 'promo', 'native-ad', 'adsbox',
    'adframe', 'adslot', 'ad-slot', 'ad-unit', 'ad-container', 'dfp', 'gpt-ad', 'outbrain',
    'taboola', 'revcontent', 'adsense', 'adwords', 'doubleclick', 'criteo'];
  const AD_ATTR = ['data-ad', 'data-ads', 'data-adunit', 'data-slot', 'data-ad-slot',
    'data-ad-client', 'data-native-ad', 'data-promoted'];
  const SPONSORED = ['sponsored', 'promoted', 'advertisement', 'paid content', 'presented by',
    'partner content', 'around the web', 'from our partners', 'paid partnership'];
  const AD_DOM = ['doubleclick', 'googlesyndication', 'adnxs', 'advertising', 'taboola',
    'outbrain', 'criteo', 'adroll', 'pubmatic', 'rubiconproject'];

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function getEffectiveThreshold() {
    const adaptiveBoost = state.domainProfiles[DOMAIN]?.adaptiveBoost || 0;
    return Math.max(0.78, state.threshold - (adaptiveBoost / 200));
  }

  function flushPendingBlocks(force = false) {
    if (!state.pendingBlocks) return;
    if (!force && state.pendingBlocks < 2) return;
    chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', category: 'ml', count: state.pendingBlocks });
    state.pendingBlocks = 0;
  }

  async function loadModel() {
    try {
      const response = await fetch(chrome.runtime.getURL('model/ad_classifier.json'));
      state.model = await response.json();
      if (typeof state.model.threshold === 'number') {
        state.threshold = state.model.threshold <= 1 ? state.model.threshold : state.model.threshold / 100;
      }
      state.ready = true;
      queue.forEach((el) => classify(el));
      queue = [];
    } catch (_) {
      state.ready = false;
    }
  }

  function predict(features) {
    let score = state.model.init;
    for (const tree of state.model.trees) {
      let node = tree;
      while ('f' in node) {
        node = features[node.f] <= node.t ? node.l : node.r;
      }
      score += state.model.lr * node.v;
    }
    return 1 / (1 + Math.exp(-score));
  }

  function extractFeatures(el) {
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const area = w * h;
    const ratio = w / Math.max(h, 1);
    const style = window.getComputedStyle(el);
    const cls = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toLowerCase();
    const text = (el.innerText || '').toLowerCase().slice(0, 300);
    const attrs = Array.from(el.attributes || []).map((attr) => attr.name.toLowerCase());
    const zIndex = parseInt(style.zIndex, 10) || 0;
    const tag = el.tagName.toLowerCase();

    const iframes = el.querySelectorAll('iframe');
    const links = el.querySelectorAll('a[href]');
    let externalLinks = 0;
    for (const link of links) {
      try {
        if (new URL(link.href).hostname !== location.hostname) externalLinks += 1;
      } catch (_) {}
    }

    let depth = 0;
    let parent = el.parentElement;
    while (parent && depth < 20) {
      depth += 1;
      parent = parent.parentElement;
    }

    return [
      w, h, area, ratio,
      IAB.some(([aw, ah]) => Math.abs(w - aw) < 8 && Math.abs(h - ah) < 8) ? 1 : 0,
      (style.position === 'fixed' || style.position === 'sticky') ? 1 : 0,
      zIndex > 100 ? 1 : 0,
      Math.min(6, AD_CLS.filter((token) => cls.includes(token) || id.includes(token)).length),
      Math.min(4, AD_ATTR.filter((attr) => attrs.some((name) => name.startsWith(attr))).length),
      SPONSORED.some((token) => text.includes(token)) ? 1 : 0,
      Array.from(iframes).some((frame) => AD_DOM.some((domain) => (frame.src || '').includes(domain))) ? 1 : 0,
      tag === 'ins' ? 1 : 0,
      externalLinks,
      el.querySelector('a[href*="adchoices"],a[href*="aboutads"]') ? 1 : 0,
      Array.from(el.querySelectorAll('script[src]')).some((script) => /adsbygoogle|taboola|outbrain/.test(script.src)) ? 1 : 0,
      parseInt(el.getAttribute('data-shieldblock-hscore') || '0', 10),
      el.children.length,
      text.length,
      depth,
    ];
  }

  function isCandidate(el) {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 2000 || area > 800000) return false;

    if (el.getAttribute('data-shieldblock-hscore')) return true;

    const cls = `${(el.className || '').toString().toLowerCase()} ${(el.id || '').toLowerCase()}`;
    if (AD_CLS.some((token) => cls.includes(token))) return true;

    if (AD_ATTR.some((attr) => el.hasAttribute(attr) || Array.from(el.attributes).some((entry) => entry.name.toLowerCase().startsWith(attr)))) return true;
    if (IAB.some(([w, h]) => Math.abs(rect.width - w) < 8 && Math.abs(rect.height - h) < 8)) return true;

    const text = (el.innerText || '').toLowerCase().slice(0, 200);
    if (SPONSORED.some((token) => text.includes(token))) return true;

    return Array.from(el.querySelectorAll('iframe')).some((frame) => AD_DOM.some((domain) => (frame.src || '').includes(domain)));
  }

  function classify(el) {
    if (!state.ready) {
      queue.push(el);
      return;
    }
    if (!state.enabled || matchesAllowlist(DOMAIN, state.allowlist)) return;
    if (classified.has(el)) return;
    if (el.getAttribute('data-shieldblock-score') || el.getAttribute('data-shieldblock-ml')) return;
    if (!isCandidate(el)) return;

    classified.add(el);
    try {
      const probability = predict(extractFeatures(el));
      if (probability >= getEffectiveThreshold()) {
        el.style.cssText += 'display:none!important;visibility:hidden!important;';
        el.setAttribute('data-shieldblock-ml', probability.toFixed(3));
        state.pendingBlocks += 1;
        flushPendingBlocks();
      }
    } catch (_) {}
  }

  function scan() {
    if (!state.ready || !state.enabled || matchesAllowlist(DOMAIN, state.allowlist)) return;
    for (const tag of TAGS) {
      document.querySelectorAll(tag).forEach(classify);
    }
  }

  function refreshState() {
    chrome.storage.local.get(['enabled', 'mlEnabled', 'mlThreshold', 'allowlist', 'domainProfiles'], (data) => {
      state.enabled = data.enabled !== false && data.mlEnabled !== false;
      state.allowlist = data.allowlist || [];
      state.domainProfiles = data.domainProfiles || {};
      state.threshold = (data.mlThreshold || 88) / 100;
    });
  }

  loadModel().then(() => {
    refreshState();
    scan();
    setInterval(scan, 3500);
  });

  new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length > 0) || !state.ready) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 600);
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (['TOGGLE_ML', 'TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED', 'CUSTOM_RULES_UPDATED'].includes(message.type)) {
      refreshState();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.mlEnabled || changes.mlThreshold || changes.allowlist || changes.domainProfiles) {
      refreshState();
    }
  });

  window.addEventListener('beforeunload', () => flushPendingBlocks(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingBlocks(true);
  });
})();
