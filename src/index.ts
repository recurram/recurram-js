import { initBackend, requireBackend } from "./backend.js";
import { encodeFast, tryDecodeFast } from "./fast-codec.js";
import {
  deserializeCompact,
  serializeCompact,
  serializeCompactBatch,
  serializeSessionOptions,
  serializeValue,
} from "./transport.js";
import type { InitOptions, RecurramValue, SessionOptions } from "./types.js";
import type { RuntimeKind, RuntimeSessionEncoder } from "./runtime/types.js";

export type {
  InitOptions,
  RecurramValue,
  Schema,
  SchemaField,
  SessionOptions,
  UnknownReferencePolicy,
} from "./types.js";

type EncodeImpl = (value: RecurramValue) => Uint8Array;
type DecodeImpl = (bytes: Uint8Array) => RecurramValue;

let encodeImpl: EncodeImpl | null = null;
let decodeImpl: DecodeImpl | null = null;

export async function init(options: InitOptions = {}): Promise<RuntimeKind> {
  const kind = await initBackend(options);
  encodeImpl = null;
  decodeImpl = null;
  return kind;
}

export function encode(value: RecurramValue): Uint8Array {
  if (!encodeImpl) {
    requireBackend();
    encodeImpl = (input) => encodeFast(input);
  }
  return encodeImpl(value);
}

export function decode(bytes: Uint8Array): RecurramValue {
  if (!decodeImpl) {
    const backend = requireBackend();
    if (backend.decodeNative) {
      decodeImpl = (input) => backend.decodeNative!(input) as RecurramValue;
    } else {
      decodeImpl = (input) => {
        const decoded = tryDecodeFast(input);
        if (decoded !== undefined) {
          return decoded;
        }
        return deserializeCompact(backend.decodeToCompactJson(input));
      };
    }
  }
  return decodeImpl(bytes);
}

export function createSessionEncoder(
  options: SessionOptions = {},
): SessionEncoder {
  const raw = requireBackend().createSessionEncoder(
    serializeSessionOptions(options),
  );
  return new SessionEncoder(raw);
}

export class SessionEncoder {
  readonly #inner: RuntimeSessionEncoder;

  constructor(inner: RuntimeSessionEncoder) {
    this.#inner = inner;
  }

  encode(value: RecurramValue): Uint8Array {
    return this.#inner.encodeCompactJson(serializeCompact(value));
  }

  encodeBatch(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeBatchCompactJson(serializeCompactBatch(values));
  }

  encodePatch(value: RecurramValue): Uint8Array {
    return this.#inner.encodePatchTransportJson(serializeValue(value));
  }

  encodeMicroBatch(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeMicroBatchCompactJson(
      serializeCompactBatch(values),
    );
  }

  reset(): void {
    this.#inner.reset();
  }
}
