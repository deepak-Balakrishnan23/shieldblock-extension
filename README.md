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
- `tools/e2e-youtube.mjs` — drives the real extension in headless Chrome against `tests/e2e/`
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

## YouTube Ads

YouTube in-stream ads cannot be blocked at the network layer: the ad and the
video you asked for are served from the same `googlevideo.com` hosts, over the
same URLs, and a filter wide enough to catch one kills the other. The rules in
`rules/youtube-network.json` therefore only cover the surrounding ad
infrastructure — measurement beacons, the IMA SDK, DoubleClick and
googlesyndication endpoints. The ads themselves are removed in the page, in
three layers that back each other up.

**1. Payload pruning (`scriptlets/yt-player.js`, MAIN world, `document_start`).**
Every ad on YouTube is described in an Innertube JSON payload before it is
played or rendered: the watch page's ad schedule (`adPlacements`, `playerAds`,
`adSlots`, `adBreakHeartbeatParams`), and the feed, search, and Shorts ad
renderers (`adSlotRenderer`, `displayAdRenderer`, `promotedSparklesWebRenderer`,
and the rest). One walk removes all of them, and then drops the array entries
those deletions emptied out — otherwise the feed renders a blank slot where the
ad was. Payload branches that carry the playable video (`streamingData`,
`videoDetails`, `playabilityStatus`) are never walked.

The walk runs on everything that can carry a payload, because YouTube uses all
of them: the `ytInitialPlayerResponse` and `ytInitialData` bootstrap globals,
`fetch` and `XMLHttpRequest` responses for any `/youtubei/` endpoint, and
`JSON.parse`/`Response.prototype.json` as the catch-all for the code paths the
transport hooks never observe. The XHR listener is registered from `open()`
rather than `send()` on purpose: a page attaches its own handler between those
two calls, and listeners fire in registration order, so registering at send time
means YouTube reads the response before it has been cleaned.

**2. Player fallback.** When an ad plays anyway — a payload shape we do not know
yet, or a break requested after the page loaded — the scriptlet mutes it, seeks
it to its end, and runs the rate up to 16x in case the seek is refused. It only
does this while `#movie_player` carries `ad-showing`/`ad-interrupting`, since
seeking on a false positive would throw the viewer to the end of the real video.
A `MutationObserver` on the player's class list catches the transition
immediately, with a 200ms loop behind it for states that change no class.

**3. Cosmetic filtering (`cosmetic.js`).** The `youtube.com` selector set hides
the ad containers and feed renderers that reach the DOM before the scriptlet
sees their payload. Note that it also hides the skip buttons, so the scriptlet
clicks them without checking visibility — `HTMLElement.click()` works on a
hidden element, and requiring visibility made the skip path dead code.

All three layers check `data-shieldblock-enabled` and
`data-shieldblock-allowlisted` on `<html>`, which `content.js` publishes, so
pausing protection or allowlisting YouTube turns every one of them off.

### Testing the YouTube layers

`npm test` covers the payload walk on its own. The parts that have actually
broken cannot be reached that way — whether the XHR hook runs before the page's
own handler, whether a skip button our own CSS has hidden can still be clicked,
and whether the player fallback mutes and seeks an ad are all browser
behaviour. `npm run test:e2e` loads the unpacked extension into headless Chrome
and asserts all of it against a fixture watch page.

The fixture is served from a local HTTPS server that `www.youtube.com` is
pointed at with `--host-resolver-rules`, so the page's origin really is
youtube.com and the host gate opens. HTTPS with a throwaway certificate is not
optional: youtube.com is HSTS-preloaded, so the page will not load over plain
HTTP, and a cert error cannot be clicked past — the certificate's public key is
pinned with `--ignore-certificate-errors-spki-list` instead.

It needs `openssl` and a browser that still loads an unpacked extension while
being driven. Released Google Chrome no longer does — it starts cleanly,
ignores `--load-extension`, and every check then measures an unprotected page —
so the runner prefers a Chromium installed by `npx playwright install
chromium`, which is also what CI uses. Set `CHROME_PATH` to override. A browser
that comes up without the extension fails the run before any check, rather than
reporting a wall of failures that all have the one cause.

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
