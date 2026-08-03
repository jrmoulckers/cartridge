import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PLATFORMS, platformsNeedingServerCredentials } from '../lib/platforms.ts';

test('tracks all four platforms exactly once', () => {
  const ids = PLATFORMS.map((platform) => platform.id);
  assert.deepEqual([...ids].sort(), ['nintendo', 'playstation', 'steam', 'xbox']);
  assert.equal(new Set(ids).size, ids.length);
});

test('only Nintendo is credential-free (manual entry)', () => {
  const ids = platformsNeedingServerCredentials().map((platform) => platform.id);
  assert.deepEqual([...ids].sort(), ['playstation', 'steam', 'xbox']);
});
