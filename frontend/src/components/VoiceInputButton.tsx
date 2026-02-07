"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthUser } from "@/lib/useAuth";
import { getIdTokenMaybe } from "@/lib/auth-helpers";

export function VoiceInputButton({
  onTranscript,
  sessionKey,
  className,
  showStatusText = true,
  onStatusChange,
}: {
  onTranscript: (text: string) => void;
  sessionKey: string;
  className?: string;
  showStatusText?: boolean;
  onStatusChange?: (payload: { message: string; isError: boolean }) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onStatusChangeRef = useRef(onStatusChange);
  const { user } = useAuthUser();

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onStatusChangeRef.current?.({
      message: errorText || statusText,
      isError: Boolean(errorText),
    });
  }, [errorText, statusText]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const pickMimeType = (): string | undefined => {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
    const supported = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    return supported.find((type) => MediaRecorder.isTypeSupported(type));
  };

  const fileNameForBlob = (blob: Blob): string => {
    const mime = blob.type || "audio/webm";
    const ext = mime.includes("mp4")
      ? "m4a"
      : mime.includes("ogg")
        ? "ogg"
        : "webm";
    return `voice-input.${ext}`;
  };

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      setProcessing(true);
      setErrorText("");
      setStatusText("Transcribing...");
      try {
        const idToken = await getIdTokenMaybe(user);

        const formData = new FormData();
        formData.append("audio", blob, fileNameForBlob(blob));
        formData.append("session_key", sessionKey);
        if (idToken) formData.append("idToken", idToken);

        const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          let errorMessage = `Transcription failed (${response.status})`;
          try {
            const errBody = (await response.json()) as { message?: string };
            if (errBody.message) errorMessage = errBody.message;
          } catch { /* response wasn't JSON */ }
          throw new Error(errorMessage);
        }
        const data = (await response.json()) as {
          transcript_text?: string;
          transcript?: string;
          text?: string;
        };

        const transcript =
          data.transcript_text || data.transcript || data.text || "";
        if (!transcript.trim()) {
          throw new Error("No transcript returned.");
        }

        onTranscript(transcript.trim());
        setStatusText("Transcript ready. Edit and send.");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to transcribe audio.";
        setErrorText(message);
        setStatusText("");
      } finally {
        setProcessing(false);
      }
    },
    [onTranscript, sessionKey, user]
  );

  const startRecording = useCallback(async () => {
    setErrorText("");
    setStatusText("");
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorText("Voice input is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setErrorText("Recording error. Please try again.");
        setRecording(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };
      recorder.onstop = async () => {
        setRecording(false);
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        if (audioBlob.size === 0) {
          setErrorText("No audio detected. Please try again.");
          return;
        }
        await transcribeBlob(audioBlob);
      };

      recorder.start();
      setRecording(true);
      setStatusText("Listening...");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Microphone access failed.";
      setErrorText(message);
      setRecording(false);
    }
  }, [transcribeBlob]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    setStatusText("Finishing recording...");
  }, []);

  const toggleRecording = () => {
    if (processing) return;
    if (recording) {
      stopRecording();
    } else {
      void startRecording();
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
          disabled={processing}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
            recording
              ? "border-[color:var(--cp-danger)] bg-[color:color-mix(in_srgb,var(--cp-danger)_12%,white_88%)] text-[color:var(--cp-danger)]"
              : "border-[color:var(--cp-line)] bg-white/80 text-[color:var(--cp-muted)] hover:text-[color:var(--cp-text)]",
            processing && "cursor-not-allowed opacity-65"
          )}
          aria-label={
            recording
              ? "Stop recording"
              : processing
                ? "Transcribing voice input"
                : "Start voice input"
          }
        >
          {recording ? (
            <MicOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {showStatusText && (statusText || errorText) && (
        <span
          className={cn(
            "text-xs italic",
            errorText
              ? "text-[color:var(--cp-danger)]"
              : "text-[color:var(--cp-muted)]"
          )}
          role={errorText ? "alert" : "status"}
        >
          {errorText || statusText}
        </span>
      )}
    </div>
  );
}
