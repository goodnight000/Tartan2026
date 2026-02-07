"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TagInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (value.includes(tag)) return;
    onChange([...value, tag]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="flex flex-wrap gap-2">
        {value.map((item) => (
          <Badge key={item}>
            {item}
            <button
              type="button"
              className="ml-2 text-slate-400"
              onClick={() => onChange(value.filter((tag) => tag !== item))}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
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
