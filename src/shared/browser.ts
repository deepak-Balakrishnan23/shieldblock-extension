export type ExtensionApi = any;

export const ext: ExtensionApi = ((globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser
  ?? (globalThis as { chrome?: ExtensionApi }).chrome)!;

export function runtimeUrl(path: string): string {
  return ext.runtime.getURL(path);
}
