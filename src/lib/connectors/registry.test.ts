/**
 * Proof that the connector seam holds.
 *
 * Two things are asserted here, and both are non-negotiables rather than nice-to-haves:
 *
 * 1. The interface is implementable — a complete connector compiles against it, which is
 *    the only way to know the shape is right before writing four real ones.
 * 2. A connector that throws degrades *exactly one* platform. The healthy platform keeps
 *    returning data and its status stays `ok`.
 *
 * The fakes below are test-only. No connector ships in phase 2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  registerConnector,
  resetRegistry,
  fetchLibrary,
  fetchRecent,
  fetchAchievements,
  refreshAll,
  connectorStatus,
  anyDegraded,
  statusFor,
  registeredConnectors,
} from './registry';
import { ConnectorError, type Connector, type Credentials } from './types';

const credentials: Credentials = { token: 'test' };

/** A well-behaved connector: reports playtime, has achievements, never fails. */
const healthy: Connector = {
  platform: 'steam',
  label: 'Steam',
  capabilities: {
    playtime: true,
    achievements: true,
    lastPlayed: true,
    official: true,
    requiresBridge: true,
  },
  async authenticate() {
    return { status: 'connected', credentials };
  },
  async fetchLibrary() {
    return {
      items: [{ externalId: '1145360', title: 'Hades', minutesPlayed: 1200 }],
    };
  },
  async fetchRecent() {
    return { items: [{ externalId: '1145360', title: 'Hades', minutesPlayed: 1210 }] };
  },
  async fetchAchievements() {
    return { items: [{ externalId: '1145360', achievements: { earned: 30, total: 49 } }] };
  },
};

/** A platform that reports no playtime at all — `null`, never `0`. */
const noPlaytime: Connector = {
  ...healthy,
  platform: 'playstation',
  label: 'PlayStation',
  capabilities: { ...healthy.capabilities, playtime: false },
  async fetchLibrary() {
    return { items: [{ externalId: 'CUSA00001', title: 'Bloodborne', minutesPlayed: null }] };
  },
};

/** A connector that fails the way a real one will: rate-limited, mid-sync. */
const failing: Connector = {
  ...healthy,
  platform: 'xbox',
  label: 'Xbox',
  async fetchLibrary() {
    throw new ConnectorError('xbox', 'rate-limit', 'Xbox asked us to slow down.', {
      retryAfterMs: 60_000,
    });
  },
  async fetchRecent() {
    throw new ConnectorError('xbox', 'rate-limit', 'Xbox asked us to slow down.');
  },
};

/** A connector that misbehaves — throws something that isn't even an Error. */
const rogue: Connector = {
  ...healthy,
  platform: 'nintendo',
  label: 'Nintendo',
  async fetchLibrary() {
    throw 'kaboom';
  },
  async fetchRecent() {
    throw 'kaboom';
  },
};

beforeEach(() => {
  resetRegistry();
});

describe('the registry', () => {
  it('starts empty — no connectors is the supported default', () => {
    expect(registeredConnectors()).toEqual([]);
    expect(get(anyDegraded)).toBe(false);
  });

  it('returns a typed failure for a platform that was never registered', async () => {
    const result = await fetchLibrary('steam', { credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unsupported');
  });

  it('passes a healthy connector’s data through', async () => {
    registerConnector(healthy);
    const result = await fetchLibrary('steam', { credentials });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0].title).toBe('Hades');
    expect(statusFor('steam').health).toBe('ok');
  });

  it('preserves null playtime rather than turning it into zero', async () => {
    registerConnector(noPlaytime);
    const result = await fetchLibrary('playstation', { credentials });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0].minutesPlayed).toBeNull();
  });
});

describe('the error boundary', () => {
  it('turns a ConnectorError into a value instead of a rejection', async () => {
    registerConnector(failing);
    const result = await fetchLibrary('xbox', { credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('rate-limit');
      expect(result.error.retryAfterMs).toBe(60_000);
    }
  });

  it('contains a connector that throws a non-Error', async () => {
    registerConnector(rogue);
    const result = await fetchLibrary('nintendo', { credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConnectorError);
      expect(result.error.kind).toBe('unknown');
      expect(result.error.cause).toBe('kaboom');
    }
  });

  it('degrades exactly one platform and leaves the others alone', async () => {
    registerConnector(healthy);
    registerConnector(failing);
    registerConnector(rogue);

    const outcomes = await refreshAll(() => credentials);

    expect(outcomes.get('steam')?.ok).toBe(true);
    expect(outcomes.get('xbox')?.ok).toBe(false);
    expect(outcomes.get('nintendo')?.ok).toBe(false);

    const status = get(connectorStatus);
    expect(status.steam.health).toBe('ok');
    expect(status.xbox.health).toBe('degraded');
    expect(status.nintendo.health).toBe('degraded');
    expect(get(anyDegraded)).toBe(true);
  });

  it('never rejects the batch, even when every connector fails', async () => {
    registerConnector(failing);
    registerConnector(rogue);
    await expect(refreshAll(() => credentials)).resolves.toBeInstanceOf(Map);
  });

  it('reports a missing credential as an auth failure without calling the connector', async () => {
    registerConnector(healthy);
    const outcomes = await refreshAll(() => undefined);
    const outcome = outcomes.get('steam');
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.error.kind).toBe('auth');
  });

  it('recovers: a platform that failed and then succeeds reports ok again', async () => {
    let broken = true;
    registerConnector({
      ...healthy,
      platform: 'pc',
      label: 'PC',
      async fetchRecent() {
        if (broken) throw new ConnectorError('pc', 'network', 'Offline.');
        return { items: [] };
      },
    });

    expect((await fetchRecent('pc', { credentials })).ok).toBe(false);
    expect(statusFor('pc').health).toBe('degraded');

    broken = false;
    expect((await fetchRecent('pc', { credentials })).ok).toBe(true);
    expect(statusFor('pc').health).toBe('ok');
    expect(statusFor('pc').message).toBeUndefined();
  });

  it('boundaries achievements the same way', async () => {
    registerConnector(healthy);
    const result = await fetchAchievements('steam', { credentials, externalId: '1145360' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0].achievements.earned).toBe(30);
  });
});
