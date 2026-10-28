import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/*
 * The console is served by the Edge itself (services/fairplay-edge, FAIRPLAY_CONSOLE_DIR),
 * on the Edge's own origin, so it needs no internet and makes no cross-origin request.
 * Nothing here may load from a CDN: the Edge's Content-Security-Policy allows 'self' only,
 * and a test fails the build output if any http(s) URL to another host appears in it.
 */
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    // `pnpm --filter @dtp/fairplay-console dev` against an Edge on this machine.
    proxy: { "/edge": { target: "http://127.0.0.1:8443", changeOrigin: false } },
  },
});
