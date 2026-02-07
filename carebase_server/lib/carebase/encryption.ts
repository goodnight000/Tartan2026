import { cmac } from '@noble/ciphers/aes.js';
import { CareBaseDecryptError } from './errors';

const MASTER_KEY_STORAGE = 'carebase-master-key';
let memoryMasterKey: string | null = null;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

const isNodeRuntime =
  typeof process !== 'undefined' && !!process.versions?.node;

export function getStoredMasterKey(): string | null {
  const storage = getLocalStorage();
  if (!storage) {
    return memoryMasterKey;
  }
  return storage.getItem(MASTER_KEY_STORAGE);
}

export function storeMasterKey(base64Key: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    memoryMasterKey = base64Key;
    return;
  }
  storage.setItem(MASTER_KEY_STORAGE, base64Key);
}

export function generateMasterKeyBase64(): string {
  const random = getRandomBytes(16);
  return toBase64(random);
}

export function getOrCreateMasterKey(): string {
  const existing = getStoredMasterKey();
  if (existing) {
    return existing;
  }
  const created = generateMasterKeyBase64();
  storeMasterKey(created);
  return created;
}

export function decodeMasterKey(base64Key: string): Uint8Array {
  return fromBase64(base64Key);
}

export function encodeMasterKey(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function generateEncryptionKey(masterKey: Uint8Array, dataKey: string): Uint8Array {
  return deriveEncryptionKey(masterKey, dataKey);
}

export function deriveEncryptionKey(masterKey: Uint8Array, dataKey: string): Uint8Array {
  const message = utf8ToBytes(dataKey);
  return cmac(masterKey, message);
}

export async function encryptValue(
  encryptionKey: Uint8Array,
  plaintext: string
): Promise<Uint8Array> {
  const plaintextBytes = utf8ToBytes(plaintext);

  if (isNodeRuntime) {
    const { createCipheriv, randomBytes } = await import('crypto');
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-128-gcm', encryptionKey, nonce, {
      authTagLength: TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintextBytes),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return concatBytes(new Uint8Array(nonce), new Uint8Array(ciphertext), new Uint8Array(tag));
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available in this environment.');
  }

  const nonce = getRandomBytes(NONCE_LENGTH);
  const key = await crypto.subtle.importKey(
    'raw',
    encryptionKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: TAG_LENGTH * 8 },
    key,
    plaintextBytes
  );
  return concatBytes(nonce, new Uint8Array(ciphertextWithTag));
}

export async function decryptValue(
  encryptionKey: Uint8Array,
  ciphertext: Uint8Array
): Promise<string> {
  if (ciphertext.length <= NONCE_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext is too short.');
  }
  const nonce = ciphertext.slice(0, NONCE_LENGTH);
  const payload = ciphertext.slice(NONCE_LENGTH);

  if (isNodeRuntime) {
    const { createDecipheriv } = await import('crypto');
    const tag = payload.slice(payload.length - TAG_LENGTH);
    const body = payload.slice(0, payload.length - TAG_LENGTH);
    const decipher = createDecipheriv('aes-128-gcm', encryptionKey, nonce, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tag));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(body)),
      decipher.final(),
    ]);
    return bytesToUtf8(new Uint8Array(plaintext));
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available in this environment.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encryptionKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: TAG_LENGTH * 8 },
      key,
      payload
    );
    return bytesToUtf8(new Uint8Array(plaintext));
  } catch (error) {
    throw new CareBaseDecryptError();
  }
}

export async function decryptWithKey(
  encryptedData: Uint8Array,
  encryptionKey: Uint8Array
): Promise<string> {
  return decryptValue(encryptionKey, encryptedData);
}

function getRandomBytes(length: number): Uint8Array {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  if (isNodeRuntime) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require('crypto') as typeof import('crypto');
    return new Uint8Array(randomBytes(length));
  }
  throw new Error('Secure random generator is not available.');
}

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getLocalStorage(): Storage | null {
  const storage = globalThis?.localStorage;
  if (!storage) {
    return null;
  }
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return storage;
}
