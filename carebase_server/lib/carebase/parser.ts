import type { CareBaseCommand, CareBaseParseResult } from './types';

const COMMAND_PATTERN =
  /<carebase-(fetch|delete|query)>([\s\S]*?)<\/carebase-\1>|<carebase-store:\s*([^>]+?)\s*>([\s\S]*?)<\/carebase-store>|<carebase-list>\s*<\/carebase-list>/gi;

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseCareBaseCommands(text: string): CareBaseParseResult {
  const commands: CareBaseCommand[] = [];

  let strippedText = text;

  strippedText = strippedText.replace(
    COMMAND_PATTERN,
    (_match, simpleType, simpleContent, storeKey, storeValue) => {
      if (simpleType) {
        const normalizedKey = normalizeContent(simpleContent ?? '');
        if (normalizedKey.length > 0) {
          commands.push({ type: simpleType, key: normalizedKey });
        }
        return '';
      }

      if (storeKey) {
        const normalizedKey = normalizeContent(storeKey);
        const normalizedValue = (storeValue ?? '').trim();
        if (normalizedKey.length > 0) {
          commands.push({ type: 'store', key: normalizedKey, value: normalizedValue });
        }
        return '';
      }

      commands.push({ type: 'list' });
      return '';
    }
  );

  return {
    commands,
    strippedText: strippedText.replace(/\s{2,}/g, ' ').trim(),
  };
}
