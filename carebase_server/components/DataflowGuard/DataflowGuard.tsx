"use client";

import { useEffect, useState } from "react";
import styles from "./DataflowGuard.module.css";

export interface DataflowRequest {
  key: string;
  context?: string;
}

interface DataflowGuardProps {
  open: boolean;
  request: DataflowRequest | null;
  onAllow: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export default function DataflowGuard({
  open,
  request,
  onAllow,
  onDeny,
  onAlwaysAllow,
}: DataflowGuardProps) {
  const [showContext, setShowContext] = useState(false);

  useEffect(() => {
    if (open) {
      setShowContext(false);
    }
  }, [open, request]);

  if (!open || !request) {
    return null;
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.lock}>Data Access Request</span>
          <p>Agent requests access to:</p>
          <h3>{request.key}</h3>
        </div>
        <div className={styles.actions}>
          <button className={`${styles.button} ${styles.primary}`} onClick={onAllow}>
            Allow
          </button>
          <button className={`${styles.button} ${styles.secondary}`} onClick={onDeny}>
            Deny
          </button>
          <button className={`${styles.button} ${styles.secondary}`} onClick={onAlwaysAllow}>
            Always Allow
          </button>
          <button
            className={`${styles.button} ${styles.ghost}`}
            onClick={() => setShowContext((prev) => !prev)}
          >
            {showContext ? "Hide Context" : "View Context"}
          </button>
        </div>
        {showContext ? (
          <div className={styles.context}>
            <p>Agent Context</p>
            <pre>{request.context || "No context available."}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
