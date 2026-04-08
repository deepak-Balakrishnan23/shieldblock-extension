# Testing Checklist

## Automated

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Optional synthetic browser test:

```bash
npx playwright install chromium
npm run test:e2e
```

## Manual YouTube Verification

Run these checks in a clean browser profile with no other blockers installed.

1. Load the unpacked Chrome build from `dist/chrome`.
2. Close all open YouTube tabs.
3. Open a fresh watch page directly.
4. Verify:
   - no pre-roll ad video plays
   - no black `0:00 / 0:00` or `0:00 / 0:30` shell appears
   - pause/play controls work normally
   - comments, captions, subscriptions, and seekbar still work
5. Watch a long video for at least 15 minutes to check mid-roll suppression.
6. Check the homepage and search results for promoted cards and sponsored shelves.
7. Repeat both logged out and logged in.

## Suggested Manual URLs

- Pre-roll watch page: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Long-form mid-roll check: `https://www.youtube.com/watch?v=aqz-KE-bpKQ`
- Homepage feed: `https://www.youtube.com/`
- Search feed: `https://www.youtube.com/results?search_query=technology`

## 30-Minute Stability Run

1. Leave YouTube open for 30 minutes.
2. Navigate between home, search, and at least 3 watch pages.
3. Watch memory in the browser task manager.
4. Confirm no repeating runtime errors in the extension service worker console.

## Known Limits

- Live YouTube behavior can regress when YouTube changes internal payload fields.
- The synthetic E2E test validates the sanitizer and promoted-card path, not live YouTube's production servers.
