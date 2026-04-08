import { ext } from '../shared/browser';
import { getSettings } from '../shared/storage';
import { matchesAllowlist } from '../shared/utils';

const STYLE_ID = 'shieldblock-annoyances-style';

const SELECTORS = [
  '#onetrust-banner-sdk',
  '#qc-cmp2-ui',
  '#didomi-popup',
  '.cookie-banner',
  '.cookie-consent',
  '.consent-banner',
  '.newsletter-popup',
  '.subscribe-popup',
  '.modal-overlay',
  '.onesignal-slidedown-container',
  '.push-notification-prompt',
];

let enabled = true;
let allowlisted = false;

function ensureStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
  if (!enabled || allowlisted || location.hostname.includes('youtube.com')) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${SELECTORS.join(',')} { display:none !important; visibility:hidden !important; }
    html, body { overflow:auto !important; position:static !important; }
  `;
  document.documentElement.appendChild(style);
}

function scrubAnnoyances(): void {
  if (!enabled || allowlisted) return;
  document.querySelectorAll<HTMLElement>(SELECTORS.join(',')).forEach((node) => {
    node.dataset.shieldblockHidden = '1';
    node.remove();
  });
  document.documentElement.classList.remove('modal-open', 'overflow-hidden', 'no-scroll');
  document.body?.classList.remove('modal-open', 'overflow-hidden', 'no-scroll');
}

async function refreshState(): Promise<void> {
  const settings = await getSettings(['enabled', 'annoyancesEnabled', 'allowlist']);
  enabled = settings.enabled !== false && settings.annoyancesEnabled !== false;
  allowlisted = matchesAllowlist(location.hostname, settings.allowlist ?? []);
  ensureStyle();
  scrubAnnoyances();
}

new MutationObserver(() => {
  scrubAnnoyances();
}).observe(document.documentElement, { childList: true, subtree: true });

ext.runtime.onMessage.addListener((message: any) => {
  if (['TOGGLE_EXTENSION', 'TOGGLE_ANNOYANCES', 'ALLOWLIST_UPDATED'].includes(message.type)) {
    void refreshState();
  }
});

ext.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName === 'local' && (changes.enabled || changes.allowlist || changes.annoyancesEnabled)) {
    void refreshState();
  }
});

void refreshState();
