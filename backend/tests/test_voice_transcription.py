from __future__ import annotations

from fastapi import HTTPException


def test_voice_transcribe_success_persists_scoped_analysis(client, auth_headers, backend_module, monkeypatch):
    def fake_transcribe(**kwargs):
        return {
            "transcript_text": "I have dizziness and missed two doses.",
            "confidence": 0.92,
            "segments": [{"id": 0, "text": "I have dizziness and missed two doses."}],
            "provider_payload": {"mock": True},
        }

    monkeypatch.setattr(backend_module, "_openai_whisper_transcribe", fake_transcribe)

    response = client.post(
        "/voice/transcribe",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a", "language_hint": "en"},
        files={"audio": ("symptoms.m4a", b"fake-audio-bytes", "audio/m4a")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript_text"] == "I have dizziness and missed two doses."
    assert payload["confidence"] == 0.92
    assert payload["segments"]
    assert payload["document_id"].startswith("doc_")

    with backend_module.container.db.connection() as conn:
        doc = conn.execute(
            """
            SELECT user_id, session_key, file_category, processing_status
            FROM documents
            WHERE id = ?
            """,
            (payload["document_id"],),
        ).fetchone()
        assert doc is not None
        assert doc["user_id"] == "user-a"
        assert doc["session_key"] == "session-a"
        assert doc["file_category"] == "voice_attachment"
        assert doc["processing_status"] == "processed"

        finding = conn.execute(
            """
            SELECT user_id, session_key, finding_type, value_text
            FROM extracted_findings
            WHERE document_id = ?
            LIMIT 1
            """,
            (payload["document_id"],),
        ).fetchone()
        assert finding is not None
        assert finding["user_id"] == "user-a"
        assert finding["session_key"] == "session-a"
        assert finding["finding_type"] == "voice_transcript"
        assert "dizziness" in (finding["value_text"] or "").lower()


def test_voice_transcribe_rejects_unsupported_format(client, auth_headers):
    response = client.post(
        "/voice/transcribe",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"audio": ("not-audio.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415
    assert "unsupported audio format" in response.json()["detail"].lower()


def test_voice_transcribe_provider_timeout_surfaces_clear_error(client, auth_headers, backend_module, monkeypatch):
    def fake_transcribe(**kwargs):
        raise HTTPException(status_code=504, detail="Transcription provider timed out.")

    monkeypatch.setattr(backend_module, "_openai_whisper_transcribe", fake_transcribe)
    response = client.post(
        "/voice/transcribe",
        headers=auth_headers("user-a"),
        data={"session_key": "session-a"},
        files={"audio": ("symptoms.wav", b"wav-bytes", "audio/wav")},
    )
    assert response.status_code == 504
    assert "timed out" in response.json()["detail"].lower()
