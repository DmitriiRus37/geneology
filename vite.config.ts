import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Один HTML на выходе: открывается двойным щелчком с диска, без сервера и сети.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5178,
    host: "127.0.0.1",
    // в разработке за данными ходим в тот же локальный сервер: node server.mjs
    proxy: { "/api": "http://127.0.0.1:5179" },
  },
});
