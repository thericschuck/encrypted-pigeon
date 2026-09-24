import type { Config } from "tailwindcss";

const config: Config = {
  // Per-user theme (settings): <html class="light|dark"> forces a scheme,
  // no class follows the OS. See src/lib/theme.ts.
  darkMode: [
    "variant",
    [
      "@media (prefers-color-scheme: dark) { &:not(:where(.light, .light *)) }",
      "&:where(.dark, .dark *)",
    ],
  ],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Dark-mode palette: the light theme's parchment/terracotta
        // (#f7f0df / #c1643a / #5c4a37, see the flight map and PWA prompt)
        // carried over into warm, low-glare browns instead of a cold grey.
        night: {
          bg: "#17130f",
          surface: "#211c16",
          raised: "#2c251d",
          border: "#3b3228",
          text: "#eee4cf",
          muted: "#a3957a",
          accent: "#d9774b",
          bubble: "#9c4f2c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
