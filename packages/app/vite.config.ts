import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { blueprintStore } from './vite-plugins/blueprintStore';

export default defineConfig({
  server: { port: 5180, strictPort: true },
  plugins: [blueprintStore(fileURLToPath(new URL('../../blueprints', import.meta.url)))],
});
