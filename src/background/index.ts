import { ext } from '../shared/browser';
import {
  ActivityEvent,
  DEFAULT_SETTINGS,
  RemoteRuleManifest,
  RULESET_COUNTS,
  RULESET_IDS,
  RulesetId,
} from '../shared/constants';
import { getSettings, setSettings } from '../shared/storage';
import { normalizeDomain, sha256Hex } from '../shared/utils';

const UPDATE_ALARM = 'shieldblock-rule-refresh';
const FALLBACK_UPDATE_PATH = 'updates/fallback-update.json';

function getEnabledRuleCount(data: Record<string, unknown>): number {
  if (data.enabled === false) return 0;
  return RULESET_IDS.reduce((sum, rulesetId) => {
    return data[`${rulesetId}Enabled`] === false ? sum : sum + RULESET_COUNTS[rulesetId];
  }, 0);
}

async function recordActivity(partial: Omit<ActivityEvent, 'timestamp'>): Promise<void> {
  const settings = await getSettings(['lastActivities']);
  const lastActivities = settings.lastActivities ?? [];
  lastActivities.unshift({ ...partial, timestamp: Date.now() });
  await setSettings({ lastActivities: lastActivities.slice(0, 20) });
}

function safeSendMessage(tabId: number, message: unknown): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    ext.tabs.sendMessage(tabId, message, (response: unknown) => {
      const lastError = ext.runtime.lastError;
      if (lastError) {
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

async function broadcast(message: unknown): Promise<void> {
  const tabs = await ext.tabs.query({});
  await Promise.all(tabs.filter((tab: any) => typeof tab.id === 'number').map((tab: any) => safeSendMessage(tab.id!, message)));
}

async function syncRulesets(state: Record<string, unknown>): Promise<void> {
  if (!ext.declarativeNetRequest?.updateEnabledRulesets) return;

  const enableRulesetIds = state.enabled === false
    ? []
    : RULESET_IDS.filter((rulesetId) => state[`${rulesetId}Enabled`] !== false);
  const disableRulesetIds = RULESET_IDS.filter((id) => !enableRulesetIds.includes(id));

  await ext.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}

async function readFallbackUpdateManifest(): Promise<RemoteRuleManifest | null> {
  try {
    const response = await fetch(ext.runtime.getURL(FALLBACK_UPDATE_PATH));
    if (!response.ok) return null;
    return await response.json() as RemoteRuleManifest;
  } catch {
    return null;
  }
}

async function validateUpdateManifest(manifest: RemoteRuleManifest): Promise<boolean> {
  const payload = JSON.stringify(manifest.payload);
  const digest = await sha256Hex(payload);
  return digest === manifest.integrity.sha256;
}

async function applyDynamicRules(manifest: RemoteRuleManifest): Promise<boolean> {
  if (!ext.declarativeNetRequest?.updateDynamicRules) return false;
  const existing = await ext.declarativeNetRequest.getDynamicRules();
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule: any) => rule.id),
    addRules: manifest.payload.dynamicRules,
  });
  await setSettings({
    lastAppliedUpdate: manifest.version,
    lastUpdateCheck: Date.now(),
  });
  return true;
}

async function refreshRemoteUpdates(): Promise<void> {
  const settings = await getSettings(['remoteUpdateUrl', 'debugMode']);
  let manifest: RemoteRuleManifest | null = null;

  if (settings.remoteUpdateUrl) {
    try {
      const response = await fetch(settings.remoteUpdateUrl, { cache: 'no-store' });
      if (response.ok) {
        manifest = await response.json() as RemoteRuleManifest;
      }
    } catch {
      manifest = null;
    }
  }

  if (!manifest) {
    manifest = await readFallbackUpdateManifest();
  }
  if (!manifest) return;

  if (!(await validateUpdateManifest(manifest))) {
    await recordActivity({
      kind: 'security',
      title: 'Rule update rejected',
      detail: 'Integrity check failed',
    });
    return;
  }

  const applied = await applyDynamicRules(manifest);
  if (applied) {
    await recordActivity({
      kind: 'info',
      title: 'Rule update applied',
      detail: `Version ${manifest.version}`,
    });
  }
}

async function activeTabSummary(): Promise<{ success: boolean; tab?: any; summary?: unknown }> {
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return { success: false };
  const summary = await safeSendMessage(tab.id, { type: 'GET_PAGE_SUMMARY' });
  return { success: true, tab, summary };
}

ext.runtime.onInstalled.addListener(async () => {
  const current = await ext.storage.local.get(null);
  await ext.storage.local.set({ ...DEFAULT_SETTINGS, ...current, installDate: current.installDate ?? Date.now() });
  await syncRulesets({ ...DEFAULT_SETTINGS, ...current });
  if (ext.alarms) {
    ext.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
  }
});

if (ext.alarms) {
  ext.alarms.onAlarm.addListener((alarm: any) => {
    if (alarm.name === UPDATE_ALARM) {
      void refreshRemoteUpdates();
    }
  });
}

ext.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: unknown) => void) => {
  void (async () => {
    switch (message.type) {
      case 'GET_STATS': {
        const state = await getSettings();
        sendResponse({
          ...state,
          enabledRuleCount: getEnabledRuleCount(state as Record<string, unknown>),
        });
        return;
      }
      case 'GET_ACTIVE_TAB_INFO': {
        sendResponse(await activeTabSummary());
        return;
      }
      case 'INCREMENT_BLOCKED': {
        const category = `${message.category ?? 'ads'}Blocked`;
        const state = await getSettings(['totalBlocked', 'sessionBlocked', 'adsBlocked', 'trackersBlocked', 'smartBlocked']);
        await setSettings({
          totalBlocked: (state.totalBlocked ?? 0) + (message.count ?? 1),
          sessionBlocked: (state.sessionBlocked ?? 0) + (message.count ?? 1),
          [category]: ((state as Record<string, number>)[category] ?? 0) + (message.count ?? 1),
        });
        sendResponse({ success: true });
        return;
      }
      case 'ACTIVITY_EVENT': {
        await recordActivity({
          kind: message.kind ?? 'info',
          title: message.title ?? 'ShieldBlock event',
          detail: message.detail ?? '',
        });
        sendResponse({ success: true });
        return;
      }
      case 'TOGGLE_EXTENSION': {
        const state = await getSettings();
        const next = { ...state, enabled: message.enabled !== false };
        await setSettings({ enabled: next.enabled });
        await syncRulesets(next as Record<string, unknown>);
        await broadcast({ type: 'TOGGLE_EXTENSION', enabled: next.enabled });
        sendResponse({ success: true });
        return;
      }
      case 'TOGGLE_CATEGORY': {
        const category = message.category as RulesetId;
        await setSettings({ [`${category}Enabled`]: message.enabled !== false } as Record<string, unknown>);
        const state = await getSettings();
        await syncRulesets(state as Record<string, unknown>);
        if (category === 'youtube') {
          await broadcast({ type: 'TOGGLE_YOUTUBE', enabled: message.enabled !== false });
        }
        sendResponse({ success: true });
        return;
      }
      case 'TOGGLE_ANNOYANCES': {
        await setSettings({ annoyancesEnabled: message.enabled !== false });
        await broadcast({ type: 'TOGGLE_ANNOYANCES', enabled: message.enabled !== false });
        sendResponse({ success: true });
        return;
      }
      case 'RESET_STATS': {
        await setSettings({
          totalBlocked: 0,
          adsBlocked: 0,
          trackersBlocked: 0,
          smartBlocked: 0,
          phishingDetected: 0,
          sessionBlocked: 0,
        });
        sendResponse({ success: true });
        return;
      }
      case 'ADD_TO_ALLOWLIST': {
        const domain = normalizeDomain(message.domain ?? '');
        const state = await getSettings(['allowlist']);
        const allowlist = new Set(state.allowlist ?? []);
        if (domain) allowlist.add(domain);
        await setSettings({ allowlist: [...allowlist] });
        await broadcast({ type: 'ALLOWLIST_UPDATED' });
        sendResponse({ success: true });
        return;
      }
      case 'REMOVE_FROM_ALLOWLIST': {
        const domain = normalizeDomain(message.domain ?? '');
        const state = await getSettings(['allowlist']);
        await setSettings({ allowlist: (state.allowlist ?? []).filter((item) => item !== domain) });
        await broadcast({ type: 'ALLOWLIST_UPDATED' });
        sendResponse({ success: true });
        return;
      }
      case 'SAVE_CUSTOM_RULE': {
        const domain = normalizeDomain(message.domain ?? '');
        const rule = String(message.rule ?? '').trim();
        if (!domain || !rule) {
          sendResponse({ success: false });
          return;
        }
        const state = await getSettings(['customRulesByDomain']);
        const next = { ...(state.customRulesByDomain ?? {}) };
        const rules = new Set(next[domain] ?? []);
        rules.add(rule);
        next[domain] = [...rules];
        await setSettings({ customRulesByDomain: next });
        await recordActivity({
          kind: 'learning',
          title: 'Learned site rule',
          detail: `${domain} -> ${rule}`,
        });
        await broadcast({ type: 'CUSTOM_RULES_UPDATED' });
        sendResponse({ success: true, customRulesByDomain: next });
        return;
      }
      case 'CLEAR_CUSTOM_RULES': {
        await setSettings({ customRulesByDomain: {} });
        sendResponse({ success: true });
        return;
      }
      case 'ACTIVATE_PICKER': {
        const tabs = await ext.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.id) await safeSendMessage(tab.id, { type: 'ACTIVATE_PICKER' });
        sendResponse({ success: true });
        return;
      }
      case 'RUN_RULE_UPDATE': {
        await refreshRemoteUpdates();
        sendResponse({ success: true });
        return;
      }
      default: {
        sendResponse({ success: false, error: 'Unsupported message' });
      }
    }
  })().catch(async (error: unknown) => {
    await recordActivity({
      kind: 'security',
      title: 'Background error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  });

  return true;
});
