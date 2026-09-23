import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { BLUEPRINTS, handleBlueprintRequest, REPLAYS, type FileStore, type StoreOptions } from '../src/storage/blueprintHandler.ts';

/** Serves a folder of JSON files at `route` during `vite dev`. The handler rejects any name that could escape it. */
function jsonFileStore(dir: string, route: string, opts: StoreOptions): Plugin {
  const store: FileStore = {
    list: () => (existsSync(dir) ? readdirSync(dir) : []),
    read: (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : undefined),
    write: (f, text) => {
      // Write then rename, so a crash mid-write never leaves a half-written file.
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.${f}.tmp`);
      writeFileSync(tmp, text);
      renameSync(tmp, join(dir, f));
    },
    remove: (f) => unlinkSync(join(dir, f)),
  };
  return {
    name: `robots-${opts.noun}-store`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= opts.maxBytes + 1) chunks.push(c);
        });
        req.on('end', () => {
          const body = size > opts.maxBytes ? 'x'.repeat(opts.maxBytes + 1) : Buffer.concat(chunks).toString('utf8');
          const r = handleBlueprintRequest(req.method ?? 'GET', req.url ?? '/', body, store, opts);
          res.statusCode = r.status;
          res.setHeader('content-type', 'application/json');
          res.end(r.body);
        });
      });
    },
  };
}

/** `blueprints/` at /api/blueprints. */
export function blueprintStore(dir: string): Plugin {
  return jsonFileStore(dir, '/api/blueprints', BLUEPRINTS);
}

/** `replays/` at /api/replays (M3): the world toolbar's Save replay writes here. */
export function replayStore(dir: string): Plugin {
  return jsonFileStore(dir, '/api/replays', REPLAYS);
}
