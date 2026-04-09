# ShieldBlock AI v3

ShieldBlock AI v3 is a Chrome Manifest V3 extension that blocks ads, trackers, annoyances, and sponsored content with layered local detection.

## Load As Unpacked

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select `/Users/baladhak/Documents/New project/shieldblock-v3`
5. Pin ShieldBlock AI if you want quick access to the popup

## Project Structure

- `manifest.json` — extension manifest, rulesets, content scripts, and metadata
- `background.js` — service worker for filter updates, stats, allowlist rules, and settings
- `content.js` — picker, custom cosmetics, and local stats observers
- `cosmetic.js` — generic and domain-specific cosmetic filtering engine
- `heuristic.js` — DOM scoring engine for native and sponsored ads
- `ml-classifier.js` — local tree-based classifier for borderline ad candidates
- `filter-compiler.js` — ABP-to-DNR parsing and compilation helpers
- `scriptlets/` — main-world patches for anti-adblock and site-specific behavior
- `rules/` — packaged fallback DNR rulesets
- `popup.html` / `popup.js` — popup control center
- `options.html` / `options.js` — settings, allowlist, custom rules, and diagnostics
- `icons/` — placeholder extension icons

## Update Filter Lists Manually

You can refresh filter lists in either place:

- open the popup and click the refresh button
- open the options page and use **Fetch now** for a list row

Both actions trigger the background service worker to download the latest public lists and rebuild the in-memory dynamic rule snapshot.

## Add A New Scriptlet

1. Create a new file in `scriptlets/`
2. Register the scriptlet with the shared registry format used by the existing files
3. Add the file to the `MAIN` world `content_scripts` entry in `manifest.json`
4. Add the scriptlet name to `SCRIPTLET_MAP` and any matching domain mapping in `scriptlets/index.js`
5. Reload the unpacked extension and verify the page global patch behaves as expected

## Build Process

There is no build step.

ShieldBlock AI v3 is plain ES2022 JavaScript. Edit the files directly and reload the unpacked extension in Chrome.
