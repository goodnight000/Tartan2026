from __future__ import annotations

import json


def test_documents_analyze_success_returns_safe_summary_and_persists(client, auth_headers, backend_module, monkeypatch):
    def fake_interpret(**kwargs):
        return {
            "key_findings": ["Critical troponin elevation", "No focal hemorrhage identified"],
            "plain_language_summary": "Findings suggest concern and need quick review.",
            "follow_up_questions": [
                "Should I repeat this test today?",
                "What symptoms mean I should seek emergency care?",
                "How does this compare with prior labs?",
            ],
            "uncertainty_statement": "Limited to uploaded report text.",
            "safety_guidance": "",
            "urgency_level": "routine",
            "high_risk_flags": ["critical"],
        }

    monkeypatch.setattr(backend_module, "_openai_document_interpret", fake_interpret)

    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a", "file_category": "lab_report", "question": "What matters most here?"},
        files={
            "document": (
                "cbc.txt",
                b"Hemoglobin low. Troponin critical. Compare with prior.",
                "text/plain",
            )
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["document_id"].startswith("doc_")
    assert payload["file_category"] == "lab_report"
    assert payload["key_findings"]
    assert "not a diagnosis" in payload["plain_language_summary"].lower()
    assert len(payload["follow_up_questions"]) >= 3
    assert payload["safety_framing"]["urgency_level"] == "urgent"
    assert "critical" in payload["safety_framing"]["high_risk_flags"]
    assert payload["extraction"]["llm_used"] is True

    with backend_module.container.db.connection() as conn:
        doc = conn.execute(
            """
            SELECT user_id, session_key, processing_status, extraction_confidence, summary_json
            FROM documents
            WHERE id = ?
            """,
            (payload["document_id"],),
        ).fetchone()
        assert doc is not None
        assert doc["user_id"] == "user-a"
        assert doc["session_key"] == "session-a"
        assert doc["processing_status"] == "processed"
        assert doc["extraction_confidence"] > 0
        summary = json.loads(doc["summary_json"])
        assert summary["analysis_type"] == "document_summary"

        findings_count = conn.execute(
            "SELECT COUNT(*) AS count FROM extracted_findings WHERE document_id = ?",
            (payload["document_id"],),
        ).fetchone()
        assert findings_count is not None
        assert findings_count["count"] >= 2


def test_documents_analyze_rejects_empty_upload(client, auth_headers):
    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"document": ("empty.txt", b"", "text/plain")},
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_documents_analyze_reports_missing_openai_key(client, auth_headers, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"document": ("report.txt", b"CBC abnormal values", "text/plain")},
    )
    assert response.status_code == 503
    assert "api key" in response.json()["detail"].lower()
