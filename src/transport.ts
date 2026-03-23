import type { GoweValue, Schema, SessionOptions } from "./types.js";

export type TransportValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "i64"; v: string }
  | { t: "u64"; v: string }
  | { t: "f64"; v: number }
  | { t: "string"; v: string }
  | { t: "binary"; v: string }
  | { t: "array"; v: TransportValue[] }
  | { t: "map"; v: Array<[string, TransportValue]> };

type TransportInt = number | string;

interface TransportSchemaField {
  number: TransportInt;
  name: string;
  logicalType: string;
  required: boolean;
  defaultValue?: TransportValue;
  min?: TransportInt;
  max?: TransportInt;
  enumValues?: string[];
}

interface TransportSchema {
  schemaId: TransportInt;
  name: string;
  fields: TransportSchemaField[];
}

interface TransportSessionOptions {
  maxBaseSnapshots?: number;
  enableStatePatch?: boolean;
  enableTemplateBatch?: boolean;
  enableTrainedDictionary?: boolean;
  unknownReferencePolicy?: "failFast" | "statelessRetry";
}

const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

export function serializeValue(value: GoweValue): string {
  return JSON.stringify(toTransportValue(value));
}

export function deserializeValue(json: string): GoweValue {
  const parsed = JSON.parse(json) as TransportValue;
  return fromTransportValue(parsed);
}

export function serializeValues(values: GoweValue[]): string {
  const out = new Array<TransportValue>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    out[index] = toTransportValue(values[index]);
  }
  return JSON.stringify(out);
}

export function serializeSchema(schema: Schema): string {
  const fields = new Array<TransportSchemaField>(schema.fields.length);
  for (let index = 0; index < schema.fields.length; index += 1) {
    const field = schema.fields[index];
    const out: TransportSchemaField = {
      number: toTransportInteger(field.number, "field.number", true),
      name: field.name,
      logicalType: field.logicalType,
      required: field.required,
    };
    if (field.defaultValue !== undefined) {
      out.defaultValue = toTransportValue(field.defaultValue);
    }
    if (field.min !== undefined) {
      out.min = toTransportInteger(field.min, "field.min", false);
    }
    if (field.max !== undefined) {
      out.max = toTransportInteger(field.max, "field.max", false);
    }
    if (field.enumValues !== undefined) {
      out.enumValues = field.enumValues;
    }
    fields[index] = out;
  }

  const payload: TransportSchema = {
    schemaId: toTransportInteger(schema.schemaId, "schemaId", true),
    name: schema.name,
    fields,
  };
  return JSON.stringify(payload);
}

export function serializeSessionOptions(options: SessionOptions = {}): string {
  const payload: TransportSessionOptions = {};
  if (options.maxBaseSnapshots !== undefined) {
    if (
      !Number.isInteger(options.maxBaseSnapshots) ||
      options.maxBaseSnapshots < 0
    ) {
      throw new Error("maxBaseSnapshots must be a non-negative integer");
    }
    payload.maxBaseSnapshots = options.maxBaseSnapshots;
  }
  if (options.enableStatePatch !== undefined) {
    payload.enableStatePatch = options.enableStatePatch;
  }
  if (options.enableTemplateBatch !== undefined) {
    payload.enableTemplateBatch = options.enableTemplateBatch;
  }
  if (options.enableTrainedDictionary !== undefined) {
    payload.enableTrainedDictionary = options.enableTrainedDictionary;
  }
  if (options.unknownReferencePolicy !== undefined) {
    payload.unknownReferencePolicy = options.unknownReferencePolicy;
  }
  return JSON.stringify(payload);
}

export function toTransportValue(value: GoweValue): TransportValue {
  if (value === null) {
    return { t: "null" };
  }
  if (typeof value === "boolean") {
    return { t: "bool", v: value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("number values must be finite");
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          "unsafe integer number detected; use bigint for 64-bit integers",
        );
      }
      return value >= 0
        ? { t: "u64", v: String(value) }
        : { t: "i64", v: String(value) };
    }
    return { t: "f64", v: value };
  }
  if (typeof value === "bigint") {
    if (value >= 0n) {
      if (value > MAX_U64) {
        throw new Error("u64 overflow");
      }
      return { t: "u64", v: value.toString() };
    }
    if (value < MIN_I64 || value > MAX_I64) {
      throw new Error("i64 overflow");
    }
    return { t: "i64", v: value.toString() };
  }
  if (typeof value === "string") {
    return { t: "string", v: value };
  }
  if (value instanceof Uint8Array) {
    return { t: "binary", v: toBase64(value) };
  }
  if (Array.isArray(value)) {
    const length = value.length;
    const out = new Array<TransportValue>(length);
    for (let index = 0; index < length; index += 1) {
      out[index] = toTransportValue(value[index]);
    }
    return { t: "array", v: out };
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("unsupported value type");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("unsupported value type");
  }

  const entries: Array<[string, TransportValue]> = [];
  const objectValue = value as Record<string, GoweValue>;
  for (const key in objectValue) {
    entries.push([key, toTransportValue(objectValue[key])]);
  }
  return { t: "map", v: entries };
}

export function toTransportValues(values: GoweValue[]): TransportValue[] {
  const out = new Array<TransportValue>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    out[index] = toTransportValue(values[index]);
  }
  return out;
}

export function fromTransportValue(value: TransportValue): GoweValue {
  switch (value.t) {
    case "null":
      return null;
    case "bool":
      return value.v;
    case "i64":
      return BigInt(value.v);
    case "u64":
      return BigInt(value.v);
    case "f64":
      return value.v;
    case "string":
      return value.v;
    case "binary":
      return fromBase64(value.v);
    case "array": {
      const length = value.v.length;
      const out = new Array<GoweValue>(length);
      for (let index = 0; index < length; index += 1) {
        out[index] = fromTransportValue(value.v[index]);
      }
      return out;
    }
    case "map": {
      const out: Record<string, GoweValue> = {};
      const length = value.v.length;
      for (let index = 0; index < length; index += 1) {
        const entry = value.v[index];
        out[entry[0]] = fromTransportValue(entry[1]);
      }
      return out;
    }
    default:
      throw new Error("unknown transport value kind");
  }
}

function toTransportInteger(
  value: number | bigint,
  fieldName: string,
  unsigned: boolean,
): TransportInt {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error(`${fieldName} must be a safe integer number or bigint`);
    }
    if (unsigned && value < 0) {
      throw new Error(`${fieldName} must be unsigned`);
    }
    return value;
  }
  if (unsigned) {
    if (value < 0n || value > MAX_U64) {
      throw new Error(`${fieldName} must fit u64`);
    }
    return value.toString();
  }
  if (value < MIN_I64 || value > MAX_I64) {
    throw new Error(`${fieldName} must fit i64`);
  }
  return value.toString();
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("base64");
  }
  if (typeof btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }
  throw new Error("base64 encoding is not available in this runtime");
}

function fromBase64(encoded: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64");
  }
  if (typeof atob === "function") {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  throw new Error("base64 decoding is not available in this runtime");
}

// ── Compact transport format ────────────────────────────────────────────────
//
// Tags: 0=null, 1=bool, 2=i64, 3=u64, 4=f64, 5=string, 6=binary, 7=array, 8=map
// Format: [tag] for null, [tag, value] for everything else.
// Map value is a flat array: [key1, val1, key2, val2, ...]
// This produces ~50% shorter JSON than the object-based transport format.

type CompactValue = readonly [number] | readonly [number, unknown];

export function serializeCompact(value: GoweValue): string {
  return JSON.stringify(toCompactValue(value));
}

export function deserializeCompact(json: string): GoweValue {
  const parsed = JSON.parse(json) as CompactValue;
  return fromCompactValue(parsed);
}

export function serializeCompactBatch(values: GoweValue[]): string {
  const out = new Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    out[index] = toCompactValue(values[index]);
  }
  return JSON.stringify(out);
}

function toCompactValue(value: GoweValue): CompactValue {
  if (value === null) {
    return [0];
  }
  if (typeof value === "boolean") {
    return [1, value];
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("number values must be finite");
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          "unsafe integer number detected; use bigint for 64-bit integers",
        );
      }
      return value >= 0 ? [3, String(value)] : [2, String(value)];
    }
    return [4, value];
  }
  if (typeof value === "bigint") {
    if (value >= 0n) {
      if (value > MAX_U64) {
        throw new Error("u64 overflow");
      }
      return [3, value.toString()];
    }
    if (value < MIN_I64 || value > MAX_I64) {
      throw new Error("i64 overflow");
    }
    return [2, value.toString()];
  }
  if (typeof value === "string") {
    return [5, value];
  }
  if (value instanceof Uint8Array) {
    return [6, toBase64(value)];
  }
  if (Array.isArray(value)) {
    const length = value.length;
    const out = new Array(length);
    for (let index = 0; index < length; index += 1) {
      out[index] = toCompactValue(value[index]);
    }
    return [7, out];
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("unsupported value type");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("unsupported value type");
  }

  // Map: flat array [key1, val1, key2, val2, ...]
  const objectValue = value as Record<string, GoweValue>;
  const keys = Object.keys(objectValue);
  const flat = new Array(keys.length * 2);
  for (let index = 0; index < keys.length; index += 1) {
    flat[index * 2] = keys[index];
    flat[index * 2 + 1] = toCompactValue(objectValue[keys[index]]);
  }
  return [8, flat];
}

function fromCompactValue(cv: CompactValue): GoweValue {
  const tag = cv[0] as number;
  switch (tag) {
    case 0: // null
      return null;
    case 1: // bool
      return (cv as readonly [number, boolean])[1];
    case 2: // i64
      return BigInt((cv as readonly [number, string])[1]);
    case 3: // u64
      return BigInt((cv as readonly [number, string])[1]);
    case 4: // f64
      return (cv as readonly [number, number])[1];
    case 5: // string
      return (cv as readonly [number, string])[1];
    case 6: // binary
      return fromBase64((cv as readonly [number, string])[1]);
    case 7: {
      // array
      const items = (cv as readonly [number, CompactValue[]])[1];
      const length = items.length;
      const out = new Array<GoweValue>(length);
      for (let index = 0; index < length; index += 1) {
        out[index] = fromCompactValue(items[index]);
      }
      return out;
    }
    case 8: {
      // map: flat array [key1, val1, key2, val2, ...]
      const flat = (cv as readonly [number, unknown[]])[1];
      const out: Record<string, GoweValue> = {};
      const length = flat.length;
      for (let index = 0; index < length; index += 2) {
        out[flat[index] as string] = fromCompactValue(
          flat[index + 1] as CompactValue,
        );
      }
      return out;
    }
    default:
      throw new Error(`unknown compact tag: ${tag}`);
  }
}
