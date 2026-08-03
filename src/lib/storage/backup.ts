/**
 * Backup and restore.
 *
 * A Cartridge backup is one JSON file the user owns. It carries the whole database —
 * **tombstones included** — inside a versioned envelope, so a restore on another device
 * learns about deletions too, and a future sync layer can merge rather than clobber.
 *
 * Cover images are already stored as data URLs in `game.coverData`, so a backup is
 * self-contained and a restored library still shows covers with no network.
 */
import * as db from './db';
import type { DbSnapshot } from './db';

/** Marker identifying a file as a Cartridge backup (guards against foreign files). */
export const BACKUP_SCHEMA = 'cartridge/backup';
/** Current envelope version. Bump only for a breaking payload change. */
export const BACKUP_VERSION = 1;

export interface Backup {
  schema: typeof BACKUP_SCHEMA;
  version: number;
  exportedAt: number;
  data: DbSnapshot;
}

export interface BackupCounts {
  games: number;
  entries: number;
  shelves: number;
  links: number;
  stats: number;
}

/** Live (non-tombstoned) row counts, for the confirmation the UI shows before a restore. */
export function countBackup(backup: Backup): BackupCounts {
  const live = <T extends { deleted?: number }>(rows: T[]) => rows.filter((r) => !r.deleted).length;
  return {
    games: live(backup.data.games),
    entries: live(backup.data.entries),
    shelves: live(backup.data.shelves),
    links: live(backup.data.platformLinks),
    stats: live(backup.data.sessionStats),
  };
}

export async function createBackup(): Promise<Backup> {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: await db.getAllForBackup(),
  };
}

/** `Cartridge-2026-08-03.json` — sorts chronologically in a folder. */
export function backupFileName(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Cartridge-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.json`;
}

/** Trigger a browser download of the backup. Works offline; no server involved. */
export async function downloadBackup(): Promise<string> {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const name = backupFileName();
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so Safari has taken the blob before it disappears.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

export class BackupError extends Error {}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Validate an unknown parsed object as a backup. Deliberately strict about the envelope
 * (restoring the wrong file would silently destroy a library) and forgiving about missing
 * arrays, so a backup written before a store existed still restores.
 */
export function parseBackup(input: unknown): Backup {
  if (!input || typeof input !== 'object') throw new BackupError('That file is not a backup.');
  const raw = input as Record<string, unknown>;

  if (raw.schema !== BACKUP_SCHEMA) {
    throw new BackupError("That file isn't a Cartridge backup.");
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupError(
      'That backup was written by a newer version of Cartridge. Update the app, then try again.',
    );
  }
  const data = raw.data;
  if (!data || typeof data !== 'object') throw new BackupError('That backup has no data in it.');
  const d = data as Record<string, unknown>;

  const list = <T>(value: unknown): T[] => (isArray(value) ? (value as T[]) : []);
  const snapshot: DbSnapshot = {
    games: list(d.games),
    entries: list(d.entries),
    platformLinks: list(d.platformLinks),
    shelves: list(d.shelves),
    sessionStats: list(d.sessionStats),
    meta: list(d.meta),
  };

  if (!snapshot.games.length && !snapshot.entries.length && !snapshot.shelves.length) {
    throw new BackupError('That backup is empty.');
  }

  return {
    schema: BACKUP_SCHEMA,
    version: raw.version,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    data: snapshot,
  };
}

export async function readBackupFile(file: File): Promise<Backup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new BackupError("That file isn't valid JSON.");
  }
  return parseBackup(parsed);
}

/**
 * Replace the library with a backup. **Destructive**, so the caller must confirm first;
 * the pre-restore snapshot returned by `createBackup` is the caller's undo.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  await db.replaceAll(backup.data);
  await db.ensureBuiltinShelves();
}
