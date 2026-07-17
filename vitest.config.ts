import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    hookTimeout: 60_000,
    maxWorkers: 2,
    testTimeout: 60_000,
  },
});
