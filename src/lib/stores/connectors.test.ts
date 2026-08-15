/**
 * The reconnect prompt's condition.
 *
 * Credentials are deliberately outside the backup envelope, and this is the cost of that
 * choice: restore onto a new device and the whole library comes back — ratings, reviews,
 * Steam links and all — with no Steam account attached. The state is real and the user has
 * no way to guess it, so it has to be derived and shown rather than discovered when a sync
 * quietly does nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';

import { links } from './library';
import {
  connections,
  connectionsLoaded,
  linkedGameCounts,
  needsReconnect,
  type Connection,
} from './connectors';
import type { PlatformLink } from '../types';

function link(gameId: string, extra: Partial<PlatformLink> = {}): PlatformLink {
  const now = Date.now();
  return {
    id: `l-${gameId}-${extra.platform ?? 'steam'}`,
    gameId,
    platform: 'steam',
    externalId: `app-${gameId}`,
    confidence: 'exact',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

const connected: Connection = {
  platform: 'steam',
  connectedAt: Date.now(),
  account: '7'.repeat(17),
};

beforeEach(() => {
  links.set([]);
  connections.set({});
  connectionsLoaded.set(true);
});

describe('needsReconnect', () => {
  it('is silent while connections are still loading', () => {
    connectionsLoaded.set(false);
    links.set([link('a')]);
    // Otherwise every boot flashes "reconnect" for a moment before the read resolves, which
    // is worse than saying nothing.
    expect(get(needsReconnect)).toEqual([]);
  });

  it('is silent for a library with no platform links at all', () => {
    expect(get(needsReconnect)).toEqual([]);
  });

  it('is silent when the platform is connected', () => {
    links.set([link('a')]);
    connections.set({ steam: connected });
    expect(get(needsReconnect)).toEqual([]);
  });

  it('asks for a reconnect when links survived a restore but the credential did not', () => {
    links.set([link('a'), link('b')]);
    expect(get(needsReconnect)).toEqual(['steam']);
  });

  it('resolves itself the moment the platform is reconnected', () => {
    links.set([link('a')]);
    expect(get(needsReconnect)).toEqual(['steam']);
    connections.set({ steam: connected });
    expect(get(needsReconnect)).toEqual([]);
  });

  it('ignores links a disconnect tombstoned', () => {
    // Disconnecting removes the credential *and* tombstones the links, so the prompt must
    // not immediately reappear telling the user to undo what they just chose.
    links.set([link('a', { deleted: Date.now() })]);
    expect(get(needsReconnect)).toEqual([]);
  });

  it('names each platform once, however many games are linked', () => {
    links.set([link('a'), link('b'), link('c', { platform: 'xbox', id: 'l-c-xbox' })]);
    expect(get(needsReconnect).sort()).toEqual(['steam', 'xbox']);
  });
});

describe('linkedGameCounts', () => {
  it('counts games, not links', () => {
    links.set([
      link('a'),
      link('b'),
      // The same game linked twice on one platform is still one game.
      link('a', { id: 'l-a-dupe', externalId: 'app-a-alt' }),
      link('c', { platform: 'xbox', id: 'l-c-xbox' }),
    ]);
    expect(get(linkedGameCounts)).toEqual({ steam: 2, xbox: 1 });
  });

  it('leaves tombstoned links out of the number the prompt shows', () => {
    links.set([link('a'), link('b', { deleted: Date.now() })]);
    expect(get(linkedGameCounts)).toEqual({ steam: 1 });
  });
});
