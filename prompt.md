You are a senior full-stack engineer. Generate production-quality (hackathon-ready) code for the project "MedClaw" with the following constraints:

GOAL
Build an MVP personal AI family doctor with:
1) Chat + persistent medical profile memory
2) Symptom logging with timestamps
3) Safety triage (emergency detection -> redirect)
4) Agentic actions: Tier1 search (labs/pharmacies) + Tier2 booking (MOCK) with explicit consent gate
5) Clean Next.js UI: onboarding form, chat UI, profile page, action-confirm modal

TECH STACK (must follow)
Frontend: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui + react-hook-form + zod
Backend: Python FastAPI + Pydantic v2
DB/Auth: Supabase Postgres (use supabase-js on frontend for auth; backend uses SUPABASE_SERVICE_ROLE_KEY for DB writes)
Streaming: Use SSE (Server-Sent Events) for assistant responses
No background jobs required; implement “proactive reminders” as a simple stored computation endpoint (e.g. GET /reminders) for demo.

DELIVERABLES
Output a complete repo structure with code blocks for each file. Include:
- frontend/ (Next.js app)
- backend/ (FastAPI app)
- supabase/ (SQL for table creation)
- README.md (setup + run commands)

DATA MODEL (Supabase)
Create SQL tables:
users handled by Supabase auth
medical_profiles:
  user_id (uuid, pk, references auth.users)
  conditions jsonb
  allergies jsonb
  meds jsonb
  family_history jsonb
  preferences jsonb
  updated_at timestamp
symptom_logs:
  id uuid pk
  user_id uuid
  symptom_text text
  structured_json jsonb
  severity int
  onset_time timestamp null
  created_at timestamp
action_logs:
  id uuid pk
  user_id uuid
  action_type text
  plan_json jsonb
  executed_json jsonb
  status text
  created_at timestamp

BACKEND API (FastAPI)
Implement these endpoints:
1) POST /chat/stream
   - headers: Authorization: Bearer <supabase_access_token>
   - body: { "message": string, "client_context": { "timezone": string, "location_text"?: string } }
   - behavior:
     a) run triage on message + known profile. If emergency: immediately stream a fixed emergency response and stop.
     b) load medical profile + recent symptom logs
     c) call LLM to produce STRICT JSON:
        {
          "assistant_message": string,
          "risk_level": "low"|"medium"|"high"|"emergency",
          "memory_updates": { "symptom_log"?: {...}, "profile_patch"?: {...} },
          "proposed_action"?: { "tier": 1|2, "tool": string, "params": object },
          "requires_consent": boolean,
          "consent_prompt"?: string
        }
     d) apply memory updates to DB (profile patch + symptom log)
     e) if proposed_action exists:
        - DO NOT execute tool when requires_consent=true
        - instead include in stream a machine-readable event:
          event: action_plan
          data: <json plan>
     f) stream assistant_message tokens via SSE
2) POST /actions/execute
   - headers: Authorization: Bearer <supabase_access_token>
   - body: { "plan": {tier, tool, params}, "user_confirmed": true }
   - behavior:
     a) verify confirmed
     b) execute tool:
        - Tier 1: places_search (labs/pharmacies/specialists)
        - Tier 2: booking_mock (returns confirmation_id)
     c) store action_logs
     d) return JSON result
3) GET /profile
4) POST /profile (upsert from onboarding)
5) GET /reminders
   - compute “refill reminder” using meds in profile: if fill_date+days_supply close to today -> return list

TOOLS
Implement tool registry with strict input/output schemas.
- places_search: mock by default (static JSON) BUT include a real integration option via Google Places API if GOOGLE_PLACES_API_KEY is set. If not set, fallback to mock data.
- booking_mock: returns a confirmation id and a summary.

SAFETY TRIAGE (hard-coded, not only LLM)
Implement triage.py:
- If message contains high-risk symptom patterns (e.g., chest pain, severe trouble breathing, fainting, stroke signs, severe allergic reaction, suicidal ideation/self-harm) -> emergency
- When emergency: return message telling user to call emergency services/ER and do not proceed with tools.

FRONTEND PAGES (Next.js)
1) /onboarding
  - react-hook-form + zod collects:
    conditions (array text)
    allergies (array text)
    meds (name, dose, frequency_per_day, start_date, refill_days, last_fill_date)
    family_history (text)
    preferences (radius_miles, open_now, etc.)
  - POST to backend /profile
2) /chat
  - chat UI with streaming SSE from /chat/stream
  - render assistant messages
  - if receives action_plan event: show ActionConfirmModal with plan details, and button “Confirm & Execute”
  - on confirm: call backend /actions/execute and render results in chat
3) /profile
  - display current structured profile + recent symptoms + recent actions

AUTH
Use Supabase Auth (email magic link is fine).
Frontend obtains access token and attaches to backend calls.

ENV VARS
frontend:
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
backend:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  OPENAI_API_KEY (or generic LLM key)
  GOOGLE_PLACES_API_KEY (optional)
  ALLOWED_ORIGINS

CODE STYLE
- TypeScript: strict, good types, no any
- Python: type hints everywhere
- Clear separation: orchestrator, triage, tools, db
- Include minimal tests or at least “smoke test scripts”

OUTPUT FORMAT
1) Start with a repo tree
2) Then provide each file with a code block labeled by path, e.g.
   ```ts
   // frontend/app/chat/page.tsx
   ...
