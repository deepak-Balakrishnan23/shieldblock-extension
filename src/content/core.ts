import { ext } from '../shared/browser';
import { PAGE_EVENT_NAME, PAGE_POLICY_EVENT, YOUTUBE_FAMILY_HOSTS } from '../shared/constants';

const OVERLAY_ID = 'shieldblock-overlay';
const STYLE_ID = 'shieldblock-overlay-style';
const CLOAK_ID = 'shieldblock-cloak-style';

let currentUrl = location.href;
let blockedState = false;

function needsPreemptiveCloak(): boolean {
  return YOUTUBE_FAMILY_HOSTS.some((hostname) => location.hostname === hostname || location.hostname.endsWith(`.${hostname}`));
}

function ensureCloak(): void {
  if (!needsPreemptiveCloak() || document.getElementById(CLOAK_ID)) return;
  const style = document.createElement('style');
  style.id = CLOAK_ID;
  style.textContent = 'html { visibility: hidden !important; }';
  document.documentElement.appendChild(style);
}

function removeCloak(): void {
  document.getElementById(CLOAK_ID)?.remove();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      background:
        radial-gradient(circle at top, rgba(236, 101, 68, 0.22), transparent 35%),
        linear-gradient(180deg, rgba(8, 12, 20, 0.96), rgba(8, 12, 20, 0.98));
      color: #f6f4ef;
      font-family: Georgia, "Times New Roman", serif;
      padding: 28px;
      align-items: center;
      justify-content: center;
    }

    #${OVERLAY_ID}[data-visible="true"] {
      display: flex;
    }

    #${OVERLAY_ID} .shieldblock-card {
      width: min(640px, calc(100vw - 32px));
      border-radius: 28px;
      border: 1px solid rgba(255, 226, 205, 0.2);
      background: rgba(24, 30, 42, 0.92);
      box-shadow: 0 28px 100px rgba(0, 0, 0, 0.4);
      padding: 32px;
    }

    #${OVERLAY_ID} .shieldblock-kicker {
      font: 600 12px/1.2 "Trebuchet MS", sans-serif;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #f9c7af;
      margin-bottom: 14px;
    }

    #${OVERLAY_ID} h1 {
      margin: 0 0 10px;
      font-size: clamp(30px, 6vw, 44px);
      line-height: 0.95;
    }

    #${OVERLAY_ID} p,
    #${OVERLAY_ID} li {
      color: #d2d6de;
      font: 400 15px/1.6 "Trebuchet MS", sans-serif;
    }

    #${OVERLAY_ID} ul {
      margin: 18px 0 0;
      padding-left: 18px;
    }
  `;
  document.documentElement.appendChild(style);
}

function pauseMedia(): void {
  document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => {
    media.pause();
    media.muted = true;
  });

  document.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
    frame.style.visibility = 'hidden';
  });
}

function removeYoutubeEmbeds(root: ParentNode = document): void {
  root.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
    const source = frame.src || frame.getAttribute('src') || '';
    if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(source)) {
      frame.remove();
    }
  });
}

function overlay(): HTMLDivElement {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.innerHTML = `
    <div class="shieldblock-card">
      <div class="shieldblock-kicker">Focus session</div>
      <h1>That page is blocked.</h1>
      <p id="shieldblock-copy">ShieldBlock stopped this navigation before the page could fully render.</p>
      <ul>
        <li>Network rules block direct navigations and embedded frames.</li>
        <li>This overlay closes gaps caused by SPA navigation and already-open tabs.</li>
        <li>Use the popup or options page to change your block list or schedule.</li>
      </ul>
    </div>
  `;
  document.documentElement.appendChild(root);
  return root;
}

function setBlocked(blocked: boolean, copy?: string): void {
  ensureStyle();
  const root = overlay();
  blockedState = blocked;
  root.dataset.visible = blocked ? 'true' : 'false';
  const copyNode = root.querySelector('#shieldblock-copy');
  if (blocked && copyNode) {
    copyNode.textContent = copy ?? 'ShieldBlock stopped this navigation before the page could fully render.';
    pauseMedia();
    removeYoutubeEmbeds();
  }

  window.dispatchEvent(new CustomEvent(PAGE_POLICY_EVENT, {
    detail: { blocked },
  }));
}

async function refresh(): Promise<void> {
  if (location.protocol.startsWith('chrome-extension')) {
    return;
  }

  try {
    const result = await ext.runtime.sendMessage({ type: 'CHECK_URL', url: location.href }) as {
      blocked: boolean;
      allowlisted: boolean;
      match: { matched: boolean; displayValue?: string };
    };

    if (result.blocked) {
      removeCloak();
      setBlocked(true, result.match.displayValue
        ? `Blocked by rule "${result.match.displayValue}".`
        : 'ShieldBlock stopped this navigation before the page could fully render.');
      return;
    }

    removeCloak();
    setBlocked(false);
  } catch {
    removeCloak();
    setBlocked(false);
  }
}

function observeUrlChanges(): void {
  const maybeRefresh = () => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    void refresh();
  };

  window.addEventListener(PAGE_EVENT_NAME, maybeRefresh as EventListener);
  window.addEventListener('hashchange', maybeRefresh, true);
  window.addEventListener('popstate', maybeRefresh, true);
  setInterval(maybeRefresh, 500);
}

function protectOverlay(): void {
  const observer = new MutationObserver(() => {
    if (blockedState && !document.getElementById(OVERLAY_ID)) {
      setBlocked(true, 'ShieldBlock restored its blocking overlay after page tampering.');
    }
    removeYoutubeEmbeds();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

ext.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === 'STATE_UPDATED') {
    void refresh();
  }
});

ensureCloak();
observeUrlChanges();
protectOverlay();
void refresh();
