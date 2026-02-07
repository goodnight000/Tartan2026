from __future__ import annotations

import pytest


def test_documents_analysis_is_strictly_user_and_session_scoped(client, auth_headers, backend_module, monkeypatch):
    def fake_interpret(**kwargs):
        return {
            "key_findings": ["No acute hemorrhage.", "Mild bibasilar atelectasis."],
            "plain_language_summary": "Findings appear non-emergent but should be reviewed clinically.",
            "follow_up_questions": [
                "Should this be compared with prior imaging?",
                "Do I need repeat imaging?",
                "What symptoms should prompt urgent review?",
            ],
            "uncertainty_statement": "Based on report text only.",
            "safety_guidance": "",
            "urgency_level": "routine",
            "high_risk_flags": [],
        }

    monkeypatch.setattr(backend_module, "_openai_document_interpret", fake_interpret)

    response_a1 = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a-1", "file_category": "imaging_report"},
        files={"document": ("imaging-a1.txt", b"Report A1", "text/plain")},
    )
    response_a2 = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a-2", "file_category": "imaging_report"},
        files={"document": ("imaging-a2.txt", b"Report A2", "text/plain")},
    )
    response_b1 = client.post(
        "/documents/analyze",
        headers=auth_headers("user-b"),
        data={"session_key": "session-b-1", "file_category": "imaging_report"},
        files={"document": ("imaging-b1.txt", b"Report B1", "text/plain")},
    )

    assert response_a1.status_code == 200
    assert response_a2.status_code == 200
    assert response_b1.status_code == 200

    with backend_module.container.db.connection() as conn:
        docs_a = conn.execute(
            "SELECT session_key FROM documents WHERE user_id = ? ORDER BY session_key",
            ("user-a",),
        ).fetchall()
        docs_b = conn.execute(
            "SELECT session_key FROM documents WHERE user_id = ? ORDER BY session_key",
            ("user-b",),
        ).fetchall()
        assert [row["session_key"] for row in docs_a] == ["session-a-1", "session-a-2"]
        assert [row["session_key"] for row in docs_b] == ["session-b-1"]

        findings_a = conn.execute(
            "SELECT COUNT(*) AS count FROM extracted_findings WHERE user_id = ?",
            ("user-a",),
        ).fetchone()
        findings_b = conn.execute(
            "SELECT COUNT(*) AS count FROM extracted_findings WHERE user_id = ?",
            ("user-b",),
        ).fetchone()
        assert findings_a is not None and findings_a["count"] > 0
        assert findings_b is not None and findings_b["count"] > 0


def test_store_document_analysis_rejects_cross_scope_update(backend_module):
    clinical = backend_module.container.memory.clinical
    document_id = "doc_scope_test"
    clinical.create_document_record(
        document_id=document_id,
        user_id="user-a",
        session_key="session-a",
        file_name="doc.txt",
        mime_type="text/plain",
        file_category="lab_report",
        storage_ref="memory://document/doc_scope_test",
        processing_status="queued",
    )

    with pytest.raises(ValueError):
        clinical.store_document_analysis(
            document_id=document_id,
            user_id="user-b",
            session_key="session-a",
            processing_status="processed",
            extraction_confidence=0.9,
            summary={"analysis_type": "document_summary"},
            findings=[],
        )
