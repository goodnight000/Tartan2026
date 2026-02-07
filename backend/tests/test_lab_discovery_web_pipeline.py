from __future__ import annotations

from typing import Any

import httpx

from carepilot_tools.web_discovery import WebDiscoveryPipeline


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        json_data: Any = None,
        text: str = "",
        headers: dict[str, str] | None = None,
        url: str = "https://example.test",
    ) -> None:
        self.status_code = status_code
        self._json_data = json_data
        self.text = text
        self.headers = headers or {"content-type": "application/json"}
        self.url = url
        self.content = b"1"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=httpx.Request("GET", self.url), response=httpx.Response(self.status_code))

    def json(self) -> Any:
        return self._json_data


def test_discover_labs_uses_nominatim_live_results(monkeypatch):
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")
    pipeline = WebDiscoveryPipeline()

    def fake_get(url: str, **kwargs):
        if "nominatim.openstreetmap.org/search" in url:
            q = str((kwargs.get("params") or {}).get("q", ""))
            if "blood test" in q:
                return _FakeResponse(
                    json_data=[
                        {
                            "name": "RealCare Clinic Lab",
                            "display_name": "RealCare Clinic Lab, Pittsburgh, Pennsylvania, USA",
                            "type": "clinic",
                            "class": "amenity",
                            "lat": "40.4406",
                            "lon": "-79.9959",
                            "extratags": {},
                        },
                        {
                            "name": "Northside Diagnostics",
                            "display_name": "Northside Diagnostics, Pittsburgh, Pennsylvania, USA",
                            "type": "laboratory",
                            "class": "amenity",
                            "lat": "40.4420",
                            "lon": "-79.9900",
                            "extratags": {},
                        },
                    ]
                )
            return _FakeResponse(
                json_data=[
                    {
                        "display_name": "Pittsburgh, Pennsylvania, USA",
                        "lat": "40.4406",
                        "lon": "-79.9959",
                    }
                ]
            )
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("carepilot_tools.web_discovery.httpx.get", fake_get)
    result = pipeline.discover_labs(
        origin="Pittsburgh",
        max_distance_miles=10,
        budget_cap=120,
        preferred_time_window="next_available",
        in_network_preference="prefer_in_network",
    )
    assert result["using_live_data"] is True
    assert result["provider"] == "osm_nominatim_search"
    assert result["options"]
    assert all(item["data_source"] == "osm_nominatim_search" for item in result["options"])
    assert result["fallback_reason"] is None


def test_discover_labs_prefers_brave_when_key_set_and_enriches_fetch(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "test-key")
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")
    pipeline = WebDiscoveryPipeline()

    def fake_get(url: str, **kwargs):
        if "api.search.brave.com" in url:
            return _FakeResponse(
                json_data={
                    "web": {
                        "results": [
                            {
                                "title": "Riverfront Lab and Clinic",
                                "url": "https://riverfront.example/labs",
                                "description": "Blood testing and diagnostics",
                            }
                        ]
                    }
                }
            )
        if "nominatim.openstreetmap.org/search" in url:
            return _FakeResponse(json_data=[])
        if "riverfront.example" in url:
            return _FakeResponse(
                headers={"content-type": "text/html"},
                text="<html><body>Call us at (412) 555-0102 for booking</body></html>",
                url="https://riverfront.example/labs",
            )
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("carepilot_tools.web_discovery.httpx.get", fake_get)
    result = pipeline.discover_labs(
        origin="Pittsburgh",
        max_distance_miles=10,
        budget_cap=120,
        preferred_time_window="next_available",
        in_network_preference="prefer_in_network",
    )
    assert result["using_live_data"] is True
    assert result["provider"] == "brave_web_search"
    assert result["options"]
    assert result["options"][0]["data_source"] == "brave_web_search"
    assert result["options"][0]["contact_phone"] == "+14125550102"


def test_discover_labs_falls_back_when_external_search_fails(monkeypatch):
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")
    pipeline = WebDiscoveryPipeline()

    def failing_get(*args, **kwargs):
        raise httpx.TimeoutException("timeout")

    monkeypatch.setattr("carepilot_tools.web_discovery.httpx.get", failing_get)
    result = pipeline.discover_labs(
        origin="Pittsburgh",
        max_distance_miles=10,
        budget_cap=120,
        preferred_time_window="next_available",
        in_network_preference="prefer_in_network",
    )
    assert result["using_live_data"] is False
    assert result["provider"] == "fallback_static"
    assert result["fallback_reason"] in {"no_live_results", "filtered_live_results_empty"}
    assert result["options"]


def test_discover_labs_respects_external_disable_flag(monkeypatch):
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "true")
    pipeline = WebDiscoveryPipeline()
    result = pipeline.discover_labs(
        origin="Pittsburgh",
        max_distance_miles=10,
        budget_cap=120,
        preferred_time_window="next_available",
        in_network_preference="prefer_in_network",
    )
    assert result["using_live_data"] is False
    assert result["provider"] == "fallback_static"
    assert result["fallback_reason"] == "external_web_disabled"
