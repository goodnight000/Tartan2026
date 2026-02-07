"use client";

import { useMemo, useState } from "react";
import {
  decodeMasterKey,
  decryptValue,
  encodeMasterKey,
  generateEncryptionKey,
  getOrCreateMasterKey,
} from "@/lib/carebase/encryption";
import { getRecord } from "@/lib/carebase/database";

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function SupportToolsPanel() {
  const [dataKey, setDataKey] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [ciphertextInput, setCiphertextInput] = useState("");
  const [encryptionKeyInput, setEncryptionKeyInput] = useState("");
  const [decryptedOutput, setDecryptedOutput] = useState("");
  const [ciphertextOutput, setCiphertextOutput] = useState("");
  const [status, setStatus] = useState("");

  const masterKey = useMemo(() => decodeMasterKey(getOrCreateMasterKey()), []);

  const handleGenerate = () => {
    if (!dataKey.trim()) {
      setStatus("Provide a data key to derive the encryption key.");
      return;
    }
    const encryptionKey = generateEncryptionKey(masterKey, dataKey.trim());
    const encoded = encodeMasterKey(encryptionKey);
    setGeneratedKey(encoded);
    setStatus("Derived encryption key for support share.");
  };

  const handleFetchCiphertext = async () => {
    if (!dataKey.trim()) {
      setStatus("Provide a data key to fetch ciphertext.");
      return;
    }
    const record = await getRecord(dataKey.trim());
    if (!record) {
      setCiphertextOutput("");
      setStatus("No record found for that key.");
      return;
    }
    const base64 = btoa(String.fromCharCode(...record.encryptedValue));
    setCiphertextOutput(base64);
    setStatus("Ciphertext fetched from CareBase.");
  };

  const handleDecrypt = async () => {
    try {
      if (!ciphertextInput.trim() || !encryptionKeyInput.trim()) {
        setStatus("Provide ciphertext and encryption key.");
        return;
      }
      const encryptionKey = base64ToBytes(encryptionKeyInput);
      const ciphertext = base64ToBytes(ciphertextInput);
      const plaintext = await decryptValue(encryptionKey, ciphertext);
      setDecryptedOutput(plaintext);
      setStatus("Decryption successful.");
    } catch (error) {
      setStatus("Decryption failed. Check the key and ciphertext.");
    }
  };

  return (
    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white p-4 space-y-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--cp-muted)]">Support Tools</p>
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 rounded-xl border border-[color:var(--cp-line)] px-3 py-2 text-sm"
            value={dataKey}
            onChange={(event) => setDataKey(event.target.value)}
            placeholder="Data key (e.g., allergies)"
          />
          <button
            className="rounded-full bg-[color:var(--cp-primary)] px-4 py-2 text-sm text-white"
            onClick={handleGenerate}
          >
            Derive Key
          </button>
          <button
            className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
            onClick={handleFetchCiphertext}
          >
            Fetch Ciphertext
          </button>
        </div>
        <div className="text-xs break-all text-[color:var(--cp-muted)]">
          {generatedKey || "(no key generated)"}
        </div>
        <div className="text-xs break-all text-[color:var(--cp-muted)]">
          {ciphertextOutput || "(no ciphertext)"}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--cp-muted)]">Standalone Decryption</p>
        <textarea
          className="w-full rounded-xl border border-[color:var(--cp-line)] px-3 py-2 text-xs"
          value={ciphertextInput}
          onChange={(event) => setCiphertextInput(event.target.value)}
          placeholder="Ciphertext (Base64)"
          rows={3}
        />
        <input
          className="w-full rounded-xl border border-[color:var(--cp-line)] px-3 py-2 text-xs"
          value={encryptionKeyInput}
          onChange={(event) => setEncryptionKeyInput(event.target.value)}
          placeholder="Encryption Key (Base64)"
        />
        <button
          className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
          onClick={handleDecrypt}
        >
          Decrypt
        </button>
        <div className="text-xs break-all text-[color:var(--cp-muted)]">
          {decryptedOutput || "(no output)"}
        </div>
      </div>

      <div className="text-xs text-[color:var(--cp-muted)]">{status}</div>
    </div>
  );
}
