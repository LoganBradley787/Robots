/** Client for the dev server's blueprint file API (see vite-plugins/blueprintStore.ts). */

export interface BlueprintListing {
  file: string;
  name: string;
}

const BASE = '/api/blueprints';

/** A safe file stem from a display name: lowercase, dashes, letters and digits only. */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s === '' ? 'blueprint' : s;
}

export function fileForName(name: string): string {
  return `${slug(name)}.json`;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(msg);
  }
  return res;
}

export async function listBlueprints(): Promise<BlueprintListing[]> {
  return (await (await check(await fetch(BASE))).json()) as BlueprintListing[];
}

export async function loadBlueprintFile(file: string): Promise<unknown> {
  return (await check(await fetch(`${BASE}/${file}`))).json();
}

export async function saveBlueprintFile(file: string, json: unknown): Promise<void> {
  await check(await fetch(`${BASE}/${file}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }));
}

export async function deleteBlueprintFile(file: string): Promise<void> {
  await check(await fetch(`${BASE}/${file}`, { method: 'DELETE' }));
}

/** Writes a replay into the repo's `replays/` folder. */
export async function saveReplayFile(file: string, json: unknown): Promise<void> {
  await check(await fetch(`/api/replays/${file}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }));
}

/** `2026-09-23-1512-car.json`: sortable by time, named after the robot you were controlling. */
export function replayFileName(now: Date, robot: string | undefined): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${slug(robot ?? 'world')}.json`;
}
