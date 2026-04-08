# ShieldBlock

ShieldBlock is a cross-browser ad blocker focused on smooth YouTube blocking, low-overhead general filtering, and local-only privacy protections.

## Features

- Chrome Manifest V3 build
- Firefox-compatible build
- Bundled static filter rules for ads, trackers, popups, malware, and YouTube
- YouTube page-context payload sanitization for pre-roll and mid-roll suppression
- Lightweight overlay, sponsored-card, and annoyance cleanup
- Local allowlist and site-teaching picker
- Integrity-checked dynamic update channel for small site-fix deltas

## Project Layout

- `src/` TypeScript source
- `scripts/` build and list-compilation tooling
- `rules/` bundled static DNR rule snapshots
- `dist/chrome/` built Chrome extension
- `dist/firefox/` built Firefox extension
- `tests/` unit and synthetic E2E coverage

## Build

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## Output

- Chrome bundle: `dist/chrome`
- Firefox bundle: `dist/firefox`
- Packaged zips can be created from those folders for distribution or review.

## Install

### Chrome

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select `dist/chrome`
5. For a reviewable archive, zip the contents of `dist/chrome`

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `dist/firefox/manifest.json`
4. For distribution, zip the contents of `dist/firefox`

## Rule Refresh

To regenerate bundled rules from filter-list downloads:

```bash
node ./scripts/compile_filter_lists.js
```

Then rebuild:

```bash
npm run build
```
