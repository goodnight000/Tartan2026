import { describe, expect, it } from 'vitest';
import { decodeRFC1751, encodeRFC1751 } from './index';

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

describe('RFC1751', () => {
  it('encodes a 128-bit key into words', () => {
    const key = hexToBytes('CCAC 2AED 5910 56BE 4F90 FD44 1C53 4766');
    const phrase = encodeRFC1751(key);
    expect(phrase).toBe('RASH BUSH MILK LOOK BAD BRIM AVID GAFF BAIT ROT POD LOVE');
  });

  it('decodes words into a 128-bit key', () => {
    const phrase = 'TROD MUTE TAIL WARM CHAR KONG HAAG CITY BORE O TEAL AWL';
    const key = decodeRFC1751(phrase);
    expect(bytesToHex(key)).toBe('eff81f9bfbc65350920cdd7416de8009');
  });
});
