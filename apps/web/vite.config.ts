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
      "@dtp/engines": path.resolve(__dirname, "../../packages/engines/src/media-url.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
