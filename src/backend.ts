import type { InitOptions } from "./types.js";
import type { RuntimeBackend, RuntimeKind } from "./runtime/types.js";

let backend: RuntimeBackend | null = null;
let initPromise: Promise<RuntimeBackend> | null = null;

export async function initBackend(
  options: InitOptions = {},
): Promise<RuntimeKind> {
  if (backend) {
    return backend.kind;
  }
  if (!initPromise) {
    initPromise = loadBackend(options).catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  backend = await initPromise;
  return backend.kind;
}

export function requireBackend(): RuntimeBackend {
  if (!backend) {
    throw new Error(
      "recurram is not initialized. Call await init() before encode/decode.",
    );
  }
  return backend;
}

async function loadBackend(options: InitOptions): Promise<RuntimeBackend> {
  const prefer = options.prefer;
  if (prefer === "napi") {
    if (!isNodeRuntime()) {
      throw new Error("N-API backend is only available in Node.js");
    }
    const { loadNodeBackend } = await import("./runtime/node-backend.js");
    return loadNodeBackend();
  }
  if (prefer === "wasm") {
    if (isNodeRuntime()) {
      throw new Error(
        "WASM backend is intended for browser JS. Use prefer: 'napi' on Node.js",
      );
    }
    const { loadWasmBackend } = await import("./runtime/wasm-backend.js");
    return loadWasmBackend(options.wasmInput);
  }

  if (isNodeRuntime()) {
    const { loadNodeBackend } = await import("./runtime/node-backend.js");
    return loadNodeBackend();
  }
  const { loadWasmBackend } = await import("./runtime/wasm-backend.js");
  return loadWasmBackend(options.wasmInput);
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}
