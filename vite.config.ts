import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const tailwindcss = require("@tailwindcss/vite").default as typeof import("@tailwindcss/vite").default;

const __dirname = dirname(fileURLToPath(import.meta.url));

const host = process.env.VITE_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [react(), tailwindcss({ optimize: false })],

  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        externalAssistant: resolve(__dirname, "external-assistant.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('/@blocknote/') || id.includes('/@mantine/')) {
            return 'editor-vendor';
          }
          if (id.includes('/pdfjs-dist/')) {
            return 'pdf-vendor';
          }
          if (id.includes('/katex/') || id.includes('/react-icons/')) {
            return 'math-vendor';
          }
          if (id.includes('/lucide-react/')) {
            return 'icons-vendor';
          }
          if (id.includes('/zustand/')) {
            return 'state-vendor';
          }
          return undefined;
        }
      }
    }
  },

  // Keep Vite output visible in Electron dev and build runs.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ["**/dist-electron/**", "**/.shelf-dev/**"],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
}));
