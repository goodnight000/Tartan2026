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
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openai/gpt-4o-mini
DEDALUS_API_KEY=your_dedalus_key
DEDALUS_MODEL=anthropic/claude-opus-4-5
DEDALUS_MCP_SERVERS=http://localhost:3000/mcp
```

## Backend (uv)

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

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
