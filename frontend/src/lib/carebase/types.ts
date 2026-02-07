export type SensitivityLevel = 'Ask' | 'Allow';

export interface CareBaseRecord {
  key: string;
  encryptedValue: Uint8Array;
  sensitivityLevel: SensitivityLevel;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
}

export type CareBaseCommandType =
  | 'fetch'
  | 'store'
  | 'delete'
  | 'list'
  | 'query';

export interface CareBaseCommand {
  type: CareBaseCommandType;
  key?: string;
  value?: string;
}

export interface CareBaseParseResult {
  commands: CareBaseCommand[];
  strippedText: string;
}
