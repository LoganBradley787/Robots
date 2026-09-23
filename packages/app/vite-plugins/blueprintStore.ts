import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { handleBlueprintRequest, MAX_BODY_BYTES, type FileStore } from '../src/storage/blueprintHandler';

/** Serves /api/blueprints over a directory during `vite dev`. The handler rejects any name that could escape it. */
export function blueprintStore(dir: string): Plugin {
  const store: FileStore = {
    list: () => (existsSync(dir) ? readdirSync(dir) : []),
    read: (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : undefined),
    write: (f, text) => {
      // Write then rename, so a crash mid-write never leaves a half-written blueprint.
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.${f}.tmp`);
      writeFileSync(tmp, text);
      renameSync(tmp, join(dir, f));
    },
    remove: (f) => unlinkSync(join(dir, f)),
  };
  return {
    name: 'robots-blueprint-store',
    configureServer(server) {
      server.middlewares.use('/api/blueprints', (req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BODY_BYTES + 1) chunks.push(c);
        });
        req.on('end', () => {
          const body = size > MAX_BODY_BYTES ? 'x'.repeat(MAX_BODY_BYTES + 1) : Buffer.concat(chunks).toString('utf8');
          const r = handleBlueprintRequest(req.method ?? 'GET', req.url ?? '/', body, store);
          res.statusCode = r.status;
          res.setHeader('content-type', 'application/json');
          res.end(r.body);
        });
      });
    },
  };
}
