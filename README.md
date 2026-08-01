# ShieldBlock AI v3

ShieldBlock AI v3 is a Chrome Manifest V3 extension that blocks ads, trackers, annoyances, and sponsored content with layered local detection.

## Load As Unpacked

Requires Chrome 120 or newer.

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select this repository's root directory
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
- `rules/` — hand-maintained DNR rulesets
- `rules/generated/` — rulesets compiled from upstream filter lists at build time
- `tools/build-rules.mjs` — compiles upstream lists into `rules/generated/`
- `tools/validate-rules.mjs` — checks packaged rulesets against Chrome's DNR limits
- `popup.html` / `popup.js` — popup control center
- `options.html` / `options.js` — settings, allowlist, custom rules, and diagnostics
- `icons/` — placeholder extension icons

## Network Filtering

Network rules are compiled from the upstream lists **at build time** into static
rulesets under `rules/generated/`, not downloaded at runtime.

The reason is Chrome's MV3 quotas. Dynamic rules — the only ones an extension can
add at runtime — are capped at 5,000 across the whole extension, which cannot
hold EasyList-scale coverage. Static rulesets get a far larger budget: 30,000
rules guaranteed to every extension, plus a 330,000-rule pool shared across all
installed extensions. The generated rules are therefore split into two tiers:

- **core** — enabled in the manifest, sized so everything enabled at install fits
  inside the guaranteed 30,000 and can never fail to load
- **extended** — shipped disabled and enabled at startup by the service worker,
  which halves the request and retries if the shared pool is too full to fit it

The remaining dynamic-rule quota is reserved for your custom rules and allowlist.

### Exception rules

`@@` exception rules are compiled alongside the block rules. Filter lists ship
thousands of them specifically to stop overblocking — payment flows, login
widgets, and CDNs that serve both ads and site assets — so dropping them causes
more site breakage than the block rules prevent.

Exceptions become DNR `allow` rules, and `$document`/`$all` exceptions become
`allowAllRequests`, which lifts blocking for a page and everything inside it.
They live in their own always-enabled tier: an exception must never be disabled
while the block it overrides is still active.

Priorities follow ABP precedence, with the user allowlist above everything:

| Priority | Rule |
| --- | --- |
| 100 | block |
| 200 | exception (`@@`) |
| 300 | document exception (`$document`, `$all`) |
| 400 | `$important` block |
| 500 | `$important` exception |
| 600 | `$important` document exception |
| 1000 | user allowlist entry |

Modifiers with no DNR equivalent are skipped rather than approximated, including
`$popup`, `$csp`, `$redirect`, `$removeparam`, and `$badfilter`. Cosmetic-scoped
exception modifiers (`$elemhide`, `$generichide`, `$stealth`) are recognized and
ignored, so a rule like `@@||site^$document,elemhide` still contributes its
network exception.

### Rebuilding the packaged rules

```bash
npm run build:rules
```

This fetches the upstream lists, compiles and deduplicates them, rewrites
`rules/generated/` and the manifest's `rule_resources`, then validates the result.
A monthly GitHub Actions workflow does the same and opens a pull request.

To check already-packaged rules without refetching:

```bash
npm run validate:rules
```

The compiler's parsing and precedence rules are covered by unit tests:

```bash
npm test
```

### Live updates

Scheduled re-downloading of filter lists is **off by default**, because the
packaged rulesets are compiled from those same lists and re-fetching them would
spend the scarce dynamic quota re-adding rules that are already active. Manual
refresh still works from the popup's refresh button or the options page's
**Fetch now**, and the scheduled layer can be enabled by sending the background
worker `{ action: 'setLiveFilterUpdates', enabled: true }`.

## Add A New Scriptlet

1. Create a new file in `scriptlets/`
2. Register the scriptlet with the shared registry format used by the existing files
3. Add the file to the `MAIN` world `content_scripts` entry in `manifest.json`
4. Add the scriptlet name to `SCRIPTLET_MAP` and any matching domain mapping in `scriptlets/index.js`
5. Reload the unpacked extension and verify the page global patch behaves as expected

## Publishing

```bash
npm run package
```

Writes `dist/shieldblock-ai-v<version>.zip` containing only runtime files —
tooling, tests, docs, and CI config are left out. Validates the rulesets first.

```bash
npm run screenshots
```

Renders the five Chrome Web Store screenshots into `dist/store/` at 1280×800.
They are captured from the real `popup.html` and `options.html` with a small
`chrome.*` stub supplying representative data, so the listing shows the actual
UI. Requires a Chromium-based browser installed locally.

Listing copy, category, language, and permission justifications live in
[store_assets.md](store_assets.md).

## Build Process

The extension code has no build step — it is plain ES2022 JavaScript, so you can
edit files directly and reload the unpacked extension in Chrome.

The only generated artifacts are the packaged rulesets in `rules/generated/`,
which are committed to the repository and only need regenerating when you want
fresher upstream filters. See [Network Filtering](#network-filtering).
