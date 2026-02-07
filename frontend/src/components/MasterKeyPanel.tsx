"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import {
  decodeMasterKey,
  encodeMasterKey,
  generateMasterKeyBase64,
  getOrCreateMasterKey,
  storeMasterKey,
} from "@/lib/carebase/encryption";
import { decodeRFC1751, encodeRFC1751 } from "@/lib/rfc1751";

export function MasterKeyPanel() {
  const [base64Key, setBase64Key] = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [base64Input, setBase64Input] = useState("");
  const [status, setStatus] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    setBase64Key(getOrCreateMasterKey());
  }, []);

  const rfcPhrase = useMemo(() => {
    if (!base64Key) return "";
    return encodeRFC1751(decodeMasterKey(base64Key));
  }, [base64Key]);

  useEffect(() => {
    if (!base64Key) return;
    const qrPayload = `carebase-master-key:${base64Key}`;
    QRCode.toDataURL(qrPayload, { margin: 1, width: 200 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [base64Key]);

  const applyBase64 = (value: string) => {
    try {
      const bytes = decodeMasterKey(value);
      if (bytes.length !== 16) throw new Error();
      storeMasterKey(value);
      setBase64Key(value);
      setStatus("Master key updated from Base64.");
    } catch {
      setStatus("Invalid Base64 master key.");
    }
  };

  const applyPhrase = (value: string) => {
    try {
      const bytes = decodeRFC1751(value);
      if (bytes.length !== 16) throw new Error();
      const encoded = encodeMasterKey(bytes);
      storeMasterKey(encoded);
      setBase64Key(encoded);
      setStatus("Master key updated from RFC1751 phrase.");
    } catch {
      setStatus("Invalid RFC1751 phrase.");
    }
  };

  const regenerate = () => {
    const confirmReset = window.confirm(
      "Regenerate master key? This will make existing encrypted data unreadable."
    );
    if (!confirmReset) return;
    const next = generateMasterKeyBase64();
    storeMasterKey(next);
    setBase64Key(next);
    setStatus("Master key regenerated.");
  };

  return (
    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--cp-muted)]">Master Key</p>
        <div className="text-xs break-all text-[color:var(--cp-muted)] mt-1">{base64Key}</div>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--cp-muted)]">RFC1751 Phrase</p>
        <div className="text-xs break-all text-[color:var(--cp-muted)] mt-1">{rfcPhrase}</div>
      </div>
      <div className="flex flex-wrap gap-4 items-center">
        <div className="h-36 w-36 rounded-xl bg-[color:var(--cp-surface)] grid place-items-center">
          {qrDataUrl ? (
            <Image src={qrDataUrl} alt="Master key QR" width={120} height={120} unoptimized />
          ) : (
            "QR"
          )}
        </div>
        <p className="text-xs text-[color:var(--cp-muted)]">
          Scan the QR code or use the phrase above to transfer the key to a new device.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="flex-1 rounded-xl border border-[color:var(--cp-line)] px-3 py-2 text-sm"
          value={phraseInput}
          onChange={(event) => setPhraseInput(event.target.value)}
          placeholder="RFC1751 phrase"
        />
        <button
          className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
          onClick={() => applyPhrase(phraseInput)}
        >
          Apply Phrase
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="flex-1 rounded-xl border border-[color:var(--cp-line)] px-3 py-2 text-sm"
          value={base64Input}
          onChange={(event) => setBase64Input(event.target.value)}
          placeholder="Base64 key"
        />
        <button
          className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
          onClick={() => applyBase64(base64Input)}
        >
          Apply Base64
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-full bg-[color:var(--cp-primary)] px-4 py-2 text-sm text-white"
          onClick={regenerate}
        >
          Regenerate Master Key
        </button>
        <button
          className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
          onClick={() => {
            navigator.clipboard.writeText(rfcPhrase);
            setStatus("RFC1751 phrase copied.");
          }}
        >
          Copy Phrase
        </button>
        <button
          className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
          onClick={() => {
            navigator.clipboard.writeText(base64Key);
            setStatus("Base64 key copied.");
          }}
        >
          Copy Base64
        </button>
      </div>
      <div className="text-xs text-[color:var(--cp-muted)]">{status}</div>
    </div>
  );
}
