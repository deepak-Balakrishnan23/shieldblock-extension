# ShieldBlock Architecture

## Research Summary

As of March 30, 2026, the reliable YouTube-blocking options available to browser extensions fall into four buckets:

1. Network filtering
   Chrome MV3 uses `declarativeNetRequest` (DNR), which is privacy-friendly and fast, but static rulesets are bundled and only a limited number of rulesets can be enabled at once. DNR works well for broad ad/tracker hosts, telemetry endpoints, and some YouTube ad endpoints, but it is not flexible enough on its own for YouTube's frequently changing player payloads.

2. In-page request and payload interception
   YouTube often delivers ad scheduling information inside `ytInitialPlayerResponse`, `ytInitialData`, or `youtubei/v1/player`-style JSON payloads. Intercepting these payloads in the page context and stripping ad metadata before the player consumes it is the most reliable MV3-safe technique for pre-roll and mid-roll suppression without fighting playback controls.

3. DOM/CSS cleanup
   Cosmetic filtering is still necessary for overlays, sponsored shelves, companion banners, and promoted cards. It should be lightweight, targeted, and avoid broad DOM scanning loops on YouTube because those create jank.

4. Player manipulation
   Fast-forwarding ad streams, repeatedly forcing play, or constantly mutating the player's internal state can appear to work, but it is brittle and often causes black screens, broken pause/play behavior, and visible flashes. This approach is intentionally minimized here.

## Final Architecture Decision

ShieldBlock uses a hybrid design:

1. General cross-site blocking via bundled DNR rules imported from EasyList/EasyPrivacy/Fanboy-derived snapshots.
2. YouTube-specific page-context interception to sanitize player and browse payloads before YouTube consumes them.
3. Lightweight YouTube UI cleanup for overlays, sponsored cards, and skip-button assistance.
4. Background-managed dynamic update channel for a small signed/integrity-checked site-fix delta.
5. Local-only storage, counters, and allowlist management. No browsing data leaves the device.

This is the best fit for MV3 because it avoids the two extremes:

- DNR-only: too weak for YouTube's dynamic payloads.
- player-hack-only: too fragile and visually noisy.

## How Each YouTube Ad Type Is Handled

- Pre-roll video ads:
  The injected page hook sanitizes `ytInitialPlayerResponse` and `youtubei/v1/player` responses to remove `adPlacements`, `playerAds`, `cueRanges`, and related ad scheduling keys before the player processes them. DNR also blocks known ad telemetry endpoints.

- Mid-roll ads:
  The same payload sanitization removes ad break metadata and cue ranges that schedule breaks during playback. This is more stable than seeking the player timeline.

- Overlays and banners:
  The YouTube content script applies a small CSS ruleset to hide ad overlay containers, companion slots, and inline player ad decorations.

- Sponsored cards and promoted feed content:
  The YouTube content script inspects known promoted renderers plus text/link heuristics and removes sponsored shelves/cards from feeds and sidebars.

- Skip buttons:
  As a fallback, visible skip buttons are clicked quickly. This is only a secondary path and does not attempt to force playback.

## Why This Is Smoother Than The Previous Builds

The earlier prototypes relied on:

- aggressive mutation polling
- broad blocking of media URLs
- auto-resume and playback-rate hacks
- fighting `ad-showing` state after YouTube had already entered ad mode

Those approaches caused black screens, `0:00 / 0:00` shells, and broken pause behavior. The new design shifts most YouTube work earlier in the lifecycle, at the payload layer.

## MV3 Rule Limits And Update Strategy

Chrome MV3 limits the number of static rulesets that can be enabled at once, even though each ruleset can contain many rules. ShieldBlock keeps large bundled rules in six static rulesets and reserves dynamic rules for a very small update delta.

The update path is:

1. Bundled fallback manifest for safe offline defaults.
2. Optional remote manifest URL for site-fix deltas.
3. SHA-256 integrity verification before applying dynamic rules.
4. Automatic rollback to bundled fallback if the remote fetch fails.

This keeps updates lightweight and avoids trying to remotely replace the entire blocker core.

## Browser Strategy

- Chrome:
  MV3 service worker + DNR + content scripts + page-context YouTube hook.

- Firefox:
  Same shared source and browser-specific manifest. The code avoids Chrome-only assumptions and adds Firefox data-collection metadata declaring no data collection.

## Privacy And Permissions

Requested permissions are intentionally narrow for an ad blocker:

- `declarativeNetRequestWithHostAccess`
  Needed for network blocking while reducing user-facing permission friction compared with broader approaches.

- `storage`
  Needed for local settings, allowlist, counters, and learned site rules.

- `tabs` and `activeTab`
  Needed for the popup to query the current tab and activate the element picker.

- `alarms`
  Needed for scheduled rule-update checks.

- `<all_urls>`
  Required because ad/tracker blocking and YouTube/site fixes must run across arbitrary sites.

No telemetry, analytics, or remote code execution is used.

## Known Limitations

- Live YouTube behavior still requires periodic maintenance because YouTube changes payload formats and promoted renderers.
- Chrome MV3 cannot dynamically replace huge filter lists at runtime the way legacy MV2 blockers once could.
- The provided automated E2E test is a synthetic YouTube fixture, not a full live YouTube playback test.
