# Architecture

## Manifest V3 structure

- `background.js`: MV3 service worker generated from `src/background/index.ts`
- `content.js`: isolated-world fallback blocker generated from `src/content/core.ts`
- `page-bridge.js`: main-world history hook for SPA navigation detection
- `popup.html` + `popup.js`: fast control surface for daily use
- `options.html` + `options.js`: fuller management UI
- `blocked.html`: user-facing redirect target for blocked navigations
- `styles.css`: shared UI styles

## Why blockers fail

- URL-only popup logic does not protect already-open tabs.
- Content-only overlays can lose the race to top-level navigations.
- Main-frame blocks alone do not stop embedded players or in-page route changes.
- YouTube is especially tricky because the product spans `youtube.com`, `m.youtube.com`, `youtu.be`, `youtube-nocookie.com`, and client-side route changes such as Shorts and watch pages.

## ShieldBlock design

- State lives in `chrome.storage.local` and is normalized through `src/shared/storage.ts`.
- Rule parsing and evaluation live in `src/shared/matcher.ts`.
- DNR compilation happens in `src/shared/dnr.ts`.
- The background worker rebuilds dynamic rules whenever state changes and also redirects already-open blocked tabs to the extension block page.
- The content script provides a fail-safe overlay, pauses media, and listens for route changes so SPA navigations are re-evaluated quickly.

## Messaging system

- Popup/options -> worker:
  - `GET_POPUP_SNAPSHOT`
  - `GET_STATE`
  - `UPSERT_BLOCK_ENTRY`
  - `DELETE_BLOCK_ENTRY`
  - `TOGGLE_ENABLED`
  - `SET_STRICT_MODE`
  - `SAVE_SCHEDULE`
  - `TOGGLE_ALLOWLIST_FOR_ACTIVE_TAB`
- Content -> worker:
  - `CHECK_URL`
  - `GET_BLOCK_REASON`
- Worker -> content:
  - `STATE_UPDATED`

## Anti-bypass considerations

- Dynamic rules cover fresh navigations before content loads.
- The overlay closes the gap on already-open tabs, history changes, and pages that remain alive in memory.
- Sub-frame DNR rules block embeds so users cannot bypass a host block through iframes.
- YouTube aliases are expanded automatically, which avoids the common mistake of only blocking `www.youtube.com`.
