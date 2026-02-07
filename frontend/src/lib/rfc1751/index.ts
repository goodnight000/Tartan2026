import { RFC1751_WORDLIST } from './wordlist';

const WORDLIST = RFC1751_WORDLIST as readonly string[];
const WORD_MAP = new Map<string, number>(
  WORDLIST.map((word, index) => [word, index])
);

function standardizeWord(word: string): string {
  return word
    .trim()
    .toUpperCase()
    .replace(/1/g, 'L')
    .replace(/0/g, 'O')
    .replace(/5/g, 'S');
}

function extractBits(source: Uint8Array, start: number, length: number): number {
  if (length > 11 || start < 0 || length < 0 || start + length > 66) {
    throw new Error('Invalid bit extraction parameters.');
  }
  const cl = source[Math.floor(start / 8)] ?? 0;
  const cc = source[Math.floor(start / 8) + 1] ?? 0;
  const cr = source[Math.floor(start / 8) + 2] ?? 0;
  let x = ((cl << 8) | cc) << 8 | cr;
  x = x >>> (24 - (length + (start % 8)));
  x = x & (0xffff >>> (16 - length));
  return x;
}

function insertBits(target: Uint8Array, value: number, start: number, length: number): void {
  if (length > 11 || start < 0 || length < 0 || start + length > 66) {
    throw new Error('Invalid bit insertion parameters.');
  }
  const shift = ((8 - ((start + length) % 8)) % 8);
  const y = value << shift;
  const cl = (y >> 16) & 0xff;
  const cc = (y >> 8) & 0xff;
  const cr = y & 0xff;

  if (shift + length > 16) {
    target[Math.floor(start / 8)] |= cl;
    target[Math.floor(start / 8) + 1] |= cc;
    target[Math.floor(start / 8) + 2] |= cr;
  } else if (shift + length > 8) {
    target[Math.floor(start / 8)] |= cc;
    target[Math.floor(start / 8) + 1] |= cr;
  } else {
    target[Math.floor(start / 8)] |= cr;
  }
}

function computeParity(buffer: Uint8Array): number {
  let parity = 0;
  for (let i = 0; i < 64; i += 2) {
    parity += extractBits(buffer, i, 2);
  }
  return parity & 3;
}

function encodeEightBytes(bytes: Uint8Array): string[] {
  if (bytes.length !== 8) {
    throw new Error('RFC1751 encoder expects 8 bytes.');
  }
  const cp = new Uint8Array(9);
  cp.set(bytes, 0);
  const parity = computeParity(cp);
  cp[8] = parity << 6;

  const wordIndexes = [0, 11, 22, 33, 44, 55].map((start) =>
    extractBits(cp, start, 11)
  );

  return wordIndexes.map((index) => WORDLIST[index]);
}

function decodeSixWords(words: string[]): Uint8Array {
  if (words.length !== 6) {
    throw new Error('RFC1751 decoder expects 6 words.');
  }
  const buffer = new Uint8Array(9);

  words.forEach((word, index) => {
    const standardized = standardizeWord(word);
    if (!standardized || standardized.length > 4) {
      throw new Error(`Invalid word length: ${word}`);
    }
    const value = WORD_MAP.get(standardized);
    if (value === undefined) {
      throw new Error(`Word not in RFC1751 list: ${word}`);
    }
    if (standardized.length < 4 && value > 570) {
      throw new Error(`Short word not permitted in this range: ${word}`);
    }
    if (standardized.length === 4 && value <= 570) {
      throw new Error(`Four-letter word not permitted in short-word range: ${word}`);
    }
    insertBits(buffer, value, index * 11, 11);
  });

  const parity = computeParity(buffer);
  const storedParity = extractBits(buffer, 64, 2);
  if (parity !== storedParity) {
    throw new Error('RFC1751 parity check failed.');
  }

  return buffer.slice(0, 8);
}

export function encodeRFC1751(bytes: Uint8Array): string {
  if (bytes.length !== 8 && bytes.length !== 16) {
    throw new Error('RFC1751 encoding requires 8 or 16 bytes.');
  }

  if (bytes.length === 8) {
    return encodeEightBytes(bytes).join(' ');
  }

  const first = encodeEightBytes(bytes.slice(0, 8));
  const second = encodeEightBytes(bytes.slice(8));
  return [...first, ...second].join(' ');
}

export function decodeRFC1751(phrase: string): Uint8Array {
  const words = phrase
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length !== 6 && words.length !== 12) {
    throw new Error('RFC1751 decoding expects 6 or 12 words.');
  }

  if (words.length === 6) {
    return decodeSixWords(words);
  }

  const first = decodeSixWords(words.slice(0, 6));
  const second = decodeSixWords(words.slice(6));
  return new Uint8Array([...first, ...second]);
}
