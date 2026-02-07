from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Callable

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def backend_module(tmp_path, monkeypatch):
    db_path = tmp_path / "carepilot-test.sqlite"
    monkeypatch.setenv("CAREPILOT_DB_PATH", str(db_path))
    monkeypatch.setenv("ALLOW_ANON", "false")
    # Keep CI deterministic; dedicated provider tests can override this.
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "true")

    if "main" in sys.modules:
        module = importlib.reload(sys.modules["main"])
    else:
        module = importlib.import_module("main")
    return module


@pytest.fixture
def client(backend_module):
    with TestClient(backend_module.app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> Callable[[str], dict[str, str]]:
    def _make(user_id: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {user_id}"}

    return _make
