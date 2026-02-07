#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CAREBASE_DIR="$ROOT_DIR/carebase_server"

BACKEND_PID_FILE="/tmp/carepilot-backend.pid"
FRONTEND_PID_FILE="/tmp/carepilot-frontend.pid"
CAREBASE_PID_FILE="/tmp/carebase-server.pid"
BACKEND_LOG="/tmp/carepilot-backend.log"
FRONTEND_LOG="/tmp/carepilot-frontend.log"
CAREBASE_LOG="/tmp/carebase-server.log"

if [[ -f "$BACKEND_PID_FILE" ]] && kill -0 "$(cat "$BACKEND_PID_FILE")" 2>/dev/null; then
  echo "Backend already running (pid $(cat "$BACKEND_PID_FILE"))."
else
  rm -f "$BACKEND_PID_FILE"
  (
    cd "$BACKEND_DIR"
    PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
    if [[ ! -x "$PYTHON_BIN" ]]; then
      PYTHON_BIN="python3"
    fi
    nohup env ALLOW_ANON="${ALLOW_ANON:-true}" \
      "$PYTHON_BIN" -m uvicorn main:app --host 127.0.0.1 --port 8000 \
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
    echo "Firebase frontend config not detected. Starting in local IndexedDB mode."
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

if [[ -d "$CAREBASE_DIR" ]]; then
  if [[ -f "$CAREBASE_PID_FILE" ]] && kill -0 "$(cat "$CAREBASE_PID_FILE")" 2>/dev/null; then
    echo "CareBase server already running (pid $(cat "$CAREBASE_PID_FILE"))."
  else
    rm -f "$CAREBASE_PID_FILE"
    (
      cd "$CAREBASE_DIR"
      nohup env \
        WATCHPACK_POLLING=true \
        CHOKIDAR_USEPOLLING=true \
        npm run dev -- --hostname 127.0.0.1 --port 3100 \
        >"$CAREBASE_LOG" 2>&1 &
      echo $! >"$CAREBASE_PID_FILE"
    )
    echo "Started CareBase server: pid $(cat "$CAREBASE_PID_FILE")"
  fi
else
  echo "CareBase server directory not found at $CAREBASE_DIR (skipping)."
fi

echo "Backend log:  $BACKEND_LOG"
echo "Frontend log: $FRONTEND_LOG"
echo "CareBase log: $CAREBASE_LOG"
echo "Frontend URL: http://127.0.0.1:3000"
echo "CareBase URL: http://127.0.0.1:3100"
echo "Backend URL:  http://127.0.0.1:8000/docs"
