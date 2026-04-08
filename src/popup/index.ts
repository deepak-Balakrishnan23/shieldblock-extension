import { ext } from '../shared/browser';
import { RULESET_COUNTS } from '../shared/constants';

type PopupState = {
  enabled?: boolean;
  totalBlocked?: number;
  adsBlocked?: number;
  trackersBlocked?: number;
  sessionBlocked?: number;
  youtubeEnabled?: boolean;
  annoyancesEnabled?: boolean;
  allowlist?: string[];
  lastActivities?: Array<{ title: string; detail?: string }>;
};

const ids = {
  power: document.getElementById('power') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLDivElement,
  total: document.getElementById('total') as HTMLSpanElement,
  ads: document.getElementById('ads') as HTMLSpanElement,
  trackers: document.getElementById('trackers') as HTMLSpanElement,
  session: document.getElementById('session') as HTMLSpanElement,
  rules: document.getElementById('rules') as HTMLSpanElement,
  youtubeToggle: document.getElementById('youtube-toggle') as HTMLInputElement,
  annoyancesToggle: document.getElementById('annoyances-toggle') as HTMLInputElement,
  site: document.getElementById('site') as HTMLDivElement,
  activity: document.getElementById('activity') as HTMLDivElement,
  allowlistInput: document.getElementById('allowlist-input') as HTMLInputElement,
  addAllowlist: document.getElementById('allowlist-add') as HTMLButtonElement,
  allowlist: document.getElementById('allowlist') as HTMLDivElement,
  picker: document.getElementById('picker') as HTMLButtonElement,
};

function formatCount(value = 0): string {
  return value.toLocaleString();
}

function enabledRuleCount(): number {
  return Object.values(RULESET_COUNTS).reduce((sum, count) => sum + count, 0);
}

function renderActivities(items: Array<{ title: string; detail?: string }> = []): void {
  ids.activity.innerHTML = items.length
    ? items.slice(0, 6).map((item) => `<div class="row"><strong>${item.title}</strong><span>${item.detail ?? ''}</span></div>`).join('')
    : '<div class="empty">No recent activity yet.</div>';
}

function renderAllowlist(items: string[] = []): void {
  ids.allowlist.innerHTML = items.length
    ? items.map((item) => `<button class="pill" data-domain="${item}">${item}</button>`).join('')
    : '<div class="empty">No allowlisted sites.</div>';

  ids.allowlist.querySelectorAll<HTMLButtonElement>('button[data-domain]').forEach((button) => {
    button.addEventListener('click', () => {
      void ext.runtime.sendMessage({ type: 'REMOVE_FROM_ALLOWLIST', domain: button.dataset.domain }).then(load);
    });
  });
}

function renderSite(summary: any): void {
  if (!summary?.summary) {
    ids.site.innerHTML = '<div class="empty">Open a page to inspect local ad pressure.</div>';
    return;
  }

  const { hostname, intrusionScore, status, candidateSignals, blockedHints } = summary.summary;
  ids.site.innerHTML = `
    <div class="metric-lg">${intrusionScore}/100</div>
    <div>${hostname}</div>
    <div>${status}</div>
    <div class="muted">signals ${candidateSignals} · hidden ${blockedHints}</div>
  `;
}

async function load(): Promise<void> {
  const state = await ext.runtime.sendMessage({ type: 'GET_STATS' }) as PopupState;
  ids.power.dataset.enabled = String(state.enabled !== false);
  ids.status.textContent = state.enabled === false ? 'Protection paused' : 'Adaptive protection active';
  ids.total.textContent = formatCount(state.totalBlocked);
  ids.ads.textContent = formatCount(state.adsBlocked);
  ids.trackers.textContent = formatCount(state.trackersBlocked);
  ids.session.textContent = formatCount(state.sessionBlocked);
  ids.rules.textContent = formatCount(enabledRuleCount());
  ids.youtubeToggle.checked = state.youtubeEnabled !== false;
  ids.annoyancesToggle.checked = state.annoyancesEnabled !== false;
  renderActivities(state.lastActivities);
  renderAllowlist(state.allowlist);

  const summary = await ext.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
  renderSite(summary);
}

ids.power.addEventListener('click', () => {
  const next = ids.power.dataset.enabled !== 'true';
  void ext.runtime.sendMessage({ type: 'TOGGLE_EXTENSION', enabled: next }).then(load);
});

ids.youtubeToggle.addEventListener('change', () => {
  void ext.runtime.sendMessage({ type: 'TOGGLE_CATEGORY', category: 'youtube', enabled: ids.youtubeToggle.checked }).then(load);
});

ids.annoyancesToggle.addEventListener('change', () => {
  void ext.runtime.sendMessage({ type: 'TOGGLE_ANNOYANCES', enabled: ids.annoyancesToggle.checked }).then(load);
});

ids.addAllowlist.addEventListener('click', () => {
  const domain = ids.allowlistInput.value.trim();
  if (!domain) return;
  void ext.runtime.sendMessage({ type: 'ADD_TO_ALLOWLIST', domain }).then(() => {
    ids.allowlistInput.value = '';
    return load();
  });
});

ids.picker.addEventListener('click', () => {
  void ext.runtime.sendMessage({ type: 'ACTIVATE_PICKER' });
  window.close();
});

void load();
