import type {
  RuntimeBackend,
  RuntimeSessionEncoder,
  TransportValueObj,
} from "./types.js";

interface WasmSessionEncoder {
  encodeTransportJson(valueJson: string): Uint8Array;
  encodeWithSchemaTransportJson(
    schemaJson: string,
    valueJson: string,
  ): Uint8Array;
  encodeBatchTransportJson(valuesJson: string): Uint8Array;
  encodePatchTransportJson(valueJson: string): Uint8Array;
  encodeMicroBatchTransportJson(valuesJson: string): Uint8Array;
  reset(): void;
}

interface WasmModule {
  default: (input?: unknown) => Promise<unknown>;
  encodeTransportJson(valueJson: string): Uint8Array;
  decodeToTransportJson(bytes: Uint8Array): string;
  encodeWithSchemaTransportJson(
    schemaJson: string,
    valueJson: string,
  ): Uint8Array;
  encodeBatchTransportJson(valuesJson: string): Uint8Array;
  createSessionEncoder(optionsJson?: string): WasmSessionEncoder;
}

export async function loadWasmBackend(
  wasmInput?: unknown,
): Promise<RuntimeBackend> {
  const moduleUrl = new URL("../../wasm/pkg/recurram_wasm.js", import.meta.url);
  const wasm = (await import(moduleUrl.href)) as WasmModule;
  // bundler target auto-initializes via static WASM import; web/deno targets
  // expose an explicit async default init function that must be called.
  if (typeof wasm.default === "function") {
    await wasm.default(wasmInput);
  }
  return {
    kind: "wasm",
    encodeTransportJson: (valueJson) => wasm.encodeTransportJson(valueJson),
    decodeToTransportJson: (bytes) => wasm.decodeToTransportJson(bytes),
    decodeToCompactJson: (bytes) => wasm.decodeToTransportJson(bytes), // WASM fallback
    encodeWithSchemaTransportJson: (schemaJson, valueJson) =>
      wasm.encodeWithSchemaTransportJson(schemaJson, valueJson),
    encodeBatchTransportJson: (valuesJson) =>
      wasm.encodeBatchTransportJson(valuesJson),
    // WASM fallback: serialize to JSON then use JSON API
    encodeDirect: (value) => wasm.encodeTransportJson(JSON.stringify(value)),
    decodeDirect: (bytes) =>
      JSON.parse(wasm.decodeToTransportJson(bytes)) as TransportValueObj,
    encodeBatchDirect: (values) =>
      wasm.encodeBatchTransportJson(JSON.stringify(values)),
    // WASM fallback: compact not available, fall through to transport JSON
    encodeCompactJson: (json) => wasm.encodeTransportJson(json),
    encodeBatchCompactJson: (json) => wasm.encodeBatchTransportJson(json),
    createSessionEncoder: (optionsJson) => {
      const inner = wasm.createSessionEncoder(optionsJson);
      return wrapSessionEncoder(inner);
    },
  };
}

function wrapSessionEncoder(inner: WasmSessionEncoder): RuntimeSessionEncoder {
  return {
    encodeTransportJson: (valueJson) => inner.encodeTransportJson(valueJson),
    encodeWithSchemaTransportJson: (schemaJson, valueJson) =>
      inner.encodeWithSchemaTransportJson(schemaJson, valueJson),
    encodeBatchTransportJson: (valuesJson) =>
      inner.encodeBatchTransportJson(valuesJson),
    encodePatchTransportJson: (valueJson) =>
      inner.encodePatchTransportJson(valueJson),
    encodeMicroBatchTransportJson: (valuesJson) =>
      inner.encodeMicroBatchTransportJson(valuesJson),
    // WASM fallback: serialize to JSON then use JSON API
    encodeDirect: (value) => inner.encodeTransportJson(JSON.stringify(value)),
    encodeBatchDirect: (values) =>
      inner.encodeBatchTransportJson(JSON.stringify(values)),
    encodePatchDirect: (value) =>
      inner.encodePatchTransportJson(JSON.stringify(value)),
    encodeMicroBatchDirect: (values) =>
      inner.encodeMicroBatchTransportJson(JSON.stringify(values)),
    // WASM fallback: compact not available, fall through to transport JSON
    encodeCompactJson: (json) => inner.encodeTransportJson(json),
    encodeBatchCompactJson: (json) => inner.encodeBatchTransportJson(json),
    encodePatchCompactJson: (json) => inner.encodePatchTransportJson(json),
    encodeMicroBatchCompactJson: (json) =>
      inner.encodeMicroBatchTransportJson(json),
    reset: () => inner.reset(),
  };
}
