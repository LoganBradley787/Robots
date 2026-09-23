import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost, type ScriptHost } from '@robots/sim-core';

let host: Promise<ScriptHost> | undefined;

/** The Node build of the script sandbox, loaded once per process (`08`: same engine as the browser build). */
export function scriptHost(): Promise<ScriptHost> {
  host ??= createQuickJsHost(variant);
  return host;
}
