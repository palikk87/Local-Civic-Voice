import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8000,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    // NOTE: do not add custom `manualChunks` here. Hand-splitting React away from the
    // libraries that depend on it produced a load-order cycle where @radix-ui and
    // react-query booted before React was defined — the production build white-screened
    // ("Cannot read properties of undefined (reading 'forwardRef')") while dev was fine.
    // Vite's default chunking is safe; per-page splitting already comes from React.lazy.
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
