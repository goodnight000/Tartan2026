import { clearRecords, listRecords, putRecord } from "../carebase/database";
import type { CareBaseRecord } from "../carebase/types";

interface CloudRecordPayload {
  key: string;
  encryptedValue: number[];
  sensitivityLevel: "Ask" | "Allow";
  createdAt: number;
  updatedAt: number;
  syncedAt?: number | null;
}

export async function pushLocalToCloud(): Promise<void> {
  const records = await listRecords();
  await Promise.all(
    records.map((record) =>
      fetch("/api/cloud/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record: {
            key: record.key,
            encryptedValue: Array.from(record.encryptedValue),
            sensitivityLevel: record.sensitivityLevel,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            syncedAt: Date.now(),
          },
        }),
      })
    )
  );

  await fetch("/api/cloud/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp: Date.now() }),
  });
}

export async function pullCloudToLocal(): Promise<void> {
  const response = await fetch("/api/cloud/records");
  if (!response.ok) {
    throw new Error("Cloud sync fetch failed.");
  }
  const payload = (await response.json()) as {
    records: CloudRecordPayload[];
  };

  await clearRecords();

  for (const record of payload.records) {
    const local: CareBaseRecord = {
      key: record.key,
      encryptedValue: new Uint8Array(record.encryptedValue),
      sensitivityLevel: record.sensitivityLevel,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      syncedAt: record.syncedAt ?? undefined,
    };
    await putRecord(local);
  }
}

export function startAutoSync(intervalMs = 60000): () => void {
  const interval = window.setInterval(() => {
    void pushLocalToCloud();
  }, intervalMs);

  return () => window.clearInterval(interval);
}
