import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchGames } from './igdb';
import type { Env } from './types';

function env() {
  const put = vi.fn();
  const metadata = {
    get: vi.fn(async (key: string) =>
      key === 'twitch:token:v1' ? { token: 'test-token', expiresAt: Date.now() + 60_000 } : null,
    ),
    put,
  } as unknown as KVNamespace;

  return {
    value: {
      METADATA: metadata,
      ALLOWED_ORIGINS: '',
      TWITCH_CLIENT_ID: 'test-client',
      TWITCH_CLIENT_SECRET: 'test-secret',
      STEAM_API_KEY: 'test-steam-key',
    } satisfies Env,
    put,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchGames caching', () => {
  it('does not turn a transient empty IGDB response into a 24-hour cache entry', async () => {
    const { value, put } = env();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));

    await expect(searchGames(value, 'sea of thieves', 10)).resolves.toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });

  it('still caches non-empty public search results', async () => {
    const { value, put } = env();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 1, name: 'Sea of Thieves' }]), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(searchGames(value, 'sea of thieves', 10)).resolves.toHaveLength(1);
    expect(put).toHaveBeenCalledOnce();
  });
});
