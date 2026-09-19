import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, it } from 'node:test';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTLET_SOURCE = readFileSync(join(REPO_ROOT, 'scriptlets', 'yt-player.js'), 'utf8');

/**
 * Runs the yt-player scriptlet in a bare context that stands in for a YouTube
 * page, and returns the sandbox. The scriptlet is a MAIN-world IIFE with no
 * exports, so the payload walk is reached through the internals it publishes.
 * @returns {Record<string, any>}
 */
function loadScriptlet(hostname = 'www.youtube.com') {
  const sandbox = {
    document: {
      documentElement: { getAttribute: () => null },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    location: { hostname },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
  };

  const context = createContext(sandbox);
  runInContext(SCRIPTLET_SOURCE, context);
  return context;
}

/**
 * Prunes a payload through the scriptlet's walk and returns it.
 * @param {object} payload
 * @returns {object}
 */
function prune(payload) {
  const context = loadScriptlet();
  context.__shieldblockYtInternals.pruneAds(payload);
  return payload;
}

/**
 * Builds a watch-page player response carrying every ad payload YouTube ships.
 * @returns {object}
 */
function playerResponseWithAds() {
  return {
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'Real video' },
    streamingData: { formats: [{ itag: 18, url: 'https://example.invalid/v' }] },
    playabilityStatus: { status: 'OK' },
    adPlacements: [{ adPlacementRenderer: { config: {} } }],
    adSlots: [{ adSlotRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adBreakHeartbeatParams: 'Q2xpY2s=',
    playerConfig: { audioConfig: { loudnessDb: 1.5 }, adParams: 'xyz' },
  };
}

describe('youtube player response', () => {
  it('removes every ad payload', () => {
    const pruned = prune(playerResponseWithAds());

    for (const key of ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']) {
      assert.equal(key in pruned, false, `${key} survived the prune`);
    }
    assert.equal('adParams' in pruned.playerConfig, false);
  });

  it('leaves the playable video untouched', () => {
    const pruned = prune(playerResponseWithAds());

    assert.equal(pruned.videoDetails.videoId, 'dQw4w9WgXcQ');
    assert.equal(pruned.streamingData.formats.length, 1);
    assert.equal(pruned.playabilityStatus.status, 'OK');
    assert.equal(pruned.playerConfig.audioConfig.loudnessDb, 1.5);
  });

  it('keeps video ids, which are not ad data', () => {
    // Regression guard: `externalVideoId` was once pruned as an ad key, which
    // stripped identifiers out of legitimate branches of the response.
    const pruned = prune({
      streamingData: {},
      videoDetails: {},
      contents: { watchNextRenderer: { externalVideoId: 'abc123', videoId: 'abc123' } },
    });

    assert.equal(pruned.contents.watchNextRenderer.externalVideoId, 'abc123');
    assert.equal(pruned.contents.watchNextRenderer.videoId, 'abc123');
  });
});

describe('youtube feed payloads', () => {
  it('drops feed ad slots and the rich item wrapping them', () => {
    const pruned = prune({
      contents: {
        richGridRenderer: {
          contents: [
            { richItemRenderer: { content: { videoRenderer: { videoId: 'keep-me' } } } },
            { richItemRenderer: { content: { adSlotRenderer: { adLayoutMetadata: {} } }, trackingParams: 'tp' } },
            { richItemRenderer: { content: { inFeedAdLayoutRenderer: {} } } },
          ],
        },
      },
    });

    const remaining = pruned.contents.richGridRenderer.contents;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].richItemRenderer.content.videoRenderer.videoId, 'keep-me');
  });

  it('drops promoted results from search sections', () => {
    const pruned = prune({
      contents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  { searchPyvRenderer: { ads: [{}] } },
                  { videoRenderer: { videoId: 'organic' } },
                  { promotedSparklesTextSearchRenderer: {} },
                ],
              },
            },
          ],
        },
      },
    });

    const results = pruned.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
    assert.equal(results.length, 1);
    assert.equal(results[0].videoRenderer.videoId, 'organic');
  });

  it('drops ads delivered through continuations', () => {
    const pruned = prune({
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              { richItemRenderer: { content: { displayAdRenderer: {} } } },
              { richItemRenderer: { content: { videoRenderer: { videoId: 'organic' } } } },
            ],
          },
        },
      ],
    });

    const items = pruned.onResponseReceivedActions[0]
      .appendContinuationItemsAction.continuationItems;
    assert.equal(items.length, 1);
    assert.equal(items[0].richItemRenderer.content.videoRenderer.videoId, 'organic');
  });

  it('drops Shorts ad slots but keeps the reels around them', () => {
    const pruned = prune({
      contents: {
        reelShelfRenderer: {
          items: [
            { reelItemRenderer: { videoId: 'short-1' } },
            { adSlotRenderer: {} },
            { reelItemRenderer: { videoId: 'short-2' } },
          ],
        },
      },
    });

    const items = pruned.contents.reelShelfRenderer.items;
    assert.deepEqual(items.map((item) => item.reelItemRenderer.videoId), ['short-1', 'short-2']);
  });
});

describe('payload walk safety', () => {
  it('ignores non-objects', () => {
    const context = loadScriptlet();
    const { pruneAds } = context.__shieldblockYtInternals;

    assert.equal(pruneAds(null), null);
    assert.equal(pruneAds(undefined), undefined);
    assert.equal(pruneAds('adPlacements'), 'adPlacements');
  });

  it('terminates on a payload that references itself', () => {
    const payload = { contents: { items: [{ videoRenderer: { videoId: 'a' } }] } };
    payload.contents.self = payload;

    const pruned = prune(payload);
    assert.equal(pruned.contents.items[0].videoRenderer.videoId, 'a');
  });

  it('only walks payloads that look like Innertube responses', () => {
    const context = loadScriptlet();
    const { looksLikeInnertubePayload } = context.__shieldblockYtInternals;

    assert.equal(looksLikeInnertubePayload({ contents: {} }), true);
    assert.equal(looksLikeInnertubePayload({ adPlacements: [] }), true);
    assert.equal(looksLikeInnertubePayload({ theme: 'dark' }), false);
    assert.equal(looksLikeInnertubePayload([{ contents: {} }]), false);
    assert.equal(looksLikeInnertubePayload(null), false);
  });
});

describe('JSON.parse hook', () => {
  it('strips ads from payloads the page parses itself', () => {
    const context = loadScriptlet();
    context.__payload = JSON.stringify(playerResponseWithAds());

    const parsed = runInContext('JSON.parse(globalThis.__payload)', context);

    assert.equal('adPlacements' in parsed, false);
    assert.equal('playerAds' in parsed, false);
    assert.equal(parsed.videoDetails.videoId, 'dQw4w9WgXcQ');
  });

  it('leaves unrelated JSON alone', () => {
    const context = loadScriptlet();
    context.__payload = JSON.stringify({ theme: 'dark', adPlacementsLookalike: 1 });

    const parsed = runInContext('JSON.parse(globalThis.__payload)', context);

    // Compared key by key: the parsed object comes from the sandbox realm, so
    // a deep-strict compare would fail on the prototype, not the contents.
    assert.deepEqual(Object.keys(parsed), ['theme', 'adPlacementsLookalike']);
    assert.equal(parsed.theme, 'dark');
    assert.equal(parsed.adPlacementsLookalike, 1);
  });
});

describe('off-YouTube pages', () => {
  // The manifest loads this scriptlet on every page, so everything it installs
  // has to stay off sites that have no YouTube player to clean up.
  it('installs nothing', () => {
    const context = loadScriptlet('example.com');

    assert.equal(Object.getOwnPropertyDescriptor(context, 'ytInitialPlayerResponse'), undefined);
    assert.equal(context.__sb_yt_hooked, undefined);
    assert.equal(context.__sb_innertube_hooked, undefined);
  });

  it('leaves JSON.parse alone', () => {
    const context = loadScriptlet('example.com');
    context.__payload = JSON.stringify({ contents: {}, adPlacements: [{ adPlacementRenderer: {} }] });

    const parsed = runInContext('JSON.parse(globalThis.__payload)', context);

    assert.equal(parsed.adPlacements.length, 1);
  });
});
