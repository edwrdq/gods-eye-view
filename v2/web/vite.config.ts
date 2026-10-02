import { createRequire } from 'node:module';
import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig, loadEnv } from 'vite';

// Cesium resolves from the hoisted workspace node_modules, so locate it
// through the package resolver rather than assuming ./node_modules.
const require = createRequire(import.meta.url);
const cesiumBuild = path.join(path.dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');

// The API server reads PORT from v2/.env; follow it so the proxy matches.
const apiPort = loadEnv('development', path.resolve(import.meta.dirname, '..'), '').PORT || '8787';
const apiProxy = { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } };

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
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    target: 'es2022',
    // The Cesium chunk is large by nature and loaded after the shell paints.
    chunkSizeWarningLimit: 6000,
  },
});
