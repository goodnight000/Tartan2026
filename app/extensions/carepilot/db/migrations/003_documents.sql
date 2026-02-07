PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_category TEXT NOT NULL CHECK (
    file_category IN ('lab_report', 'imaging_report', 'clinical_note', 'voice_attachment', 'other')
  ),
  encrypted_path TEXT NOT NULL,
  upload_time TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  retention_policy_key TEXT NOT NULL,
  is_context_eligible INTEGER NOT NULL DEFAULT 1,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('queued', 'processed', 'failed', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extracted_findings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  label TEXT NOT NULL,
  value_text TEXT NULL,
  unit TEXT NULL,
  reference_range TEXT NULL,
  is_abnormal INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_user_category_upload
  ON documents(user_id, file_category, upload_time);
CREATE INDEX IF NOT EXISTS idx_findings_user_label ON extracted_findings(user_id, label);

CREATE TRIGGER IF NOT EXISTS trg_documents_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_extracted_findings_updated_at
AFTER UPDATE ON extracted_findings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE extracted_findings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
