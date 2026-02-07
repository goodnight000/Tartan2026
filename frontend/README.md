# MedClaw Frontend

Hackathon-ready Next.js frontend for MedClaw.

## Setup

1. Install deps

```bash
npm install
```

2. Create `.env.local`

```
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openai/gpt-4o-mini
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_firebase_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id
BACKEND_URL=http://localhost:8000
# Optional override; defaults to /chat/stream.
BACKEND_CHAT_STREAM_PATH=/chat/stream
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

后端仅在你需要工具/数据服务时启动。

后端可选环境变量：
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=openai/gpt-4o-mini`
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_SITE_URL=https://your-site.example`
- `OPENROUTER_APP_NAME=MedClaw`
- `GOOGLE_PLACES_API_KEY=...`

前端内嵌聊天（Next.js API route）需要：
- `BACKEND_URL`
- `BACKEND_CHAT_STREAM_PATH`（可选）

前端使用 Firebase Auth + Firestore：
- `NEXT_PUBLIC_FIREBASE_*` 系列变量

## MCP Google Maps（可选）

使用 `mcp-google-map` 作为 MCP 服务器（HTTP transport）：

```bash
npm install -g @cablate/mcp-google-map
mcp-google-map --port 3000 --apikey "YOUR_GOOGLE_MAPS_API_KEY"
```

设置环境变量：
```
BACKEND_URL=http://localhost:8000
```

## Pages

- `/login` Email + password auth (Firebase UI)
- `/onboarding` Medical profile wizard
- `/app` Dashboard + chat panel
- `/profile` Profile + recent logs

## Notes

- Chat uses SSE from `/api/chat/stream`.
