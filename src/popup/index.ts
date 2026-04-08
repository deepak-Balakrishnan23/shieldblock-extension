import { PopupSnapshot } from '../shared/constants';
import { minutesToClock, toMinutes } from '../shared/utils';

const ids = {
  enabled: document.getElementById('enabled') as HTMLInputElement,
  strictMode: document.getElementById('strict-mode') as HTMLInputElement,
  currentSite: document.getElementById('current-site') as HTMLDivElement,
  currentMeta: document.getElementById('current-meta') as HTMLDivElement,
  allowlistToggle: document.getElementById('allowlist-toggle') as HTMLButtonElement,
  addForm: document.getElementById('add-form') as HTMLFormElement,
  addInput: document.getElementById('site-input') as HTMLInputElement,
  list: document.getElementById('block-list') as HTMLDivElement,
  totalBlocked: document.getElementById('total-blocked') as HTMLSpanElement,
  blockedToday: document.getElementById('blocked-today') as HTMLSpanElement,
  scheduleEnabled: document.getElementById('schedule-enabled') as HTMLInputElement,
  scheduleStart: document.getElementById('schedule-start') as HTMLInputElement,
  scheduleEnd: document.getElementById('schedule-end') as HTMLInputElement,
  scheduleDays: Array.from(document.querySelectorAll<HTMLInputElement>('[data-day]')),
  saveSchedule: document.getElementById('save-schedule') as HTMLButtonElement,
  openOptions: document.getElementById('open-options') as HTMLButtonElement,
  feedback: document.getElementById('feedback') as HTMLDivElement,
};

let snapshot: PopupSnapshot | null = null;

function showFeedback(message: string, tone: 'error' | 'success' = 'success'): void {
  ids.feedback.textContent = message;
  ids.feedback.dataset.tone = tone;
}

function renderEntries(): void {
  if (!snapshot) return;

  const entries = snapshot.state.blockEntries;
  ids.list.innerHTML = entries.length
    ? entries.map((entry) => `
      <div class="list-row">
        <div>
          <strong>${entry.label}</strong>
          <div class="muted">${entry.type}</div>
        </div>
        <button class="ghost" data-id="${entry.id}">Remove</button>
      </div>
    `).join('')
    : '<div class="empty">No blocked sites yet. Add YouTube, Reddit, or a custom /regex/.</div>';

  ids.list.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'DELETE_BLOCK_ENTRY', id: button.dataset.id });
      await load();
    });
  });
}

function renderActiveTab(): void {
  if (!snapshot) return;

  const { activeTab } = snapshot;
  ids.currentSite.textContent = activeTab.hostname || 'No active page';

  if (!activeTab.url) {
    ids.currentMeta.textContent = 'Open a tab to inspect live blocking state.';
    ids.allowlistToggle.disabled = true;
    return;
  }

  ids.allowlistToggle.disabled = false;
  ids.allowlistToggle.textContent = activeTab.allowlisted ? 'Remove allowlist' : 'Allow this site';

  if (activeTab.blocked) {
    ids.currentMeta.textContent = activeTab.match.displayValue
      ? `Blocked by ${activeTab.match.displayValue}`
      : 'Blocked by your current rules.';
    return;
  }

  ids.currentMeta.textContent = activeTab.allowlisted
    ? 'This hostname is temporarily exempt via allowlist.'
    : 'This tab is currently allowed.';
}

function renderSchedule(): void {
  if (!snapshot) return;

  const schedule = snapshot.state.focusSchedule;
  ids.scheduleEnabled.checked = schedule.enabled;
  ids.scheduleStart.value = minutesToClock(schedule.startMinutes);
  ids.scheduleEnd.value = minutesToClock(schedule.endMinutes);
  ids.scheduleDays.forEach((checkbox) => {
    checkbox.checked = schedule.days.includes(Number(checkbox.dataset.day));
  });
}

async function load(): Promise<void> {
  snapshot = await chrome.runtime.sendMessage({ type: 'GET_POPUP_SNAPSHOT' }) as PopupSnapshot;

  ids.enabled.checked = snapshot.state.enabled;
  ids.strictMode.checked = snapshot.state.strictMode;
  ids.totalBlocked.textContent = String(snapshot.state.stats.totalBlocked);
  ids.blockedToday.textContent = String(snapshot.state.stats.blockedToday);
  renderActiveTab();
  renderEntries();
  renderSchedule();
}

ids.enabled.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: ids.enabled.checked });
  await load();
});

ids.strictMode.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'SET_STRICT_MODE', strictMode: ids.strictMode.checked });
  await load();
});

ids.allowlistToggle.addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_ALLOWLIST_FOR_ACTIVE_TAB' }) as {
    ok: boolean;
    allowlisted: boolean;
  };
  showFeedback(result.allowlisted ? 'Site added to allowlist.' : 'Site removed from allowlist.');
  await load();
});

ids.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await chrome.runtime.sendMessage({
    type: 'UPSERT_BLOCK_ENTRY',
    input: ids.addInput.value,
  }) as { ok: boolean; error?: string };

  if (!result.ok) {
    showFeedback(result.error ?? 'Unable to save that rule.', 'error');
    return;
  }

  ids.addInput.value = '';
  showFeedback('Blocking rule added.');
  await load();
});

ids.saveSchedule.addEventListener('click', async () => {
  const days = ids.scheduleDays
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => Number(checkbox.dataset.day));

  const result = await chrome.runtime.sendMessage({
    type: 'SAVE_SCHEDULE',
    enabled: ids.scheduleEnabled.checked,
    days,
    startMinutes: toMinutes(ids.scheduleStart.value),
    endMinutes: toMinutes(ids.scheduleEnd.value),
  }) as { ok: boolean; error?: string };

  if (!result.ok) {
    showFeedback(result.error ?? 'Unable to save schedule.', 'error');
    return;
  }

  showFeedback('Schedule saved.');
  await load();
});

ids.openOptions.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void load().catch(() => {
  showFeedback('Popup failed to load.', 'error');
});
