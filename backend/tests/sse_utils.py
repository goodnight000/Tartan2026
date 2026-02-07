from __future__ import annotations

from typing import Any, Dict, List


def parse_sse_events(payload_text: str) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    current: Dict[str, Any] = {}
    for raw_line in payload_text.splitlines():
        line = raw_line.strip("\r")
        if line.startswith("event: "):
            current["event"] = line[7:]
        elif line.startswith("data: "):
            current["data"] = line[6:]
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events
