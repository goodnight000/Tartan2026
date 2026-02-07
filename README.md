# MedClaw Monorepo

## Active Directories

- `frontend/`
- `backend/`
- `carebase_server/`: CareBase memory service

## Tech Stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS, Framer Motion, TanStack Query, React Hook Form + Zod, Lucide Icons
- Backend: FastAPI, Uvicorn, Pydantic, httpx, Python 3.10+
- Auth: Firebase Auth (optional)
- Data/Storage: SQLite (local), CareBase (Next.js + better-sqlite3)
- Tooling: npm, uv, Docker (optional)

## Quick Start

### Scripts (recommended)

```bash
./scripts/dev-up.sh
```

Frontend: http://localhost:3000  
Backend: http://localhost:8000/docs  
CareBase: http://localhost:3100

To stop:

```bash
./scripts/dev-down.sh
```

### Local dev (manual)

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

### Docker (optional)

```bash
docker compose up --build
```

To stop:

```bash
docker compose down
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

## Optional Env

```
ALLOW_ANON=true
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-sonnet-4-5
GOOGLE_PLACES_API_KEY=your_google_places_key
CAREBASE_ONLY=true
```

## Legal

- End User License Agreement: `EULA.txt`
