import { ext, runtimeUrl } from '../shared/browser';
import { getSettings } from '../shared/storage';
import { matchesAllowlist } from '../shared/utils';
import { isSponsoredCandidate } from '../shared/youtubeSanitizer';

const STYLE_ID = 'shieldblock-youtube-style';
const HOOK_ID = 'shieldblock-youtube-hook';

const PLAYER_SELECTORS = [
  '.ytp-ad-overlay-container',
  '.ytp-ad-overlay-slot',
  '.ytp-ad-text-overlay',
  '.ytp-ad-image-overlay',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-instream-info',
  '.ytp-ad-simple-ad-badge',
  '.ytp-ad-preview-container',
  '.ytp-ad-shopping-overlay',
  '.ytp-ad-action-interstitial',
  '.ytp-ad-module',
  '.ytp-ad-message-container',
  '#player-ads',
];

const FEED_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-compact-video-renderer',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-compact-promoted-video-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-companion-slot-renderer',
];

const SKIP_SELECTORS = [
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-skip-ad-button',
];

let enabled = true;
let allowlisted = false;
let pendingAdActions = 0;
let intervalId = 0;

function canRun(): boolean {
  return enabled && !allowlisted;
}

function markAction(count = 1): void {
  pendingAdActions += count;
  if (pendingAdActions < 2) return;
  ext.runtime.sendMessage({ type: 'INCREMENT_BLOCKED', category: 'ads', count: pendingAdActions });
  ext.runtime.sendMessage({
    type: 'ACTIVITY_EVENT',
    kind: 'blocking',
    title: 'YouTube ads blocked',
    detail: `${pendingAdActions} YouTube ad element(s) removed`,
  });
  pendingAdActions = 0;
}

function ensureHook(): void {
  document.getElementById(HOOK_ID)?.remove();
  if (!canRun()) return;

  const script = document.createElement('script');
  script.id = HOOK_ID;
  script.src = runtimeUrl('page/youtube-hook.js');
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function ensureStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
  if (!canRun()) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${PLAYER_SELECTORS.join(',')} {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    .ad-showing .ytp-ad-player-overlay,
    .ad-showing .ytp-ad-module,
    #player-ads {
      display: none !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function hideFeedAds(): void {
  if (!canRun()) return;

  document.querySelectorAll<HTMLElement>(FEED_SELECTORS.join(',')).forEach((node) => {
    const text = (node.innerText || '').trim();
    const hrefs = Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.href).join(' ');
    if (!isSponsoredCandidate(text, hrefs)) return;
    if (node.dataset.shieldblockHidden === '1') return;
    node.dataset.shieldblockHidden = '1';
    node.style.display = 'none';
    markAction();
  });
}

function clickSkipButton(): void {
  if (!canRun()) return;
  for (const selector of SKIP_SELECTORS) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button && button.offsetParent !== null) {
      button.click();
      markAction();
      break;
    }
  }
}

async function refreshState(): Promise<void> {
  const settings = await getSettings(['enabled', 'youtubeEnabled', 'allowlist']);
  enabled = settings.enabled !== false && settings.youtubeEnabled !== false;
  allowlisted = matchesAllowlist(location.hostname, settings.allowlist ?? []);
  ensureHook();
  ensureStyle();
  hideFeedAds();
}

new MutationObserver(() => {
  hideFeedAds();
  clickSkipButton();
}).observe(document.documentElement, { childList: true, subtree: true });

function startPolling(): void {
  window.clearInterval(intervalId);
  intervalId = window.setInterval(() => {
    hideFeedAds();
    clickSkipButton();
  }, 250);
}

ext.runtime.onMessage.addListener((message: any) => {
  if (['TOGGLE_EXTENSION', 'TOGGLE_YOUTUBE', 'ALLOWLIST_UPDATED'].includes(message.type)) {
    void refreshState();
  }
});

ext.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName === 'local' && (changes.enabled || changes.allowlist || changes.youtubeEnabled)) {
    void refreshState();
  }
});

window.addEventListener('beforeunload', () => {
  if (pendingAdActions > 0) markAction(0);
});

void refreshState().then(startPolling);
