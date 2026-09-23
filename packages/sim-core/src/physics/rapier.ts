import * as RAPIER from '@dimforge/rapier2d-deterministic-compat';

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM exactly once. Every entry point awaits this before constructing a PhysicsWorld. */
export function loadRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init().then(() => undefined);
  return ready;
}

export function rapierVersion(): string {
  return RAPIER.version();
}
