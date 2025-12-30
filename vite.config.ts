import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // THREE.js and related 3D libraries (largest chunk)
          'three-vendor': [
            'three',
            '@react-three/fiber',
            '@react-three/drei',
          ],
          // Manifold CSG library
          'manifold': ['manifold-3d'],
          // React core
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // UI component libraries
          'ui-vendor': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          // Utility libraries
          'utils-vendor': [
            'clsx',
            'tailwind-merge',
            'class-variance-authority',
            'lucide-react',
          ],
        },
      },
    },
    // Increase chunk size warning limit since we're intentionally creating larger vendor chunks
    chunkSizeWarningLimit: 600,
  },
}));