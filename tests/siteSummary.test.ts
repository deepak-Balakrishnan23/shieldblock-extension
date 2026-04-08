import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { computePageSummary } from '../src/shared/siteSummary';

describe('computePageSummary', () => {
  it('scores pages with multiple ad signals higher', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Fixture</title>
      <div data-shieldblock-signal></div>
      <div data-shieldblock-signal></div>
      <div data-shieldblock-hidden></div>
      <iframe></iframe>
      <div aria-label="Sponsored"></div>
    `);

    const summary = computePageSummary(dom.window.document, 'example.com', true, false);

    expect(summary.hostname).toBe('example.com');
    expect(summary.intrusionScore).toBeGreaterThan(20);
    expect(summary.status).toMatch(/ad pressure/i);
  });
});
