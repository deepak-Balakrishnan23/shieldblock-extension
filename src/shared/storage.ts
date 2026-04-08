import { ext } from './browser';
import { AppState, DEFAULT_STATE } from './constants';

export async function getState(): Promise<AppState> {
  const values = await ext.storage.local.get(null);
  return {
    ...DEFAULT_STATE,
    ...values,
    focusSchedule: {
      ...DEFAULT_STATE.focusSchedule,
      ...(values.focusSchedule ?? {}),
    },
    stats: {
      ...DEFAULT_STATE.stats,
      ...(values.stats ?? {}),
    },
    blockEntries: Array.isArray(values.blockEntries) ? values.blockEntries : DEFAULT_STATE.blockEntries,
    allowlist: Array.isArray(values.allowlist) ? values.allowlist : DEFAULT_STATE.allowlist,
  } as AppState;
}

export async function setState(values: Partial<AppState>): Promise<void> {
  await ext.storage.local.set(values);
}
