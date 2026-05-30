'use strict';

/** Estimated average bytes saved per blocked ad/tracker/threat request. */
const AVG_BYTES_PER_BLOCK = 55 * 1024;
const POLL_INTERVAL_MS = 2000;

const elements = {
  statusText: document.getElementById('status-text'),
  masterToggle: document.getElementById('master-toggle'),
  toggleLabel: document.getElementById('toggle-label'),
  liveStatus: document.getElementById('live-status'),
  adsCount: document.getElementById('ads-count'),
  adsToday: document.getElementById('ads-today'),
  trackersCount: document.getElementById('trackers-count'),
  trackersToday: document.getElementById('trackers-today'),
  dataSaved: document.getElementById('data-saved'),
  dataSavedToday: document.getElementById('data-saved-today'),
  cosmeticCount: document.getElementById('cosmetic-count'),
  heuristicCount: document.getElementById('heuristic-count'),
  mlCount: document.getElementById('ml-count'),
  phishingCount: document.getElementById('phishing-count'),
  currentDomain: document.getElementById('current-domain'),
  pageTitle: document.getElementById('page-title'),
  pageSub: document.getElementById('page-sub'),
  allowlistButton: document.getElementById('allowlist-button'),
  refreshLists: document.getElementById('refresh-lists'),
  refreshLabel: document.getElementById('refresh-label'),
  openOptions: document.getElementById('open-options'),
};

let refreshTimer = 0;
let currentStats = {
  enabled: true,
  currentDomain: '',
  isCurrentSiteAllowlisted: false,
};

const numberFormatter = new Intl.NumberFormat();

/**
 * Formats an integer with locale-aware grouping.
 * @param {unknown} value
 * @returns {string}
 */
function formatCount(value) {
  return numberFormatter.format(Number(value) || 0);
}

/**
 * Formats a byte count as a human-readable data size.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  const safe = Number(bytes) || 0;
  if (safe < 1024) return `${safe} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * Returns the active tab id, or 0 when unavailable.
 * @returns {Promise<number>}
 */
async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? 0;
}

/**
 * Sets the loading state of the filter-refresh button.
 * @param {boolean} loading
 * @returns {void}
 */
function setRefreshLoading(loading) {
  if (!elements.refreshLists) return;
  elements.refreshLists.disabled = loading;
  if (elements.refreshLabel) {
    elements.refreshLabel.textContent = loading ? 'Updating…' : 'Update filters';
  }
}

/**
 * Renders the supplied stats payload into the popup.
 * @param {Record<string, unknown>} stats
 * @returns {void}
 */
function renderStats(stats) {
  currentStats = { ...currentStats, ...stats };

  const enabled = stats.enabled !== false;
  const currentDomain = String(stats.currentDomain || '');
  const allowlisted = stats.isCurrentSiteAllowlisted === true;

  // Hero status + toggle
  if (elements.statusText) {
    elements.statusText.textContent = enabled ? 'Enabled' : 'Disabled';
    elements.statusText.dataset.on = String(enabled);
  }
  if (elements.masterToggle) elements.masterToggle.setAttribute('aria-pressed', String(enabled));
  if (elements.toggleLabel) elements.toggleLabel.textContent = enabled ? 'Enabled' : 'Disabled';
  if (elements.liveStatus) elements.liveStatus.textContent = enabled ? 'Protection enabled.' : 'Protection paused.';

  // Primary stats
  const ads = Number(stats.blockedCount) || 0;
  const trackers = Number(stats.trackerCount) || 0;
  const threats = Number(stats.phishingCount) || 0;
  const todayAds = Number(stats.todayAds) || 0;
  const todayTrackers = Number(stats.todayTrackers) || 0;
  const todayThreats = Number(stats.todayPhishing) || 0;

  if (elements.adsCount) elements.adsCount.textContent = formatCount(ads);
  if (elements.adsToday) elements.adsToday.textContent = `+${formatCount(todayAds)} today`;
  if (elements.trackersCount) elements.trackersCount.textContent = formatCount(trackers);
  if (elements.trackersToday) elements.trackersToday.textContent = `+${formatCount(todayTrackers)} today`;

  const totalBlocked = ads + trackers + threats;
  const totalToday = todayAds + todayTrackers + todayThreats;
  if (elements.dataSaved) elements.dataSaved.textContent = formatBytes(totalBlocked * AVG_BYTES_PER_BLOCK);
  if (elements.dataSavedToday) elements.dataSavedToday.textContent = `+${formatBytes(totalToday * AVG_BYTES_PER_BLOCK)} today`;

  // Secondary breakdown
  if (elements.cosmeticCount) elements.cosmeticCount.textContent = formatCount(stats.cosmeticCount);
  if (elements.heuristicCount) elements.heuristicCount.textContent = formatCount(stats.heuristicCount);
  if (elements.mlCount) elements.mlCount.textContent = formatCount(stats.mlCount);
  if (elements.phishingCount) elements.phishingCount.textContent = formatCount(threats);

  // Current page / allowlist row
  if (elements.currentDomain) elements.currentDomain.textContent = currentDomain || 'this site';
  if (elements.allowlistButton) {
    elements.allowlistButton.disabled = !currentDomain;
    elements.allowlistButton.dataset.allowlisted = String(allowlisted);
    elements.allowlistButton.setAttribute(
      'aria-label',
      allowlisted ? `Resume protection on ${currentDomain}` : `Pause protection on ${currentDomain}`,
    );
  }
  if (elements.pageTitle) {
    elements.pageTitle.textContent = !currentDomain
      ? 'No active site'
      : allowlisted ? 'This page is allowed' : 'This page is protected';
  }
  if (elements.pageSub) {
    if (!currentDomain) {
      elements.pageSub.textContent = 'Open a website to manage protection';
    } else {
      elements.pageSub.innerHTML = allowlisted
        ? `Protection paused on <strong></strong>`
        : `Blocking ads and trackers on <strong></strong>`;
      const strong = elements.pageSub.querySelector('strong');
      if (strong) strong.textContent = currentDomain;
    }
  }
}

/**
 * Loads stats from the service worker.
 * @returns {Promise<void>}
 */
async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'getStats' });
    renderStats(stats ?? {});
  } catch {
    renderStats({ enabled: false, currentDomain: '' });
    if (elements.statusText) elements.statusText.textContent = 'Unavailable';
  }
}

/**
 * Toggles master protection on/off.
 * @returns {Promise<void>}
 */
async function handleToggle() {
  const next = elements.masterToggle?.getAttribute('aria-pressed') !== 'true';
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'toggle', enabled: next });
    renderStats(stats ?? {});
  } catch {
    await loadStats();
  }
}

/**
 * Refreshes the filter lists.
 * @returns {Promise<void>}
 */
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

/**
 * Adds or removes the current site from the allowlist.
 * @returns {Promise<void>}
 */
async function handleAllowlistToggle() {
  if (!currentStats.currentDomain) return;
  const action = currentStats.isCurrentSiteAllowlisted ? 'removeAllowlistDomain' : 'allowlistDomain';
  try {
    const stats = await chrome.runtime.sendMessage({ action, domain: currentStats.currentDomain });
    renderStats(stats ?? {});
    const tabId = await getActiveTabId();
    if (tabId) await chrome.tabs.reload(tabId);
  } catch {
    await loadStats();
  }
}

elements.masterToggle?.addEventListener('click', () => { void handleToggle(); });
elements.refreshLists?.addEventListener('click', () => { void handleRefreshLists(); });
elements.allowlistButton?.addEventListener('click', () => { void handleAllowlistToggle(); });
elements.openOptions?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });

window.addEventListener('unload', () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

void loadStats();
refreshTimer = window.setInterval(() => { void loadStats(); }, POLL_INTERVAL_MS);
