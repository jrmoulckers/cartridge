/**
 * The Steam connector against a stubbed bridge.
 *
 * A connector's failure modes matter more than its happy path — the happy path is a JSON
 * mapping, while the failure paths are what the user actually experiences the first time
 * they try this. So most of what follows is about being wrong well: a private profile
 * saying so, a rate limit carrying a retry, garbage staying inside the boundary, and a
 * `0` never quietly becoming a `null`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { steamConnector, isSteamId, STEAM_PRIVACY_URL } from './steam';
import { ConnectorError, type Credentials } from './types';
import { registerConnector, getConnector } from './registry';
import { setBridgeUrl } from '../stores/settings';

const BRIDGE = 'https://bridge.test';
const credentials: Credentials = { steamId: '76561197960287930' };

/** Reply with a body and status, the way the bridge does. */
function reply(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setBridgeUrl(BRIDGE);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setBridgeUrl('');
});

describe('capabilities', () => {
  it('registering the connector reaches for nothing', () => {
    // Boot registers Steam unconditionally. That has to stay inert, or an offline launch
    // starts making requests for a platform nobody connected.
    registerConnector(steamConnector);
    expect(getConnector('steam')).toBe(steamConnector);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('are reported honestly — Steam does all three, officially', () => {
    expect(steamConnector.capabilities).toEqual({
      playtime: true,
      achievements: true,
      lastPlayed: true,
      official: true,
      requiresBridge: true,
    });
  });
});

describe('isSteamId', () => {
  it('accepts a 17-digit id and nothing else', () => {
    expect(isSteamId('76561197960287930')).toBe(true);
    expect(isSteamId('7656119796028793')).toBe(false);
    expect(isSteamId('not-an-id')).toBe(false);
    expect(isSteamId(76561197960287930)).toBe(false);
    expect(isSteamId(undefined)).toBe(false);
  });
});

describe('authenticate', () => {
  it('confirms a stored id without touching the network', async () => {
    const result = await steamConnector.authenticate(credentials);
    expect(result.status).toBe('connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing connection as a status, not a throw', async () => {
    await expect(steamConnector.authenticate({})).resolves.toMatchObject({
      status: 'disconnected',
    });
  });

  it('says so plainly when there is no bridge to sign in through', async () => {
    setBridgeUrl('');
    const result = await steamConnector.authenticate(credentials);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/bridge/i);
  });
});

describe('fetchLibrary', () => {
  it('maps Steam’s shape onto Cartridge’s', async () => {
    fetchMock.mockResolvedValue(
      reply({
        games: [
          {
            appid: '1145360',
            title: 'Hades',
            minutesPlayed: 1200,
            lastPlayedAt: 1_699_000_000_000,
            imageUrl: 'https://cdn.test/1145360/header.jpg',
          },
        ],
      }),
    );

    const page = await steamConnector.fetchLibrary({ credentials });
    expect(page.items).toEqual([
      {
        externalId: '1145360',
        title: 'Hades',
        minutesPlayed: 1200,
        lastPlayedAt: 1_699_000_000_000,
        imageUrl: 'https://cdn.test/1145360/header.jpg',
      },
    ]);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`${BRIDGE}/steam/library?steamid=76561197960287930`);
  });

  it('sends no cookies or credentials with the request', async () => {
    fetchMock.mockResolvedValue(reply({ games: [] }));
    await steamConnector.fetchLibrary({ credentials });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', mode: 'cors' });
  });

  it('keeps a real zero and never invents one', async () => {
    fetchMock.mockResolvedValue(
      reply({
        games: [
          { appid: '1', title: 'Never launched', minutesPlayed: 0 },
          { appid: '2', title: 'Unknown', minutesPlayed: null },
          { appid: '3', title: 'Nonsense', minutesPlayed: 'lots' },
        ],
      }),
    );

    const page = await steamConnector.fetchLibrary({ credentials });
    expect(page.items[0].minutesPlayed).toBe(0);
    expect(page.items[1].minutesPlayed).toBeNull();
    // A number we can't read becomes null, not a guess.
    expect(page.items[2].minutesPlayed).toBeNull();
  });

  it('drops a never-played timestamp rather than reporting 1970', async () => {
    fetchMock.mockResolvedValue(
      reply({ games: [{ appid: '1', title: 'Never launched', minutesPlayed: 0, lastPlayedAt: 0 }] }),
    );
    const page = await steamConnector.fetchLibrary({ credentials });
    expect(page.items[0].lastPlayedAt).toBeUndefined();
  });

  it('refuses to run without a credential, as an auth error', async () => {
    await expect(steamConnector.fetchLibrary({ credentials: {} })).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failing well', () => {
  it('turns a private profile into its own error kind, with a way to fix it', async () => {
    fetchMock.mockResolvedValue(
      reply(
        {
          error: 'steam-private',
          message: 'That Steam profile’s game details are private.',
          helpUrl: STEAM_PRIVACY_URL,
        },
        { status: 403 },
      ),
    );

    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.kind).toBe('private');
    // Not `auth`: the credential is fine and reconnecting would send them in a circle.
    expect(error.kind).not.toBe('auth');
    expect(error.helpUrl).toBe(STEAM_PRIVACY_URL);
  });

  it('carries Steam’s retry window through a rate limit', async () => {
    fetchMock.mockResolvedValue(
      reply({ error: 'upstream', message: 'Slow down.' }, { status: 429, headers: { 'retry-after': '90' } }),
    );

    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error.kind).toBe('rate-limit');
    expect(error.retryAfterMs).toBe(90_000);
  });

  it('calls an unreachable bridge a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error.kind).toBe('network');
  });

  it('says something useful when the bridge has no Steam key', async () => {
    fetchMock.mockResolvedValue(
      reply({ error: 'upstream', message: 'no key' }, { status: 503 }),
    );
    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error.kind).toBe('unsupported');
    expect(error.message).toMatch(/no Steam key/i);
  });

  it('does not pretend a garbage response is a library', async () => {
    fetchMock.mockResolvedValue(reply({ nonsense: true }));
    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.kind).toBe('unsupported');
  });

  it('survives a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const error = await steamConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectorError);
  });
});

describe('fetchRecent', () => {
  it('asks the recent endpoint, not the whole library', async () => {
    fetchMock.mockResolvedValue(reply({ games: [] }));
    await steamConnector.fetchRecent({ credentials });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/steam/recent');
  });
});

describe('fetchAchievements', () => {
  it('asks for a batch and keeps the games that have achievements', async () => {
    fetchMock.mockResolvedValue(
      reply({
        results: [
          { appid: '1145360', achievements: { earned: 30, total: 49 } },
          // No achievements at all — a fact, not a failure, and not a 0/0 row.
          { appid: '400', achievements: null },
        ],
      }),
    );

    const page = await steamConnector.fetchAchievements({
      credentials,
      externalIds: ['1145360', '400'],
    });

    expect(page.items).toEqual([{ externalId: '1145360', achievements: { earned: 30, total: 49 } }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('appids=1145360,400');
  });

  it('accepts a single id too', async () => {
    fetchMock.mockResolvedValue(reply({ results: [] }));
    await steamConnector.fetchAchievements({ credentials, externalId: '1145360' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('appids=1145360');
  });

  it('returns an empty page rather than fetching the world when given no ids', async () => {
    const page = await steamConnector.fetchAchievements({ credentials });
    expect(page.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the batch it will ask for', async () => {
    fetchMock.mockResolvedValue(reply({ results: [] }));
    const many = Array.from({ length: 60 }, (_, i) => String(i + 1));
    await steamConnector.fetchAchievements({ credentials, externalIds: many });

    const appids = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('appids');
    expect(appids!.split(',')).toHaveLength(20);
  });

  it('ignores an id that isn’t an appid', async () => {
    const page = await steamConnector.fetchAchievements({
      credentials,
      externalIds: ['../../etc/passwd'],
    });
    expect(page.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops a nonsensical count rather than storing it', async () => {
    fetchMock.mockResolvedValue(
      reply({
        results: [
          { appid: '1', achievements: { earned: 3, total: 0 } },
          { appid: '2', achievements: { earned: 'many', total: 10 } },
        ],
      }),
    );
    const page = await steamConnector.fetchAchievements({ credentials, externalIds: ['1', '2'] });
    expect(page.items).toEqual([]);
  });
});
