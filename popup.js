const elements = {
  statusBadge: document.getElementById('status-badge'),
  statusText: document.getElementById('status-text'),
  toggleCopy: document.getElementById('toggle-copy'),
  masterToggle: document.getElementById('master-toggle'),
  adsCount: document.getElementById('ads-count'),
  trackersCount: document.getElementById('trackers-count'),
  cosmeticCount: document.getElementById('cosmetic-count'),
  heuristicCount: document.getElementById('heuristic-count'),
  mlCount: document.getElementById('ml-count'),
  phishingCount: document.getElementById('phishing-count'),
  refreshLists: document.getElementById('refresh-lists'),
  currentDomain: document.getElementById('current-domain'),
  allowlistButton: document.getElementById('allowlist-button'),
  openOptions: document.getElementById('open-options'),
};

let refreshTimer = 0;
let currentStats = {
  enabled: true,
  currentDomain: '',
  isCurrentSiteAllowlisted: false,
};

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? 0;
}

function setRefreshLoading(loading) {
  if (!elements.refreshLists) return;
  elements.refreshLists.disabled = loading;
  elements.refreshLists.textContent = loading ? '…' : '↻';
}

function renderStats(stats) {
  currentStats = { ...currentStats, ...stats };

  const enabled = stats.enabled !== false;
  const currentDomain = stats.currentDomain || '';
  const allowlisted = stats.isCurrentSiteAllowlisted === true;

  if (elements.statusBadge) elements.statusBadge.dataset.on = String(enabled);
  if (elements.statusText) elements.statusText.textContent = enabled ? 'Enabled' : 'Disabled';
  if (elements.masterToggle) elements.masterToggle.checked = enabled;
  if (elements.toggleCopy) {
    elements.toggleCopy.textContent = enabled
      ? 'All protection layers are active.'
      : 'ShieldBlock AI is paused.';
  }

  if (elements.adsCount) elements.adsCount.textContent = formatCount(stats.blockedCount);
  if (elements.trackersCount) elements.trackersCount.textContent = formatCount(stats.trackerCount);
  if (elements.cosmeticCount) elements.cosmeticCount.textContent = formatCount(stats.cosmeticCount);
  if (elements.heuristicCount) elements.heuristicCount.textContent = formatCount(stats.heuristicCount);
  if (elements.mlCount) elements.mlCount.textContent = formatCount(stats.mlCount);
  if (elements.phishingCount) elements.phishingCount.textContent = formatCount(stats.phishingCount);

  if (elements.currentDomain) elements.currentDomain.textContent = currentDomain || 'No active site';
  if (elements.allowlistButton) {
    elements.allowlistButton.disabled = !currentDomain;
    elements.allowlistButton.textContent = allowlisted ? 'Remove' : 'Allowlist';
    elements.allowlistButton.dataset.mode = allowlisted ? 'remove' : 'allow';
  }
}

async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'getStats' });
    renderStats(stats ?? {});
  } catch {
    renderStats({
      enabled: false,
      currentDomain: '',
      blockedCount: 0,
      trackerCount: 0,
      cosmeticCount: 0,
      heuristicCount: 0,
      mlCount: 0,
      phishingCount: 0,
      isCurrentSiteAllowlisted: false,
    });
    if (elements.statusText) elements.statusText.textContent = 'Unavailable';
    if (elements.toggleCopy) elements.toggleCopy.textContent = 'Unable to reach service worker.';
  }
}

async function handleToggleChange() {
  if (!elements.masterToggle) return;
  try {
    const stats = await chrome.runtime.sendMessage({
      action: 'toggle',
      enabled: elements.masterToggle.checked,
    });
    renderStats(stats ?? {});
  } catch {
    elements.masterToggle.checked = !elements.masterToggle.checked;
    await loadStats();
  }
}

async function handleRefreshLists() {
  setRefreshLoading(true);
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'refreshLists' });
    renderStats(stats ?? {});
  } catch {
    await loadStats();
  } finally {
    setRefreshLoading(false);
  }
}

async function handleAllowlistToggle() {
  if (!currentStats.currentDomain) return;
  const action = currentStats.isCurrentSiteAllowlisted
    ? 'removeAllowlistDomain'
    : 'allowlistDomain';
  try {
    const stats = await chrome.runtime.sendMessage({ action, domain: currentStats.currentDomain });
    renderStats(stats ?? {});
    const tabId = await getActiveTabId();
    if (tabId) await chrome.tabs.reload(tabId);
  } catch {
    await loadStats();
  }
}

function startPolling() {
  refreshTimer = window.setInterval(() => { void loadStats(); }, 2000);
}

// Attach listeners only if elements exist
if (elements.masterToggle) {
  elements.masterToggle.addEventListener('change', () => { void handleToggleChange(); });
}
if (elements.refreshLists) {
  elements.refreshLists.addEventListener('click', () => { void handleRefreshLists(); });
}
if (elements.allowlistButton) {
  elements.allowlistButton.addEventListener('click', () => { void handleAllowlistToggle(); });
}
if (elements.openOptions) {
  elements.openOptions.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
}

window.addEventListener('unload', () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

void loadStats();
startPolling();
