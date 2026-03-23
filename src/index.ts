import { initBackend, requireBackend } from "./backend.js";
import {
  deserializeValue,
  serializeSchema,
  serializeSessionOptions,
  serializeValue,
  serializeValues,
} from "./transport.js";
import type {
  InitOptions,
  GoweValue,
  Schema,
  SessionOptions,
} from "./types.js";
import type { RuntimeKind, RuntimeSessionEncoder } from "./runtime/types.js";

export type {
  InitOptions,
  GoweValue,
  Schema,
  SchemaField,
  SessionOptions,
  UnknownReferencePolicy,
} from "./types.js";

export async function init(options: InitOptions = {}): Promise<RuntimeKind> {
  return initBackend(options);
}

export function toTransportJson(value: GoweValue): string {
  return serializeValue(value);
}

export function fromTransportJson(valueJson: string): GoweValue {
  return deserializeValue(valueJson);
}

export function toTransportJsonBatch(values: GoweValue[]): string {
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

export function encode(value: GoweValue): Uint8Array {
  return requireBackend().encodeTransportJson(serializeValue(value));
}

export function decode(bytes: Uint8Array): GoweValue {
  return deserializeValue(requireBackend().decodeToTransportJson(bytes));
}

export function encodeWithSchema(schema: Schema, value: GoweValue): Uint8Array {
  return requireBackend().encodeWithSchemaTransportJson(
    serializeSchema(schema),
    serializeValue(value),
  );
}

export function encodeBatch(values: GoweValue[]): Uint8Array {
  return requireBackend().encodeBatchTransportJson(serializeValues(values));
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

  encode(value: GoweValue): Uint8Array {
    return this.#inner.encodeTransportJson(serializeValue(value));
  }

  encodeTransportJson(valueJson: string): Uint8Array {
    return this.#inner.encodeTransportJson(valueJson);
  }

  encodeWithSchema(schema: Schema, value: GoweValue): Uint8Array {
    return this.#inner.encodeWithSchemaTransportJson(
      serializeSchema(schema),
      serializeValue(value),
    );
  }

  encodeBatch(values: GoweValue[]): Uint8Array {
    return this.#inner.encodeBatchTransportJson(serializeValues(values));
  }

  encodeBatchTransportJson(valuesJson: string): Uint8Array {
    return this.#inner.encodeBatchTransportJson(valuesJson);
  }

  encodePatch(value: GoweValue): Uint8Array {
    return this.#inner.encodePatchTransportJson(serializeValue(value));
  }

  encodePatchTransportJson(valueJson: string): Uint8Array {
    return this.#inner.encodePatchTransportJson(valueJson);
  }

  encodeMicroBatch(values: GoweValue[]): Uint8Array {
    return this.#inner.encodeMicroBatchTransportJson(serializeValues(values));
  }

  encodeMicroBatchTransportJson(valuesJson: string): Uint8Array {
    return this.#inner.encodeMicroBatchTransportJson(valuesJson);
  }

  reset(): void {
    this.#inner.reset();
  }
}
