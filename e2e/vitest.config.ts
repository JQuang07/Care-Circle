import { defineConfig } from "vitest/config";
import ByName from "./src/sequencer";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./src/global-setup.ts"],
    fileParallelism: false,      // scenarios share one Rose; run them in order
    sequence: { concurrent: false, shuffle: false, sequencer: ByName },
    testTimeout: 240_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
