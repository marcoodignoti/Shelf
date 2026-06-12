import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    entries: ["index.html"],
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "dist-electron/**", ".secrets/**"],
    include: ["src/**/*.test.{ts,tsx}"],
    pool: process.platform === "win32" ? "threads" : "vmForks",
    deps: {
      optimizer: {
        client: { enabled: false },
        ssr: { enabled: false },
      },
    },
  },
});
