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

/** What the list says of one file: its name (the file stem when it has none) and, M16, its kind when it has one. */
function listingOf(file: string, text: string | undefined): { file: string; name: string; kind?: string } {
  const out: { file: string; name: string; kind?: string } = { file, name: file.slice(0, -'.json'.length) };
  try {
    const v: unknown = JSON.parse(text ?? '');
    if (typeof v === 'object' && v !== null) {
      const o = v as { name?: unknown; kind?: unknown };
      if (typeof o.name === 'string') out.name = o.name;
      if (typeof o.kind === 'string' && o.kind !== '') out.kind = o.kind;
    }
  } catch {
    // keep the file stem
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A blueprint file's text with its top-level `kind` set (or taken out, for undefined), touching only that one line so
 * a hand-laid-out grid stays as it was written (M16). Falls back to rewriting the whole file, indented, when the text
 * is not laid out one field a line. Undefined when the text is not a JSON object.
 */
export function setKindInText(text: string, kind: string | undefined): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { kind: _old, ...rest } = value as Record<string, unknown>;
  const want: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    want[k] = v;
    if (k === 'name' && kind !== undefined) want.kind = kind;
  }
  if (kind !== undefined && !('kind' in want)) want.kind = kind;
  // The same blueprint with only its kind changed, wherever in the file the kind line sits.
  const same = (t: string): boolean => {
    try {
      const { kind: k, ...others } = JSON.parse(t) as Record<string, unknown>;
      return k === kind && JSON.stringify(others) === JSON.stringify(rest);
    } catch {
      return false;
    }
  };
  // Top-level fields share the indent of the first field.
  const indent = /^\{\s*?\n([ \t]*)"/.exec(text)?.[1];
  if (indent !== undefined) {
    const str = '"(?:[^"\\\\]|\\\\.)*"';
    const line = new RegExp(`^${escapeRe(indent)}"kind":[ \\t]*${str},[ \\t]*\\r?\\n`, 'm');
    const name = new RegExp(`^${escapeRe(indent)}"name":[ \\t]*${str},[ \\t]*\\r?\\n`, 'm');
    const written = kind === undefined ? '' : `${indent}"kind": ${JSON.stringify(kind)},\n`;
    const edited = line.test(text) ? text.replace(line, () => written) : kind === undefined ? text : text.replace(name, (m) => `${m}${written}`);
    if (same(edited)) return edited;
  }
  return `${JSON.stringify(want, null, 2)}\n`;
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
      .map((file) => listingOf(file, store.read(file)))
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
    case 'PATCH': {
      // M16: `{ "kind": "enemy" }` sets the file's kind, `{ "kind": null }` clears it. Nothing else can be patched.
      const text = store.read(file);
      if (text === undefined) return json(404, { error: `no ${noun} ${file}` });
      let patch: unknown;
      try {
        patch = JSON.parse(body);
      } catch {
        return json(400, { error: 'body is not JSON' });
      }
      const kind = typeof patch === 'object' && patch !== null ? (patch as { kind?: unknown }).kind : undefined;
      if (kind !== null && (typeof kind !== 'string' || kind.trim() === '' || kind.length > 40)) return json(400, { error: 'a patch is { "kind": "a word" } or { "kind": null }' });
      const next = setKindInText(text, kind === null ? undefined : kind.trim());
      if (next === undefined) return json(400, { error: `${file} is not a readable ${noun}` });
      if (next !== text) store.write(file, next);
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

/** A shelf file: `hover.js`, `aim-and-fire.js`. */
const SHELF_NAME = /^[a-z0-9][a-z0-9-]*\.js$/;

/**
 * The shelf of shared behaviors (M16): the repo's `behaviors/` folder, read only. `/` lists every behavior file with
 * its text (there are few, and the builder wants them all at once), sorted by file name; `/<file>.js` is one file's
 * text. Nothing can be written through here: the shelf is edited as files, and a robot gets its own copy.
 */
export function handleShelfRequest(method: string, url: string, store: Pick<FileStore, 'list' | 'read'>): ApiResponse {
  if (method !== 'GET') return json(405, { error: 'the shelf is read only' });
  const path = url.split('?')[0] ?? '/';
  if (path === '/' || path === '') {
    const files = store
      .list()
      .filter((f) => SHELF_NAME.test(f))
      .sort();
    return json(200, files.flatMap((file) => {
      const text = store.read(file);
      return text === undefined ? [] : [{ file, text }];
    }));
  }
  const file = path.slice(1);
  if (!SHELF_NAME.test(file)) return json(400, { error: `bad behavior file name "${file}"` });
  const text = store.read(file);
  return text === undefined ? json(404, { error: `no behavior ${file}` }) : { status: 200, body: text };
}
