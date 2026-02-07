import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1120",
        mist: "#f8fafc",
        slateBlue: "#1e293b",
        teal: "#0f766e",
        sky: "#38bdf8",
        "cp-bg": "var(--cp-bg)",
        "cp-bg-strong": "var(--cp-bg-strong)",
        "cp-surface": "var(--cp-surface)",
        "cp-surface-soft": "var(--cp-surface-soft)",
        "cp-text": "var(--cp-text)",
        "cp-muted": "var(--cp-muted)",
        "cp-line": "var(--cp-line)",
        "cp-primary": "var(--cp-primary)",
        "cp-primary-soft": "var(--cp-primary-soft)",
        "cp-accent": "var(--cp-accent)",
        "cp-success": "var(--cp-success)",
        "cp-warn": "var(--cp-warn)",
        "cp-danger": "var(--cp-danger)",
        "cp-info": "var(--cp-info)",
        "triage-emergent": "#b9382d",
        "triage-urgent": "#c8871a",
        "triage-routine": "#1f6b4a",
      },
      borderRadius: {
        "cp-sm": "var(--cp-radius-sm)",
        "cp-md": "var(--cp-radius-md)",
        "cp-lg": "var(--cp-radius-lg)",
      },
      keyframes: {
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "slide-up": {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "1" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
      animation: {
        "skeleton-shimmer": "skeleton-shimmer 1.8s ease-in-out infinite",
        "slide-up": "slide-up 400ms cubic-bezier(0.2, 0.85, 0.2, 1) both",
        "pulse-ring": "pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
