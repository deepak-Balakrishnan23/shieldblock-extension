import { ext } from '../shared/browser';
import { computePageSummary } from '../shared/siteSummary';
import { getSettings } from '../shared/storage';
import { matchesAllowlist, normalizeDomain } from '../shared/utils';

const BASE_STYLE_ID = 'shieldblock-base-style';
const PICKER_ID = 'shieldblock-picker-overlay';

const BASE_SELECTORS = [
  'ins.adsbygoogle',
  '[data-ad-client]',
  '[data-ad-slot]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="adnxs.com"]',
  '[aria-label="Advertisement"]',
  '[aria-label="Sponsored"]',
  '[data-promoted="true"]',
  '[data-ad-preview]',
];

let enabled = true;
let allowlisted = false;

function ensureBaseStyle(): void {
  document.getElementById(BASE_STYLE_ID)?.remove();
  if (!enabled || allowlisted || location.hostname.includes('youtube.com')) return;

  const style = document.createElement('style');
  style.id = BASE_STYLE_ID;
  style.textContent = `${BASE_SELECTORS.join(',')} { display:none !important; visibility:hidden !important; }`;
  document.documentElement.appendChild(style);
}

function cssPathFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < 5) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const classNames = Array.from(current.classList).slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
    const parent = current.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName) : [];
    const index = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
    parts.unshift(`${tag}${classNames}${index}`);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function removePicker(): void {
  document.getElementById(PICKER_ID)?.remove();
}

function activatePicker(): void {
  removePicker();

  const overlay = document.createElement('div');
  overlay.id = PICKER_ID;
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:2147483647; cursor:crosshair;
    background:rgba(12, 18, 18, 0.1); border:2px dashed rgba(68, 255, 189, 0.55);
  `;

  let highlighted: HTMLElement | null = null;
  let previousOutline = '';

  const cleanupHighlight = () => {
    if (highlighted) {
      highlighted.style.outline = previousOutline;
    }
    highlighted = null;
  };

  const onMove = (event: MouseEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof HTMLElement) || target === overlay) return;
    cleanupHighlight();
    highlighted = target;
    previousOutline = target.style.outline;
    target.style.outline = '2px solid #44ffbd';
  };

  const stop = () => {
    cleanupHighlight();
    overlay.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof Element)) {
      stop();
      return;
    }

    const rule = cssPathFor(target);
    ext.runtime.sendMessage({
      type: 'SAVE_CUSTOM_RULE',
      domain: normalizeDomain(location.hostname),
      rule,
    });
    stop();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') stop();
  };

  overlay.addEventListener('click', onClick, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.documentElement.appendChild(overlay);
}

async function refreshState(): Promise<void> {
  const settings = await getSettings(['enabled', 'allowlist']);
  enabled = settings.enabled !== false;
  allowlisted = matchesAllowlist(location.hostname, settings.allowlist ?? []);
  ensureBaseStyle();
}

const observer = new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>('iframe[src*="doubleclick"], iframe[src*="googlesyndication"]').forEach((frame) => {
    frame.dataset.shieldblockHidden = '1';
    frame.style.display = 'none';
  });
});

observer.observe(document.documentElement, { childList: true, subtree: true });

ext.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: unknown) => void) => {
  if (message.type === 'GET_PAGE_SUMMARY') {
    sendResponse(computePageSummary(document, location.hostname, enabled, allowlisted));
    return true;
  }

  if (message.type === 'ACTIVATE_PICKER') {
    activatePicker();
  }

  if (['TOGGLE_EXTENSION', 'ALLOWLIST_UPDATED'].includes(message.type)) {
    void refreshState();
  }

  return false;
});

ext.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName === 'local' && (changes.enabled || changes.allowlist)) {
    void refreshState();
  }
});

void refreshState();
