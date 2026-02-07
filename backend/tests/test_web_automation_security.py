from __future__ import annotations

import socket

from carepilot_tools.web_automation import BrowserAutomationRunner


def test_normalize_url_rejects_localhost_and_private_hosts():
    assert BrowserAutomationRunner._normalize_url("http://127.0.0.1:8000") is None
    assert BrowserAutomationRunner._normalize_url("http://localhost:3000") is None
    assert BrowserAutomationRunner._normalize_url("http://10.0.0.8") is None
    assert BrowserAutomationRunner._normalize_url("http://192.168.1.2") is None


def test_normalize_url_accepts_public_https(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))],
    )
    assert BrowserAutomationRunner._normalize_url("https://example.com/path") == "https://example.com/path"


def test_normalize_url_rejects_public_http_by_default():
    assert BrowserAutomationRunner._normalize_url("http://example.com/path") is None


def test_normalize_url_allows_public_http_when_enabled(monkeypatch):
    monkeypatch.setenv("CAREPILOT_ALLOW_INSECURE_HTTP", "true")
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))],
    )
    assert BrowserAutomationRunner._normalize_url("http://example.com/path") == "http://example.com/path"


def test_normalize_url_rejects_unresolved_hostnames_by_default(monkeypatch):
    monkeypatch.delenv("CAREPILOT_BROWSER_ALLOW_UNRESOLVED_HOSTS", raising=False)

    def _raise_gaierror(*_args, **_kwargs):
        raise socket.gaierror("dns unavailable")

    monkeypatch.setattr(socket, "getaddrinfo", _raise_gaierror)
    assert BrowserAutomationRunner._normalize_url("https://example.com/path") is None


def test_normalize_url_allows_unresolved_hostnames_when_explicitly_enabled(monkeypatch):
    monkeypatch.setenv("CAREPILOT_BROWSER_ALLOW_UNRESOLVED_HOSTS", "true")

    def _raise_gaierror(*_args, **_kwargs):
        raise socket.gaierror("dns unavailable")

    monkeypatch.setattr(socket, "getaddrinfo", _raise_gaierror)
    assert BrowserAutomationRunner._normalize_url("https://example.com/path") == "https://example.com/path"
