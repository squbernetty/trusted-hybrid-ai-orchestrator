import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export default defineConfig({
  plugins: [
    react(),
  ],

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,

    // Keep development compatible with the strict CSP.
    // Disabling HMR prevents React Fast Refresh from
    // injecting an inline development preamble.
    hmr: false,

    headers: securityHeaders,

    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: false,
      },
    },
  },

  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: securityHeaders,
  },
});
