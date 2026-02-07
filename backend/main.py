from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import httpx

app = FastAPI(title="MedClaw Stub Backend")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"]
    ,
    allow_headers=["*"]
)

# In-memory store for demo
STATE: Dict[str, Dict[str, Any]] = {}


class ClientContext(BaseModel):
    timezone: str
    location_text: str | None = None


class ChatRequest(BaseModel):
    message: str
    client_context: ClientContext


class ActionPlan(BaseModel):
    tier: int
    tool: str
    params: Dict[str, Any] = Field(default_factory=dict)
    consent_prompt: str | None = None


class ActionExecuteRequest(BaseModel):
    plan: ActionPlan
    user_confirmed: bool


class ProfilePayload(BaseModel):
    user_id: str | None = None
    conditions: List[str] = Field(default_factory=list)
    allergies: List[str] = Field(default_factory=list)
    meds: List[Dict[str, Any]] = Field(default_factory=list)
    family_history: str | None = None
    preferences: Dict[str, Any] = Field(default_factory=dict)


class SymptomPayload(BaseModel):
    symptom_text: str
    severity: int
    onset_time: str | None = None
    notes: str | None = None


def get_user_id(auth_header: str | None) -> str:
    if not auth_header:
        if os.getenv("ALLOW_ANON", "false").lower() == "true":
            return "demo-user"
        raise HTTPException(status_code=401, detail="Missing Authorization")
    return auth_header.replace("Bearer", "").strip() or "demo-user"


def get_store(user_id: str) -> Dict[str, Any]:
    if user_id not in STATE:
        STATE[user_id] = {
            "profile": None,
            "symptoms": [],
            "actions": []
        }
    return STATE[user_id]


@app.get("/profile")
def get_profile(authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    profile = store["profile"]
    if not profile:
        return {}
    return profile


@app.post("/profile")
def upsert_profile(payload: ProfilePayload, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    profile = payload.model_dump()
    profile["user_id"] = user_id
    profile["updated_at"] = datetime.utcnow().isoformat()
    store["profile"] = profile
    return {"ok": True}


@app.get("/reminders")
def get_reminders(authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    profile = store["profile"] or {}
    meds = profile.get("meds", [])
    reminders = []
    today = datetime.utcnow().date()
    for med in meds:
        last_fill = med.get("last_fill_date")
        days = med.get("refill_days")
        if last_fill and days:
            try:
                due_date = datetime.fromisoformat(last_fill).date() + timedelta(days=int(days))
                days_left = (due_date - today).days
                if days_left <= 7:
                    reminders.append(
                        {
                            "med_name": med.get("name", "med"),
                            "days_left": days_left,
                            "recommended_action": "Refill soon"
                        }
                    )
            except Exception:
                continue
    return {"refill_reminders": reminders}


@app.post("/symptoms")
def post_symptoms(payload: SymptomPayload, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    store["symptoms"].append(
        {
            "created_at": datetime.utcnow().isoformat(),
            "symptom_text": payload.symptom_text,
            "severity": payload.severity,
            "notes": payload.notes
        }
    )
    return {"ok": True}


@app.get("/logs/symptoms")
def logs_symptoms(limit: int = 20, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    return {"items": list(reversed(store["symptoms"]))[:limit]}


@app.get("/logs/actions")
def logs_actions(limit: int = 20, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    return {"items": list(reversed(store["actions"]))[:limit]}


@app.post("/actions/execute")
def actions_execute(payload: ActionExecuteRequest, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    store = get_store(user_id)
    if not payload.user_confirmed:
        raise HTTPException(status_code=400, detail="User not confirmed")

    if payload.plan.tool == "booking_mock":
        result = {
            "confirmation_id": f"BK-{uuid.uuid4().hex[:8]}",
            "summary": "Booking confirmed"
        }
    elif payload.plan.tool in {"find_nearby_pharmacies", "find_nearby_labs", "find_specialists"}:
        api_key = os.getenv("GOOGLE_PLACES_API_KEY")
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing GOOGLE_PLACES_API_KEY")
        query = payload.plan.params.get("query") or payload.plan.tool.replace("_", " ")
        location = payload.plan.params.get("location")
        radius_miles = payload.plan.params.get("radius_miles", 5)
        radius_m = int(float(radius_miles) * 1609.34)

        params = {"query": query, "key": api_key}
        if location:
            params["location"] = location
            params["radius"] = radius_m

        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                "https://maps.googleapis.com/maps/api/place/textsearch/json",
                params=params,
            )
            response.raise_for_status()
            data = response.json()

        items = []
        for item in data.get("results", [])[:5]:
            items.append(
                {
                    "name": item.get("name"),
                    "address": item.get("formatted_address"),
                    "distance_m": None,
                    "hours": None,
                    "phone": None,
                }
            )

        result = {"items": items, "source": "google_places"}
    else:
        result = {
            "items": [
                {
                    "name": "CarePlus Pharmacy",
                    "address": "123 Main St",
                    "distance_m": 1200,
                    "hours": "9am-9pm"
                },
                {
                    "name": "CityLab Diagnostics",
                    "address": "456 Pine Ave",
                    "distance_m": 2100,
                    "hours": "8am-6pm"
                }
            ]
        }

    store["actions"].append(
        {
            "created_at": datetime.utcnow().isoformat(),
            "action_type": payload.plan.tool,
            "status": "success"
        }
    )

    return {"status": "success", "result": result}


@app.post("/chat/stream")
def chat_stream(payload: ChatRequest, authorization: str | None = Header(default=None)):
    _ = get_user_id(authorization)

    def event_stream():
        openrouter_key = os.getenv("OPENROUTER_API_KEY")
        openrouter_model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

        if not openrouter_key:
            assistant = (
                "Thanks for the update. I noted your symptoms. "
                "Would you like me to find nearby labs or pharmacies?"
            )
            for ch in assistant:
                yield f"event: token\ndata: {json.dumps({'delta': ch})}\n\n"
                time.sleep(0.01)
            plan = {
                "tier": 1,
                "tool": "find_nearby_pharmacies",
                "params": {"query": "pharmacy", "radius_miles": 5},
                "consent_prompt": "I can search nearby pharmacies. Proceed?",
            }
            yield f"event: action_plan\ndata: {json.dumps(plan)}\n\n"
            return

        base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        site_url = os.getenv("OPENROUTER_SITE_URL")
        app_name = os.getenv("OPENROUTER_APP_NAME", "MedClaw")
        headers: Dict[str, str] = {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
        }
        if site_url:
            headers["HTTP-Referer"] = site_url
        if app_name:
            headers["X-Title"] = app_name

        payload_body = {
            "model": openrouter_model,
            "stream": True,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are MedClaw, a careful medical assistant. "
                        "Be concise, ask clarifying questions, and avoid diagnosing."
                    ),
                },
                {"role": "user", "content": payload.message},
            ],
        }

        with httpx.Client(timeout=60.0) as client:
            with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload_body,
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            delta = (
                                chunk.get("choices", [{}])[0]
                                .get("delta", {})
                                .get("content")
                            )
                            if delta:
                                yield f"event: token\ndata: {json.dumps({'delta': delta})}\n\n"
                        except json.JSONDecodeError:
                            continue

        message = payload.message.lower()
        if any(keyword in message for keyword in ["pharmacy", "drugstore"]):
            plan = {
                "tier": 1,
                "tool": "find_nearby_pharmacies",
                "params": {"query": "pharmacy", "radius_miles": 5},
                "consent_prompt": "I can search nearby pharmacies. Proceed?",
            }
            yield f"event: action_plan\ndata: {json.dumps(plan)}\n\n"
        elif any(keyword in message for keyword in ["lab", "test center", "diagnostic"]):
            plan = {
                "tier": 1,
                "tool": "find_nearby_labs",
                "params": {"query": "medical lab", "radius_miles": 5},
                "consent_prompt": "I can search nearby labs. Proceed?",
            }
            yield f"event: action_plan\ndata: {json.dumps(plan)}\n\n"
        elif any(keyword in message for keyword in ["specialist", "doctor", "clinic"]):
            plan = {
                "tier": 1,
                "tool": "find_specialists",
                "params": {"query": "medical clinic", "radius_miles": 5},
                "consent_prompt": "I can search nearby specialists. Proceed?",
            }
            yield f"event: action_plan\ndata: {json.dumps(plan)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
