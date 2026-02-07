import { describe, expect, it } from 'vitest';
import { parseCareBaseCommands } from './parser';

describe('parseCareBaseCommands', () => {
  it('extracts commands and strips text', () => {
    const input = `Hello.\n<carebase-fetch>user height</carebase-fetch>\nThanks!`;
    const result = parseCareBaseCommands(input);

    expect(result.commands).toEqual([
      { type: 'fetch', key: 'user height' },
    ]);
    expect(result.strippedText).toBe('Hello. Thanks!');
  });

  it('handles store, delete, list, query', () => {
    const input = `
      <carebase-store: allergies>Peanuts, shellfish</carebase-store>
      <carebase-delete>old key</carebase-delete>
      <carebase-list></carebase-list>
      <carebase-query>blood pressure</carebase-query>
    `;
    const result = parseCareBaseCommands(input);

    expect(result.commands).toEqual([
      { type: 'store', key: 'allergies', value: 'Peanuts, shellfish' },
      { type: 'delete', key: 'old key' },
      { type: 'list' },
      { type: 'query', key: 'blood pressure' },
    ]);
  });
});
