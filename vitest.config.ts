import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    entries: ["index.html"],
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "dist-electron/**", ".secrets/**"],
    include: ["src/**/*.test.{ts,tsx}", "packages/shared/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "src/lib/locales/**",
      ],
    },
    pool: process.platform === "win32" ? "threads" : "vmForks",
    deps: {
      optimizer: {
        client: { enabled: false },
        ssr: { enabled: false },
      },
    },
  },
});
