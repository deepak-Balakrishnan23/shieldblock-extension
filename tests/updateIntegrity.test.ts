import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/shared/utils';

describe('sha256Hex', () => {
  it('creates stable digests for update payloads', async () => {
    const digest = await sha256Hex(JSON.stringify({ hello: 'world' }));
    expect(digest).toHaveLength(64);
    expect(digest).toBe('93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588');
  });
});
