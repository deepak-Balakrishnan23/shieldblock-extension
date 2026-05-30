# ShieldBlock AI Privacy Policy

ShieldBlock AI does not collect, sell, transfer, or monetize personal data.

## What ShieldBlock AI Processes

ShieldBlock AI processes page content, network metadata, and user-created settings locally inside Chrome so it can block ads, trackers, annoyances, and sponsored content.

All detection and blocking logic runs on-device. This includes:

- declarative network request rules
- cosmetic filtering
- heuristic scoring
- machine-learning classification
- custom rules and allowlists
- local usage counters

## What ShieldBlock AI Does Not Collect

ShieldBlock AI does not collect:

- browsing history for remote storage
- page content for remote storage
- account information
- email addresses
- passwords
- form entries
- personal identifiers
- full request URLs in extension storage

## Network Requests

ShieldBlock AI does not send your browsing history, page content, or any
personal identifiers to external servers. It makes only the following outbound
requests:

### 1. Filter list downloads (background service worker)

Public ad/tracker filter lists are downloaded on install and on periodic
refresh:

- `https://easylist.to/easylist/easylist.txt`
- `https://easylist.to/easylist/easyprivacy.txt`
- `https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`
- `https://filters.adtidy.org/extension/chromium/filters/2.txt`

No page data or user identifiers are attached to these requests.

### 2. SponsorBlock segment lookups (YouTube only)

To skip in-video sponsor segments on YouTube, the extension queries the
community SponsorBlock API at `https://sponsor.ajay.app`. To protect privacy it
sends **only a 4-character SHA-256 hash prefix of the video ID** (k-anonymity) —
never the full video ID, your identity, or your watch history. This request is
made only while you are viewing a YouTube video and protection is enabled.

Malware, phishing, and cryptominer protection uses a blocklist bundled inside
the extension and requires no network request.

## Storage

ShieldBlock AI stores settings locally using `chrome.storage.local`.

Stored data is limited to:

- enabled or disabled state
- rule counts and refresh timestamps
- filter list status
- allowlisted domains
- custom network and cosmetic rules
- debug flag
- local subsystem counters and per-day blocked totals

## Data Sharing

ShieldBlock AI does not sell data, rent data, or share data with advertisers, analytics vendors, or data brokers.

## Contact

For privacy questions, contact: `privacy@shieldblock.example`
