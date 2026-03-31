import { initBackend, requireBackend } from "./backend.js";
import { encodeFast, tryDecodeFast } from "./fast-codec.js";
import {
  deserializeCompact,
  deserializeValue,
  fromTransportValue,
  serializeCompact,
  serializeCompactBatch,
  serializeSchema,
  serializeSessionOptions,
  serializeValue,
  serializeValues,
  toTransportValue,
  toTransportValues,
} from "./transport.js";
import type { TransportValue } from "./transport.js";
import type {
  InitOptions,
  RecurramValue,
  Schema,
  SessionOptions,
} from "./types.js";
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
type EncodeBatchImpl = (values: RecurramValue[]) => Uint8Array;

let encodeImpl: EncodeImpl | null = null;
let decodeImpl: DecodeImpl | null = null;
let encodeBatchImpl: EncodeBatchImpl | null = null;

export async function init(options: InitOptions = {}): Promise<RuntimeKind> {
  const kind = await initBackend(options);
  encodeImpl = null;
  decodeImpl = null;
  encodeBatchImpl = null;
  return kind;
}

export function encode(value: RecurramValue): Uint8Array {
  if (!encodeImpl) {
    requireBackend();
    encodeImpl = (input) => encodeFast(input);
  }
  return encodeImpl(value);
}

export function encodeBatch(values: RecurramValue[]): Uint8Array {
  if (!encodeBatchImpl) {
    const backend = requireBackend();
    encodeBatchImpl = (input) =>
      backend.encodeBatchCompactJson(serializeCompactBatch(input));
  }
  return encodeBatchImpl(values);
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

export function toTransportJson(value: RecurramValue): string {
  return serializeValue(value);
}

export function fromTransportJson(valueJson: string): RecurramValue {
  return deserializeValue(valueJson);
}

export function toTransportJsonBatch(values: RecurramValue[]): string {
  return serializeValues(values);
}

export function encodeTransportJson(valueJson: string): Uint8Array {
  return requireBackend().encodeTransportJson(valueJson);
}

export function decodeToTransportJson(bytes: Uint8Array): string {
  return requireBackend().decodeToTransportJson(bytes);
}

export function encodeBatchTransportJson(valuesJson: string): Uint8Array {
  return requireBackend().encodeBatchTransportJson(valuesJson);
}

export function encodeWithSchema(
  schema: Schema,
  value: RecurramValue,
): Uint8Array {
  return requireBackend().encodeWithSchemaTransportJson(
    serializeSchema(schema),
    serializeValue(value),
  );
}

export function encodeDirect(value: RecurramValue): Uint8Array {
  return requireBackend().encodeDirect(
    toTransportValue(
      value,
    ) as unknown as import("./runtime/types.js").TransportValueObj,
  );
}

export function decodeDirect(bytes: Uint8Array): RecurramValue {
  const transport = requireBackend().decodeDirect(bytes);
  return fromTransportValue(transport as unknown as TransportValue);
}

export function encodeBatchDirect(values: RecurramValue[]): Uint8Array {
  return requireBackend().encodeBatchDirect(
    toTransportValues(
      values,
    ) as unknown as import("./runtime/types.js").TransportValueObj[],
  );
}

export function toCompactJson(value: RecurramValue): string {
  return serializeCompact(value);
}

export function toCompactJsonBatch(values: RecurramValue[]): string {
  return serializeCompactBatch(values);
}

export function encodeCompactJson(json: string): Uint8Array {
  return requireBackend().encodeCompactJson(json);
}

export function decodeToCompactJson(bytes: Uint8Array): string {
  return requireBackend().decodeToCompactJson(bytes);
}

export function encodeBatchCompactJson(json: string): Uint8Array {
  return requireBackend().encodeBatchCompactJson(json);
}

export function encodeCompact(value: RecurramValue): Uint8Array {
  return requireBackend().encodeCompactJson(serializeCompact(value));
}

export function encodeBatchCompact(values: RecurramValue[]): Uint8Array {
  return requireBackend().encodeBatchCompactJson(serializeCompactBatch(values));
}

export function createSessionEncoder(
  options: SessionOptions = {},
): AdvancedSessionEncoder {
  const raw = requireBackend().createSessionEncoder(
    serializeSessionOptions(options),
  );
  return new AdvancedSessionEncoder(raw);
}

export class AdvancedSessionEncoder {
  readonly #inner: RuntimeSessionEncoder;

  constructor(inner: RuntimeSessionEncoder) {
    this.#inner = inner;
  }

  encode(value: RecurramValue): Uint8Array {
    return this.#inner.encodeCompactJson(serializeCompact(value));
  }

  encodeTransportJson(valueJson: string): Uint8Array {
    return this.#inner.encodeTransportJson(valueJson);
  }

  encodeWithSchema(schema: Schema, value: RecurramValue): Uint8Array {
    return this.#inner.encodeWithSchemaTransportJson(
      serializeSchema(schema),
      serializeValue(value),
    );
  }

  encodeBatch(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeBatchCompactJson(serializeCompactBatch(values));
  }

  encodeBatchTransportJson(valuesJson: string): Uint8Array {
    return this.#inner.encodeBatchTransportJson(valuesJson);
  }

  encodePatch(value: RecurramValue): Uint8Array {
    return this.#inner.encodePatchTransportJson(serializeValue(value));
  }

  encodePatchTransportJson(valueJson: string): Uint8Array {
    return this.#inner.encodePatchTransportJson(valueJson);
  }

  encodeMicroBatch(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeMicroBatchCompactJson(
      serializeCompactBatch(values),
    );
  }

  encodeMicroBatchTransportJson(valuesJson: string): Uint8Array {
    return this.#inner.encodeMicroBatchTransportJson(valuesJson);
  }

  encodeDirect(value: RecurramValue): Uint8Array {
    return this.#inner.encodeDirect(
      toTransportValue(
        value,
      ) as unknown as import("./runtime/types.js").TransportValueObj,
    );
  }

  encodeBatchDirect(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeBatchDirect(
      toTransportValues(
        values,
      ) as unknown as import("./runtime/types.js").TransportValueObj[],
    );
  }

  encodePatchDirect(value: RecurramValue): Uint8Array {
    return this.#inner.encodePatchDirect(
      toTransportValue(
        value,
      ) as unknown as import("./runtime/types.js").TransportValueObj,
    );
  }

  encodeMicroBatchDirect(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeMicroBatchDirect(
      toTransportValues(
        values,
      ) as unknown as import("./runtime/types.js").TransportValueObj[],
    );
  }

  encodeCompact(value: RecurramValue): Uint8Array {
    return this.#inner.encodeCompactJson(serializeCompact(value));
  }

  encodeCompactJson(json: string): Uint8Array {
    return this.#inner.encodeCompactJson(json);
  }

  encodeBatchCompact(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeBatchCompactJson(serializeCompactBatch(values));
  }

  encodeBatchCompactJson(json: string): Uint8Array {
    return this.#inner.encodeBatchCompactJson(json);
  }

  encodePatchCompact(value: RecurramValue): Uint8Array {
    return this.#inner.encodePatchCompactJson(serializeCompact(value));
  }

  encodePatchCompactJson(json: string): Uint8Array {
    return this.#inner.encodePatchCompactJson(json);
  }

  encodeMicroBatchCompact(values: RecurramValue[]): Uint8Array {
    return this.#inner.encodeMicroBatchCompactJson(
      serializeCompactBatch(values),
    );
  }

  encodeMicroBatchCompactJson(json: string): Uint8Array {
    return this.#inner.encodeMicroBatchCompactJson(json);
  }

  reset(): void {
    this.#inner.reset();
  }
}
