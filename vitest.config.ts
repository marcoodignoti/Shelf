import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "dist-electron/**", ".secrets/**"],
    include: ["src/**/*.test.{ts,tsx}"],
    pool: "threads",
  },
});
