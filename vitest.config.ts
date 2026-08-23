import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@copify/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@copify/persistence": path.resolve(__dirname, "packages/persistence/src/index.ts"),
      "@copify/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@copify/runner": path.resolve(__dirname, "packages/runner/src/network.ts")
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});
