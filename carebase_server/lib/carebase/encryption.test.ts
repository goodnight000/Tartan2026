import { describe, expect, it } from 'vitest';
import {
  decryptValue,
  deriveEncryptionKey,
  encryptValue,
} from './encryption';

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('encryption', () => {
  it('derives AES-CMAC keys using RFC4493 vectors', () => {
    const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c');
    const message = hexToBytes('');
    const expected = 'bb1d6929e95937287fa37d129b756746';

    const result = deriveEncryptionKey(key, new TextDecoder().decode(message));
    expect(bytesToHex(result)).toBe(expected);
  });

  it('encrypts and decrypts with AES-GCM', async () => {
    const masterKey = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c');
    const encryptionKey = deriveEncryptionKey(masterKey, 'carebase:test');
    const plaintext = 'Sensitive data payload';

    const ciphertext = await encryptValue(encryptionKey, plaintext);
    const decrypted = await decryptValue(encryptionKey, ciphertext);

    expect(decrypted).toBe(plaintext);
  });
});
