"use client";

import { useCallback, useRef, useState } from "react";
import DataflowGuard, {
  type DataflowRequest,
} from "../components/DataflowGuard/DataflowGuard";
import {
  decryptValue,
  deriveEncryptionKey,
  encryptValue,
  getOrCreateMasterKey,
  decodeMasterKey,
} from "../lib/carebase/encryption";
import {
  deleteRecord,
  getRecord,
  listRecords,
  putRecord,
} from "../lib/carebase/database";
import { parseCareBaseCommands } from "../lib/carebase/parser";
import type { CareBaseRecord } from "../lib/carebase/types";
import styles from "./page.module.css";

const SAMPLE_RESPONSE = `The user just shared updates.
<carebase-store: user height>170 cm</carebase-store>
<carebase-store: allergies>Peanuts</carebase-store>
If you need the height later, fetch it.
<carebase-fetch>user height</carebase-fetch>`;

type LogEntry = {
  title: string;
  detail: string;
};

type GuardDecision = "allow" | "deny" | "always";

export default function CareBaseDemo() {
  const [input, setInput] = useState(SAMPLE_RESPONSE);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [guardRequest, setGuardRequest] = useState<DataflowRequest | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const decisionRef = useRef<((decision: GuardDecision) => void) | null>(null);

  const requestDecision = useCallback((request: DataflowRequest) => {
    return new Promise<GuardDecision>((resolve) => {
      decisionRef.current = resolve;
      setGuardRequest(request);
      setGuardOpen(true);
    });
  }, []);

  const closeGuard = useCallback(() => {
    setGuardOpen(false);
    setGuardRequest(null);
  }, []);

  const resolveGuard = useCallback((decision: GuardDecision) => {
    decisionRef.current?.(decision);
    decisionRef.current = null;
    closeGuard();
  }, [closeGuard]);

  const appendLog = useCallback((title: string, detail: string) => {
    setLog((prev) => [...prev, { title, detail }]);
  }, []);

  const processCommands = useCallback(async () => {
    setLog([]);
    const parsed = parseCareBaseCommands(input);
    if (parsed.strippedText) {
      appendLog("Non-command text", parsed.strippedText);
    }

    const masterKey = decodeMasterKey(getOrCreateMasterKey());

    for (const command of parsed.commands) {
      if (command.type === "store" && command.key && command.value) {
        const encryptionKey = deriveEncryptionKey(masterKey, command.key);
        const encryptedValue = await encryptValue(encryptionKey, command.value);
        const existing = await getRecord(command.key);
        const now = Date.now();
        const record: CareBaseRecord = {
          key: command.key,
          encryptedValue,
          sensitivityLevel: existing?.sensitivityLevel ?? "Ask",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          syncedAt: existing?.syncedAt,
        };
        await putRecord(record);
        appendLog("Stored", `${command.key} (Sensitivity: ${record.sensitivityLevel})`);
        continue;
      }

      if (command.type === "fetch" && command.key) {
        const record = await getRecord(command.key);
        if (!record) {
          appendLog("Fetch", `Error: non-existence key (${command.key})`);
          continue;
        }

        if (record.sensitivityLevel === "Ask") {
          const decision = await requestDecision({
            key: record.key,
            context: input,
          });
          if (decision === "deny") {
            appendLog("Fetch", `Error: permission denied (${record.key})`);
            continue;
          }
          if (decision === "always") {
            const updated: CareBaseRecord = {
              ...record,
              sensitivityLevel: "Allow",
              updatedAt: Date.now(),
            };
            await putRecord(updated);
          }
        }

        const encryptionKey = deriveEncryptionKey(masterKey, record.key);
        try {
          const plaintext = await decryptValue(encryptionKey, record.encryptedValue);
          appendLog("Fetch", `${record.key}: ${plaintext}`);
        } catch (error) {
          appendLog("Fetch", `Error: failed to decrypt (${record.key})`);
        }
        continue;
      }

      if (command.type === "delete" && command.key) {
        const record = await getRecord(command.key);
        if (!record) {
          appendLog("Delete", `Error: non-existence key (${command.key})`);
          continue;
        }
        await deleteRecord(command.key);
        appendLog("Delete", `Success: deleted ${command.key}`);
        continue;
      }

      if (command.type === "list") {
        const records = await listRecords();
        const keys = records.map((record) => record.key).join(", ");
        appendLog("List", keys.length ? keys : "No records found");
        continue;
      }

      if (command.type === "query" && command.key) {
        const records = await listRecords();
        const matches = records.filter((record) =>
          record.key.toLowerCase().includes(command.key!.toLowerCase())
        );
        const summary = matches
          .map((record) => `${record.key}: ${record.sensitivityLevel}`)
          .join(", ");
        appendLog("Query", summary || "No matches found");
      }
    }
  }, [appendLog, input, requestDecision]);

  return (
    <div className={styles.demo}>
      <div className={styles.panel}>
        <h2>Agent Response Input</h2>
        <p>
          Paste an agent response containing CareBase XML tags and see how the
          guard works.
        </p>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={10}
        />
        <button className={styles.primaryButton} onClick={processCommands}>
          Process Commands
        </button>
      </div>
      <div className={styles.panel}>
        <h2>Execution Log</h2>
        <div className={styles.log}>
          {log.length === 0 ? (
            <p className={styles.muted}>No commands processed yet.</p>
          ) : (
            log.map((entry, index) => (
              <div key={`${entry.title}-${index}`} className={styles.logEntry}>
                <strong>{entry.title}</strong>
                <span>{entry.detail}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <DataflowGuard
        open={guardOpen}
        request={guardRequest}
        onAllow={() => resolveGuard("allow")}
        onDeny={() => resolveGuard("deny")}
        onAlwaysAllow={() => resolveGuard("always")}
      />
    </div>
  );
}
