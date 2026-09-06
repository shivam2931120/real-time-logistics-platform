import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    chunkSizeWarningLimit: 1_100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) return "maps";
          if (id.includes("@clerk")) return "auth";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("socket.io-client")) return "realtime";
          return undefined;
        },
      },
    },
  },
});
