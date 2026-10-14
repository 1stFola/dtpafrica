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
      /* The Vision contracts, from source: constants and types with no imports of their own,
         so the browser takes them as they are and nothing has to be built first. The screens
         used to keep hand copies, and the copies drifted (docs/vision/58). */
      "@dtp/vision-contracts": path.resolve(__dirname, "../../packages/vision-contracts/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    /* Hosts beyond localhost the dev server answers, comma-separated: set only while a
       temporary link lets a remote reviewer in (docs/vision/97). Unset, Vite's own
       localhost-only check applies. */
    ...(process.env.VITE_ALLOWED_HOSTS ? { allowedHosts: process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean) } : {}),
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
