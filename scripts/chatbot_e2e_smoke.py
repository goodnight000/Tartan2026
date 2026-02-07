#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


@dataclass
class Scenario:
  name: str
  message: str
  expected_tool: str


def parse_sse_events(payload_text: str) -> list[dict[str, Any]]:
  events: list[dict[str, Any]] = []
  current: dict[str, Any] = {}
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


def first_event_payload(events: list[dict[str, Any]], event_name: str) -> Any | None:
  for event in events:
    if event.get("event") != event_name:
      continue
    raw = event.get("data")
    if not isinstance(raw, str):
      return raw
    try:
      return json.loads(raw)
    except json.JSONDecodeError:
      return raw
  return None


def token_text(events: list[dict[str, Any]]) -> str:
  chunks: list[str] = []
  for event in events:
    if event.get("event") != "token":
      continue
    raw = event.get("data")
    if not isinstance(raw, str):
      continue
    try:
      payload = json.loads(raw)
      delta = payload.get("delta")
      if isinstance(delta, str):
        chunks.append(delta)
    except json.JSONDecodeError:
      continue
  return "".join(chunks)


def run() -> int:
  repo_root = Path(__file__).resolve().parents[1]
  backend_dir = repo_root / "backend"
  if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

  # Ensure transactional backend mode is active for smoke checks.
  os.environ.setdefault("CAREBASE_ONLY", "false")
  os.environ.setdefault("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")

  backend_module = importlib.import_module("main")
  backend_module = importlib.reload(backend_module)

  session_key = f"smoke-session-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
  headers = {"Authorization": "Bearer smoke-user"}

  scenarios = [
    Scenario(
      name="Lab Discovery Planning",
      message="Find a nearby blood test lab in Pittsburgh under $120 for next week.",
      expected_tool="lab_clinic_discovery",
    ),
    Scenario(
      name="Appointment Booking With Confirmation",
      message=(
        "Book Quest Diagnostics in Pittsburgh next Tuesday at 9am. "
        "Booking URL is https://book.health-example.com/appointments. "
        "My name is Jane Doe. Email jane@example.com. Phone +14125551212."
      ),
      expected_tool="appointment_book",
    ),
    Scenario(
      name="Medical Purchase With Confirmation",
      message=(
        "Please purchase 1 medical pulse oximeter using this checkout URL: "
        "https://shop.health-example.com/checkout. "
        "My name is Jane Doe. Email jane@example.com. Phone +14125551212."
      ),
      expected_tool="medical_purchase",
    ),
  ]

  results: list[dict[str, Any]] = []

  with TestClient(backend_module.app) as client:
    for scenario in scenarios:
      chat_response = client.post(
        "/chat/stream",
        headers=headers,
        json={
          "message": scenario.message,
          "session_key": session_key,
          "history": [],
          "client_context": {
            "timezone": "America/New_York",
            "location_text": "Pittsburgh",
          },
        },
      )

      scenario_result: dict[str, Any] = {
        "name": scenario.name,
        "expected_tool": scenario.expected_tool,
        "chat_status_code": chat_response.status_code,
      }

      if chat_response.status_code != 200:
        scenario_result["pass"] = False
        scenario_result["error"] = f"/chat/stream returned {chat_response.status_code}"
        results.append(scenario_result)
        continue

      events = parse_sse_events(chat_response.text)
      plan = first_event_payload(events, "action_plan")
      message_payload = first_event_payload(events, "message")
      message_text = ""
      if isinstance(message_payload, dict):
        maybe_text = message_payload.get("text")
        if isinstance(maybe_text, str):
          message_text = maybe_text
      if not message_text:
        message_text = token_text(events)

      scenario_result["chat_message_preview"] = message_text[:240]
      scenario_result["event_types"] = [event.get("event") for event in events]
      scenario_result["action_plan"] = plan

      if not isinstance(plan, dict):
        scenario_result["pass"] = False
        scenario_result["error"] = "No action_plan event emitted."
        results.append(scenario_result)
        continue

      actual_tool = plan.get("tool")
      scenario_result["actual_tool"] = actual_tool
      if actual_tool != scenario.expected_tool:
        scenario_result["pass"] = False
        scenario_result["error"] = f"Expected tool {scenario.expected_tool}, got {actual_tool!r}"
        results.append(scenario_result)
        continue

      execute_response = client.post(
        "/actions/execute",
        headers=headers,
        json={
          "plan": plan,
          "user_confirmed": True,
          "session_key": session_key,
          "message_text": scenario.message,
        },
      )
      scenario_result["execute_status_code"] = execute_response.status_code

      execute_body: dict[str, Any] = {}
      try:
        execute_body = execute_response.json()
      except Exception:
        execute_body = {"raw": execute_response.text[:500]}
      scenario_result["execute_body"] = execute_body

      top_status = execute_body.get("status") if isinstance(execute_body, dict) else None
      outcome = execute_body.get("result") if isinstance(execute_body, dict) else None
      action_status: str | None = None
      if isinstance(outcome, dict):
        direct = outcome.get("status")
        if isinstance(direct, str) and direct:
          action_status = direct
        elif isinstance(outcome.get("lifecycle"), list) and outcome["lifecycle"]:
          tail = outcome["lifecycle"][-1]
          if isinstance(tail, str):
            action_status = tail
      if action_status is None and isinstance(top_status, str):
        action_status = top_status
      scenario_result["action_status"] = action_status

      # Smoke success criterion: plan exists, expected tool is selected, execution endpoint accepts approval.
      scenario_result["pass"] = (
        execute_response.status_code == 200
        and top_status == "success"
        and isinstance(action_status, str)
        and action_status in {"succeeded", "pending", "partial", "failed", "success"}
      )
      if not scenario_result["pass"]:
        scenario_result["error"] = "Execution did not return an accepted action lifecycle status."

      results.append(scenario_result)

  passed = sum(1 for item in results if item.get("pass"))
  failed = len(results) - passed
  timestamp = datetime.now(timezone.utc).isoformat()

  report_lines = [
    "# Chatbot E2E Smoke Report",
    "",
    f"- Timestamp (UTC): `{timestamp}`",
    f"- CAREBASE_ONLY: `{os.getenv('CAREBASE_ONLY')}`",
    f"- CAREPILOT_DISABLE_EXTERNAL_WEB: `{os.getenv('CAREPILOT_DISABLE_EXTERNAL_WEB')}`",
    f"- Total scenarios: `{len(results)}`",
    f"- Passed: `{passed}`",
    f"- Failed: `{failed}`",
    "",
    "## Scenario Results",
    "",
  ]

  for item in results:
    status = "PASS" if item.get("pass") else "FAIL"
    report_lines.append(f"### {status} - {item['name']}")
    report_lines.append(f"- Expected tool: `{item.get('expected_tool')}`")
    report_lines.append(f"- Actual tool: `{item.get('actual_tool')}`")
    report_lines.append(f"- Chat status code: `{item.get('chat_status_code')}`")
    report_lines.append(f"- Execute status code: `{item.get('execute_status_code')}`")
    report_lines.append(f"- Action lifecycle status: `{item.get('action_status')}`")
    if item.get("error"):
      report_lines.append(f"- Error: `{item['error']}`")
    preview = item.get("chat_message_preview") or ""
    if preview:
      report_lines.append(f"- Chat preview: `{preview}`")
    report_lines.append("- Action plan payload:")
    report_lines.append("```json")
    report_lines.append(json.dumps(item.get("action_plan"), indent=2, ensure_ascii=True))
    report_lines.append("```")
    report_lines.append("- Execute response payload:")
    report_lines.append("```json")
    report_lines.append(json.dumps(item.get("execute_body"), indent=2, ensure_ascii=True))
    report_lines.append("```")
    report_lines.append("")

  report_path = repo_root / "CHATBOT_E2E_SMOKE_REPORT.md"
  report_path.write_text("\n".join(report_lines), encoding="utf-8")
  print(f"Wrote report: {report_path}")
  print(f"Passed {passed}/{len(results)} scenarios.")

  return 0 if failed == 0 else 1


if __name__ == "__main__":
  raise SystemExit(run())
