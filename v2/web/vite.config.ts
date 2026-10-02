import { createRequire } from 'node:module';
import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig } from 'vite';

// Cesium resolves from the hoisted workspace node_modules, so locate it
// through the package resolver rather than assuming ./node_modules.
const require = createRequire(import.meta.url);
const cesiumBuild = path.join(path.dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');

export default defineConfig({
  plugins: [
    svelte(),
    // Cesium loads workers, wasm and textures at runtime from CESIUM_BASE_URL.
    viteStaticCopy({
      targets: ['Workers', 'Assets', 'Widgets', 'ThirdParty'].map((dir) => ({
        src: path.join(cesiumBuild, dir, '**', '*').replaceAll('\\', '/'),
        dest: 'cesium',
        structured: true,
        // structured keeps the path below the project root; drop everything up to Build/Cesium.
        rename: { stripBase: path.relative(process.cwd(), cesiumBuild).split(/[\\/]/).filter((p) => p && p !== '..').length },
      })),
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    // The Cesium chunk is large by nature and loaded after the shell paints.
    chunkSizeWarningLimit: 6000,
  },
});
