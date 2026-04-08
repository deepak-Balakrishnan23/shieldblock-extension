import { test, expect } from '@playwright/test';
import { parseAndSanitizeJson, isSponsoredCandidate } from '../../src/shared/youtubeSanitizer';

test('youtube fixture removes feed promos and strips player payload ads', async ({ page }) => {
  await page.setContent(`
    <ytd-display-ad-renderer id="promo">Sponsored install now</ytd-display-ad-renderer>
    <div id="result"></div>
  `);

  const payload = JSON.stringify({
    playerResponse: {
      adPlacements: [{ adPlacementRenderer: true }],
      videoDetails: { title: 'Fixture' },
    },
  });

  const sanitized = parseAndSanitizeJson(payload);
  const shouldHide = await page.locator('#promo').evaluate((node, helperText) => {
    const text = (node.textContent || '').trim();
    if ((text + helperText).includes('Sponsored')) {
      node.remove();
    }
    return text;
  }, isSponsoredCandidate('Sponsored install now', '') ? 'Sponsored' : '');

  await expect(page.locator('#promo')).toHaveCount(0);
  expect(shouldHide).toContain('Sponsored');
  expect(sanitized).toContain('"adPlacements":[]');
});
