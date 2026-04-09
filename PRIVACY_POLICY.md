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

ShieldBlock AI does not send browsing data to external servers.

The extension only makes outbound requests to download public filter lists used for blocking:

- `https://easylist.to/easylist/easylist.txt`
- `https://easylist.to/easylist/easyprivacy.txt`
- `https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`
- `https://filters.adtidy.org/extension/chromium/filters/2.txt`

These requests are made by the background service worker on install and periodic refresh. No page data or user identifiers are attached intentionally by ShieldBlock AI.

## Storage

ShieldBlock AI stores settings locally using `chrome.storage.local`.

Stored data is limited to:

- enabled or disabled state
- rule counts and refresh timestamps
- filter list status
- allowlisted domains
- custom network and cosmetic rules
- debug flag
- local subsystem counters

## Data Sharing

ShieldBlock AI does not sell data, rent data, or share data with advertisers, analytics vendors, or data brokers.

## Contact

For privacy questions, contact: `privacy@shieldblock.example`
