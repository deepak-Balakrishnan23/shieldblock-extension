import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileRules, parseFilterList } from '../filter-compiler.js';

/**
 * Parses a single filter line.
 * @param {string} line
 * @returns {object|undefined}
 */
function parseOne(line) {
  return parseFilterList(line)[0];
}

describe('non-network filter syntax', () => {
  // Every one of these once compiled into a junk network rule. The `$$` case
  // was the dangerous one: splitting at `$` blocked the whole domain.
  const nonNetworkLines = [
    ["winaero.com#%#//scriptlet('abort-current-inline-script', 'jQuery')", 'AdGuard scriptlet'],
    ['example.com$$script[data-src="ad"]', 'AdGuard HTML filter'],
    ['example.com##.ad', 'cosmetic'],
    ['example.com#@#.ad', 'cosmetic exception'],
    ['example.com#?#div:has(.ad)', 'procedural cosmetic'],
    ['example.com#$#.ad { display: none }', 'CSS injection'],
    ['example.com#@$#.ad { display: none }', 'CSS injection exception'],
  ];

  for (const [line, label] of nonNetworkLines) {
    it(`skips ${label}`, () => {
      assert.equal(parseFilterList(line).length, 0);
    });
  }
});

describe('urlFilter normalization', () => {
  it('domain-anchors a bare hostname', () => {
    assert.equal(parseOne('||doubleclick.net^$third-party').condition.urlFilter, '||doubleclick.net^');
  });

  it('never emits a pattern beginning with "||*"', () => {
    // Chrome rejects `||*` outright, which invalidates the entire ruleset file.
    const rule = parseOne('*.gif');
    assert.ok(rule === undefined || !rule.condition.urlFilter.startsWith('||*'));
  });

  it('strips a leading wildcard instead of anchoring it', () => {
    assert.equal(parseOne('*.gif').condition.urlFilter, '.gif');
  });

  it('percent-encodes non-ASCII so the pattern stays DNR-legal', () => {
    assert.equal(
      parseOne('||beerfaucet.io/promo/300×250.gif').condition.urlFilter,
      '||beerfaucet.io/promo/300%C3%97250.gif',
    );
  });

  it('keeps path fragments as substring matches rather than anchoring them', () => {
    assert.equal(parseOne('/adserver^').condition.urlFilter, '/adserver^');
  });

  it('drops regex filters, which DNR urlFilter cannot express', () => {
    assert.equal(parseFilterList('/banner\\d+/').length, 0);
  });
});

describe('modifiers', () => {
  it('maps the 1p/3p party shorthands', () => {
    assert.equal(parseOne('||a.com^$3p').condition.domainType, 'thirdParty');
    assert.equal(parseOne('||a.com^$1p').condition.domainType, 'firstParty');
  });

  it('maps the frame alias to sub_frame', () => {
    assert.deepEqual(parseOne('||a.com^$frame').condition.resourceTypes, ['sub_frame']);
  });

  it('splits domain= into included and excluded initiators', () => {
    const condition = parseOne('||a.com^$domain=b.com|~c.com').condition;
    assert.deepEqual(condition.initiatorDomains, ['b.com']);
    assert.deepEqual(condition.excludedInitiatorDomains, ['c.com']);
  });

  it('drops rules whose domain= cannot be expressed as plain hostnames', () => {
    // One malformed host makes Chrome reject the whole ruleset it lives in.
    assert.equal(parseFilterList('||a.com^$domain=/regex/').length, 0);
  });
});

describe('exception rules', () => {
  it('compiles a bare exception to an allow rule that outranks blocks', () => {
    const rule = parseOne('@@||paypal.com/checkout^');
    assert.equal(rule.action.type, 'allow');
    assert.ok(rule.priority > parseOne('||paypal.com/checkout^').priority);
  });

  it('compiles $document to allowAllRequests on navigation types only', () => {
    const rule = parseOne('@@||example.com^$document');
    assert.equal(rule.action.type, 'allowAllRequests');
    assert.deepEqual(rule.condition.resourceTypes, ['main_frame', 'sub_frame']);
  });

  it('treats $all like $document', () => {
    assert.equal(parseOne('@@||example.com^$all').action.type, 'allowAllRequests');
  });

  it('scopes an exception to the listed resource types', () => {
    assert.deepEqual(parseOne('@@||cdn.example.com^$script,image').condition.resourceTypes, ['script', 'image']);
  });

  it('skips cosmetic-only exceptions, which carry no network meaning', () => {
    for (const line of ['@@||a.com^$generichide', '@@||a.com^$ghide', '@@||a.com^$stealth=donottrack']) {
      assert.equal(parseFilterList(line).length, 0, line);
    }
  });

  it('keeps the network half of a mixed cosmetic exception', () => {
    // Discarding this over `elemhide` would leave the site broken.
    assert.equal(parseOne('@@||example.com^$document,elemhide').action.type, 'allowAllRequests');
  });

  it('skips exceptions whose modifiers have no DNR equivalent', () => {
    for (const line of ['@@||a.com^$popup', '@@||a.com^$badfilter', '@@||a.com^$csp=script-src none']) {
      assert.equal(parseFilterList(line).length, 0, line);
    }
  });
});

describe('priority ladder', () => {
  const priorityOf = (line) => parseOne(line).priority;

  it('orders block < exception < important block < important exception', () => {
    assert.ok(priorityOf('||a.com^') < priorityOf('@@||a.com^'));
    assert.ok(priorityOf('@@||a.com^') < priorityOf('||a.com^$important'));
    assert.ok(priorityOf('||a.com^$important') < priorityOf('@@||a.com^$important'));
  });

  it('keeps every generated priority below the user allowlist priority of 1000', () => {
    for (const line of ['||a.com^$important', '@@||a.com^$important', '@@||a.com^$document,important']) {
      assert.ok(priorityOf(line) < 1000, line);
    }
  });
});

describe('compileRules', () => {
  it('preserves a rule action instead of forcing every rule to block', () => {
    const compiled = compileRules(parseFilterList('@@||a.com^'), 1);
    assert.equal(compiled[0].action.type, 'allow');
  });

  it('keeps a block and its exception rather than deduplicating them together', () => {
    // They share a condition; collapsing them would silently drop the exception.
    const compiled = compileRules(parseFilterList('||ads.example.com^\n@@||ads.example.com^'), 1);
    assert.deepEqual(compiled.map((rule) => rule.action.type), ['block', 'allow']);
  });

  it('assigns unique sequential ids from the given start', () => {
    const compiled = compileRules(parseFilterList('||a.com^\n||b.com^\n||c.com^'), 500);
    assert.deepEqual(compiled.map((rule) => rule.id), [500, 501, 502]);
  });

  it('deduplicates identical rules', () => {
    assert.equal(compileRules(parseFilterList('||a.com^\n||a.com^'), 1).length, 1);
  });
});
