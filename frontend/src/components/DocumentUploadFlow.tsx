"use client";

import { useState, useCallback } from "react";
import { FileText, Upload, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";

type UploadStep = "select" | "upload" | "processing" | "done";

type DocumentTypeOption = {
  label: string;
  value: "lab_report" | "imaging_report" | "clinical_note" | "other";
};

const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  { label: "Lab Results", value: "lab_report" },
  { label: "Imaging Report", value: "imaging_report" },
  { label: "Clinical Note", value: "clinical_note" },
  { label: "Other", value: "other" },
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "text/plain",
  "text/csv",
]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
  ".csv",
]);

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : "";
}

function validateUploadFile(file: File): string | null {
  if (file.size <= 0) return "File is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "File is too large (max 25MB).";
  const ext = fileExtension(file.name);
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type) && !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return "Unsupported file type. Upload PDF, image, TXT, or CSV.";
  }
  return null;
}

export type DocumentUploadResult = {
  docType: string;
  fileName: string;
  summary: string;
  followUpQuestions: string[];
  messageForChat: string;
};

export function DocumentUploadFlow({
  onComplete,
  sessionKey,
  className,
}: {
  onComplete: (result: DocumentUploadResult) => void;
  sessionKey: string;
  className?: string;
}) {
  const [step, setStep] = useState<UploadStep>("select");
  const [docType, setDocType] = useState<DocumentTypeOption | null>(null);
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [errorText, setErrorText] = useState("");

  const formatResultForChat = useCallback(
    (type: string, name: string, resultSummary: string, followUpQuestions: string[]) => {
      const questionLines =
        followUpQuestions.length > 0
          ? followUpQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
          : "No specific follow-up questions were identified.";
      return [
        `I analyzed your ${type.toLowerCase()} file **${name}**.`,
        "",
        `**Plain-language summary:** ${resultSummary}`,
        "",
        "**Suggested clinician follow-up questions:**",
        questionLines,
        "",
        "_This interpretation is informational only and not a diagnosis._",
      ].join("\n");
    },
    []
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!docType?.value) {
        setErrorText("Please select a document type first.");
        return;
      }
      const validationError = validateUploadFile(file);
      if (validationError) {
        setErrorText(validationError);
        setStep("upload");
        return;
      }

      setFileName(file.name);
      setStep("processing");
      setErrorText("");
      setSummary("");
      setQuestions([]);

      try {
        let idToken: string | undefined;
        const user = auth.currentUser;
        if (user) {
          try {
            idToken = await user.getIdToken();
          } catch {
            // noop
          }
        }

        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("doc_type", docType.value);
        formData.append("session_key", sessionKey);
        if (idToken) formData.append("idToken", idToken);

        const response = await fetch("/api/documents/analyze", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          let errorMessage = `Document analysis failed (${response.status})`;
          try {
            const errBody = (await response.json()) as { message?: string };
            if (errBody.message) errorMessage = errBody.message;
          } catch { /* response wasn't JSON */ }
          throw new Error(errorMessage);
        }
        const data = (await response.json()) as {
          summary?: string;
          plain_language_summary?: string;
          follow_up_questions?: string[];
          suggested_questions?: string[];
        };

        const normalizedSummary =
          data.summary?.trim() ||
          data.plain_language_summary?.trim() ||
          "I could not extract a detailed summary from this file.";
        const normalizedQuestions = (
          data.follow_up_questions ||
          data.suggested_questions ||
          []
        ).filter((item): item is string => typeof item === "string" && item.trim().length > 0);

        setSummary(normalizedSummary);
        setQuestions(normalizedQuestions);
        setStep("done");

        onComplete({
          docType: docType.label,
          fileName: file.name,
          summary: normalizedSummary,
          followUpQuestions: normalizedQuestions,
          messageForChat: formatResultForChat(docType.label, file.name, normalizedSummary, normalizedQuestions),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to process this file right now.";
        setErrorText(message);
        setStep("upload");
      }
    },
    [docType, formatResultForChat, onComplete, sessionKey]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        void handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (file) {
      void handleFileUpload(file);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {step === "select" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
            Document Type
          </p>
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_TYPE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={docType?.value === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDocType(option);
                  setStep("upload");
                  setErrorText("");
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {step === "upload" && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          role="region"
          aria-label={`Upload ${(docType?.label || "document").toLowerCase()} document`}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[color:var(--cp-line)] bg-white/50 p-6"
        >
          <Upload className="h-8 w-8 text-[color:var(--cp-muted)]" aria-hidden="true" />
          <p className="text-sm text-[color:var(--cp-muted)]">
            Drag & drop your {(docType?.label || "document").toLowerCase()} here
          </p>
          <label>
            <span className="cursor-pointer text-xs font-semibold text-[color:var(--cp-primary)] underline">
              or browse files
            </span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
              onChange={handleFileSelect}
            />
          </label>
        </div>
      )}

      {step === "processing" && (
        <div className="space-y-2" role="status" aria-label="Processing document">
          <div className="flex items-center gap-2 text-sm text-[color:var(--cp-muted)]">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Processing {fileName}...
          </div>
          <SkeletonCard />
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3 rounded-2xl border border-[color:var(--cp-success)]/30 bg-[color:color-mix(in_srgb,var(--cp-success)_6%,white_94%)] p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-[color:var(--cp-success)]" aria-hidden="true" />
            <span className="text-sm text-[color:var(--cp-text)]">{fileName} analyzed</span>
          </div>
          <p className="text-sm text-[color:var(--cp-text)]">{summary}</p>
          <div className="rounded-xl border border-[color:var(--cp-line)] bg-white/80 p-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
              Suggested Follow-Up Questions
            </p>
            {questions.length > 0 ? (
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-[color:var(--cp-text)]">
                {questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[color:var(--cp-muted)]">
                No specific follow-up questions were identified.
              </p>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-[color:var(--cp-accent)]/35 bg-[color:color-mix(in_srgb,var(--cp-accent)_10%,white_90%)] p-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-[color:var(--cp-accent)]" aria-hidden="true" />
            <p className="text-xs text-[color:var(--cp-text)]">
              This summary is informational and not a diagnosis. Use it to discuss next steps with a licensed clinician.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStep("select");
              setDocType(null);
              setFileName("");
              setSummary("");
              setQuestions([]);
              setErrorText("");
            }}
          >
            Analyze another file
          </Button>
        </div>
      )}

      {errorText && (
        <div
          className="rounded-xl border border-[color:var(--cp-danger)]/35 bg-[color:color-mix(in_srgb,var(--cp-danger)_8%,white_92%)] p-2 text-sm text-[color:var(--cp-danger)]"
          role="alert"
        >
          {errorText}
        </div>
      )}
    </div>
  );
}
