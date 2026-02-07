PRAGMA foreign_keys = ON;

ALTER TABLE symptom_states ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE symptom_states ADD COLUMN memory_source TEXT NOT NULL DEFAULT 'live' CHECK (
  memory_source IN ('live', 'migration_backfill')
);
ALTER TABLE symptom_states ADD COLUMN source_record_id TEXT NULL;

ALTER TABLE health_signals ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE health_signals ADD COLUMN memory_source TEXT NOT NULL DEFAULT 'live' CHECK (
  memory_source IN ('live', 'migration_backfill')
);
ALTER TABLE health_signals ADD COLUMN source_record_id TEXT NULL;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_migration_sidecar_record
  ON memory_migration_sidecar(memory_record_id, memory_record_type);

CREATE TRIGGER IF NOT EXISTS trg_memory_migration_sidecar_updated_at
AFTER UPDATE ON memory_migration_sidecar
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE memory_migration_sidecar SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
