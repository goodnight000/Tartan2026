"use client";

import { useMemo, useState } from "react";
import styles from "./SupportToolsPanel.module.css";
import {
  decodeMasterKey,
  decryptWithKey,
  encodeMasterKey,
  generateEncryptionKey,
  getOrCreateMasterKey,
} from "../../lib/carebase/encryption";
import { getRecord } from "../../lib/carebase/database";

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function SupportToolsPanel() {
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

  const handleDecrypt = async () => {
    try {
      if (!ciphertextInput.trim() || !encryptionKeyInput.trim()) {
        setStatus("Provide ciphertext and encryption key.");
        return;
      }
      const encryptionKey = base64ToBytes(encryptionKeyInput);
      const ciphertext = base64ToBytes(ciphertextInput);
      const plaintext = await decryptWithKey(ciphertext, encryptionKey);
      setDecryptedOutput(plaintext);
      setStatus("Decryption successful.");
    } catch (error) {
      setStatus("Decryption failed. Check the key and ciphertext.");
    }
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
    setStatus("Ciphertext fetched from local database.");
  };

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.label}>Generate Encryption Key</div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={dataKey}
            onChange={(event) => setDataKey(event.target.value)}
            placeholder="Data key (e.g., allergies)"
          />
          <button className={styles.primary} onClick={handleGenerate}>
            Derive Key
          </button>
          <button className={styles.secondary} onClick={handleFetchCiphertext}>
            Fetch Ciphertext
          </button>
        </div>
        <div className={styles.output}>{generatedKey || "(no key generated)"}</div>
        <div className={styles.output}>{ciphertextOutput || "(no ciphertext)"}</div>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Standalone Decryption</div>
        <textarea
          className={styles.textarea}
          value={ciphertextInput}
          onChange={(event) => setCiphertextInput(event.target.value)}
          placeholder="Ciphertext (Base64)"
        />
        <input
          className={styles.input}
          value={encryptionKeyInput}
          onChange={(event) => setEncryptionKeyInput(event.target.value)}
          placeholder="Encryption Key (Base64)"
        />
        <div className={styles.buttonRow}>
          <button className={styles.secondary} onClick={handleDecrypt}>
            Decrypt
          </button>
        </div>
        <div className={styles.output}>{decryptedOutput || "(no output)"}</div>
      </div>

      <div className={styles.notice}>{status}</div>
    </div>
  );
}
