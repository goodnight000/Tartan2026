"use client";

import { useState, useCallback } from "react";
import { FileText, Upload, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

type UploadStep = "select" | "upload" | "processing" | "done";

export function DocumentUploadFlow({
  onComplete,
  className,
}: {
  onComplete: (summary: string) => void;
  className?: string;
}) {
  const [step, setStep] = useState<UploadStep>("select");
  const [docType, setDocType] = useState<string>("");
  const [fileName, setFileName] = useState("");

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        setFileName(file.name);
        setStep("processing");
        setTimeout(() => {
          setStep("done");
          onComplete(`Uploaded ${docType}: ${file.name}. Summary will appear in chat.`);
        }, 2000);
      }
    },
    [docType, onComplete]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setStep("processing");
      setTimeout(() => {
        setStep("done");
        onComplete(`Uploaded ${docType}: ${file.name}. Summary will appear in chat.`);
      }, 2000);
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
            {["Lab Results", "Imaging Report", "Prescription", "Other"].map((type) => (
              <Button
                key={type}
                type="button"
                variant={docType === type ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDocType(type);
                  setStep("upload");
                }}
              >
                {type}
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
          aria-label={`Upload ${docType.toLowerCase()} document`}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[color:var(--cp-line)] bg-white/50 p-6"
        >
          <Upload className="h-8 w-8 text-[color:var(--cp-muted)]" aria-hidden="true" />
          <p className="text-sm text-[color:var(--cp-muted)]">
            Drag & drop your {docType.toLowerCase()} here
          </p>
          <label>
            <span className="cursor-pointer text-xs font-semibold text-[color:var(--cp-primary)] underline">
              or browse files
            </span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
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
        <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--cp-success)]/30 bg-[color:color-mix(in_srgb,var(--cp-success)_6%,white_94%)] p-3">
          <CheckCircle className="h-4 w-4 text-[color:var(--cp-success)]" aria-hidden="true" />
          <span className="text-sm text-[color:var(--cp-text)]">{fileName} processed</span>
        </div>
      )}
    </div>
  );
}
