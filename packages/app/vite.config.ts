import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { blueprintStore } from './vite-plugins/blueprintStore';

export default defineConfig({
  server: { port: 5180, strictPort: true },
  // Preact through Vite's built-in JSX transform (no preset, so no Babel). Components reload the page on change.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [blueprintStore(fileURLToPath(new URL('../../blueprints', import.meta.url)))],
});
