import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@xyflow/")) return "react-flow";
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
      },
    },
  },
});
