/**
 * The connector registry — the error boundary between platforms.
 *
 * Cartridge's fourth non-negotiable is that a failing connector degrades one tab and never
 * the whole app. That guarantee has to live somewhere concrete, and this is it: every call
 * into a connector goes through {@link run}, which catches everything, records the failure
 * against that platform alone, and returns a neutral result. Callers get `ok` or `error`;
 * they never get a thrown exception from someone else's platform.
 *
 * The registry is empty in phase 2. Registering nothing is the supported default.
 */
import { writable, get, derived } from 'svelte/store';
import type { Platform } from '../types';
import {
  ConnectorError,
  type Connector,
  type ConnectorAchievements,
  type ConnectorGame,
  type FetchOptions,
  type Page,
} from './types';

/** What the UI shows next to a platform. */
export type ConnectorHealth = 'idle' | 'working' | 'ok' | 'degraded';

export interface ConnectorStatus {
  platform: Platform;
  health: ConnectorHealth;
  /** A sentence about the most recent failure — shown on that platform's tab only. */
  message?: string;
  lastOkAt?: number;
  lastErrorAt?: number;
}

const registry = new Map<Platform, Connector>();

/** Per-platform status, keyed by platform. Never global: that is the whole point. */
export const connectorStatus = writable<Record<string, ConnectorStatus>>({});

/** True when at least one platform is currently degraded. */
export const anyDegraded = derived(connectorStatus, ($status) =>
  Object.values($status).some((s) => s.health === 'degraded'),
);

export function registerConnector(connector: Connector): void {
  registry.set(connector.platform, connector);
  patch(connector.platform, { health: 'idle' });
}

export function getConnector(platform: Platform): Connector | undefined {
  return registry.get(platform);
}

export function registeredConnectors(): Connector[] {
  return [...registry.values()];
}

/** Test hook: forget every registration and every status. */
export function resetRegistry(): void {
  registry.clear();
  connectorStatus.set({});
}

function patch(platform: Platform, next: Partial<ConnectorStatus>): void {
  connectorStatus.update((all) => {
    const base: ConnectorStatus = all[platform] ?? { platform, health: 'idle' };
    return { ...all, [platform]: { ...base, ...next, platform } };
  });
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ConnectorError };

/**
 * Run one connector operation inside its own error boundary.
 *
 * Nothing thrown by a connector — a `ConnectorError`, a `TypeError` from a bad response, a
 * string, whatever a future third-party implementation manages to produce — escapes this
 * function. The failure is recorded against `platform` and returned as a value.
 */
export async function run<T>(
  platform: Platform,
  operation: (connector: Connector) => Promise<T>,
): Promise<Outcome<T>> {
  const connector = registry.get(platform);
  if (!connector) {
    const error = new ConnectorError(platform, 'unsupported', 'That platform isn’t connected.');
    patch(platform, { health: 'degraded', message: error.message, lastErrorAt: Date.now() });
    return { ok: false, error };
  }

  patch(platform, { health: 'working' });
  try {
    const value = await operation(connector);
    patch(platform, { health: 'ok', message: undefined, lastOkAt: Date.now() });
    return { ok: true, value };
  } catch (thrown) {
    const error =
      thrown instanceof ConnectorError
        ? thrown
        : new ConnectorError(
            platform,
            'unknown',
            `${connector.label} couldn’t be reached. Everything else still works.`,
            { cause: thrown },
          );
    patch(platform, { health: 'degraded', message: error.message, lastErrorAt: Date.now() });
    return { ok: false, error };
  }
}

/** `fetchLibrary` for one platform, boundaried. */
export function fetchLibrary(
  platform: Platform,
  options: FetchOptions,
): Promise<Outcome<Page<ConnectorGame>>> {
  return run(platform, (c) => c.fetchLibrary(options));
}

/** `fetchRecent` for one platform, boundaried. */
export function fetchRecent(
  platform: Platform,
  options: FetchOptions,
): Promise<Outcome<Page<ConnectorGame>>> {
  return run(platform, (c) => c.fetchRecent(options));
}

/** `fetchAchievements` for one platform, boundaried. */
export function fetchAchievements(
  platform: Platform,
  options: FetchOptions & { externalId?: string },
): Promise<Outcome<Page<ConnectorAchievements>>> {
  return run(platform, (c) => c.fetchAchievements(options));
}

/**
 * Refresh every registered connector at once.
 *
 * Uses `Promise.all` over calls that are individually boundaried, so one platform throwing
 * cannot reject the batch — the caller always receives one outcome per platform, some of
 * which may have failed.
 */
export async function refreshAll(
  credentialsFor: (platform: Platform) => FetchOptions['credentials'] | undefined,
  signal?: AbortSignal,
): Promise<Map<Platform, Outcome<Page<ConnectorGame>>>> {
  const platforms = [...registry.keys()];
  const results = await Promise.all(
    platforms.map(async (platform) => {
      const credentials = credentialsFor(platform);
      if (!credentials) {
        return [
          platform,
          {
            ok: false,
            error: new ConnectorError(platform, 'auth', 'Not connected yet.'),
          } as Outcome<Page<ConnectorGame>>,
        ] as const;
      }
      return [platform, await fetchRecent(platform, { credentials, signal })] as const;
    }),
  );
  return new Map(results);
}

/** Current status for one platform, for a component that only cares about its own tab. */
export function statusFor(platform: Platform): ConnectorStatus {
  return get(connectorStatus)[platform] ?? { platform, health: 'idle' };
}
