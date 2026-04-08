// ShieldBlock AI — Phishing & Malware URL Scorer v2.4
// Safer trust matching, live toggles, and quieter hover behavior.

(function () {
  'use strict';

  const state = {
    enabled: true,
    allowlist: [],
  };

  const RISKY_TLDS = [
    '.xyz', '.top', '.click', '.link', '.work', '.party', '.loan',
    '.gq', '.ml', '.cf', '.ga', '.tk', '.pw', '.download', '.racing',
    '.win', '.bid', '.stream', '.review', '.cricket', '.science',
  ];

  const BRAND_LOOKALIKES = [
    'paypa1', 'pay-pal', 'paypall', 'pyapal',
    'g00gle', 'go0gle', 'g0ogle', 'googl3',
    'arnazon', 'amaz0n', 'amazzon', 'amazon-',
    'app1e', 'appl3', 'apple-',
    'faceb00k', 'facebok', 'face-book',
    'micros0ft', 'micr0soft', 'microsoft-',
    'netfl1x', 'netf1ix', 'netfliix',
    'bankofamerica-', 'bankofamerica.',
    'chase-', 'citi-', 'wellsfargo-',
  ];

  const TRUSTED_DOMAINS = ['google.com', 'youtube.com', 'facebook.com', 'amazon.com',
    'microsoft.com', 'apple.com', 'github.com', 'twitter.com', 'x.com'];

  let hoverTooltip = null;

  function matchesBoundary(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function matchesAllowlist(hostname, allowlist) {
    return (allowlist || []).some((entry) => matchesBoundary(hostname, entry));
  }

  function canRun() {
    return state.enabled && !matchesAllowlist(location.hostname, state.allowlist);
  }

  function scoreURL(url) {
    let score = 0;
    const signals = [];

    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return { score: 0, signals: [] };
    }

    const hostname = parsed.hostname.toLowerCase();
    const fullUrl = url.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const params = parsed.search.toLowerCase();

    for (const tld of RISKY_TLDS) {
      if (hostname.endsWith(tld)) {
        score += 20;
        signals.push(`risky-tld:${tld}`);
        break;
      }
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      score += 40;
      signals.push('ip-as-hostname');
    }

    const subdomainCount = hostname.split('.').length - 2;
    if (subdomainCount > 3) {
      score += 15;
      signals.push(`excessive-subdomains:${subdomainCount}`);
    }

    for (const fake of BRAND_LOOKALIKES) {
      if (hostname.includes(fake)) {
        score += 50;
        signals.push(`brand-lookalike:${fake}`);
        break;
      }
    }

    const encodedMatches = (path.match(/%[0-9a-f]{2}/g) || []).length;
    if (encodedMatches > 5) {
      score += 15;
      signals.push(`url-encoded:${encodedMatches}`);
    }

    const suspiciousKeywords = [
      'login', 'verify', 'secure', 'update', 'confirm', 'account',
      'banking', 'wallet', 'password', 'credential', 'signin', 'auth',
      'suspended', 'unlock', 'validation', 'recover', 'restore',
    ];

    let keywordScore = 0;
    for (const keyword of suspiciousKeywords) {
      if (fullUrl.includes(keyword)) {
        keywordScore += 10;
        signals.push(`keyword:${keyword}`);
        if (keywordScore >= 30) break;
      }
    }
    score += keywordScore;

    if (url.length > 200) {
      score += 10;
      signals.push(`long-url:${url.length}`);
    }

    if (parsed.protocol === 'http:' && fullUrl.includes('login')) {
      score += 20;
      signals.push('http-login');
    }

    if (params.includes('redirect=') || params.includes('url=') || params.includes('goto=')) {
      score += 15;
      signals.push('redirect-param');
    }

    const homoglyphs = /[а-яА-Я\u0430\u043E\u0440\u0441\u0435\u0445\u0443]/;
    if (homoglyphs.test(hostname)) {
      score += 40;
      signals.push('homoglyph-chars');
    }

    const hyphenCount = (hostname.match(/-/g) || []).length;
    if (hyphenCount > 3) {
      score += 10;
      signals.push(`hyphens:${hyphenCount}`);
    }

    if (/\d{5,}/.test(hostname)) {
      score += 8;
      signals.push('long-numeric-sequence');
    }

    return { score, signals };
  }

  function removeTooltip() {
    hoverTooltip?.remove();
    hoverTooltip = null;
  }

  function createTooltip(text, x, y) {
    removeTooltip();
    hoverTooltip = document.createElement('div');
    hoverTooltip.style.cssText = `
      position:fixed;left:${x}px;top:${y - 36}px;z-index:2147483647;
      background:#1a0a0e;border:1px solid #ff4d6d;color:#ff4d6d;
      font-family:system-ui,sans-serif;font-size:11px;padding:4px 10px;
      border-radius:6px;pointer-events:none;max-width:320px;white-space:nowrap;
      box-shadow:0 2px 10px rgba(0,0,0,0.4);
    `;
    hoverTooltip.textContent = text;
    (document.body || document.documentElement).appendChild(hoverTooltip);
  }

  function showPhishingWarning(url, score, signals) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      for (const trusted of TRUSTED_DOMAINS) {
        if (matchesBoundary(hostname, trusted)) return;
      }
    } catch (_) {
      return;
    }

    const mount = document.body || document.documentElement;
    if (!mount) return;

    const existing = document.getElementById('shieldblock-phishing-warning');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'shieldblock-phishing-warning';
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:2147483647;
      background:#1a0a0e;border-bottom:2px solid #ff4d6d;
      padding:12px 20px;display:flex;align-items:center;gap:12px;
      font-family:system-ui,sans-serif;font-size:13px;color:#f0f0f2;
      box-shadow:0 4px 20px rgba(255,77,109,0.3);
    `;

    banner.innerHTML = `
      <span style="font-size:18px">!</span>
      <div style="flex:1">
        <strong style="color:#ff4d6d">ShieldBlock AI: Suspicious page detected</strong>
        <div style="font-size:11px;color:#9999aa;margin-top:2px">
          Risk score: ${score}/100 | Signals: ${signals.slice(0, 3).join(', ')}
        </div>
      </div>
      <button id="sb-dismiss-warning" style="
        background:rgba(255,77,109,0.15);border:1px solid #ff4d6d;color:#ff4d6d;
        padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;
      ">Dismiss</button>
      <button id="sb-go-back" style="
        background:#ff4d6d;border:none;color:white;
        padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;
      ">Go Back</button>
    `;

    mount.prepend(banner);
    document.getElementById('sb-dismiss-warning')?.addEventListener('click', () => banner.remove());
    document.getElementById('sb-go-back')?.addEventListener('click', () => history.back());
  }

  function scanCurrentPage() {
    if (!canRun()) return;
    const { score, signals } = scoreURL(location.href);
    if (score >= 60) {
      showPhishingWarning(location.href, score, signals);
      chrome.runtime.sendMessage({ type: 'PHISHING_DETECTED', url: location.href, score });
    }
  }

  function refreshState(callback) {
    chrome.storage.local.get(['enabled', 'phishingEnabled', 'allowlist'], (data) => {
      state.enabled = data.enabled !== false && data.phishingEnabled !== false;
      state.allowlist = data.allowlist || [];
      if (!state.enabled) {
        document.getElementById('shieldblock-phishing-warning')?.remove();
        removeTooltip();
      }
      callback?.();
    });
  }

  document.addEventListener('mouseover', (event) => {
    if (!canRun()) return;
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = link.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

    const { score, signals } = scoreURL(href);
    if (score >= 55) {
      createTooltip(`Risky link (${score}) | ${signals[0] || 'suspicious pattern'}`, event.clientX, event.clientY);
    }
  }, { passive: true });

  document.addEventListener('mouseout', (event) => {
    if (event.target.closest('a[href]')) removeTooltip();
  }, { passive: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (['TOGGLE_PHISHING', 'TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED'].includes(message.type)) {
      refreshState(scanCurrentPage);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled || changes.phishingEnabled || changes.allowlist) {
      refreshState(scanCurrentPage);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => refreshState(scanCurrentPage));
  } else {
    refreshState(scanCurrentPage);
  }
})();
