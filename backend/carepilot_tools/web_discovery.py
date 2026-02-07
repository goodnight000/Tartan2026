from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import httpx

from memory.time_utils import utc_now

_MEDICAL_KEYWORDS = (
    "lab",
    "laboratory",
    "diagnostic",
    "clinic",
    "health",
    "blood test",
    "urgent care",
    "hospital",
    "quest",
    "labcorp",
)


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_medical_candidate(*parts: str) -> bool:
    text = " ".join(part for part in parts if part).lower()
    return any(keyword in text for keyword in _MEDICAL_KEYWORDS)


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _strip_html(html: str) -> str:
    content = re.sub(r"(?is)<script.*?>.*?</script>", " ", html)
    content = re.sub(r"(?is)<style.*?>.*?</style>", " ", content)
    content = re.sub(r"(?is)<[^>]+>", " ", content)
    return _normalize_whitespace(content)


def _extract_phone(text: str) -> str | None:
    match = re.search(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}", text)
    if not match:
        return None
    digits = re.sub(r"\D", "", match.group(0))
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}"


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    km = radius_km * c
    return km * 0.621371


@dataclass
class SearchHit:
    name: str
    address: str
    url: str | None
    snippet: str
    source: str
    lat: float | None = None
    lon: float | None = None


class WebDiscoveryPipeline:
    def __init__(self) -> None:
        self.brave_api_key = (os.getenv("BRAVE_API_KEY") or "").strip()
        self.disable_external = os.getenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false").lower() == "true"
        self.timeout = float(os.getenv("CAREPILOT_WEB_TIMEOUT_SECONDS", "5.0"))

    def discover_labs(
        self,
        *,
        origin: str,
        max_distance_miles: float,
        budget_cap: float,
        preferred_time_window: str,
        in_network_preference: str,
    ) -> dict[str, Any]:
        if self.disable_external:
            return self._fallback_result(
                origin=origin,
                max_distance_miles=max_distance_miles,
                budget_cap=budget_cap,
                preferred_time_window=preferred_time_window,
                in_network_preference=in_network_preference,
                reason="external_web_disabled",
            )

        hits, provider = self._web_search(
            query="blood test medical laboratory clinic",
            location=origin,
            limit=12,
        )
        if not hits:
            return self._fallback_result(
                origin=origin,
                max_distance_miles=max_distance_miles,
                budget_cap=budget_cap,
                preferred_time_window=preferred_time_window,
                in_network_preference=in_network_preference,
                reason="no_live_results",
            )

        origin_coord = self._resolve_origin_coord(origin)
        now = utc_now()
        ranked: list[dict[str, Any]] = []
        fetch_count = 0

        for idx, hit in enumerate(hits):
            if not _is_medical_candidate(hit.name, hit.snippet, hit.address):
                continue

            distance_miles: float | None = None
            if origin_coord and hit.lat is not None and hit.lon is not None:
                distance_miles = _haversine_miles(origin_coord[0], origin_coord[1], hit.lat, hit.lon)
                if distance_miles > max_distance_miles * 1.75:
                    continue

            enrichment: dict[str, Any] = {}
            if hit.url and fetch_count < 4:
                enrichment = self._web_fetch(hit.url)
                fetch_count += 1

            distance_norm = (
                min(distance_miles / max(max_distance_miles, 1.0), 1.0)
                if distance_miles is not None
                else 0.55
            )
            price_norm = 0.45
            wait_norm = min(0.25 + idx * 0.08, 1.0)
            rating_norm = 0.82
            network_penalty = 0.0 if in_network_preference != "prefer_in_network" else 0.5
            raw_score = (
                0.35 * distance_norm
                + 0.25 * price_norm
                + 0.25 * wait_norm
                + 0.10 * (1.0 - rating_norm)
                + 0.05 * network_penalty
            )
            rank_score = round(max(0.0, 1.0 - raw_score), 4)
            next_slot_dt = now + timedelta(hours=16 + idx * 4)
            ranked.append(
                {
                    "name": hit.name,
                    "distance_miles": round(distance_miles, 2) if distance_miles is not None else None,
                    "price_range": "unknown",
                    "next_slot": next_slot_dt.strftime("%a %I:%M %p"),
                    "rating": 4.1,
                    "rank_score": rank_score,
                    "network_match_hint": "unknown",
                    "rank_reason": (
                        f"distance={distance_norm:.2f}, price={price_norm:.2f}, wait={wait_norm:.2f}, "
                        f"rating_penalty={(1.0 - rating_norm):.2f}, network_penalty={network_penalty:.2f}"
                    ),
                    "criteria": {
                        "max_distance_miles": max_distance_miles,
                        "budget_cap": budget_cap,
                        "preferred_time_window": preferred_time_window,
                        "origin": origin,
                        "provider": provider,
                    },
                    "address": hit.address or origin,
                    "source_url": hit.url,
                    "contact_phone": enrichment.get("phone"),
                    "data_source": provider,
                }
            )

        if not ranked:
            return self._fallback_result(
                origin=origin,
                max_distance_miles=max_distance_miles,
                budget_cap=budget_cap,
                preferred_time_window=preferred_time_window,
                in_network_preference=in_network_preference,
                reason="filtered_live_results_empty",
            )

        ranked.sort(key=lambda row: row["rank_score"], reverse=True)
        return {
            "options": ranked[:5],
            "provider": provider,
            "using_live_data": True,
            "fallback_reason": None,
        }

    def _web_search(self, *, query: str, location: str, limit: int) -> tuple[list[SearchHit], str]:
        if self.brave_api_key:
            brave_hits = self._brave_search(query=query, location=location, limit=limit)
            if brave_hits:
                return brave_hits, "brave_web_search"

        osm_hits = self._nominatim_search(query=query, location=location, limit=limit)
        if osm_hits:
            return osm_hits, "osm_nominatim_search"
        return [], "none"

    def _brave_search(self, *, query: str, location: str, limit: int) -> list[SearchHit]:
        try:
            response = httpx.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": f"{query} near {location}", "count": max(1, min(limit, 20))},
                headers={
                    "X-Subscription-Token": self.brave_api_key,
                    "Accept": "application/json",
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
        except Exception:
            return []

        payload = response.json() if response.content else {}
        rows = (payload.get("web") or {}).get("results") or []
        hits: list[SearchHit] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = _normalize_whitespace(str(row.get("title") or ""))
            description = _normalize_whitespace(str(row.get("description") or ""))
            if not _is_medical_candidate(title, description):
                continue
            url = str(row.get("url") or "").strip() or None
            hits.append(
                SearchHit(
                    name=title or "Medical provider",
                    address=location,
                    url=url,
                    snippet=description,
                    source="brave",
                )
            )
        return hits

    def _nominatim_search(self, *, query: str, location: str, limit: int) -> list[SearchHit]:
        try:
            response = httpx.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": f"{query} near {location}",
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "extratags": 1,
                    "limit": max(1, min(limit, 20)),
                },
                headers={"User-Agent": "carepilot-agent/1.0"},
                timeout=self.timeout,
            )
            response.raise_for_status()
        except Exception:
            return []

        rows = response.json() if response.content else []
        hits: list[SearchHit] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_type = str(row.get("type") or "")
            row_class = str(row.get("class") or "")
            if row_class not in {"amenity", "shop", "building"} and row_type not in {
                "clinic",
                "hospital",
                "doctors",
                "laboratory",
                "medical_laboratory",
                "healthcare",
            }:
                continue
            display_name = _normalize_whitespace(str(row.get("display_name") or ""))
            name = _normalize_whitespace(str(row.get("name") or "")) or display_name.split(",")[0]
            if not _is_medical_candidate(name, display_name, row_type):
                continue
            extratags = row.get("extratags") if isinstance(row.get("extratags"), dict) else {}
            url = str(extratags.get("website") or "").strip() or None
            hits.append(
                SearchHit(
                    name=name or "Medical provider",
                    address=display_name or location,
                    url=url,
                    snippet=display_name,
                    source="osm",
                    lat=_safe_float(row.get("lat")),
                    lon=_safe_float(row.get("lon")),
                )
            )
        return hits

    def _resolve_origin_coord(self, location: str) -> tuple[float, float] | None:
        try:
            response = httpx.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": location,
                    "format": "jsonv2",
                    "limit": 1,
                },
                headers={"User-Agent": "carepilot-agent/1.0"},
                timeout=self.timeout,
            )
            response.raise_for_status()
        except Exception:
            return None

        rows = response.json() if response.content else []
        if not isinstance(rows, list) or not rows:
            return None
        first = rows[0]
        if not isinstance(first, dict):
            return None
        lat = _safe_float(first.get("lat"))
        lon = _safe_float(first.get("lon"))
        if lat is None or lon is None:
            return None
        return lat, lon

    def _web_fetch(self, url: str) -> dict[str, Any]:
        if not url.startswith("http://") and not url.startswith("https://"):
            return {}
        try:
            response = httpx.get(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,text/plain",
                },
                timeout=self.timeout,
                follow_redirects=True,
            )
            response.raise_for_status()
        except Exception:
            return {}

        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type and "text/plain" not in content_type:
            return {}
        text = _strip_html(response.text)
        if not text:
            return {}
        return {
            "phone": _extract_phone(text),
            "content_sample": text[:400],
            "source_url": str(response.url),
        }

    def _fallback_result(
        self,
        *,
        origin: str,
        max_distance_miles: float,
        budget_cap: float,
        preferred_time_window: str,
        in_network_preference: str,
        reason: str,
    ) -> dict[str, Any]:
        base_options = [
            {
                "name": "Quest Diagnostics",
                "distance": 2.1,
                "price_low": 70,
                "price_high": 95,
                "wait_hours": 22,
                "rating": 4.4,
                "network": "in_network",
            },
            {
                "name": "Labcorp Midtown",
                "distance": 3.0,
                "price_low": 60,
                "price_high": 110,
                "wait_hours": 30,
                "rating": 4.1,
                "network": "unknown",
            },
            {
                "name": "City Health Lab",
                "distance": 1.8,
                "price_low": 85,
                "price_high": 120,
                "wait_hours": 40,
                "rating": 4.7,
                "network": "out_of_network",
            },
            {
                "name": "Riverside Clinic Lab",
                "distance": 4.4,
                "price_low": 65,
                "price_high": 102,
                "wait_hours": 18,
                "rating": 4.2,
                "network": "in_network",
            },
            {
                "name": "Metro Family Diagnostics",
                "distance": 5.2,
                "price_low": 55,
                "price_high": 90,
                "wait_hours": 28,
                "rating": 3.9,
                "network": "unknown",
            },
        ]

        now = utc_now()
        ranked: list[dict[str, Any]] = []
        for item in base_options:
            distance_norm = min(item["distance"] / max(max_distance_miles, 1.0), 1.0)
            mid_price = (item["price_low"] + item["price_high"]) / 2.0
            price_norm = min(mid_price / max(1.0, budget_cap), 2.0) / 2.0
            wait_norm = min(item["wait_hours"] / 72.0, 1.0)
            rating_norm = min(max(item["rating"] / 5.0, 0.0), 1.0)
            if in_network_preference == "prefer_in_network":
                network_penalty = {"in_network": 0.0, "unknown": 0.5, "out_of_network": 1.0}[item["network"]]
            else:
                network_penalty = 0.0 if item["network"] != "out_of_network" else 0.35
            raw_score = (
                0.35 * distance_norm
                + 0.25 * price_norm
                + 0.25 * wait_norm
                + 0.10 * (1.0 - rating_norm)
                + 0.05 * network_penalty
            )
            rank_score = round(max(0.0, 1.0 - raw_score), 4)
            ranked.append(
                {
                    "name": item["name"],
                    "distance_miles": item["distance"],
                    "price_range": f"${item['price_low']}-${item['price_high']}",
                    "next_slot": (now + timedelta(hours=item["wait_hours"])).strftime("%a %I:%M %p"),
                    "rating": item["rating"],
                    "rank_score": rank_score,
                    "network_match_hint": item["network"],
                    "rank_reason": (
                        f"distance={distance_norm:.2f}, price={price_norm:.2f}, wait={wait_norm:.2f}, "
                        f"rating_penalty={(1.0 - rating_norm):.2f}, network_penalty={network_penalty:.2f}"
                    ),
                    "criteria": {
                        "max_distance_miles": max_distance_miles,
                        "budget_cap": budget_cap,
                        "preferred_time_window": preferred_time_window,
                        "origin": origin,
                        "provider": "fallback_static",
                    },
                    "address": origin,
                    "source_url": None,
                    "contact_phone": None,
                    "data_source": "fallback_static",
                }
            )
        ranked.sort(key=lambda row: row["rank_score"], reverse=True)
        return {
            "options": ranked[:5],
            "provider": "fallback_static",
            "using_live_data": False,
            "fallback_reason": reason,
        }
