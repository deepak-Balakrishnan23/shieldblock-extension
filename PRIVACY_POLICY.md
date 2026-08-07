# ShieldBlock AI Privacy Policy

**Last updated: 1 August 2026**

ShieldBlock AI does not collect, sell, transfer, or monetize personal data.
There is no account, no sign-in, no analytics, and no telemetry of any kind.

## What ShieldBlock AI Processes

ShieldBlock AI processes page content, network metadata, and user-created
settings locally inside Chrome so it can block ads, trackers, annoyances, and
sponsored content.

All detection and blocking logic runs on your device. This includes:

- declarative network request rules
- cosmetic filtering
- heuristic scoring
- machine-learning classification
- custom rules and allowlists
- local usage counters

## What ShieldBlock AI Does Not Collect

ShieldBlock AI does not collect:

- browsing history
- page content
- account information
- email addresses
- passwords
- form entries
- personal identifiers
- request URLs

None of the above is transmitted anywhere or stored outside your browser.

## Network Requests

ShieldBlock AI does not send your browsing history, page content, or any
personal identifier to any server. It makes only the following outbound
requests.

### 1. Filter lists (optional, off by default)

The filter rules that power blocking are compiled into the extension when it is
built, so a normal install makes **no network request at all** to obtain them.

Scheduled re-downloading of filter lists is disabled by default. It happens only
if you turn on live filter updates in the options page, or press the refresh
button yourself. In that case the extension downloads these public lists:

- `https://easylist.to/easylist/easylist.txt`
- `https://easylist.to/easylist/easyprivacy.txt`
- `https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`
- `https://filters.adtidy.org/extension/chromium/filters/2.txt`

These are plain text files. No page data, browsing information, or user
identifier is attached to the request, and nothing about you is sent to the
list providers beyond the ordinary act of downloading a public file.

### 2. SponsorBlock segment lookups (YouTube only)

To skip in-video sponsor segments on YouTube, the extension queries the
community SponsorBlock API at `https://sponsor.ajay.app`.

To protect your privacy it sends **only a 4-character SHA-256 hash prefix of the
video ID**. That prefix matches many thousands of different videos, so the
service cannot determine which video you are watching. The full video ID, your
identity, and your watch history are never sent, and no cookie or identifier is
attached.

This request is made only while you are viewing a YouTube video with protection
enabled. You can switch SponsorBlock off in the options page, after which the
extension makes no outbound requests at all.

### 3. Malware and phishing protection

Uses a blocklist bundled inside the extension. It requires no network request,
and nothing about the pages you visit is ever looked up remotely.

## Storage

ShieldBlock AI stores your settings locally using `chrome.storage.local`. It
does not use `chrome.storage.sync`, so nothing is copied to your Google account
or between devices.

Stored data is limited to:

- enabled or disabled state
- rule counts and refresh timestamps
- filter list status
- allowlisted domains
- custom network and cosmetic rules
- debug and feature flags
- local subsystem counters and per-day blocked totals

You can erase all of it at any time with **Reset to defaults** in the options
page, or by removing the extension.

## Data Sharing

ShieldBlock AI does not sell data, rent data, or share data with advertisers,
analytics vendors, or data brokers. There is no third party with access to
anything, because nothing is collected.

## Changes To This Policy

If this policy changes, the "Last updated" date above will change with it, and
the revised policy will be published at the same address before the change takes
effect.

## Contact

For privacy questions, contact: **<REPLACE WITH A REAL MONITORED EMAIL ADDRESS>**
