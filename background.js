// ShieldBlock AI — Background Service Worker v2.4
// Keeps category state consistent, supports domain-scoped custom rules,
// and broadcasts live settings updates to content scripts.

const RULESET_IDS = ['ads', 'trackers', 'patterns', 'popups', 'youtube', 'malware'];
const RULESET_COUNTS = {
  ads: 12000,
  trackers: 9000,
  patterns: 8000,
  popups: 1226,
  youtube: 10,
  malware: 48,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    totalBlocked: 0,
    aiBlocked: 0,
    mlBlocked: 0,
    phishingDetected: 0,
    sessionBlocked: 0,
    adsEnabled: true,
    trackersEnabled: true,
    patternsEnabled: true,
    popupsEnabled: true,
    youtubeEnabled: true,
    malwareEnabled: true,
    aiEnabled: true,
    mlEnabled: true,
    phishingEnabled: true,
    annoyancesEnabled: true,
    aiThreshold: 72,
    mlThreshold: 88,
    customRulesByDomain: {},
    domainProfiles: {},
    lastActivities: [],
    allowlist: [],
    installDate: Date.now(),
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATS') {
    chrome.storage.local.get(null, (data) => {
      const customRulesByDomain = data.customRulesByDomain || {};
      const customRuleTotal = Object.values(customRulesByDomain)
        .reduce((sum, rules) => sum + (Array.isArray(rules) ? rules.length : 0), 0);

      sendResponse({
        ...data,
        customRulesByDomain,
        customRuleTotal,
        enabledRuleCount: getEnabledRuleCount(data),
      });
    });
    return true;
  }

  if (message.type === 'GET_ACTIVE_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ success: false });
        return;
      }

      safeSendMessage(tab.id, { type: 'GET_PAGE_SUMMARY' }, (summary) => {
        sendResponse({
          success: true,
          tab: {
            id: tab.id,
            url: tab.url || '',
            title: tab.title || '',
          },
          summary: summary || null,
        });
      });
    });
    return true;
  }

  if (message.type === 'INCREMENT_BLOCKED') {
    const { category, count = 1 } = message;
    const key = `${category}Blocked`;
    chrome.storage.local.get(['totalBlocked', 'sessionBlocked', key], (data) => {
      chrome.storage.local.set({
        totalBlocked: (data.totalBlocked || 0) + count,
        sessionBlocked: (data.sessionBlocked || 0) + count,
        [key]: (data[key] || 0) + count,
      });
    });
    return true;
  }

  if (message.type === 'PHISHING_DETECTED') {
    chrome.storage.local.get(['phishingDetected'], (data) => {
      chrome.storage.local.set({ phishingDetected: (data.phishingDetected || 0) + 1 });
    });
    recordActivity({
      kind: 'security',
      title: 'Suspicious page warning',
      detail: message.url || '',
    });
    return true;
  }

  if (message.type === 'ACTIVITY_EVENT') {
    recordActivity({
      kind: message.kind || 'info',
      title: message.title || 'ShieldBlock event',
      detail: message.detail || '',
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESET_STATS') {
    chrome.storage.local.set({
      totalBlocked: 0,
      aiBlocked: 0,
      mlBlocked: 0,
      phishingDetected: 0,
      sessionBlocked: 0,
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'TOGGLE_EXTENSION') {
    const { enabled } = message;
    chrome.storage.local.get(null, (data) => {
      chrome.storage.local.set({ enabled }, () => {
        syncRulesets({ ...data, enabled });
        broadcastToAllTabs({ type: 'TOGGLE_EXTENSION', enabled });
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'TOGGLE_CATEGORY') {
    const { category, enabled } = message;
    chrome.storage.local.get(['enabled'], (data) => {
      chrome.storage.local.set({ [`${category}Enabled`]: enabled }, () => {
        if (data.enabled !== false) {
          chrome.declarativeNetRequest.updateEnabledRulesets(
            enabled
              ? { enableRulesetIds: [category], disableRulesetIds: [] }
              : { enableRulesetIds: [], disableRulesetIds: [category] }
          );
        }

        if (category === 'youtube') {
          broadcastToAllTabs({ type: 'TOGGLE_YOUTUBE', enabled });
        }

        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'TOGGLE_AI') {
    chrome.storage.local.set({ aiEnabled: message.enabled });
    broadcastToAllTabs({ type: 'TOGGLE_AI', enabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'TOGGLE_ML') {
    chrome.storage.local.set({ mlEnabled: message.enabled });
    broadcastToAllTabs({ type: 'TOGGLE_ML', enabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'TOGGLE_PHISHING') {
    chrome.storage.local.set({ phishingEnabled: message.enabled });
    broadcastToAllTabs({ type: 'TOGGLE_PHISHING', enabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'TOGGLE_ANNOYANCES') {
    chrome.storage.local.set({ annoyancesEnabled: message.enabled });
    broadcastToAllTabs({ type: 'TOGGLE_ANNOYANCES', enabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'ACTIVATE_PICKER') {
    activeTab((tab) => safeSendMessage(tab.id, { type: 'ACTIVATE_PICKER' }));
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CLEAR_CUSTOM_RULES') {
    chrome.storage.local.set({ customRulesByDomain: {}, domainProfiles: {} }, () => {
      recordActivity({
        kind: 'learning',
        title: 'Cleared smart site rules',
        detail: 'All learned rules removed',
      });
      broadcastToAllTabs({ type: 'CUSTOM_RULES_UPDATED' });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SAVE_CUSTOM_RULE') {
    const domain = normalizeDomain(message.domain);
    const rule = typeof message.rule === 'string' ? message.rule.trim() : '';

    if (!domain || !rule) {
      sendResponse({ success: false });
      return true;
    }

    chrome.storage.local.get(['customRulesByDomain', 'domainProfiles'], (data) => {
      const customRulesByDomain = data.customRulesByDomain || {};
      const domainProfiles = data.domainProfiles || {};
      const rules = Array.isArray(customRulesByDomain[domain]) ? [...customRulesByDomain[domain]] : [];

      if (!rules.includes(rule)) {
        rules.push(rule);
      }

      customRulesByDomain[domain] = rules;
      domainProfiles[domain] = {
        missedAds: Math.min((domainProfiles[domain]?.missedAds || 0) + 1, 20),
        adaptiveBoost: Math.min((domainProfiles[domain]?.adaptiveBoost || 0) + 2, 12),
        lastUpdated: Date.now(),
      };

      chrome.storage.local.set({ customRulesByDomain, domainProfiles }, () => {
        recordActivity({
          kind: 'learning',
          title: 'Learned new site rule',
          detail: `${domain} -> ${rule}`,
        });
        broadcastToAllTabs({ type: 'CUSTOM_RULES_UPDATED' });
        sendResponse({
          success: true,
          rules,
          domainProfile: domainProfiles[domain],
        });
      });
    });
    return true;
  }

  if (message.type === 'ADD_TO_ALLOWLIST') {
    const domain = normalizeDomain(message.domain);
    if (!domain) {
      sendResponse({ success: false, allowlist: [] });
      return true;
    }

    chrome.storage.local.get(['allowlist'], (data) => {
      const list = Array.isArray(data.allowlist) ? [...data.allowlist] : [];
      if (!list.includes(domain)) {
        list.push(domain);
      }
      chrome.storage.local.set({ allowlist: list }, () => {
        recordActivity({
          kind: 'privacy',
          title: 'Added allowlist site',
          detail: domain,
        });
        broadcastToAllTabs({ type: 'ALLOWLIST_UPDATED' });
        sendResponse({ success: true, allowlist: list });
      });
    });
    return true;
  }

  if (message.type === 'REMOVE_FROM_ALLOWLIST') {
    const domain = normalizeDomain(message.domain);
    chrome.storage.local.get(['allowlist'], (data) => {
      const list = (data.allowlist || []).filter((entry) => entry !== domain);
      chrome.storage.local.set({ allowlist: list }, () => {
        recordActivity({
          kind: 'privacy',
          title: 'Removed allowlist site',
          detail: domain,
        });
        broadcastToAllTabs({ type: 'ALLOWLIST_UPDATED' });
        sendResponse({ success: true, allowlist: list });
      });
    });
    return true;
  }

  if (message.type === 'GET_ALLOWLIST') {
    chrome.storage.local.get(['allowlist'], (data) => {
      sendResponse({ allowlist: data.allowlist || [] });
    });
    return true;
  }

  if (message.type === 'UPDATE_SETTING') {
    chrome.storage.local.set({ [message.key]: message.value });
    sendResponse({ success: true });
    return true;
  }
});

function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  const hostname = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/^\.+|\.+$/g, '');
  return hostname;
}

function getEnabledRuleCount(data) {
  if (data.enabled === false) return 0;
  return RULESET_IDS.reduce((sum, id) => (
    data[`${id}Enabled`] === false ? sum : sum + RULESET_COUNTS[id]
  ), 0);
}

function getActiveRulesets(data) {
  if (data.enabled === false) return [];
  return RULESET_IDS.filter((id) => data[`${id}Enabled`] !== false);
}

function syncRulesets(data) {
  const enabledRulesets = getActiveRulesets(data);
  const disabledRulesets = RULESET_IDS.filter((id) => !enabledRulesets.includes(id));
  chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabledRulesets,
    disableRulesetIds: disabledRulesets,
  });
}

function recordActivity(entry) {
  chrome.storage.local.get(['lastActivities'], (data) => {
    const items = Array.isArray(data.lastActivities) ? [...data.lastActivities] : [];
    items.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      at: Date.now(),
      kind: entry.kind || 'info',
      title: entry.title || 'ShieldBlock event',
      detail: entry.detail || '',
    });
    chrome.storage.local.set({ lastActivities: items.slice(0, 25) });
  });
}

function broadcastToAllTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      safeSendMessage(tab.id, message);
    }
  });
}

function safeSendMessage(tabId, message, callback) {
  try {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        callback?.(null);
        return;
      }
      callback?.(response);
    });
  } catch (_) {
    callback?.(null);
  }
}

function activeTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      try {
        cb(tabs[0]);
      } catch (_) {}
    }
  });
}

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(null, (data) => {
    chrome.storage.local.set({ sessionBlocked: 0 });
    syncRulesets(data);
  });
});
