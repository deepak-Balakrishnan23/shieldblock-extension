# Test Report

Date: March 30, 2026

## Automated Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Automated Results

- `npm run lint`
  Passed

- `npm run typecheck`
  Passed

- `npm test`
  Passed

- `npm run test:e2e`
  Passed when executed outside the sandbox so Playwright could launch Chromium.

- `npm run build`
  Passed
  Outputs created in:
  - `dist/chrome`
  - `dist/firefox`

## Test Scope

Unit coverage:

- YouTube payload sanitization
- Sponsored-card heuristics
- Page-summary scoring
- Update integrity hashing

Synthetic browser coverage:

- simulated promoted YouTube card removal
- simulated player payload ad stripping

## Manual YouTube Verification Status

Live YouTube verification was prepared but not completed inside this workspace because that requires loading the unpacked extension into a real browser session against YouTube.

Prepared manual verification targets:

- `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- `https://www.youtube.com/watch?v=aqz-KE-bpKQ`
- `https://www.youtube.com/`
- `https://www.youtube.com/results?search_query=technology`

## Performance Notes

Optimizations applied:

- no generic heavy DOM scanners on YouTube
- no forced playback resumes
- no playback-rate hacks
- targeted mutation observers only
- early payload filtering to avoid expensive late-stage recovery
- small CSS selectors scoped to known YouTube ad UI

Expected overhead:

- background: negligible idle service-worker footprint
- content scripts: low steady-state CPU on non-YouTube pages
- YouTube: small polling loop plus mutation observer, designed to stay below the earlier prototype's visible jank

## Remaining Recommendation

Run one live browser verification pass in Chrome stable and Firefox stable, capture screenshots and service-worker logs, and append them here before store submission.
