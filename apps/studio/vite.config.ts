import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Relative assets let the same build run at the repository Pages URL or another static host.
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@armin-eslami/gatherform-core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@armin-eslami/gatherform-react": fileURLToPath(
        new URL("../../packages/react/src/index.tsx", import.meta.url),
      ),
    },
  },
  worker: { format: "es" },
});
