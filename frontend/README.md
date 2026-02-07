# MedClaw Frontend

Hackathon-ready Next.js frontend for MedClaw.

## Setup

1. Install deps

```bash
npm install
```

2. Create `.env.local`

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

3. Run dev server

```bash
npm run dev
```

## Stub Backend (方案 B)

如果你没有后端，可以启动本地 stub：

```bash
cd ../backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

确保 `.env.local` 里 `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`。
如果没有 Supabase 登录，也可以在启动后端前设置：
`ALLOW_ANON=true`（允许匿名请求）。

后端可选环境变量：
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=openai/gpt-4o-mini`
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_SITE_URL=https://your-site.example`
- `OPENROUTER_APP_NAME=MedClaw`
- `GOOGLE_PLACES_API_KEY=...`

前端内嵌聊天（Next.js API route）需要：
- `DEDALUS_API_KEY`
- `DEDALUS_MODEL`（可选）
- `DEDALUS_MCP_SERVERS`（可选，逗号分隔）

## MCP Google Maps（可选）

使用 `mcp-google-map` 作为 MCP 服务器（HTTP transport）：

```bash
npm install -g @cablate/mcp-google-map
mcp-google-map --port 3000 --apikey "YOUR_GOOGLE_MAPS_API_KEY"
```

设置环境变量：
```
DEDALUS_MCP_SERVERS=http://localhost:3000/mcp
```

## Pages

- `/login` Email + password auth (Supabase)
- `/onboarding` Medical profile wizard
- `/app` Dashboard + chat panel
- `/profile` Profile + recent logs

## Notes

- All backend requests attach `Authorization: Bearer <access_token>`.
- Chat uses SSE from `POST /chat/stream`.
