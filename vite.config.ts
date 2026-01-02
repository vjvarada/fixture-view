import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import obfuscatorPlugin from "rollup-plugin-obfuscator";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Code obfuscation for production builds only
    mode === "production" && obfuscatorPlugin({
      options: {
        // Performance-optimized obfuscation settings
        compact: true,
        controlFlowFlattening: false, // Disabled - significant performance hit
        deadCodeInjection: false, // Disabled - increases bundle size
        debugProtection: false, // Disabled - can break debugging tools
        disableConsoleOutput: true, // Remove console.* calls in production
        identifierNamesGenerator: "hexadecimal", // Rename variables to hex
        log: false,
        numbersToExpressions: true, // Convert numbers to expressions
        renameGlobals: false, // Don't rename globals - breaks Three.js
        selfDefending: false, // Disabled - can cause issues
        simplify: true, // Simplify code
        splitStrings: true, // Split strings into chunks
        splitStringsChunkLength: 10,
        stringArray: true, // Move strings to array
        stringArrayCallsTransform: true,
        stringArrayEncoding: ["base64"], // Encode strings
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 4,
        stringArrayWrappersType: "function",
        stringArrayThreshold: 0.75,
        transformObjectKeys: true, // Obfuscate object keys
        unicodeEscapeSequence: false, // Disabled - increases size
      },
      // Only obfuscate our application code, not vendor chunks
      include: [
        "src/**/*.js",
        "src/**/*.ts",
        "src/**/*.tsx",
        "packages/cad-core/**/*.ts",
        "packages/cad-ui/**/*.ts",
        "packages/cad-ui/**/*.tsx",
      ],
      exclude: [
        "node_modules/**",
        "**/*vendor*.js", // Don't obfuscate vendor chunks
      ],
    }),
  ].filter(Boolean),
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
    // Disable source maps in production for security
    sourcemap: mode !== "production",
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
    // Increase chunk size warning limit - THREE.js is inherently large (~1MB)
    // and cannot be split further. This is expected for 3D applications.
    chunkSizeWarningLimit: 1100,
  },
}));