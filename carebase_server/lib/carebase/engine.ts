import {
  deleteRecord,
  getRecord,
  listRecords,
  putRecord,
} from './database';
import {
  decodeMasterKey,
  decryptValue,
  deriveEncryptionKey,
  encryptValue,
  getOrCreateMasterKey,
} from './encryption';
import { parseCareBaseCommands } from './parser';
import type { CareBaseCommand, CareBaseRecord } from './types';
import { CareBaseDecryptError } from './errors';

export type AccessDecision = 'allow' | 'deny' | 'always';

export interface CareBaseEngineOptions {
  requestAccess?: (params: { key: string; context: string }) => Promise<AccessDecision>;
  context: string;
}

export interface CareBaseEngineResult {
  commands: CareBaseCommand[];
  strippedText: string;
  responses: string[];
}

function formatResponse(key: string, body: string): string {
  return `<carebase-resp: ${key}>${body}</carebase-resp>`;
}

export async function processCareBaseText(
  text: string,
  options: CareBaseEngineOptions
): Promise<CareBaseEngineResult> {
  const parsed = parseCareBaseCommands(text);
  const responses: string[] = [];
  const masterKey = decodeMasterKey(getOrCreateMasterKey());

  for (const command of parsed.commands) {
    if (command.type === 'store' && command.key && command.value) {
      const encryptionKey = deriveEncryptionKey(masterKey, command.key);
      const encryptedValue = await encryptValue(encryptionKey, command.value);
      const existing = await getRecord(command.key);
      const now = Date.now();
      const record: CareBaseRecord = {
        key: command.key,
        encryptedValue,
        sensitivityLevel: existing?.sensitivityLevel ?? 'Ask',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncedAt: existing?.syncedAt,
      };
      await putRecord(record);
      responses.push(formatResponse(command.key, 'Success: stored'));
      continue;
    }

    if (command.type === 'fetch' && command.key) {
      const record = await getRecord(command.key);
      if (!record) {
        responses.push(formatResponse(command.key, 'Error: non-existence key'));
        continue;
      }

      if (record.sensitivityLevel === 'Ask' && options.requestAccess) {
        const decision = await options.requestAccess({
          key: record.key,
          context: options.context,
        });
        if (decision === 'deny') {
          responses.push(formatResponse(record.key, 'Error: permission denied by user'));
          continue;
        }
        if (decision === 'always') {
          const updated: CareBaseRecord = {
            ...record,
            sensitivityLevel: 'Allow',
            updatedAt: Date.now(),
          };
          await putRecord(updated);
        }
      }

      const encryptionKey = deriveEncryptionKey(masterKey, record.key);
      try {
        const plaintext = await decryptValue(encryptionKey, record.encryptedValue);
        responses.push(formatResponse(record.key, plaintext));
      } catch (error) {
        throw new CareBaseDecryptError();
      }
      continue;
    }

    if (command.type === 'delete' && command.key) {
      const record = await getRecord(command.key);
      if (!record) {
        responses.push(formatResponse(command.key, 'Error: non-existence key'));
        continue;
      }
      await deleteRecord(command.key);
      responses.push(formatResponse(command.key, 'Success: deleted'));
      continue;
    }

    if (command.type === 'list') {
      const records = await listRecords();
      const keys = records.map((item) => item.key).join(', ');
      responses.push(formatResponse('list', keys.length ? keys : ''));
      continue;
    }

    if (command.type === 'query' && command.key) {
      const records = await listRecords();
      const matches = records.filter((record) =>
        record.key.toLowerCase().includes(command.key!.toLowerCase())
      );
      const summary = matches
        .map((record) => `${record.key}: ${record.sensitivityLevel}`)
        .join(', ');
      responses.push(formatResponse('query', summary));
    }
  }

  return {
    commands: parsed.commands,
    strippedText: parsed.strippedText,
    responses,
  };
}
