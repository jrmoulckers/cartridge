/**
 * The Xbox connector against a stubbed bridge.
 *
 * Xbox is the untrustworthy one: an unofficial third-party proxy over a service with no
 * public API, reached with a key the user pasted in by hand. So these tests are almost
 * entirely about being wrong well — garbage staying inside the boundary, a rejected key
 * saying the useful thing rather than the alarming one, a rate limit that doesn't cost the
 * whole sync, and an absent playtime figure staying `null` instead of becoming a `0` that
 * would sit in someone's stats forever claiming they'd never played a game they had.
 *
 * The one thing here that is not about failure is where the API key goes, and that is the
 * most important test in the file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { xboxConnector, isOpenXblKey, isXuid, fetchAccount, OPENXBL_KEY_URL } from './xbox';
import { ConnectorError, type Credentials } from './types';
import { registerConnector, getConnector } from './registry';
import { setBridgeUrl } from '../stores/settings';

const BRIDGE = 'https://bridge.test';
const KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const credentials: Credentials = { apiKey: KEY, xuid: '2533274800000000', gamertag: 'Player' };

function reply(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** The library call is followed by a playtime call; most tests want both stubbed. */
function library(games: unknown[], minutes: Record<string, number> = {}) {
  fetchMock.mockResolvedValueOnce(reply({ games }));
  fetchMock.mockResolvedValueOnce(reply({ minutes }));
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
    registerConnector(xboxConnector);
    expect(getConnector('xbox')).toBe(xboxConnector);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('admits the API is unofficial and the playtime is partial', () => {
    // Both of these are the unflattering answer, and both are load-bearing. `official: false`
    // is what lets the UI warn someone before they paste a third-party API key, and
    // `playtimeCoverage: 'partial'` is what stops a library full of "Not reported" reading
    // like a bug.
    expect(xboxConnector.capabilities).toEqual({
      playtime: true,
      playtimeCoverage: 'partial',
      achievements: true,
      lastPlayed: true,
      official: false,
      requiresBridge: true,
    });
  });
});

describe('credential shapes', () => {
  it('recognises a key and refuses obvious non-keys', () => {
    expect(isOpenXblKey(KEY)).toBe(true);
    expect(isOpenXblKey('short')).toBe(false);
    expect(isOpenXblKey('someone@example.com')).toBe(false);
    expect(isOpenXblKey(undefined)).toBe(false);
  });

  it('recognises an XUID and refuses anything with a letter in it', () => {
    expect(isXuid('2533274800000000')).toBe(true);
    expect(isXuid('12345')).toBe(false);
    expect(isXuid('2533274800000000x')).toBe(false);
  });
});

describe('where the API key goes', () => {
  it('travels in a header and never appears in the URL', async () => {
    library([]);
    await xboxConnector.fetchLibrary({ credentials });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The whole reason the bridge grew an `X-XBL-Key` header: a key in a query string ends
    // up in access logs, in `Referer` headers and in browser history, and this one is
    // long-lived. There is no rotating it out of a log file after the fact.
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)['X-XBL-Key']).toBe(KEY);
  });

  it('never sends cookies with it', async () => {
    library([]);
    await xboxConnector.fetchLibrary({ credentials });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('omit');
  });
});

describe('fetchLibrary', () => {
  it('maps a title history into connector games', async () => {
    library(
      [
        {
          titleId: '1717113201',
          title: 'Halo Infinite',
          minutesPlayed: null,
          lastPlayedAt: 1_700_000_000_000,
          imageUrl: 'https://img.test/halo.png',
          achievements: { earned: 12, total: 119 },
        },
      ],
      { '1717113201': 640 },
    );

    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items).toEqual([
      {
        externalId: '1717113201',
        title: 'Halo Infinite',
        minutesPlayed: 640,
        lastPlayedAt: 1_700_000_000_000,
        imageUrl: 'https://img.test/halo.png',
        achievements: { earned: 12, total: 119 },
      },
    ]);
  });

  it('leaves unreported playtime as null rather than inventing a zero', async () => {
    // The central Xbox fact. Most titles define no MinutesPlayed stat at all, so they come
    // back absent — which means "not reported", not "never played". A `0` here would be a
    // fabricated statistic, and on Steam `0` means something true and different.
    library([{ titleId: '1', title: 'Forza Horizon 5', minutesPlayed: null }], {});

    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items[0].minutesPlayed).toBeNull();
  });

  it('keeps the library when the playtime call fails', async () => {
    fetchMock.mockResolvedValueOnce(reply({ games: [{ titleId: '1', title: 'Gears 5' }] }));
    fetchMock.mockResolvedValueOnce(reply({ error: 'rate-limited', message: 'slow down' }, { status: 429 }));

    // Playtime is the optional half. Losing an import over an optional statistic would be
    // the wrong trade, especially against a 150-request hourly budget.
    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].minutesPlayed).toBeNull();
  });

  it('drops rows it cannot trust instead of importing nonsense', async () => {
    library(
      [
        { titleId: '1', title: 'Real Game' },
        { titleId: 'not-a-title-id', title: 'Suspicious' },
        { title: 'No id at all' },
        null,
        { titleId: '2' },
      ],
      {},
    );

    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items.map((g) => g.externalId)).toEqual(['1', '2']);
    // A title-less row keeps its id rather than becoming `undefined` in someone's library.
    expect(page.items[1].title).toBe('Title 2');
  });

  it('ignores a 0/0 achievement count so it cannot render as progress', async () => {
    library([{ titleId: '1', title: 'No Achievements', achievements: { earned: 0, total: 0 } }], {});
    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items[0].achievements).toBeUndefined();
  });

  it('refuses a non-numeric minutes value from a patched-up proxy', async () => {
    library([{ titleId: '1', title: 'Game' }], { '1': '640' as unknown as number });
    const page = await xboxConnector.fetchLibrary({ credentials });
    expect(page.items[0].minutesPlayed).toBeNull();
  });

  it('throws unsupported rather than crashing when the shape is wrong entirely', async () => {
    fetchMock.mockResolvedValueOnce(reply({ nonsense: true }));
    await expect(xboxConnector.fetchLibrary({ credentials })).rejects.toMatchObject({
      kind: 'unsupported',
      platform: 'xbox',
    });
  });
});

describe('errors a user can act on', () => {
  it('turns a rejected key into auth, with somewhere to go', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: 'xbox-auth', message: 'OpenXBL rejected that API key.' }, { status: 401 }),
    );

    const error = await xboxConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.kind).toBe('auth');
    expect(error.helpUrl).toBe(OPENXBL_KEY_URL);
  });

  it('carries a retry delay when OpenXBL throttles', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: 'rate-limited', message: 'Out of requests.' }, {
        status: 429,
        headers: { 'retry-after': '900' },
      }),
    );

    const error = await xboxConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error.kind).toBe('rate-limit');
    expect(error.retryAfterMs).toBe(900_000);
  });

  it('calls an outage unsupported, not auth — the key is fine', async () => {
    // Telling someone their key is bad when OpenXBL is simply down sends them off to make a
    // new one, which will not help and will burn their quota finding out.
    fetchMock.mockResolvedValueOnce(reply({ error: 'upstream', message: 'bad gateway' }, { status: 502 }));
    const error = await xboxConnector.fetchLibrary({ credentials }).catch((e) => e);
    expect(error.kind).toBe('unsupported');
  });

  it('asks to connect first when there are no credentials, without any request', async () => {
    await expect(xboxConnector.fetchLibrary({ credentials: {} })).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('authenticate', () => {
  it('refuses without a bridge and asks for nothing', async () => {
    setBridgeUrl('');
    const result = await xboxConnector.authenticate({ apiKey: KEY });
    expect(result.status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports disconnected rather than throwing when there is no key', async () => {
    const result = await xboxConnector.authenticate({});
    expect(result.status).toBe('disconnected');
  });

  it('re-reads the gamertag so a rename does not go stale', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ xuid: '2533274800000000', gamertag: 'NewName', gamerscore: 4210 }),
    );
    const result = await xboxConnector.authenticate({ apiKey: KEY, gamertag: 'OldName' });
    expect(result.status).toBe('connected');
    expect(result.credentials?.gamertag).toBe('NewName');
  });

  it('reports a revoked key as expired rather than throwing', async () => {
    // The interface's contract: an ordinary refusal is a returned status. A revoked key is
    // ordinary — people rotate them.
    fetchMock.mockResolvedValueOnce(reply({ error: 'xbox-auth', message: 'no' }, { status: 401 }));
    const result = await xboxConnector.authenticate({ apiKey: KEY });
    expect(result.status).toBe('expired');
  });

  it('does not blame the key for a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await xboxConnector.authenticate({ apiKey: KEY });
    expect(result.status).toBe('error');
  });
});

describe('fetchAccount', () => {
  it('rejects a malformed key before spending a request', async () => {
    await expect(fetchAccount('nope')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an account with no usable XUID', async () => {
    fetchMock.mockResolvedValueOnce(reply({ gamertag: 'Player' }));
    await expect(fetchAccount(KEY)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('falls back to a neutral name rather than showing "undefined"', async () => {
    fetchMock.mockResolvedValueOnce(reply({ xuid: '2533274800000000' }));
    const account = await fetchAccount(KEY);
    expect(account.gamertag).toBe('Xbox');
    expect(account.gamerscore).toBeNull();
  });
});

describe('fetchAchievements', () => {
  it('asks for nothing when given no ids', async () => {
    const page = await xboxConnector.fetchAchievements({ credentials });
    expect(page.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps the batch, because each id is a request against the user’s own quota', async () => {
    fetchMock.mockResolvedValueOnce(reply({ results: [] }));
    const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
    await xboxConnector.fetchAchievements({ credentials, externalIds: ids });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('titleids')?.split(',')).toHaveLength(10);
  });

  it('drops a game with no achievements rather than recording 0/0', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        results: [
          { titleId: '1', achievements: { earned: 3, total: 10 } },
          { titleId: '2', achievements: null },
          { titleId: '3', achievements: { earned: 0, total: 0 } },
        ],
      }),
    );
    const page = await xboxConnector.fetchAchievements({ credentials, externalIds: ['1', '2', '3'] });
    expect(page.items).toEqual([{ externalId: '1', achievements: { earned: 3, total: 10 } }]);
  });
});
