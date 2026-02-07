import { getRecord, putRecord } from './database';
import {
  decodeMasterKey,
  decryptValue,
  deriveEncryptionKey,
  encryptValue,
  getOrCreateMasterKey,
} from './encryption';
import type { CareBaseRecord, SensitivityLevel } from './types';
import { CareBaseDecryptError } from './errors';
import { syncRecordToCloud } from './cloud';

async function encryptForKey(key: string, value: string): Promise<Uint8Array> {
  const masterKey = decodeMasterKey(getOrCreateMasterKey());
  const encryptionKey = deriveEncryptionKey(masterKey, key);
  return encryptValue(encryptionKey, value);
}

async function decryptForKey(key: string, ciphertext: Uint8Array): Promise<string> {
  const masterKey = decodeMasterKey(getOrCreateMasterKey());
  const encryptionKey = deriveEncryptionKey(masterKey, key);
  return decryptValue(encryptionKey, ciphertext);
}

export async function setJsonRecord<T>(
  key: string,
  value: T,
  sensitivityLevel: SensitivityLevel = 'Ask'
): Promise<CareBaseRecord> {
  const payload = JSON.stringify(value);
  const encryptedValue = await encryptForKey(key, payload);
  const existing = await getRecord(key);
  const now = Date.now();
  const record: CareBaseRecord = {
    key,
    encryptedValue,
    sensitivityLevel: existing?.sensitivityLevel ?? sensitivityLevel,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    syncedAt: existing?.syncedAt,
  };
  await putRecord(record);
  void syncRecordToCloud(record);
  return record;
}

export async function getJsonRecord<T>(key: string): Promise<T | null> {
  const record = await getRecord(key);
  if (!record) {
    return null;
  }
  try {
    const plaintext = await decryptForKey(key, record.encryptedValue);
    return JSON.parse(plaintext) as T;
  } catch (error) {
    throw new CareBaseDecryptError();
  }
}

export async function getTextRecord(key: string): Promise<string | null> {
  const record = await getRecord(key);
  if (!record) {
    return null;
  }
  try {
    return await decryptForKey(key, record.encryptedValue);
  } catch (error) {
    throw new CareBaseDecryptError();
  }
}
