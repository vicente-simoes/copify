import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../..");
const aliases = {
  "@copify/shared": path.resolve(workspaceRoot, "packages/shared/src/index.ts"),
  "@copify/persistence": path.resolve(workspaceRoot, "packages/persistence/src/index.ts"),
  "@copify/core": path.resolve(workspaceRoot, "packages/core/src/index.ts"),
  "@copify/runner": path.resolve(workspaceRoot, "packages/runner/src/network.ts")
};

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin({ exclude: ["@copify/core", "@copify/persistence", "@copify/shared", "@copify/runner"] })],
    build: {
      rollupOptions: {
        // Crawlee's CommonJS dependency graph contains circular namespace wrappers
        // that cannot safely be flattened into the standalone monitor worker. Keep
        // these runtime packages external and ship them as desktop dependencies.
        external: [/^@crawlee\//, /^undici(?:\/|$)/],
        input: {
          index: path.resolve(__dirname, "src/main.ts"),
          runner: path.resolve(workspaceRoot, "packages/runner/src/runner.ts"),
          monitor: path.resolve(workspaceRoot, "packages/runner/src/monitor.ts")
        },
        output: { entryFileNames: "[name].js" }
      }
    }
  },
  preload: {
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin({ exclude: ["@copify/shared"] })],
    build: { rollupOptions: { input: path.resolve(__dirname, "src/preload.ts") } }
  },
  renderer: {
    root: __dirname,
    resolve: { alias: aliases },
    plugins: [react()],
    build: { rollupOptions: { input: path.resolve(__dirname, "index.html") } }
  }
});
