PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS symptom_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symptom TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'resolved_unconfirmed', 'unknown')),
  severity TEXT NULL,
  onset_at TEXT NULL,
  last_confirmed_at TEXT NULL,
  expires_at TEXT NULL,
  retention_class TEXT NOT NULL DEFAULT 'TIME_BOUND_STATE' CHECK (
    retention_class IN ('LONG_LIVED_FACT', 'TIME_BOUND_STATE', 'EVENT', 'INFERENCE')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (
    metric_type IN ('cycle', 'medication_tracking', 'workouts', 'sleep', 'resting_hr', 'step_count')
  ),
  source TEXT NOT NULL CHECK (source IN ('apple_health', 'user_reported', 'tool_result')),
  summary_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  stale_after TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('apple_health')),
  connection_status TEXT NOT NULL CHECK (connection_status IN ('connected', 'disconnected', 'error')),
  last_sync_at TEXT NULL,
  permissions_json TEXT NOT NULL,
  connection_meta_json TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_symptom_states_user_status ON symptom_states(user_id, status);
CREATE INDEX IF NOT EXISTS idx_health_signals_user_metric_time
  ON health_signals(user_id, metric_type, observed_at);

CREATE TRIGGER IF NOT EXISTS trg_symptom_states_updated_at
AFTER UPDATE ON symptom_states
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE symptom_states SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_health_signals_updated_at
AFTER UPDATE ON health_signals
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE health_signals SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_health_connections_updated_at
AFTER UPDATE ON health_connections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE health_connections SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
