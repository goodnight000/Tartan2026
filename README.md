# MedClaw Monorepo

## Structure

- `frontend/` Next.js app
- `backend/` FastAPI stub (uv + pyproject)

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Env in `frontend/.env.local`:
```
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openai/gpt-4o-mini
DEDALUS_API_KEY=your_dedalus_key
DEDALUS_MODEL=anthropic/claude-opus-4-5
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_firebase_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id
DEDALUS_MCP_SERVERS=http://localhost:3000/mcp
```

## Backend (uv)

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

Note: `scripts/dev-up.sh` will prefer `backend/.venv/bin/python` when that venv exists.

Optional env:
```
ALLOW_ANON=true
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=https://your-site.example
OPENROUTER_APP_NAME=MedClaw
GOOGLE_PLACES_API_KEY=your_google_places_key
```

## MCP Google Maps (optional)

```bash
npm install -g @cablate/mcp-google-map
mcp-google-map --port 3000 --apikey "YOUR_GOOGLE_MAPS_API_KEY"
```

Set:
```
DEDALUS_MCP_SERVERS=http://localhost:3000/mcp
```
