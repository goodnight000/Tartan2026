#!/usr/bin/env bash
set -euo pipefail

BACKEND_PID_FILE="/tmp/carepilot-backend.pid"
FRONTEND_PID_FILE="/tmp/carepilot-frontend.pid"

stop_pid() {
  local pid_file="$1"
  local name="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      echo "Stopped $name (pid $pid)."
    else
      echo "$name not running (stale pid file)."
    fi
    rm -f "$pid_file"
  else
    echo "$name pid file not found."
  fi
}

stop_pid "$BACKEND_PID_FILE" "backend"
stop_pid "$FRONTEND_PID_FILE" "frontend"
