# Chrome Web Store Listing

Everything below is copy-paste ready for the Developer Dashboard.
Build the assets with `npm run package` and `npm run screenshots`.

## Store Settings

| Field | Value |
| --- | --- |
| Name | ShieldBlock AI |
| Category | **Privacy & Security** |
| Language | **English (United States)** |
| Package | `dist/shieldblock-ai-v3.0.1.zip` |
| Store icon | `icons/icon128.png` (128×128 PNG) |
| Screenshots | `dist/store/screenshot-1..5.png` (1280×800, 24-bit PNG) |
| Privacy policy | Host `PRIVACY_POLICY.md` at a public URL and link it — required, because the extension requests host permissions |

## Short Description

*Max 132 characters.*

```
Blocks ads, trackers, and YouTube ads on your device. 133,000 filter rules built in. No accounts, no data collection.
```

## Full Description

```
ShieldBlock AI blocks ads, trackers, and annoyances on your device. No accounts, no analytics, and nothing about your browsing is ever collected.

WORKS THE MOMENT YOU INSTALL IT
133,000 filter rules are compiled into the extension ahead of time, so protection is active on the very first page you open. There is no list to download and no waiting.

FIVE LAYERS OF BLOCKING
• Network rules stop ad and tracker requests before they load
• Cosmetic filtering removes the empty frames ads leave behind
• Scriptlets defeat anti-adblock walls on supported sites
• Heuristics catch native and in-feed ads that lists miss
• An on-device ML classifier scores borderline sponsored content

BUILT NOT TO BREAK SITES
Filter lists ship thousands of exception rules that exist to keep payment flows, logins, and shared CDNs working. ShieldBlock AI compiles all of them, so blocking stays aggressive without taking the rest of the page down with it.

YOUTUBE
Skips video ads, mutes and burns through pre-rolls and mid-rolls, and includes SponsorBlock so in-video sponsor segments are skipped too.

PRIVACY, PLAINLY
• No accounts, no sign-in, no sync
• No analytics, no telemetry, no tracking of any kind
• Ad filtering, heuristics, and ML scoring all run on your device
• Your browsing history and page content are never collected or transmitted
• The one feature that contacts a server is SponsorBlock, and it is built so it cannot identify what you watch: it sends only a four-character hash prefix of the video ID, never the video itself. Switch it off in settings and the extension makes no outbound requests at all.

CONTROLS FOR PEOPLE WHO WANT THEM
• Allowlist any site with one click, per domain
• Write your own ABP and cosmetic filter rules
• Point-and-click element picker for anything left over
• Export and import your full configuration
• Live counters for every blocking layer

Uses EasyList, EasyPrivacy, uBlock Origin filters, and AdGuard Base.
```

## Single Purpose

*Required field.*

```
ShieldBlock AI blocks advertisements, trackers, and related nuisance content on web pages.
```

## Privacy Practices Tab

Paste each block into its matching field. Vague answers are the most common
rejection reason, so each one states what the permission does, why the feature
cannot work without it, and what happens to user data.

### Permission: `alarms`

```
Schedules the optional periodic refresh of filter lists. The extension registers a single alarm that, only when the user has turned on live filter updates, wakes the service worker to re-download the public filter lists (EasyList, EasyPrivacy, uBlock Origin, AdGuard Base) and recompile them into blocking rules. The alarm involves no user data of any kind.
```

### Permission: `declarativeNetRequest`

```
This is the extension's core ad-blocking mechanism. ShieldBlock AI ships pre-compiled static rulesets that tell Chrome which advertising and tracking requests to block, plus a small number of dynamic rules for the user's own custom filters and their per-site allowlist. declarativeNetRequest is what makes this possible without the extension reading, intercepting, or logging any network request itself: Chrome matches the rules internally. The extension never sees request URLs or contents.
```

### Host permissions (`<all_urls>`)

```
Advertising and tracking content appears on essentially every website, so there is no finite list of sites the user could pre-approve. Host access lets the extension's content scripts run on the pages the user visits in order to: hide the empty ad containers and layout gaps that remain after a network request is blocked; detect in-feed "native" ads that filter lists do not cover; and skip video ads and sponsor segments on YouTube.

These scripts read only the page's own DOM, in the page, to decide which elements to hide. No page content, URL, form data, or browsing history is collected, stored remotely, or transmitted to us or to any third party.
```

### Permission: `scripting`

```
Used to inject the extension's own bundled ml-classifier.js into a frame on demand. The classifier is a 91 KB on-device model used to score borderline sponsored content, so it is loaded lazily — only the first time a page actually contains an element the faster heuristics cannot classify confidently — rather than on every page the user opens. The injected file ships inside the extension package; no code is fetched from a server.
```

### Permission: `storage`

```
Stores the user's own configuration locally: whether protection is enabled, their per-domain allowlist, any custom filter rules they have written, and the counters of blocked items shown in the popup. This uses chrome.storage.local only. Nothing is written to chrome.storage.sync, and none of it is transmitted off the device.
```

### Permission: `tabs`

```
Used to read the hostname of the currently active tab so the popup can show whether the site the user is looking at is protected or allowlisted, so the one-click allowlist button applies to the correct domain, and so open tabs can be notified when the user changes a setting. Only the hostname of the active tab is used, only while the popup is open or a setting changes. The extension does not read, record, or transmit browsing history.
```

### Remote code

Select **"No, I am not using remote code."** Then paste:

```
All executable code ships inside the extension package: the service worker, content scripts, scriptlets, and the ML classifier. The extension contains no eval(), no new Function(), no importScripts(), and it never creates script elements or injects code from a URL. chrome.scripting.executeScript is used only to inject ml-classifier.js, a file bundled in the package.

The extension does download public filter lists over HTTPS, and looks up SponsorBlock segments, but both return plain data — filter-list text is parsed into declarativeNetRequest rule objects and JSON is read as values. Neither is ever executed as code.
```

### Single purpose

```
ShieldBlock AI has a single purpose: blocking advertisements, trackers, and related nuisance content on web pages. Every feature serves that purpose — network-level request blocking, cosmetic hiding of the ad containers left behind, heuristic detection of in-feed native ads, and skipping video ad and sponsor segments.
```

## Data Usage Disclosures

Answer **no** to every data-collection category — ShieldBlock AI stores nothing
remotely and has no server of its own.

One thing to be aware of before you certify: with SponsorBlock enabled (the
default), the extension requests skip segments from `sponsor.ajay.app`. It sends
only a four-character SHA-256 prefix of the YouTube video ID, so that service
cannot tell which video is being watched, and no identifier of yours is attached.
This is not user-data collection by ShieldBlock, but the request does leave the
browser — so do not describe the extension as making zero network requests, and
mention SponsorBlock in your privacy policy.

Then check:

- [x] I do not sell or transfer user data to third parties, outside of approved use cases
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Screenshot Captions

Optional, but they help conversion.

1. See exactly what was blocked on the page you are on
2. 133,000 filter rules, compiled in and active on first load
3. Write your own rules, or point and click to hide anything
4. Pause protection for one site without disabling the rest
5. Everything runs locally — nothing leaves your browser

## Search Keywords

ad blocker, adblock, privacy, tracker blocker, youtube ads, sponsorblock, popup blocker, cookie banners, anti-adblock
