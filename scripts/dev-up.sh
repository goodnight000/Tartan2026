#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PID_FILE="/tmp/carepilot-backend.pid"
FRONTEND_PID_FILE="/tmp/carepilot-frontend.pid"
BACKEND_LOG="/tmp/carepilot-backend.log"
FRONTEND_LOG="/tmp/carepilot-frontend.log"

if [[ -f "$BACKEND_PID_FILE" ]] && kill -0 "$(cat "$BACKEND_PID_FILE")" 2>/dev/null; then
  echo "Backend already running (pid $(cat "$BACKEND_PID_FILE"))."
else
  rm -f "$BACKEND_PID_FILE"
  (
    cd "$BACKEND_DIR"
    nohup env ALLOW_ANON="${ALLOW_ANON:-true}" \
      python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 \
      >"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  )
  echo "Started backend: pid $(cat "$BACKEND_PID_FILE")"
fi

if [[ -f "$FRONTEND_PID_FILE" ]] && kill -0 "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null; then
  echo "Frontend already running (pid $(cat "$FRONTEND_PID_FILE"))."
else
  rm -f "$FRONTEND_PID_FILE"
  if [[ ! -f "$FRONTEND_DIR/.env.local" ]] && [[ -z "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ]]; then
    echo "Missing Firebase frontend config."
    echo "Set NEXT_PUBLIC_FIREBASE_* env vars in your shell or create frontend/.env.local first."
    exit 1
  fi
  (
    cd "$FRONTEND_DIR"
    nohup env \
      BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}" \
      npm run dev -- --hostname 127.0.0.1 --port 3000 \
      >"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )
  echo "Started frontend: pid $(cat "$FRONTEND_PID_FILE")"
fi

echo "Backend log:  $BACKEND_LOG"
echo "Frontend log: $FRONTEND_LOG"
echo "Frontend URL: http://127.0.0.1:3000"
echo "Backend URL:  http://127.0.0.1:8000/docs"
