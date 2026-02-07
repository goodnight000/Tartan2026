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
        sky: "#38bdf8"
      }
    }
  },
  plugins: []
};

export default config;
