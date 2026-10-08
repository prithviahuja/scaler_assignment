import type { Config } from "tailwindcss";

/**
 * The palette mirrors Signal Desktop: one accent blue, a small set of greys per
 * theme, and Signal's own avatar tile colours. Everything is driven by CSS
 * variables declared in `globals.css` so dark mode is a single class flip.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: {
          blue: "#2C6BED",
          "blue-hover": "#1851B4",
          ultramarine: "#3A76F0",
        },
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        "surface-hover": "var(--surface-hover)",
        "surface-active": "var(--surface-active)",
        "surface-input": "var(--surface-input)",
        divider: "var(--divider)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "bubble-in": "var(--bubble-in)",
        "bubble-in-text": "var(--bubble-in-text)",
        "bubble-out": "var(--bubble-out)",
        "bubble-out-text": "var(--bubble-out-text)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "sans-serif",
        ],
      },
      borderRadius: {
        bubble: "18px",
      },
      keyframes: {
        "bubble-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { opacity: "0.35", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-3px)" },
        },
      },
      animation: {
        "bubble-in": "bubble-in 140ms ease-out",
        "toast-in": "toast-in 160ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
