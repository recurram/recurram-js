import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type {
  RuntimeBackend,
  RuntimeSessionEncoder,
  TransportValueObj,
} from "./types.js";

interface NativeSessionEncoder {
  encodeTransportJson(valueJson: string): Uint8Array;
  encodeWithSchemaTransportJson(
    schemaJson: string,
    valueJson: string,
  ): Uint8Array;
  encodeBatchTransportJson(valuesJson: string): Uint8Array;
  encodePatchTransportJson(valueJson: string): Uint8Array;
  encodeMicroBatchTransportJson(valuesJson: string): Uint8Array;
  encodeDirect(value: TransportValueObj): Uint8Array;
  encodeBatchDirect(values: TransportValueObj[]): Uint8Array;
  encodePatchDirect(value: TransportValueObj): Uint8Array;
  encodeMicroBatchDirect(values: TransportValueObj[]): Uint8Array;
  encodeCompactJson(json: string): Uint8Array;
  encodeBatchCompactJson(json: string): Uint8Array;
  encodePatchCompactJson(json: string): Uint8Array;
  encodeMicroBatchCompactJson(json: string): Uint8Array;
  reset(): void;
}

interface NativeModule {
  encodeTransportJson(valueJson: string): Uint8Array;
  decodeToTransportJson(bytes: Uint8Array): string;
  decodeToCompactJson(bytes: Uint8Array): string;
  encodeWithSchemaTransportJson(
    schemaJson: string,
    valueJson: string,
  ): Uint8Array;
  encodeBatchTransportJson(valuesJson: string): Uint8Array;
  encodeDirect(value: TransportValueObj): Uint8Array;
  decodeDirect(bytes: Uint8Array): TransportValueObj;
  encodeBatchDirect(values: TransportValueObj[]): Uint8Array;
  encodeCompactJson(json: string): Uint8Array;
  encodeBatchCompactJson(json: string): Uint8Array;
  createSessionEncoder(optionsJson?: string): NativeSessionEncoder;
}

export function loadNodeBackend(): RuntimeBackend {
  const require = createRequire(import.meta.url);
  const modulePath = fileURLToPath(
    new URL("../../native/recurram_napi.node", import.meta.url),
  );
  const native = require(modulePath) as NativeModule;
  return {
    kind: "napi",
    encodeTransportJson: (valueJson) =>
      asUint8Array(native.encodeTransportJson(valueJson)),
    decodeToTransportJson: (bytes) => native.decodeToTransportJson(bytes),
    decodeToCompactJson: (bytes) => native.decodeToCompactJson(bytes),
    encodeWithSchemaTransportJson: (schemaJson, valueJson) =>
      asUint8Array(native.encodeWithSchemaTransportJson(schemaJson, valueJson)),
    encodeBatchTransportJson: (valuesJson) =>
      asUint8Array(native.encodeBatchTransportJson(valuesJson)),
    encodeDirect: (value) => asUint8Array(native.encodeDirect(value)),
    decodeDirect: (bytes) => native.decodeDirect(bytes),
    encodeBatchDirect: (values) =>
      asUint8Array(native.encodeBatchDirect(values)),
    encodeCompactJson: (json) => asUint8Array(native.encodeCompactJson(json)),
    encodeBatchCompactJson: (json) =>
      asUint8Array(native.encodeBatchCompactJson(json)),
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
    encodeDirect: (value) => asUint8Array(inner.encodeDirect(value)),
    encodeBatchDirect: (values) =>
      asUint8Array(inner.encodeBatchDirect(values)),
    encodePatchDirect: (value) => asUint8Array(inner.encodePatchDirect(value)),
    encodeMicroBatchDirect: (values) =>
      asUint8Array(inner.encodeMicroBatchDirect(values)),
    encodeCompactJson: (json) => asUint8Array(inner.encodeCompactJson(json)),
    encodeBatchCompactJson: (json) =>
      asUint8Array(inner.encodeBatchCompactJson(json)),
    encodePatchCompactJson: (json) =>
      asUint8Array(inner.encodePatchCompactJson(json)),
    encodeMicroBatchCompactJson: (json) =>
      asUint8Array(inner.encodeMicroBatchCompactJson(json)),
    reset: () => inner.reset(),
  };
}

function asUint8Array(value: Uint8Array): Uint8Array {
  return value;
}
