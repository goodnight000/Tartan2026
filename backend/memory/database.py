from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class SQLiteMemoryDB:
    def __init__(self, db_path: str) -> None:
        self._path = Path(db_path).expanduser().resolve()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    @property
    def path(self) -> str:
        return str(self._path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self.connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS patient_profile (
                  id TEXT PRIMARY KEY,
                  user_id TEXT UNIQUE NOT NULL,
                  profile_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conditions (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  severity TEXT,
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS allergies (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  substance TEXT NOT NULL,
                  reaction TEXT,
                  severity TEXT,
                  status TEXT NOT NULL DEFAULT 'active',
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS medications (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  dose_value REAL,
                  dose_unit TEXT,
                  frequency_per_day REAL NOT NULL,
                  quantity_dispensed REAL,
                  last_fill_date TEXT,
                  pharmacy_name TEXT,
                  pharmacy_contact TEXT,
                  regimen_type TEXT NOT NULL DEFAULT 'daily',
                  interval_days REAL,
                  status TEXT NOT NULL DEFAULT 'active',
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS symptom_states (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  symptom TEXT NOT NULL,
                  status TEXT NOT NULL,
                  severity TEXT,
                  onset_at TEXT,
                  last_confirmed_at TEXT NOT NULL,
                  expires_at TEXT,
                  reconfirm_due_at TEXT,
                  retention_class TEXT NOT NULL DEFAULT 'TIME_BOUND_STATE',
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS inferences (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  inference_key TEXT NOT NULL,
                  value_json TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS appointments (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  provider_name TEXT NOT NULL,
                  location TEXT NOT NULL,
                  starts_at TEXT NOT NULL,
                  status TEXT NOT NULL,
                  external_ref TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS action_audit (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  session_key TEXT NOT NULL,
                  action_type TEXT NOT NULL,
                  payload_hash TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  idempotency_key TEXT NOT NULL,
                  replay_window_bucket TEXT NOT NULL,
                  consent_token TEXT,
                  consent_snapshot_json TEXT,
                  status TEXT NOT NULL,
                  lifecycle_json TEXT NOT NULL,
                  result_json TEXT,
                  error_code TEXT,
                  error_message TEXT,
                  started_at TEXT NOT NULL,
                  finished_at TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(user_id, idempotency_key, replay_window_bucket)
                );

                CREATE TABLE IF NOT EXISTS consent_tokens (
                  token TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  action_type TEXT NOT NULL,
                  payload_hash TEXT NOT NULL,
                  issued_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL,
                  used_at TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS health_signals (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  metric_type TEXT NOT NULL,
                  source TEXT NOT NULL,
                  summary_json TEXT NOT NULL,
                  observed_at TEXT NOT NULL,
                  synced_at TEXT NOT NULL,
                  stale_after TEXT NOT NULL,
                  stale INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conversation_preferences (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  key TEXT NOT NULL,
                  value_json TEXT NOT NULL,
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conversation_summaries (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  session_key TEXT NOT NULL,
                  summary_text TEXT NOT NULL,
                  tags_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS policy_events (
                  id TEXT PRIMARY KEY,
                  user_id TEXT,
                  session_key TEXT,
                  event_type TEXT NOT NULL,
                  tool_name TEXT,
                  details_json TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_conditions_user_status
                  ON conditions(user_id, status);
                CREATE INDEX IF NOT EXISTS idx_medications_user_status
                  ON medications(user_id, status);
                CREATE INDEX IF NOT EXISTS idx_symptom_states_user_status
                  ON symptom_states(user_id, status);
                CREATE INDEX IF NOT EXISTS idx_appointments_user_starts
                  ON appointments(user_id, starts_at);
                CREATE INDEX IF NOT EXISTS idx_action_audit_user_started
                  ON action_audit(user_id, started_at);
                CREATE INDEX IF NOT EXISTS idx_health_signals_user_metric_time
                  ON health_signals(user_id, metric_type, observed_at);
                CREATE INDEX IF NOT EXISTS idx_conv_pref_user_key
                  ON conversation_preferences(user_id, key);
                CREATE INDEX IF NOT EXISTS idx_conv_summary_user_session
                  ON conversation_summaries(user_id, session_key, created_at DESC);
                """
            )
