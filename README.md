# MedClaw Monorepo

## Active Directories

- `frontend/`: Next.js app (user-facing UI)
- `backend/`: FastAPI app (agent orchestration + tools + memory)

`app/` is legacy OpenClaw-era material and is not part of the active dev/runtime path.

## Quick Start

### 1) Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn main:app --reload --port 8000
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local` with:

```env
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-sonnet-4-5

# Firebase (if using Firebase auth)
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_firebase_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id

# Optional: Dedalus MCP
DEDALUS_API_KEY=your_dedalus_key
DEDALUS_MODEL=anthropic/claude-opus-4-5
DEDALUS_MCP_SERVERS=http://localhost:3000/mcp
```

## Env Loading (Backend)

Backend env bootstrap now reads:
1. repo-root `.env`
2. `backend/.env`
3. `frontend/.env.local`

Note: `scripts/dev-up.sh` will prefer `backend/.venv/bin/python` when that venv exists.
`app/.env` is no longer loaded by backend runtime.

Optional env:
```
ALLOW_ANON=true
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-sonnet-4-5
GOOGLE_PLACES_API_KEY=your_google_places_key
CAREBASE_ONLY=true
```

## Optional: MCP Google Maps

```bash
npm install -g @cablate/mcp-google-map
mcp-google-map --port 3000 --apikey "YOUR_GOOGLE_MAPS_API_KEY"
```
