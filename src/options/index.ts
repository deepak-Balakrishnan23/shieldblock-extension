import { AppState } from '../shared/constants';
import { minutesToClock, toMinutes } from '../shared/utils';

const ids = {
  status: document.getElementById('status') as HTMLDivElement,
  enabled: document.getElementById('enabled') as HTMLInputElement,
  strictMode: document.getElementById('strict-mode') as HTMLInputElement,
  list: document.getElementById('block-list') as HTMLDivElement,
  addForm: document.getElementById('add-form') as HTMLFormElement,
  addInput: document.getElementById('site-input') as HTMLInputElement,
  allowlist: document.getElementById('allowlist') as HTMLDivElement,
  scheduleEnabled: document.getElementById('schedule-enabled') as HTMLInputElement,
  scheduleStart: document.getElementById('schedule-start') as HTMLInputElement,
  scheduleEnd: document.getElementById('schedule-end') as HTMLInputElement,
  scheduleDays: Array.from(document.querySelectorAll<HTMLInputElement>('[data-day]')),
};

let state: AppState | null = null;

function announce(message: string): void {
  ids.status.textContent = message;
}

function renderEntries(): void {
  if (!state) return;

  ids.list.innerHTML = state.blockEntries.length
    ? state.blockEntries.map((entry) => `
      <div class="list-row">
        <div>
          <strong>${entry.label}</strong>
          <div class="muted">${entry.type} • ${entry.value}</div>
        </div>
        <button class="ghost" data-id="${entry.id}">Remove</button>
      </div>
    `).join('')
    : '<div class="empty">No sites blocked yet.</div>';

  ids.list.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'DELETE_BLOCK_ENTRY', id: button.dataset.id });
      await load();
    });
  });
}

function renderAllowlist(): void {
  if (!state) return;

  ids.allowlist.innerHTML = state.allowlist.length
    ? state.allowlist.map((hostname) => `<span class="pill">${hostname}</span>`).join('')
    : '<div class="empty">No allowlisted hosts.</div>';
}

function renderSchedule(): void {
  const currentState = state;
  if (!currentState) return;

  ids.scheduleEnabled.checked = currentState.focusSchedule.enabled;
  ids.scheduleStart.value = minutesToClock(currentState.focusSchedule.startMinutes);
  ids.scheduleEnd.value = minutesToClock(currentState.focusSchedule.endMinutes);
  ids.scheduleDays.forEach((checkbox) => {
    checkbox.checked = currentState.focusSchedule.days.includes(Number(checkbox.dataset.day));
  });
}

async function load(): Promise<void> {
  state = await chrome.runtime.sendMessage({ type: 'GET_STATE' }) as AppState;
  ids.enabled.checked = state.enabled;
  ids.strictMode.checked = state.strictMode;
  renderEntries();
  renderAllowlist();
  renderSchedule();
}

ids.enabled.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: ids.enabled.checked });
  announce(`Blocking ${ids.enabled.checked ? 'enabled' : 'paused'}.`);
  await load();
});

ids.strictMode.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'SET_STRICT_MODE', strictMode: ids.strictMode.checked });
  announce(`Strict mode ${ids.strictMode.checked ? 'enabled' : 'disabled'}.`);
  await load();
});

ids.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await chrome.runtime.sendMessage({ type: 'UPSERT_BLOCK_ENTRY', input: ids.addInput.value }) as {
    ok: boolean;
    error?: string;
  };

  if (!result.ok) {
    announce(result.error ?? 'Unable to save rule.');
    return;
  }

  ids.addInput.value = '';
  announce('Blocking rule added.');
  await load();
});

document.getElementById('save-schedule')?.addEventListener('click', async () => {
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

  announce(result.ok ? 'Schedule saved.' : (result.error ?? 'Unable to save schedule.'));
  await load();
});

document.getElementById('seed-youtube')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'UPSERT_BLOCK_ENTRY', input: 'youtube.com' });
  await load();
  announce('YouTube family blocked.');
});

void load();
