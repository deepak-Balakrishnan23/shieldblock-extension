// ShieldBlock AI — Heuristic DOM Scorer v2.4
// Domain-aware rules, adaptive thresholds, and live settings updates.

(function () {
  'use strict';

  if (location.hostname.includes('youtube.com')) return;

  const CONFIG = { scanInterval: 2500, minArea: 2000, maxArea: 800000 };
  const TAGS = ['div', 'section', 'aside', 'article', 'ins', 'iframe', 'figure', 'li'];
  const DOMAIN = location.hostname.toLowerCase();

  const state = {
    enabled: true,
    threshold: 72,
    allowlist: [],
    customRulesByDomain: {},
    domainProfiles: {},
    flushPending: 0,
  };

  const hidden = new WeakSet();

  const IAB_SIZES = [[300, 250], [728, 90], [320, 50], [160, 600], [300, 600],
    [970, 250], [970, 90], [468, 60], [336, 280], [320, 100], [300, 50], [250, 250]];

  const AD_CLASSES = ['ad', 'ads', 'advert', 'advertisement', 'advertising', 'sponsored',
    'promo', 'promoted', 'native-ad', 'nativead', 'adsbox', 'adframe', 'adslot', 'ad-slot',
    'ad-unit', 'ad-container', 'ad-wrapper', 'ad-banner', 'ad-block', 'adblock',
    'ad-placeholder', 'ad-label', 'dfp', 'gpt-ad', 'googletag', 'outbrain', 'taboola',
    'revcontent', 'mgid', 'adsense', 'adwords', 'doubleclick', 'criteo', 'teads'];

  const AD_ATTRS = ['data-ad', 'data-ads', 'data-adunit', 'data-slot', 'data-ad-slot',
    'data-ad-client', 'data-ad-format', 'data-native-ad', 'data-promoted', 'data-sponsor'];

  const SPONSORED_TEXTS = ['sponsored', 'promoted', 'advertisement', 'paid content',
    'paid post', 'presented by', 'partner content', 'brand content', 'native ad',
    'around the web', 'from our partners', 'content from sponsors', 'paid partnership'];

  const AD_DOMAINS = ['doubleclick', 'googlesyndication', 'adnxs', 'advertising',
    'taboola', 'outbrain', 'criteo', 'adroll', 'pubmatic', 'rubiconproject'];

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  }

  function getDomainRules() {
    return state.customRulesByDomain[DOMAIN] || [];
  }

  function getEffectiveThreshold() {
    const adaptiveBoost = state.domainProfiles[DOMAIN]?.adaptiveBoost || 0;
    return Math.max(58, state.threshold - adaptiveBoost);
  }

  function applyCustomRules() {
    const rules = getDomainRules();
    let styleEl = document.getElementById('shieldblock-custom-rules');

    if (!state.enabled || matchesAllowlist(DOMAIN, state.allowlist) || !rules.length) {
      styleEl?.remove();
      return;
    }

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'shieldblock-custom-rules';
      document.documentElement.appendChild(styleEl);
    }
    styleEl.textContent = `${rules.join(',\n')} { display: none !important; visibility: hidden !important; }`;
  }

  function flushPendingBlocks(force = false) {
    if (!state.flushPending) return;
    if (!force && state.flushPending < 3) return;
    chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', category: 'ai', count: state.flushPending });
    state.flushPending = 0;
  }

  function score(el) {
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const area = w * h;
    if (area < CONFIG.minArea || area > CONFIG.maxArea) return 0;

    let scoreValue = 0;
    const style = window.getComputedStyle(el);
    const cls = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toLowerCase();
    const text = (el.innerText || '').toLowerCase().slice(0, 500);
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes || []).map((attr) => attr.name.toLowerCase());
    const zIndex = parseInt(style.zIndex, 10) || 0;
    const pos = style.position;

    if (IAB_SIZES.some(([aw, ah]) => Math.abs(w - aw) < 8 && Math.abs(h - ah) < 8)) scoreValue += 30;
    scoreValue += Math.min(25, AD_CLASSES.filter((token) => cls.includes(token) || id.includes(token)).length * 5);
    scoreValue += Math.min(20, AD_ATTRS.filter((attr) => attrs.some((name) => name.startsWith(attr))).length * 10);
    if (SPONSORED_TEXTS.some((token) => text.includes(token))) scoreValue += 20;
    if (Array.from(el.querySelectorAll('iframe')).some((frame) => AD_DOMAINS.some((domain) => (frame.src || '').includes(domain)))) scoreValue += 25;
    if ((pos === 'fixed' || pos === 'sticky') && zIndex > 100) scoreValue += 15;
    if (zIndex > 9000 && area > 50000) scoreValue += 10;

    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes('advertisement') || aria === 'ad' || aria === 'ads') scoreValue += 15;
    if (tag === 'ins') scoreValue += 25;
    if (el.hasAttribute('data-google-query-id') || el.hasAttribute('data-adsbygoogle-status')) scoreValue += 20;
    if (el.querySelector('a[href*="adssettings"],a[href*="aboutads"],a[href*="adchoices"]')) scoreValue += 20;
    if (Array.from(el.querySelectorAll('script[src]')).some((script) => /adsbygoogle|taboola|outbrain/.test(script.src))) scoreValue += 15;

    if (DOMAIN.includes('facebook.com')) {
      if (Array.from(el.querySelectorAll('span')).some((span) => span.textContent.trim().toLowerCase() === 'sponsored')) scoreValue += 40;
    }
    if (DOMAIN.includes('linkedin.com')) {
      if (Array.from(el.querySelectorAll('span,li')).some((node) => node.textContent.trim().toLowerCase() === 'promoted')) scoreValue += 40;
    }
    if (DOMAIN.includes('instagram.com') || DOMAIN.includes('x.com') || DOMAIN.includes('twitter.com')) {
      if (Array.from(el.querySelectorAll('span')).some((span) => /^(sponsored|promoted)$/.test(span.textContent.trim().toLowerCase()))) scoreValue += 40;
    }

    return scoreValue;
  }

  function hide(el, scoreValue) {
    if (hidden.has(el)) return;
    hidden.add(el);
    el.setAttribute('data-shieldblock-score', scoreValue);
    el.style.cssText += 'display:none!important;visibility:hidden!important;';
    state.flushPending += 1;
    flushPendingBlocks();
  }

  function sweep() {
    if (!state.enabled || matchesAllowlist(DOMAIN, state.allowlist)) return;
    const threshold = getEffectiveThreshold();

    for (const tag of TAGS) {
      document.querySelectorAll(tag).forEach((el) => {
        if (hidden.has(el) || el.closest('[data-shieldblock-score]')) return;
        const scoreValue = score(el);
        if (scoreValue >= threshold) hide(el, scoreValue);
        else if (scoreValue > 0) el.setAttribute('data-shieldblock-hscore', scoreValue);
      });
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#161618;border:1px solid #00e5a0;color:#f0f0f2;font-family:system-ui,sans-serif;font-size:12px;padding:12px 16px;border-radius:8px;z-index:2147483647;';
    toast.textContent = message;
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function reportElement(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `${tag}#${CSS.escape(el.id)}` : null;
    const classes = Array.from(el.classList)
      .filter((token) => !/^(js-|is-|has-|active|open|visible|hidden|show)/.test(token))
      .map((token) => `.${CSS.escape(token)}`)
      .join('');
    const rule = id || (classes ? `${tag}${classes}` : null);
    if (!rule) return;

    chrome.runtime.sendMessage({ type: 'SAVE_CUSTOM_RULE', domain: DOMAIN, rule }, (response) => {
      if (response?.success) {
        state.customRulesByDomain[DOMAIN] = response.rules;
        state.domainProfiles[DOMAIN] = response.domainProfile || state.domainProfiles[DOMAIN];
        applyCustomRules();
        el.style.cssText += 'display:none!important;';
        showToast(`Rule added for ${DOMAIN}: ${rule}`);
      }
    });
  }

  function activatePicker() {
    const root = document.body || document.documentElement;
    let highlight = document.createElement('div');
    highlight.style.cssText = 'position:fixed;border:2px solid #00e5a0;background:rgba(0,229,160,0.1);pointer-events:none;z-index:2147483647;border-radius:4px;transition:all .1s;';
    root.appendChild(highlight);

    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#161618;border:1px solid #00e5a0;color:#f0f0f2;font-family:system-ui,sans-serif;font-size:13px;padding:10px 18px;border-radius:8px;z-index:2147483647;';
    toast.textContent = 'Click the missed ad. Press Esc to cancel.';
    root.appendChild(toast);

    const onMove = (event) => {
      const rect = event.target.getBoundingClientRect();
      Object.assign(highlight.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };

    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      reportElement(event.target);
      cleanup();
    };

    const onKey = (event) => {
      if (event.key === 'Escape') cleanup();
    };

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.remove();
      toast.remove();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function refreshState(callback) {
    chrome.storage.local.get(
      ['enabled', 'aiEnabled', 'aiThreshold', 'allowlist', 'customRulesByDomain', 'domainProfiles'],
      (data) => {
        state.enabled = data.enabled !== false && data.aiEnabled !== false;
        state.threshold = data.aiThreshold || 72;
        state.allowlist = data.allowlist || [];
        state.customRulesByDomain = data.customRulesByDomain || {};
        state.domainProfiles = data.domainProfiles || {};
        applyCustomRules();
        callback?.();
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      refreshState(() => {
        sweep();
        setInterval(sweep, CONFIG.scanInterval);
      });
    });
  } else {
    refreshState(() => {
      sweep();
      setInterval(sweep, CONFIG.scanInterval);
    });
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => refreshState(sweep), 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  window.addEventListener('beforeunload', () => flushPendingBlocks(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingBlocks(true);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ACTIVATE_PICKER') activatePicker();
    if (['TOGGLE_AI', 'TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED', 'CUSTOM_RULES_UPDATED'].includes(message.type)) {
      refreshState();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      changes.aiEnabled || changes.enabled || changes.aiThreshold ||
      changes.allowlist || changes.customRulesByDomain || changes.domainProfiles
    ) {
      refreshState();
    }
  });
})();
