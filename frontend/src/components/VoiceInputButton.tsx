"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function VoiceInputButton({
  onTranscript,
  className,
}: {
  onTranscript: (text: string) => void;
  className?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      if (transcript.trim()) {
        onTranscript(transcript.trim());
        setTranscript("");
      }
    } else {
      setRecording(true);
      setTranscript("Voice transcription will appear here...");
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative">
        {recording && (
          <motion.span
            className="absolute inset-0 rounded-full bg-[color:var(--cp-danger)]/20"
            animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onClick={toggleRecording}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
            recording
              ? "border-[color:var(--cp-danger)] bg-[color:color-mix(in_srgb,var(--cp-danger)_12%,white_88%)] text-[color:var(--cp-danger)]"
              : "border-[color:var(--cp-line)] bg-white/80 text-[color:var(--cp-muted)] hover:text-[color:var(--cp-text)]"
          )}
          aria-label={recording ? "Stop recording" : "Start voice input"}
        >
          {recording ? (
            <MicOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {recording && transcript && (
        <span className="text-xs italic text-[color:var(--cp-muted)]">{transcript}</span>
      )}
    </div>
  );
}
