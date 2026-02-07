import { describe, expect, it } from 'vitest';
import { deleteRecord, getRecord, listRecords, putRecord } from './database';
import type { CareBaseRecord } from './types';

describe('database', () => {
  it('writes, reads, lists, and deletes records', async () => {
    const record: CareBaseRecord = {
      key: 'test-key',
      encryptedValue: new Uint8Array([1, 2, 3]),
      sensitivityLevel: 'Ask',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await putRecord(record);
    const fetched = await getRecord('test-key');
    expect(fetched?.key).toBe('test-key');
    expect(fetched?.encryptedValue).toEqual(record.encryptedValue);

    const all = await listRecords();
    expect(all.map((item) => item.key)).toContain('test-key');

    await deleteRecord('test-key');
    const afterDelete = await getRecord('test-key');
    expect(afterDelete).toBeUndefined();
  });
});
