import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@dtp/engines/benchmark-selection": path.resolve(
        __dirname,
        "../../packages/engines/src/calibration/benchmark-selection.ts"
      ),
      /* The placeholder list, shared with the API so the browser and the server agree on
         who is a person. A subpath rather than the bare specifier below, which deliberately
         resolves to media-url.ts alone: the browser has no use for the SIP engines or the
         fixture generator, and pulling the package index in would ship all of it. */
      "@dtp/engines/placeholder-names": path.resolve(
        __dirname,
        "../../packages/engines/src/scoreboard/placeholder-names.ts"
      ),
      "@dtp/engines": path.resolve(__dirname, "../../packages/engines/src/media-url.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
