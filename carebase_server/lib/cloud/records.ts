import { getDb } from './db';

export interface CloudRecord {
  key: string;
  encryptedValue: Uint8Array;
  sensitivityLevel: 'Ask' | 'Allow';
  createdAt: number;
  updatedAt: number;
  syncedAt?: number | null;
}

function mapRow(row: any): CloudRecord {
  return {
    key: row.key,
    encryptedValue: new Uint8Array(row.encrypted_value),
    sensitivityLevel: row.sensitivity_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}

export function upsertRecord(record: CloudRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    insert into carebase_records
      (key, encrypted_value, sensitivity_level, created_at, updated_at, synced_at)
    values
      (@key, @encrypted_value, @sensitivity_level, @created_at, @updated_at, @synced_at)
    on conflict(key) do update set
      encrypted_value = excluded.encrypted_value,
      sensitivity_level = excluded.sensitivity_level,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `);

  stmt.run({
    key: record.key,
    encrypted_value: Buffer.from(record.encryptedValue),
    sensitivity_level: record.sensitivityLevel,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    synced_at: record.syncedAt ?? null,
  });
}

export function getRecord(key: string): CloudRecord | null {
  const db = getDb();
  const row = db.prepare(`select * from carebase_records where key = ?`).get(key);
  return row ? mapRow(row) : null;
}

export function listRecords(since?: number): CloudRecord[] {
  const db = getDb();
  const rows = since
    ? db
        .prepare(`select * from carebase_records where updated_at > ? order by updated_at asc`)
        .all(since)
    : db.prepare(`select * from carebase_records order by updated_at asc`).all();
  return rows.map(mapRow);
}

export function deleteRecord(key: string): boolean {
  const db = getDb();
  const result = db.prepare(`delete from carebase_records where key = ?`).run(key);
  return result.changes > 0;
}

export function getLastSync(): number | null {
  const db = getDb();
  const row = db.prepare(`select last_sync from carebase_sync where id = 1`).get();
  return row?.last_sync ?? null;
}

export function setLastSync(timestamp: number): void {
  const db = getDb();
  db.prepare(`update carebase_sync set last_sync = ? where id = 1`).run(timestamp);
}
