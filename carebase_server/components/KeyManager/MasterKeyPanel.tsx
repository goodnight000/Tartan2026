"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import styles from "./MasterKeyPanel.module.css";
import {
  decodeMasterKey,
  encodeMasterKey,
  generateMasterKeyBase64,
  getOrCreateMasterKey,
  storeMasterKey,
} from "../../lib/carebase/encryption";
import { decodeRFC1751, encodeRFC1751 } from "../../lib/rfc1751";

export default function MasterKeyPanel() {
  const [base64Key, setBase64Key] = useState<string>("");
  const [phraseInput, setPhraseInput] = useState("");
  const [base64Input, setBase64Input] = useState("");
  const [status, setStatus] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    setBase64Key(getOrCreateMasterKey());
  }, []);

  const rfcPhrase = useMemo(() => {
    if (!base64Key) {
      return "";
    }
    const bytes = decodeMasterKey(base64Key);
    return encodeRFC1751(bytes);
  }, [base64Key]);

  useEffect(() => {
    if (!base64Key) {
      setQrDataUrl("");
      return;
    }
    const qrPayload = `carebase-master-key:${base64Key}`;
    QRCode.toDataURL(qrPayload, { margin: 1, width: 200 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [base64Key]);

  const applyBase64 = (value: string) => {
    try {
      const bytes = decodeMasterKey(value);
      if (bytes.length !== 16) {
        throw new Error("Master key must be 128-bit.");
      }
      storeMasterKey(value);
      setBase64Key(value);
      setStatus("Master key updated from Base64.");
    } catch (error) {
      setStatus("Invalid Base64 master key.");
    }
  };

  const applyPhrase = (value: string) => {
    try {
      const bytes = decodeRFC1751(value);
      if (bytes.length !== 16) {
        throw new Error("Master key must be 128-bit.");
      }
      const encoded = encodeMasterKey(bytes);
      storeMasterKey(encoded);
      setBase64Key(encoded);
      setStatus("Master key updated from RFC1751 phrase.");
    } catch (error) {
      setStatus("Invalid RFC1751 phrase.");
    }
  };

  const regenerate = () => {
    const confirmReset = window.confirm(
      "Regenerate master key? This will make existing encrypted data unreadable."
    );
    if (!confirmReset) {
      return;
    }
    const next = generateMasterKeyBase64();
    storeMasterKey(next);
    setBase64Key(next);
    setStatus("Master key regenerated.");
  };

  return (
    <div className={styles.panel}>
      <div>
        <div className={styles.label}>Current Master Key (Base64)</div>
        <div className={styles.value}>{base64Key}</div>
      </div>
      <div>
        <div className={styles.label}>RFC1751 Phrase</div>
        <div className={styles.value}>{rfcPhrase}</div>
      </div>
      <div className={styles.row}>
        <div className={styles.qr}>
          {qrDataUrl ? <img src={qrDataUrl} alt="Master key QR code" /> : "QR"}
        </div>
        <div className={styles.notice}>
          Scan the QR code or use the phrase above to transfer the key to a new
          device.
        </div>
      </div>
      <div>
        <div className={styles.label}>Set Master Key (RFC1751 Phrase)</div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={phraseInput}
            onChange={(event) => setPhraseInput(event.target.value)}
            placeholder="TROD MUTE TAIL WARM ..."
          />
          <button
            className={styles.secondary}
            onClick={() => applyPhrase(phraseInput)}
          >
            Apply Phrase
          </button>
        </div>
      </div>
      <div>
        <div className={styles.label}>Set Master Key (Base64)</div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={base64Input}
            onChange={(event) => setBase64Input(event.target.value)}
            placeholder="Base64 key"
          />
          <button
            className={styles.secondary}
            onClick={() => applyBase64(base64Input)}
          >
            Apply Base64
          </button>
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button className={styles.primary} onClick={regenerate}>
          Regenerate Master Key
        </button>
        <button
          className={styles.secondary}
          onClick={() => {
            navigator.clipboard.writeText(rfcPhrase);
            setStatus("RFC1751 phrase copied.");
          }}
        >
          Copy Phrase
        </button>
        <button
          className={styles.secondary}
          onClick={() => {
            navigator.clipboard.writeText(base64Key);
            setStatus("Base64 key copied.");
          }}
        >
          Copy Base64
        </button>
      </div>
      <div className={styles.notice}>{status}</div>
    </div>
  );
}
