"use client";

import { useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TagInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const inputId = useId();

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (value.includes(tag)) return;
    onChange([...value, tag]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]"
        htmlFor={inputId}
      >
        {label}
      </label>
      <div className="flex flex-wrap gap-2" role="list" aria-label={`${label} tags`}>
        <AnimatePresence>
          {value.map((item) => (
            <motion.span
              key={item}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--cp-line)] bg-white/75 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]"
              role="listitem"
            >
              {item}
              <button
                type="button"
                className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/5 text-[color:var(--cp-muted)] hover:bg-black/10"
                onClick={() => onChange(value.filter((tag) => tag !== item))}
                aria-label={`Remove ${item}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <Input
          id={inputId}
          placeholder={placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag(input);
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => addTag(input)}>
          Add
        </Button>
      </div>
    </div>
  );
}
