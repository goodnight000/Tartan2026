import type { CareBaseRecord } from './types';
import { clearRecords, listRecords, putRecord } from './database';

const CAREBASE_SERVER_URL =
  process.env.NEXT_PUBLIC_CAREBASE_SERVER_URL || 'http://127.0.0.1:3100';

export async function syncRecordToCloud(record: CareBaseRecord): Promise<void> {
  try {
    await fetch(`${CAREBASE_SERVER_URL}/api/cloud/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    });
  } catch {
    // Best-effort cloud sync.
  }
}

export async function pushAllToCloud(): Promise<void> {
  const records = await listRecords();
  await Promise.all(records.map((record) => syncRecordToCloud(record)));
}

export async function pullCloudToLocal(): Promise<void> {
  const response = await fetch(`${CAREBASE_SERVER_URL}/api/cloud/records`);
  if (!response.ok) {
    throw new Error('Cloud sync fetch failed.');
  }
  const payload = (await response.json()) as { records: Array<any> };
  await clearRecords();
  for (const record of payload.records ?? []) {
    await putRecord({
      key: record.key,
      encryptedValue: new Uint8Array(record.encryptedValue),
      sensitivityLevel: record.sensitivityLevel,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      syncedAt: record.syncedAt ?? undefined,
    });
  }
}
