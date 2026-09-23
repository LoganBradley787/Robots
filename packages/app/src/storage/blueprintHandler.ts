/**
 * The blueprint file API, as a pure function over a small file interface so it tests without Node or Vite.
 * The Vite dev plugin wires it to the repo's `blueprints/` folder.
 */
export interface FileStore {
  list(): string[];
  read(file: string): string | undefined;
  write(file: string, text: string): void;
  remove(file: string): void;
}

export interface ApiResponse {
  status: number;
  body: string;
}

export const MAX_BODY_BYTES = 1_000_000;
const FILE_NAME = /^[a-z0-9][a-z0-9-]*\.json$/;

const json = (status: number, value: unknown): ApiResponse => ({ status, body: JSON.stringify(value) });

function nameOf(file: string, text: string | undefined): string {
  try {
    const v: unknown = JSON.parse(text ?? '');
    if (typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string') return (v as { name: string }).name;
  } catch {
    // fall through to the file stem
  }
  return file.slice(0, -'.json'.length);
}

/** How one folder of JSON files is served: blueprints (pretty, small) or replays (compact, larger). */
export interface StoreOptions {
  noun: string;
  maxBytes: number;
  /** Write indented JSON (readable in diffs) or one line. */
  pretty: boolean;
  /** Also serve `.js` script files as plain text (M5: scripts live next to their blueprint). */
  scripts?: boolean;
}

export const BLUEPRINTS: StoreOptions = { noun: 'blueprint', maxBytes: MAX_BODY_BYTES, pretty: true, scripts: true };
export const REPLAYS: StoreOptions = { noun: 'replay', maxBytes: 20_000_000, pretty: false };
/** A script file: a plain name, no path, ending in `.js`. */
const SCRIPT_NAME = /^[a-z0-9][a-z0-9._-]*\.js$/;
const MAX_SCRIPT_BYTES = 200_000;

/** `url` is relative to the route (`/api/blueprints`): `/` for the list, `/<file>.json` for one file. */
export function handleBlueprintRequest(method: string, url: string, body: string, store: FileStore, opts: StoreOptions = BLUEPRINTS): ApiResponse {
  const noun = opts.noun;
  const path = url.split('?')[0] ?? '/';
  if (path === '/' || path === '') {
    if (method !== 'GET') return json(405, { error: 'only GET is allowed on the list' });
    const items = store
      .list()
      .filter((f) => FILE_NAME.test(f))
      .map((file) => ({ file, name: nameOf(file, store.read(file)) }))
      .sort((a, b) => {
        const x = a.name.toLowerCase();
        const y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });
    return json(200, items);
  }
  const file = path.slice(1);
  if (opts.scripts && SCRIPT_NAME.test(file) && !file.includes('..')) return scriptRequest(method, file, body, store);
  if (!FILE_NAME.test(file)) return json(400, { error: `bad ${noun} file name "${file}"` });
  switch (method) {
    case 'GET': {
      const text = store.read(file);
      return text === undefined ? json(404, { error: `no ${noun} ${file}` }) : { status: 200, body: text };
    }
    case 'PUT': {
      if (body.length > opts.maxBytes) return json(413, { error: `${noun} is too large` });
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        return json(400, { error: 'body is not JSON' });
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return json(400, { error: `a ${noun} must be a JSON object` });
      store.write(file, `${opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
      return json(200, { ok: true });
    }
    case 'DELETE': {
      if (store.read(file) === undefined) return json(404, { error: `no ${noun} ${file}` });
      store.remove(file);
      return json(200, { ok: true });
    }
    default:
      return json(405, { error: `method ${method} is not allowed` });
  }
}

/** Script files are stored as they are: plain text, no JSON. */
function scriptRequest(method: string, file: string, body: string, store: FileStore): ApiResponse {
  switch (method) {
    case 'GET': {
      const text = store.read(file);
      return text === undefined ? json(404, { error: `no script ${file}` }) : { status: 200, body: text };
    }
    case 'PUT':
      if (body.length > MAX_SCRIPT_BYTES) return json(413, { error: 'script is too large' });
      store.write(file, body);
      return json(200, { ok: true });
    case 'DELETE':
      if (store.read(file) === undefined) return json(404, { error: `no script ${file}` });
      store.remove(file);
      return json(200, { ok: true });
    default:
      return json(405, { error: `method ${method} is not allowed` });
  }
}
