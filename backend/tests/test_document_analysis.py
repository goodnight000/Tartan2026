from __future__ import annotations

import json
import sys
from types import SimpleNamespace


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
        }, "anthropic"

    monkeypatch.setattr(backend_module, "_document_interpret", fake_interpret)

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


def test_documents_analyze_supports_anthropic_without_openai_key(client, auth_headers, backend_module, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")

    def fake_anthropic(**kwargs):
        return {
            "key_findings": ["LDL elevated", "No critical abnormalities listed."],
            "plain_language_summary": "Results show lipid elevation that needs routine follow-up.",
            "follow_up_questions": [
                "Should I repeat this panel fasting?",
                "What target LDL range is appropriate for me?",
                "Should medications or lifestyle changes be discussed first?",
            ],
            "uncertainty_statement": "Summary is based only on uploaded text.",
            "safety_guidance": "",
            "urgency_level": "routine",
            "high_risk_flags": [],
        }

    monkeypatch.setattr(backend_module, "_anthropic_document_interpret", fake_anthropic)

    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a", "file_category": "lab_report"},
        files={"document": ("lipids.txt", b"LDL elevated compared with prior test.", "text/plain")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["extraction"]["llm_used"] is True

    with backend_module.container.db.connection() as conn:
        doc = conn.execute(
            """
            SELECT summary_json
            FROM documents
            WHERE id = ?
            """,
            (payload["document_id"],),
        ).fetchone()
        assert doc is not None
        summary = json.loads(doc["summary_json"])
        assert summary["llm_provider"] == "anthropic"


def test_documents_analyze_rejects_empty_upload(client, auth_headers):
    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"document": ("empty.txt", b"", "text/plain")},
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_documents_analyze_uses_local_fallback_when_no_llm_provider_is_configured(client, auth_headers, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    response = client.post(
        "/documents/analyze",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"document": ("report.txt", b"CBC abnormal values", "text/plain")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["extraction"]["llm_used"] is False
    assert "not a diagnosis" in payload["plain_language_summary"].lower()


def test_document_provider_normalizes_openrouter_style_anthropic_model_name(backend_module, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setenv("ANTHROPIC_MODEL", "anthropic/claude-sonnet-4-5")
    providers = backend_module._document_provider_candidates()
    anthropic = [provider for provider in providers if provider["provider"] == "anthropic"]
    assert anthropic
    assert anthropic[0]["model"] == "claude-sonnet-4-5"


def test_extract_document_text_prefers_pypdf_for_pdf(backend_module, monkeypatch):
    class _FakePage:
        def extract_text(self):
            return "Hemoglobin 11.2 g/dL"

    class _FakeReader:
        def __init__(self, stream):
            self.pages = [_FakePage()]

    monkeypatch.setitem(sys.modules, "pypdf", SimpleNamespace(PdfReader=_FakeReader))
    text, confidence, method = backend_module._extract_document_text(
        "sample.pdf",
        "application/pdf",
        b"%PDF-1.4 fake",
    )
    assert "Hemoglobin 11.2 g/dL" in text
    assert method == "pdf_text_extract_pypdf"
    assert confidence >= 0.2


def test_normalize_follow_up_questions_rewrites_clinician_voice_to_patient_voice(backend_module):
    normalized = backend_module._normalize_follow_up_questions(
        [
            "Does the patient have any known immune system conditions or infections?",
            "Is the patient currently taking medications that might affect immune cell counts?",
            "What was the clinical indication for ordering the CD4/CD8 Ratio Profile?",
        ]
    )
    assert len(normalized) >= 3
    assert normalized[0].startswith("Do I")
    assert normalized[1].startswith("Am I")
    assert "the patient" not in " ".join(normalized).lower()
    assert normalized[2] == "Why was this test ordered for me?"
