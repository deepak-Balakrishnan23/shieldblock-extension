# ShieldBlock

ShieldBlock is a production-oriented Chrome MV3 website blocker built to behave more like top blockers such as Freedom, StayFocusd, and BlockSite than a simple URL filter.

## Product breakdown

- Core features: block list, allowlist, schedule-based focus mode, strict mode, current-tab inspection, block page, and YouTube-family hardening.
- User flow: add a hostname or URL rule in the popup, optionally restrict it to a work-hour schedule, then let the extension enforce it across direct navigations, embedded frames, and already-open tabs.
- Differentiators: YouTube alias expansion (`youtube.com`, `youtu.be`, `youtube-nocookie.com`), multi-layer blocking instead of a single API, and SPA-aware route monitoring.

## Benchmarking summary

- Freedom emphasizes that its browser extension exists because some URLs and browsers do not reliably show its block screen without extra browser-level handling.
- StayFocusd markets a mix of website blocking, timers, and Shorts blocking, which signals that modern blockers must handle path-level experiences and not just hostnames.
- BlockSite positions schedules and full-site blocking as table stakes, which means reliable blockers need both persistent rules and time-aware activation.
- Common blocker failures come from relying on one layer only: a content script can miss pre-render navigations, while a pure network block can leave already-open tabs or SPA route changes untouched.

## Technical architecture

- Manifest V3 with a background service worker, dynamic `declarativeNetRequest` rules, content scripts at `document_start`, and a small popup/options surface.
- `src/background/index.ts`: source of truth for state, rule compilation, tab enforcement, and messaging.
- `src/shared/matcher.ts`: canonical rule parsing and evaluation so popup, worker, and content scripts stay consistent.
- `src/shared/dnr.ts`: compiles user rules into MV3 dynamic rules for `main_frame` redirects and `sub_frame` blocks.
- `src/content/core.ts`: strict-mode overlay fallback for already-open tabs, refreshes, and SPA route changes.
- `src/content/page-bridge.ts`: main-world history instrumentation so `pushState` and `replaceState` navigations are visible.

## Blocking logic

ShieldBlock uses three layers:

1. URL matching: hostname, path/keyword, or `/regex/` entries are normalized and evaluated centrally.
2. Network enforcement: dynamic DNR rules redirect blocked top-level pages to `blocked.html` and block blocked subframes.
3. DOM fallback: a document-start overlay pauses media and covers the page if a blocked page is already open or navigates client-side.

### YouTube reliability strategy

- A single `youtube.com` rule expands to `youtube.com`, `youtu.be`, and `youtube-nocookie.com`.
- Sub-frame rules stop YouTube embeds inside other pages.
- The content overlay catches SPA route changes such as watch-to-shorts transitions and protects against refresh/navigation gaps.

## Setup

1. Run `npm install` if dependencies are not present.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable Developer Mode.
5. Choose Load unpacked and select `/Users/baladhak/Documents/New project/shieldblock-extension/dist/chrome`.

## Permissions

- `declarativeNetRequest`: enforce main-frame and sub-frame blocks.
- `storage`: persist rules, allowlist, and schedule state.
- `tabs`: inspect active tabs and redirect already-open blocked tabs.
- `host_permissions: <all_urls>`: required because users can block arbitrary sites.

## Optimization and next steps

- Add tamper resistance by pin-locking strict mode and delaying allowlist changes during active sessions.
- Add sync storage or account-backed policy distribution for multi-device enforcement.
- Add analytics for blocked attempts and schedule adherence, ideally with privacy-preserving local aggregation.
- Add optional AI-assisted suggestions, but keep enforcement deterministic and local.
