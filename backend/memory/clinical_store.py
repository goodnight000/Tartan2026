from __future__ import annotations

import json
import uuid
from datetime import timedelta
from typing import Any

from .database import SQLiteMemoryDB
from .time_utils import parse_iso, to_iso, utc_now


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _coerce_frequency_per_day(value: Any) -> float:
    if value is None or value == "":
        return 1.0
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 1.0
    return numeric if numeric > 0 else 1.0


class ClinicalStore:
    def __init__(self, db: SQLiteMemoryDB) -> None:
        self._db = db

    def get_profile(self, user_id: str, sections: list[str]) -> dict[str, Any]:
        with self._db.connection() as conn:
            result: dict[str, Any] = {}
            profile_row = conn.execute(
                "SELECT profile_json FROM patient_profile WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            profile_data = json.loads(profile_row["profile_json"]) if profile_row else {}

            if "conditions" in sections:
                result["conditions"] = [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT id, name, status, severity, source, confidence, updated_at
                        FROM conditions
                        WHERE user_id = ?
                        ORDER BY updated_at DESC
                        """,
                        (user_id,),
                    ).fetchall()
                ]

            if "allergies" in sections:
                result["allergies"] = [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT id, substance, reaction, severity, status, source, confidence, updated_at
                        FROM allergies
                        WHERE user_id = ?
                        ORDER BY updated_at DESC
                        """,
                        (user_id,),
                    ).fetchall()
                ]

            if "medications" in sections:
                result["medications"] = [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT id, name, dose_value, dose_unit, frequency_per_day, quantity_dispensed,
                               last_fill_date, pharmacy_name, pharmacy_contact, regimen_type, interval_days,
                               status, source, confidence, updated_at
                        FROM medications
                        WHERE user_id = ?
                        ORDER BY updated_at DESC
                        """,
                        (user_id,),
                    ).fetchall()
                ]

            if "active_symptoms" in sections:
                result["active_symptoms"] = [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT id, symptom, status, severity, onset_at, last_confirmed_at, expires_at,
                               reconfirm_due_at, source, confidence, updated_at
                        FROM symptom_states
                        WHERE user_id = ? AND status = 'active'
                        ORDER BY updated_at DESC
                        """,
                        (user_id,),
                    ).fetchall()
                ]

            if "preferences" in sections:
                result["preferences"] = profile_data.get("preferences", {})
                result["timezone"] = profile_data.get("timezone", "UTC")
                result["locale"] = profile_data.get("locale", "en-US")
                if "family_history" in profile_data:
                    result["family_history"] = profile_data["family_history"]

            result["source_of_truth"] = "clinical_store"
            return result

    def upsert_profile(self, user_id: str, profile_payload: dict[str, Any]) -> dict[str, Any]:
        now = to_iso(utc_now())
        record_id = f"profile_{user_id}"
        payload = dict(profile_payload)
        payload["user_id"] = user_id
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO patient_profile (id, user_id, profile_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  profile_json = excluded.profile_json,
                  updated_at = excluded.updated_at
                """,
                (record_id, user_id, _json_dumps(payload), now, now),
            )
        return payload | {"updated_at": now}

    def upsert_entity(
        self,
        *,
        user_id: str,
        entity_type: str,
        operation: str,
        payload: dict[str, Any],
        source: str,
        confidence: float,
    ) -> dict[str, Any]:
        now = to_iso(utc_now())
        entity_id = payload.get("id") or uuid.uuid4().hex

        if operation in {"resolve", "delete_soft"}:
            return self._mark_entity_status(
                user_id=user_id,
                entity_type=entity_type,
                entity_id=entity_id,
                operation=operation,
                now=now,
            )

        if entity_type == "condition":
            with self._db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO conditions (id, user_id, name, status, severity, source, confidence, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      status = excluded.status,
                      severity = excluded.severity,
                      source = excluded.source,
                      confidence = excluded.confidence,
                      updated_at = excluded.updated_at
                    """,
                    (
                        entity_id,
                        user_id,
                        payload.get("name", ""),
                        payload.get("status", "active"),
                        payload.get("severity"),
                        source,
                        confidence,
                        now,
                        now,
                    ),
                )
            return {"id": entity_id, "entity_type": entity_type, "status": payload.get("status", "active")}

        if entity_type == "allergy":
            with self._db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO allergies (id, user_id, substance, reaction, severity, status, source, confidence, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      substance = excluded.substance,
                      reaction = excluded.reaction,
                      severity = excluded.severity,
                      status = excluded.status,
                      source = excluded.source,
                      confidence = excluded.confidence,
                      updated_at = excluded.updated_at
                    """,
                    (
                        entity_id,
                        user_id,
                        payload.get("substance", ""),
                        payload.get("reaction"),
                        payload.get("severity"),
                        payload.get("status", "active"),
                        source,
                        confidence,
                        now,
                        now,
                    ),
                )
            return {"id": entity_id, "entity_type": entity_type, "status": payload.get("status", "active")}

        if entity_type == "medication":
            with self._db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO medications (
                      id, user_id, name, dose_value, dose_unit, frequency_per_day, quantity_dispensed,
                      last_fill_date, pharmacy_name, pharmacy_contact, regimen_type, interval_days, status,
                      source, confidence, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      dose_value = excluded.dose_value,
                      dose_unit = excluded.dose_unit,
                      frequency_per_day = excluded.frequency_per_day,
                      quantity_dispensed = excluded.quantity_dispensed,
                      last_fill_date = excluded.last_fill_date,
                      pharmacy_name = excluded.pharmacy_name,
                      pharmacy_contact = excluded.pharmacy_contact,
                      regimen_type = excluded.regimen_type,
                      interval_days = excluded.interval_days,
                      status = excluded.status,
                      source = excluded.source,
                      confidence = excluded.confidence,
                      updated_at = excluded.updated_at
                    """,
                    (
                        entity_id,
                        user_id,
                        payload.get("name", ""),
                        payload.get("dose_value"),
                        payload.get("dose_unit"),
                        _coerce_frequency_per_day(payload.get("frequency_per_day")),
                        payload.get("quantity_dispensed"),
                        payload.get("last_fill_date"),
                        payload.get("pharmacy_name"),
                        payload.get("pharmacy_contact"),
                        payload.get("regimen_type", "daily"),
                        payload.get("interval_days"),
                        payload.get("status", "active"),
                        source,
                        confidence,
                        now,
                        now,
                    ),
                )
            return {"id": entity_id, "entity_type": entity_type, "status": payload.get("status", "active")}

        if entity_type == "symptom_state":
            last_confirmed_at = payload.get("last_confirmed_at") or now
            expires_at = payload.get("expires_at") or to_iso(utc_now() + timedelta(days=7))
            reconfirm_due_at = to_iso(utc_now() + timedelta(hours=48))
            with self._db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO symptom_states (
                      id, user_id, symptom, status, severity, onset_at, last_confirmed_at,
                      expires_at, reconfirm_due_at, retention_class, source, confidence, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      symptom = excluded.symptom,
                      status = excluded.status,
                      severity = excluded.severity,
                      onset_at = excluded.onset_at,
                      last_confirmed_at = excluded.last_confirmed_at,
                      expires_at = excluded.expires_at,
                      reconfirm_due_at = excluded.reconfirm_due_at,
                      retention_class = excluded.retention_class,
                      source = excluded.source,
                      confidence = excluded.confidence,
                      updated_at = excluded.updated_at
                    """,
                    (
                        entity_id,
                        user_id,
                        payload.get("symptom", payload.get("symptom_text", "")),
                        payload.get("status", "active"),
                        payload.get("severity"),
                        payload.get("onset_at", payload.get("onset_time")),
                        last_confirmed_at,
                        expires_at,
                        reconfirm_due_at,
                        payload.get("retention_class", "TIME_BOUND_STATE"),
                        source,
                        confidence,
                        now,
                        now,
                    ),
                )
            return {
                "id": entity_id,
                "entity_type": entity_type,
                "status": payload.get("status", "active"),
                "reconfirm_due_at": reconfirm_due_at,
                "expires_at": expires_at,
            }

        if entity_type == "inference":
            max_expiry = utc_now() + timedelta(hours=24)
            requested_expiry = parse_iso(payload.get("expires_at"))
            if not requested_expiry:
                expires_at = to_iso(max_expiry)
            else:
                expires_at = to_iso(min(requested_expiry, max_expiry))
            with self._db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO inferences (
                      id, user_id, inference_key, value_json, status, created_at, expires_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      inference_key = excluded.inference_key,
                      value_json = excluded.value_json,
                      status = excluded.status,
                      expires_at = excluded.expires_at,
                      updated_at = excluded.updated_at
                    """,
                    (
                        entity_id,
                        user_id,
                        payload.get("inference_key", "generic"),
                        _json_dumps(payload.get("value", payload)),
                        payload.get("status", "active"),
                        now,
                        expires_at,
                        now,
                    ),
                )
            return {"id": entity_id, "entity_type": entity_type, "status": payload.get("status", "active")}

        raise ValueError(f"Unsupported entity_type: {entity_type}")

    def _mark_entity_status(
        self,
        *,
        user_id: str,
        entity_type: str,
        entity_id: str,
        operation: str,
        now: str,
    ) -> dict[str, Any]:
        status = "resolved" if operation == "resolve" else "inactive"
        table = {
            "condition": "conditions",
            "allergy": "allergies",
            "medication": "medications",
            "symptom_state": "symptom_states",
        }.get(entity_type)
        if not table:
            raise ValueError(f"Unsupported entity_type for {operation}: {entity_type}")
        with self._db.connection() as conn:
            conn.execute(
                f"""
                UPDATE {table}
                SET status = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (status, now, entity_id, user_id),
            )
        return {"id": entity_id, "entity_type": entity_type, "status": status}

    def get_medications(self, user_id: str) -> list[dict[str, Any]]:
        with self._db.connection() as conn:
            rows = conn.execute(
                """
                SELECT id, name, frequency_per_day, quantity_dispensed, last_fill_date, pharmacy_name,
                       pharmacy_contact, regimen_type, interval_days, status
                FROM medications
                WHERE user_id = ? AND status = 'active'
                ORDER BY updated_at DESC
                """,
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_symptom_logs(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        with self._db.connection() as conn:
            rows = conn.execute(
                """
                SELECT created_at, symptom AS symptom_text, severity, onset_at AS onset_time, status
                FROM symptom_states
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user_id, max(1, limit)),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_action_logs(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        with self._db.connection() as conn:
            rows = conn.execute(
                """
                SELECT started_at AS created_at, action_type, status
                FROM action_audit
                WHERE user_id = ?
                ORDER BY started_at DESC
                LIMIT ?
                """,
                (user_id, max(1, limit)),
            ).fetchall()
            return [dict(row) for row in rows]

    def issue_consent_token(
        self,
        *,
        user_id: str,
        action_type: str,
        payload_hash: str,
        expires_at: str,
        token: str,
    ) -> dict[str, Any]:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO consent_tokens (
                  token, user_id, action_type, payload_hash, issued_at, expires_at, used_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (token, user_id, action_type, payload_hash, now, expires_at, now, now),
            )
        return {"token": token, "issued_at": now, "expires_at": expires_at}

    def get_consent_token(self, token: str) -> dict[str, Any] | None:
        with self._db.connection() as conn:
            row = conn.execute(
                """
                SELECT token, user_id, action_type, payload_hash, issued_at, expires_at, used_at
                FROM consent_tokens
                WHERE token = ?
                """,
                (token,),
            ).fetchone()
            return dict(row) if row else None

    def mark_consent_token_used(self, token: str) -> None:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            conn.execute(
                """
                UPDATE consent_tokens
                SET used_at = ?, updated_at = ?
                WHERE token = ?
                """,
                (now, now, token),
            )

    def create_document_record(
        self,
        *,
        document_id: str,
        user_id: str,
        session_key: str,
        file_name: str,
        mime_type: str,
        file_category: str,
        storage_ref: str,
        processing_status: str = "queued",
    ) -> dict[str, Any]:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO documents (
                  id, user_id, session_key, file_name, mime_type, file_category, storage_ref,
                  upload_time, processing_status, extraction_confidence, summary_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    user_id,
                    session_key,
                    file_name,
                    mime_type,
                    file_category,
                    storage_ref,
                    now,
                    processing_status,
                    0.0,
                    None,
                    now,
                    now,
                ),
            )
        return {
            "id": document_id,
            "user_id": user_id,
            "session_key": session_key,
            "file_name": file_name,
            "mime_type": mime_type,
            "file_category": file_category,
            "processing_status": processing_status,
            "upload_time": now,
        }

    def store_document_analysis(
        self,
        *,
        document_id: str,
        user_id: str,
        session_key: str,
        processing_status: str,
        extraction_confidence: float,
        summary: dict[str, Any] | None,
        findings: list[dict[str, Any]],
    ) -> dict[str, Any]:
        now = to_iso(utc_now())
        clamped_confidence = max(0.0, min(1.0, float(extraction_confidence)))
        with self._db.connection() as conn:
            cursor = conn.execute(
                """
                UPDATE documents
                SET processing_status = ?, extraction_confidence = ?, summary_json = ?, updated_at = ?
                WHERE id = ? AND user_id = ? AND session_key = ?
                """,
                (
                    processing_status,
                    clamped_confidence,
                    _json_dumps(summary) if summary is not None else None,
                    now,
                    document_id,
                    user_id,
                    session_key,
                ),
            )
            if cursor.rowcount == 0:
                raise ValueError("Document record not found for user/session scope.")

            conn.execute(
                """
                DELETE FROM extracted_findings
                WHERE document_id = ? AND user_id = ? AND session_key = ?
                """,
                (document_id, user_id, session_key),
            )
            for finding in findings:
                conn.execute(
                    """
                    INSERT INTO extracted_findings (
                      id, document_id, user_id, session_key, finding_type, label, value_text,
                      unit, reference_range, is_abnormal, confidence, provenance_json, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        uuid.uuid4().hex,
                        document_id,
                        user_id,
                        session_key,
                        str(finding.get("finding_type") or "observation"),
                        str(finding.get("label") or "finding"),
                        finding.get("value_text"),
                        finding.get("unit"),
                        finding.get("reference_range"),
                        1 if bool(finding.get("is_abnormal")) else 0,
                        max(0.0, min(1.0, float(finding.get("confidence", clamped_confidence)))),
                        _json_dumps(finding.get("provenance", {})),
                        now,
                        now,
                    ),
                )
        return {
            "document_id": document_id,
            "processing_status": processing_status,
            "extraction_confidence": clamped_confidence,
            "findings_count": len(findings),
        }

    def create_appointment(
        self,
        *,
        appointment_id: str,
        user_id: str,
        provider_name: str,
        location: str,
        starts_at: str,
        status: str,
        external_ref: str | None,
    ) -> None:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO appointments (
                  id, user_id, provider_name, location, starts_at, status, external_ref, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  provider_name = excluded.provider_name,
                  location = excluded.location,
                  starts_at = excluded.starts_at,
                  status = excluded.status,
                  external_ref = excluded.external_ref,
                  updated_at = excluded.updated_at
                """,
                (appointment_id, user_id, provider_name, location, starts_at, status, external_ref, now, now),
            )

    def append_policy_event(
        self,
        *,
        user_id: str | None,
        session_key: str | None,
        event_type: str,
        tool_name: str | None,
        details: dict[str, Any],
    ) -> None:
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO policy_events (id, user_id, session_key, event_type, tool_name, details_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    user_id,
                    session_key,
                    event_type,
                    tool_name,
                    _json_dumps(details),
                    to_iso(utc_now()),
                ),
            )
