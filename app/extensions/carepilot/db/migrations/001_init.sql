PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patient_profile (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL,
  locale TEXT DEFAULT 'en-US',
  date_of_birth_year INTEGER NULL,
  biological_sex TEXT NULL,
  proactive_mode TEXT NOT NULL DEFAULT 'active' CHECK (proactive_mode IN ('active', 'paused', 'medication_only')),
  snooze_until TEXT NULL,
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conditions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'unknown')),
  severity TEXT NULL,
  diagnosed_date TEXT NULL,
  source TEXT NOT NULL CHECK (source IN ('user_direct', 'tool_result', 'model_inference')),
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS allergies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  substance TEXT NOT NULL,
  reaction TEXT NULL,
  severity TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'unknown')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  dose_value REAL NULL,
  dose_unit TEXT NULL,
  frequency_per_day REAL NOT NULL,
  quantity_dispensed REAL NULL,
  last_fill_date TEXT NULL,
  pharmacy_name TEXT NULL,
  pharmacy_contact TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  location TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'planned',
      'awaiting_confirmation',
      'executing',
      'succeeded',
      'failed',
      'partial',
      'blocked',
      'expired',
      'pending'
    )
  ),
  external_ref TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  consent_token TEXT NULL,
  status TEXT NOT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  consent_snapshot_json TEXT NULL,
  replay_window_bucket TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consent_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policy_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conditions_user_status ON conditions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_medications_user_status ON medications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_user_starts ON appointments(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_action_audit_user_started ON action_audit(user_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_audit_user_idempotency_bucket
  ON action_audit(user_id, idempotency_key, replay_window_bucket);

CREATE TRIGGER IF NOT EXISTS trg_patient_profile_updated_at
AFTER UPDATE ON patient_profile
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE patient_profile SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_conditions_updated_at
AFTER UPDATE ON conditions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE conditions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_allergies_updated_at
AFTER UPDATE ON allergies
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE allergies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_medications_updated_at
AFTER UPDATE ON medications
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE medications SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_appointments_updated_at
AFTER UPDATE ON appointments
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE appointments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_action_audit_updated_at
AFTER UPDATE ON action_audit
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE action_audit SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_consent_tokens_updated_at
AFTER UPDATE ON consent_tokens
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE consent_tokens SET updated_at = CURRENT_TIMESTAMP WHERE token = NEW.token;
END;

CREATE TRIGGER IF NOT EXISTS trg_policy_events_updated_at
AFTER UPDATE ON policy_events
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE policy_events SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

