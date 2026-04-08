import { ext, runtimeUrl } from '../shared/browser';
import { AppState, PopupSnapshot } from '../shared/constants';
import { buildDynamicRules } from '../shared/dnr';
import { createEntry, evaluateUrl } from '../shared/matcher';
import { getState, setState } from '../shared/storage';
import { isExpired, normalizeHostname, safeUrl, todayKey } from '../shared/utils';

const redirectingTabs = new Set<number>();
const SCHEDULE_ALARM = 'shieldblock-schedule-sync';
const CLEANUP_ALARM = 'shieldblock-cleanup';

function pruneTemporaryUnlocks(state: AppState): AppState {
  const nextUnlocks = Object.fromEntries(
    Object.entries(state.temporaryUnlocks).filter(([, expiresAt]) => !isExpired(expiresAt))
  );
  return Object.keys(nextUnlocks).length === Object.keys(state.temporaryUnlocks).length
    ? state
    : { ...state, temporaryUnlocks: nextUnlocks };
}

async function syncDynamicRules(state: AppState): Promise<void> {
  if (!ext.declarativeNetRequest?.updateDynamicRules) return;

  const existing = await ext.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule: chrome.declarativeNetRequest.Rule) => rule.id);
  const addRules = buildDynamicRules(state);

  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}

async function initializeState(): Promise<AppState> {
  const state = pruneTemporaryUnlocks(await getState());
  const next = {
    ...state,
    blockEntries: [...state.blockEntries].sort((left, right) => left.createdAt - right.createdAt),
  };
  await setState(next);
  await syncDynamicRules(next);
  return next;
}

async function resetDailyStatsIfNeeded(state: AppState): Promise<AppState> {
  const cleaned = pruneTemporaryUnlocks(state);
  const key = todayKey();
  if (cleaned.stats.lastResetDay === key) return cleaned;

  const next: AppState = {
    ...cleaned,
    stats: {
      ...cleaned.stats,
      blockedToday: 0,
      lastResetDay: key,
    },
  };
  await setState({ stats: next.stats, temporaryUnlocks: next.temporaryUnlocks });
  return next;
}

async function incrementBlockedCount(): Promise<void> {
  const state = await resetDailyStatsIfNeeded(await getState());
  await setState({
    stats: {
      ...state.stats,
      totalBlocked: state.stats.totalBlocked + 1,
      blockedToday: state.stats.blockedToday + 1,
      lastBlockedAt: Date.now(),
    },
  });
}

async function enforceTab(tabId: number, url?: string): Promise<void> {
  if (!url || redirectingTabs.has(tabId) || url.startsWith(runtimeUrl(''))) {
    return;
  }

  const state = await resetDailyStatsIfNeeded(await getState());
  const evaluation = evaluateUrl(state, url);
  if (!evaluation.blocked || !state.strictMode) return;

  redirectingTabs.add(tabId);
  await incrementBlockedCount();
  const parsed = safeUrl(url);
  const reason = evaluation.match.displayValue ?? evaluation.match.reason ?? 'active-rule';
  await ext.tabs.update(tabId, {
    url: `${runtimeUrl('blocked.html')}?fromTab=1&url=${encodeURIComponent(url)}&host=${encodeURIComponent(parsed?.hostname ?? '')}&reason=${encodeURIComponent(reason)}`,
  });
  setTimeout(() => {
    redirectingTabs.delete(tabId);
  }, 1000);
}

async function getActiveTabSnapshot(): Promise<PopupSnapshot['activeTab']> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const url = typeof tab?.url === 'string' ? tab.url : '';
  const state = await resetDailyStatsIfNeeded(await getState());
  const parsed = safeUrl(url);
  const evaluation = url ? evaluateUrl(state, url) : { blocked: false, allowlisted: false, match: { matched: false } };

  return {
    id: tab?.id,
    url,
    hostname: parsed?.hostname ?? '',
    blocked: evaluation.blocked,
    match: evaluation.match,
    allowlisted: evaluation.allowlisted,
  };
}

async function getPopupSnapshot(): Promise<PopupSnapshot> {
  const state = await resetDailyStatsIfNeeded(await getState());
  return {
    state,
    activeTab: await getActiveTabSnapshot(),
  };
}

async function broadcastState(): Promise<void> {
  const tabs = await ext.tabs.query({}) as chrome.tabs.Tab[];
  await Promise.all(
    tabs
      .filter((tab: chrome.tabs.Tab) => typeof tab.id === 'number')
      .map((tab: chrome.tabs.Tab) => ext.tabs.sendMessage(tab.id!, { type: 'STATE_UPDATED' }).catch(() => undefined))
  );
}

async function saveAndSync(nextState: Partial<AppState>): Promise<void> {
  await setState(nextState);
  const state = pruneTemporaryUnlocks(await getState());
  await syncDynamicRules(state);
  await setState({ temporaryUnlocks: state.temporaryUnlocks });
  await broadcastState();
}

ext.runtime.onInstalled.addListener(() => {
  void initializeState();
  ext.alarms?.create(SCHEDULE_ALARM, { periodInMinutes: 1 });
  ext.alarms?.create(CLEANUP_ALARM, { periodInMinutes: 5 });
});

ext.runtime.onStartup?.addListener(() => {
  void initializeState();
  ext.alarms?.create(SCHEDULE_ALARM, { periodInMinutes: 1 });
  ext.alarms?.create(CLEANUP_ALARM, { periodInMinutes: 5 });
});

ext.alarms?.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === SCHEDULE_ALARM || alarm.name === CLEANUP_ALARM) {
    void getState().then(pruneTemporaryUnlocks).then(async (state) => {
      await setState({ temporaryUnlocks: state.temporaryUnlocks });
      await syncDynamicRules(state);
    });
  }
});

ext.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  const url = changeInfo.url ?? tab.url;
  if (!url) return;
  void enforceTab(tabId, url);
});

ext.runtime.onMessage.addListener((
  message: { type: string; [key: string]: unknown },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => {
  void (async () => {
    const state = await resetDailyStatsIfNeeded(await getState());

    switch (message.type) {
      case 'GET_POPUP_SNAPSHOT':
        sendResponse(await getPopupSnapshot());
        return;

      case 'GET_STATE':
        sendResponse(state);
        return;

      case 'UPSERT_BLOCK_ENTRY': {
        const entry = createEntry(String(message.input ?? ''));
        if (!entry) {
          sendResponse({ ok: false, error: 'Enter a valid hostname, URL, keyword, or /regex/.' });
          return;
        }

        const exists = state.blockEntries.some(
          (item) => item.type === entry.type && item.value.toLowerCase() === entry.value.toLowerCase()
        );
        if (exists) {
          sendResponse({ ok: false, error: 'That rule already exists.' });
          return;
        }

        await saveAndSync({ blockEntries: [...state.blockEntries, entry] });
        sendResponse({ ok: true });
        return;
      }

      case 'DELETE_BLOCK_ENTRY':
        await saveAndSync({ blockEntries: state.blockEntries.filter((entry) => entry.id !== message.id) });
        sendResponse({ ok: true });
        return;

      case 'TOGGLE_ENABLED':
        await saveAndSync({ enabled: message.enabled !== false });
        sendResponse({ ok: true });
        return;

      case 'SET_STRICT_MODE':
        await saveAndSync({ strictMode: message.strictMode !== false });
        sendResponse({ ok: true });
        return;

      case 'SAVE_SCHEDULE': {
        const days = Array.isArray(message.days) ? message.days.filter((value): value is number => Number.isInteger(value)) : [];
        const startMinutes = Number(message.startMinutes);
        const endMinutes = Number(message.endMinutes);
        if (startMinutes < 0 || startMinutes > 1439 || endMinutes < 0 || endMinutes > 1439) {
          sendResponse({ ok: false, error: 'Schedule times must be valid 24-hour clock values.' });
          return;
        }

        await saveAndSync({
          focusSchedule: {
            enabled: message.enabled === true,
            days,
            startMinutes,
            endMinutes,
          },
        });
        sendResponse({ ok: true });
        return;
      }

      case 'TOGGLE_ALLOWLIST_FOR_ACTIVE_TAB': {
        const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
        const parsed = typeof tab?.url === 'string' ? safeUrl(tab.url) : null;
        if (!parsed) {
          sendResponse({ ok: false, allowlisted: false });
          return;
        }

        const hostname = normalizeHostname(parsed.hostname);
        const allowlist = new Set(state.allowlist);
        let allowlisted = false;
        if (allowlist.has(hostname)) {
          allowlist.delete(hostname);
        } else {
          allowlist.add(hostname);
          allowlisted = true;
        }

        await saveAndSync({ allowlist: [...allowlist].sort() });
        sendResponse({ ok: true, allowlisted });
        return;
      }

      case 'TEMPORARY_UNLOCK_HOST': {
        const hostname = normalizeHostname(String(message.hostname ?? ''));
        const minutes = Math.max(1, Math.min(60, Number(message.minutes) || 5));
        if (!hostname) {
          sendResponse({ ok: false });
          return;
        }

        const expiresAt = Date.now() + (minutes * 60 * 1000);
        await saveAndSync({
          temporaryUnlocks: {
            ...state.temporaryUnlocks,
            [hostname]: expiresAt,
          },
        });
        sendResponse({ ok: true, expiresAt });
        return;
      }

      case 'CHECK_URL': {
        const evaluation = evaluateUrl(state, String(message.url ?? ''));
        sendResponse({
          ...evaluation,
          blocked: state.strictMode && evaluation.blocked,
        });
        return;
      }

      case 'GET_BLOCK_REASON': {
        const url = _sender.tab?.url ?? '';
        sendResponse(evaluateUrl(state, url));
        return;
      }

      default:
        sendResponse({ ok: false });
    }
  })().catch((error) => {
    console.error('ShieldBlock worker error', error);
    sendResponse({ ok: false, error: 'Unexpected extension error.' });
  });

  return true;
});
