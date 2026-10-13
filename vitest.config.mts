import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { assertNoProjectEnvironmentFiles } from "./src/lib/env-file-preflight";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
assertNoProjectEnvironmentFiles(rootDirectory, "Vitest");

export default defineConfig({
  resolve: { alias: { "@": `${rootDirectory}src` } },
  envDir: false,
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
