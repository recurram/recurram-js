import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { RuntimeBackend, RuntimeSessionEncoder } from "./types.js";

interface NativeSessionEncoder {
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

interface NativeModule {
  encodeTransportJson(valueJson: string): Uint8Array;
  decodeToTransportJson(bytes: Uint8Array): string;
  encodeWithSchemaTransportJson(
    schemaJson: string,
    valueJson: string,
  ): Uint8Array;
  encodeBatchTransportJson(valuesJson: string): Uint8Array;
  createSessionEncoder(optionsJson?: string): NativeSessionEncoder;
}

export function loadNodeBackend(): RuntimeBackend {
  const require = createRequire(import.meta.url);
  const modulePath = fileURLToPath(
    new URL("../../native/gowe_napi.node", import.meta.url),
  );
  const native = require(modulePath) as NativeModule;
  return {
    kind: "napi",
    encodeTransportJson: (valueJson) =>
      asUint8Array(native.encodeTransportJson(valueJson)),
    decodeToTransportJson: (bytes) => native.decodeToTransportJson(bytes),
    encodeWithSchemaTransportJson: (schemaJson, valueJson) =>
      asUint8Array(native.encodeWithSchemaTransportJson(schemaJson, valueJson)),
    encodeBatchTransportJson: (valuesJson) =>
      asUint8Array(native.encodeBatchTransportJson(valuesJson)),
    createSessionEncoder: (optionsJson) => {
      const inner = native.createSessionEncoder(optionsJson);
      return wrapSessionEncoder(inner);
    },
  };
}

function wrapSessionEncoder(
  inner: NativeSessionEncoder,
): RuntimeSessionEncoder {
  return {
    encodeTransportJson: (valueJson) =>
      asUint8Array(inner.encodeTransportJson(valueJson)),
    encodeWithSchemaTransportJson: (schemaJson, valueJson) =>
      asUint8Array(inner.encodeWithSchemaTransportJson(schemaJson, valueJson)),
    encodeBatchTransportJson: (valuesJson) =>
      asUint8Array(inner.encodeBatchTransportJson(valuesJson)),
    encodePatchTransportJson: (valueJson) =>
      asUint8Array(inner.encodePatchTransportJson(valueJson)),
    encodeMicroBatchTransportJson: (valuesJson) =>
      asUint8Array(inner.encodeMicroBatchTransportJson(valuesJson)),
    reset: () => inner.reset(),
  };
}

function asUint8Array(value: Uint8Array): Uint8Array {
  return value;
}
