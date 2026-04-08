import { ext } from './browser';
import { DEFAULT_SETTINGS } from './constants';

export type ExtensionSettings = typeof DEFAULT_SETTINGS;

export async function getSettings<T extends keyof ExtensionSettings>(
  keys?: T[] | null
): Promise<Pick<ExtensionSettings, T> | ExtensionSettings> {
  const requested = keys && keys.length ? keys : null;
  const values = await ext.storage.local.get(requested as string[] | null);
  return { ...DEFAULT_SETTINGS, ...values } as Pick<ExtensionSettings, T> | ExtensionSettings;
}

export async function setSettings(values: Partial<ExtensionSettings>): Promise<void> {
  await ext.storage.local.set(values);
}
