# Testing strategy

## Automated checks

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Manual blocking tests

1. Load `/Users/baladhak/Documents/New project/shieldblock-extension/dist/chrome` as an unpacked extension.
2. Add `youtube.com` in the popup or click the preset in options.
3. Verify the following are blocked:
   - `https://www.youtube.com/`
   - `https://m.youtube.com/`
   - `https://www.youtube.com/shorts/<id>`
   - `https://youtu.be/<id>`
   - `https://www.youtube-nocookie.com/embed/<id>`
4. Open a page that embeds a YouTube iframe and confirm the frame does not render.
5. Open a blocked site first, then add the rule, and confirm the tab is redirected or overlaid without requiring a browser restart.
6. Test a schedule window, including an overnight window such as `22:00` to `06:00`.

## Edge cases

- Invalid input such as blank strings or malformed regex should fail gracefully in the UI.
- Chrome restart should preserve the block list and rebuild dynamic rules on startup.
- SPA route changes should still trigger the overlay after a `pushState` navigation.
- Allowlisting the active hostname should immediately unblock that host while leaving broader rules intact.

## Debugging tips

- Use `chrome://extensions`, open the service worker console, and inspect dynamic rule rebuilds.
- On blocked pages, confirm that `blocked.html` is shown for top-level navigations and that the overlay appears on already-open tabs.
- Use the Elements panel to verify `#shieldblock-overlay` exists when strict mode catches a page post-load.
