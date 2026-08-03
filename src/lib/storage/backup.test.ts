import { describe, it, expect } from 'vitest';
import {
  parseBackup,
  countBackup,
  backupFileName,
  BackupError,
  BACKUP_SCHEMA,
  BACKUP_VERSION,
} from './backup';

const minimal = {
  schema: BACKUP_SCHEMA,
  version: BACKUP_VERSION,
  exportedAt: 1,
  data: {
    games: [{ id: 'g1' }, { id: 'g2', deleted: 5 }],
    entries: [{ id: 'e1' }],
    platformLinks: [],
    shelves: [{ id: 's1' }],
    sessionStats: [],
    meta: [],
  },
};

describe('parseBackup', () => {
  it('accepts a well-formed backup', () => {
    const backup = parseBackup(minimal);
    expect(backup.data.games).toHaveLength(2);
  });

  it('rejects a file that is not a Cartridge backup', () => {
    expect(() => parseBackup({ schema: 'score-king/backup', version: 1, data: {} })).toThrow(
      BackupError,
    );
    expect(() => parseBackup({ hello: 'world' })).toThrow(BackupError);
    expect(() => parseBackup(null)).toThrow(BackupError);
  });

  it('rejects a backup from a newer app version rather than guessing', () => {
    expect(() => parseBackup({ ...minimal, version: BACKUP_VERSION + 1 })).toThrow(/newer version/);
  });

  it('rejects an empty backup', () => {
    expect(() =>
      parseBackup({ ...minimal, data: { games: [], entries: [], shelves: [] } }),
    ).toThrow(/empty/);
  });

  it('tolerates stores that did not exist when the backup was written', () => {
    const backup = parseBackup({ ...minimal, data: { games: [{ id: 'g1' }] } });
    expect(backup.data.sessionStats).toEqual([]);
    expect(backup.data.meta).toEqual([]);
  });

  it('keeps tombstones so deletions survive the round trip', () => {
    const backup = parseBackup(minimal);
    expect(backup.data.games.some((g) => (g as { deleted?: number }).deleted)).toBe(true);
  });
});

describe('countBackup', () => {
  it('counts live rows only', () => {
    expect(countBackup(parseBackup(minimal))).toEqual({
      games: 1,
      entries: 1,
      shelves: 1,
      links: 0,
      stats: 0,
    });
  });
});

describe('backupFileName', () => {
  it('is date-stamped so backups sort chronologically', () => {
    expect(backupFileName(new Date(2026, 7, 3))).toBe('Cartridge-2026-08-03.json');
  });
});
