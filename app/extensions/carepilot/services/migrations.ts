import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CarePilotDb } from "./db.js";
import { withCarePilotTransaction } from "./db.js";

export type CarePilotMigrationRecord = {
  filename: string;
  checksum: string;
  applied_at: string;
};

export type CarePilotMigrationRunResult = {
  applied: string[];
  skipped: string[];
};

type CarePilotLogger = {
  info?: (message: string) => void;
};

const MIGRATION_TABLE_NAME = "carepilot_schema_migrations";
const MEMORY_MIGRATION_FIELDS_FILENAME = "004_memory_migration_fields.sql";

function defaultMigrationsDir(): string {
  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(serviceDir, "../db/migrations");
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function assertIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function hasColumn(db: CarePilotDb, table: string, column: string): boolean {
  const quotedTable = assertIdentifier(table);
  const rows = db.prepare(`PRAGMA table_info(${quotedTable})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(db: CarePilotDb, table: string, column: string, definitionSql: string): void {
  if (hasColumn(db, table, column)) {
    return;
  }
  const quotedTable = assertIdentifier(table);
  db.exec(`ALTER TABLE ${quotedTable} ADD COLUMN ${definitionSql};`);
}

function applyMemoryMigrationFields(db: CarePilotDb): void {
  addColumnIfMissing(db, "symptom_states", "schema_version", "schema_version INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(
    db,
    "symptom_states",
    "memory_source",
    "memory_source TEXT NOT NULL DEFAULT 'live' CHECK (memory_source IN ('live', 'migration_backfill'))",
  );
  addColumnIfMissing(db, "symptom_states", "source_record_id", "source_record_id TEXT NULL");

  addColumnIfMissing(db, "health_signals", "schema_version", "schema_version INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(
    db,
    "health_signals",
    "memory_source",
    "memory_source TEXT NOT NULL DEFAULT 'live' CHECK (memory_source IN ('live', 'migration_backfill'))",
  );
  addColumnIfMissing(db, "health_signals", "source_record_id", "source_record_id TEXT NULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_migration_sidecar (
      id TEXT PRIMARY KEY,
      memory_record_id TEXT NOT NULL,
      memory_record_type TEXT NOT NULL CHECK (memory_record_type IN ('symptom_state', 'health_signal')),
      schema_version INTEGER NOT NULL DEFAULT 1,
      migration_mode TEXT NOT NULL DEFAULT 'baseline_only' CHECK (
        migration_mode IN ('baseline_only', 'shadow_compare', 'new_primary')
      ),
      migration_source TEXT NOT NULL DEFAULT 'live' CHECK (
        migration_source IN ('live', 'migration_backfill')
      ),
      source_record_id TEXT NULL,
      baseline_write_status TEXT NULL,
      new_write_status TEXT NULL,
      last_compared_at TEXT NULL,
      tombstoned_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_migration_sidecar_record
      ON memory_migration_sidecar(memory_record_id, memory_record_type);
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_memory_migration_sidecar_updated_at
    AFTER UPDATE ON memory_migration_sidecar
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE memory_migration_sidecar SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
}

function ensureMigrationTable(db: CarePilotDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function listMigrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readAppliedMigrations(db: CarePilotDb): Map<string, CarePilotMigrationRecord> {
  const rows = db
    .prepare(`SELECT filename, checksum, applied_at FROM ${MIGRATION_TABLE_NAME} ORDER BY filename ASC`)
    .all() as CarePilotMigrationRecord[];

  return new Map(rows.map((row) => [row.filename, row]));
}

export function runCarePilotMigrations(params: {
  db: CarePilotDb;
  migrationsDir?: string;
  logger?: CarePilotLogger;
}): CarePilotMigrationRunResult {
  const migrationsDir = path.resolve(params.migrationsDir ?? defaultMigrationsDir());
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`CarePilot migrations directory not found: ${migrationsDir}`);
  }

  ensureMigrationTable(params.db);

  const applied = readAppliedMigrations(params.db);
  const migrationFiles = listMigrationFiles(migrationsDir);
  const result: CarePilotMigrationRunResult = { applied: [], skipped: [] };

  for (const filename of migrationFiles) {
    const filePath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filePath, "utf8");
    const checksum = migrationChecksum(sql);
    const existing = applied.get(filename);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`CarePilot migration checksum mismatch for ${filename}`);
      }
      result.skipped.push(filename);
      continue;
    }

    withCarePilotTransaction(params.db, () => {
      if (filename === MEMORY_MIGRATION_FIELDS_FILENAME) {
        applyMemoryMigrationFields(params.db);
      } else {
        params.db.exec(sql);
      }
      params.db
        .prepare(
          `INSERT INTO ${MIGRATION_TABLE_NAME} (filename, checksum, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        )
        .run(filename, checksum);
    });

    params.logger?.info?.(`[carepilot] applied migration ${filename}`);
    result.applied.push(filename);
  }

  return result;
}

export function listAppliedCarePilotMigrations(db: CarePilotDb): CarePilotMigrationRecord[] {
  ensureMigrationTable(db);
  return db
    .prepare(`SELECT filename, checksum, applied_at FROM ${MIGRATION_TABLE_NAME} ORDER BY filename ASC`)
    .all() as CarePilotMigrationRecord[];
}
