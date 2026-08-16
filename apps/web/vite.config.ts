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
    rollupOptions: {
      output: {
        /**
         * Fold the icon library into ONE chunk.
         *
         * Measured on the live site: 42 JS chunks, 224.6 kB encoded, of which 35
         * were under 2 kB and came to 20.7 kB between them — 83% of the requests
         * carrying 9% of the bytes. Each was a single lucide icon. The protocol
         * is h2, so this was not the old six-connection limit; it was Chrome's
         * scheduler drowning under ~40 simultaneous tiny fetches. Median stall
         * before a request was even sent: 1,872 ms. The worst, a 361-byte icon,
         * spent 3,903 ms stalled to transfer in 51 ms.
         *
         * Worse, the four data calls did not start until the last chunk landed,
         * 6,388 ms in — each then finished in about 500 ms. The API was never
         * slow; it was queued behind icons.
         *
         * Why they split: an icon imported by several lazily-loaded routes gets
         * hoisted into a shared chunk, and a different subset of routes means a
         * different chunk. Thirty-five icons, thirty-five subsets.
         *
         * DELIBERATELY NARROW. An earlier attempt here split React away from the
         * libraries that depend on it, which produced a load-order cycle:
         * @radix-ui and react-query booted before React was defined, and the
         * production build white-screened with "Cannot read properties of
         * undefined (reading 'forwardRef')" while dev was fine. This rule names
         * lucide-react and nothing else, so React stays exactly where Vite put
         * it and no dependent is separated from it. Icons are leaves; nothing
         * imports from them.
         *
         * Verified by rendering the built bundle in a real browser, not just by
         * a green build — a green build is precisely what the last attempt
         * produced.
         */
        manualChunks(id: string) {
          if (id.includes("node_modules/lucide-react")) return "icons";
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Shared with apps/mobile. Deliberately a path alias rather than a
      // workspace dependency: making these packages workspace members would
      // relocate backend/bun.lock, which backend/Dockerfile copies by path.
      "@civic/core": path.resolve(__dirname, "../../packages/civic-core/src"),
    },
  },
}));
