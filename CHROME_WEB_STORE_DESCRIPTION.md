# Chrome Web Store Listing Draft

## Short description

Adaptive ad blocker with local tracker blocking, annoyance removal, and on-device phishing warnings.

## Full description

ShieldBlock is a local-first Manifest V3 blocker designed to reduce ads, trackers, cookie banners, and intrusive overlays while warning about suspicious pages.

### Core features

- Blocks ad and tracker requests with Manifest V3 declarative rules
- Ships with imported public filter coverage inspired by EasyList, EasyPrivacy, and Fanboy-style annoyance filtering
- Hides intrusive overlays, newsletter popups, and cookie banners
- Uses on-device heuristic and ML layers to catch harder page-side ad patterns
- Learns site-specific fixes with "Teach This Site"
- Shows local phishing warnings without sending URLs to external APIs
- Stores settings and learned rules locally in Chrome storage

### Privacy

- No remote-hosted code
- No ad tech SDKs
- No sale of user data
- No external browsing-data processing in the current extension logic

### Why permissions are needed

- Website access: required to apply blocking and page cleanup across websites
- Storage: required for settings, allowlist entries, counters, and learned site rules
- Tabs and active tab: required to show current-site insight and trigger page-side tools like Teach This Site

### Good fit for

- Users who want a lightweight Manifest V3 blocker
- Users who want local-first behavior
- Users who want per-site adaptive cleanup instead of a pure static list only

### Avoid these unsupported claims

Do not claim:

- 100% blocking
- best ad blocker
- guaranteed Chrome approval
- perfect phishing detection
