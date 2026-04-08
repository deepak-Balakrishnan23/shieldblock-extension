# Chrome Web Store Reviewer Notes

ShieldBlock is a Manifest V3 browser extension whose single purpose is to block ads and trackers, remove intrusive page elements, and show on-device phishing warnings.

ShieldBlock includes packaged public filter coverage compiled into static Manifest V3 rulesets. These lists are bundled into the extension package and are not executed as remote code.

## Why broad website access is requested

ShieldBlock applies blocking and cosmetic filtering across arbitrary websites. Broad host access is required because the extension:

- applies Manifest V3 rules across sites
- injects page-side cleanup logic
- hides intrusive overlays
- allows the user to teach site-specific cosmetic fixes
- computes current-site insights locally

## Why storage is requested

Storage is used only for:

- toggle settings
- allowlist entries
- local counters
- learned site-specific rules
- adaptive site profiles
- recent local activity items

## Why tabs and activeTab are requested

Tabs and activeTab are used to:

- identify the current site for popup insight
- send a Teach This Site request to the active tab
- keep UI and content-script state in sync

## Data handling

ShieldBlock processes URLs and page elements locally on-device. The reviewed code does not transmit browsing data to an external server.
