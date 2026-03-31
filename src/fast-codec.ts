import type { RecurramValue } from "./types.js";

const MESSAGE_SCALAR = 0x00;
const MESSAGE_ARRAY = 0x01;
const MESSAGE_MAP = 0x02;

const KEY_LITERAL = 0;

const TAG_NULL = 0;
const TAG_BOOL_FALSE = 1;
const TAG_BOOL_TRUE = 2;
const TAG_I64 = 3;
const TAG_U64 = 4;
const TAG_F64 = 5;
const TAG_STRING = 6;
const TAG_BINARY = 7;
const TAG_ARRAY = 8;
const TAG_MAP = 9;

const STRING_EMPTY = 0;
const STRING_LITERAL = 1;

const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

const ENCODE_CACHE_LIMIT = 4096;
const DECODE_FAIL = Symbol("decode_fail");

type DecodeValue = RecurramValue | typeof DECODE_FAIL;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const mapKeyUtf8Cache = new Map<string, Uint8Array>();
const stringUtf8Cache = new Map<string, Uint8Array>();

export function encodeFast(value: RecurramValue): Uint8Array {
  const writer = new ByteWriter(256);
  writeRootValue(value, writer);
  return writer.finish();
}

export function tryDecodeFast(bytes: Uint8Array): RecurramValue | undefined {
  const reader = new ByteReader(bytes);
  const kind = reader.readByte();
  if (kind === null) {
    return undefined;
  }

  let decoded: DecodeValue;
  if (kind === MESSAGE_SCALAR) {
    decoded = readValue(reader);
  } else if (kind === MESSAGE_ARRAY) {
    decoded = readArrayValue(reader);
  } else if (kind === MESSAGE_MAP) {
    decoded = readMapValue(reader, true);
  } else {
    return undefined;
  }

  if (decoded === DECODE_FAIL || !reader.isEof()) {
    return undefined;
  }
  return decoded;
}

class ByteWriter {
  #buffer: Uint8Array;
  #view: DataView;
  #length = 0;

  constructor(initialSize: number) {
    this.#buffer = new Uint8Array(initialSize);
    this.#view = new DataView(this.#buffer.buffer);
  }

  finish(): Uint8Array {
    return this.#buffer.subarray(0, this.#length);
  }

  pushByte(byte: number): void {
    this.#ensure(1);
    this.#buffer[this.#length] = byte;
    this.#length += 1;
  }

  pushBytes(bytes: Uint8Array): void {
    this.#ensure(bytes.byteLength);
    this.#buffer.set(bytes, this.#length);
    this.#length += bytes.byteLength;
  }

  writeVaruint(value: number | bigint): void {
    if (typeof value === "number") {
      let current = value;
      while (current >= 0x80) {
        const low = current % 0x80;
        this.pushByte(low + 0x80);
        current = Math.floor(current / 0x80);
      }
      this.pushByte(current);
      return;
    }

    let current = value;
    while (current >= 0x80n) {
      const low = Number(current & 0x7fn);
      this.pushByte(low | 0x80);
      current >>= 7n;
    }
    this.pushByte(Number(current));
  }

  writeSmallestU64(value: bigint): void {
    if (value <= 0xffn) {
      this.pushByte(1);
      this.pushByte(Number(value));
      return;
    }
    if (value <= 0xffffn) {
      this.pushByte(2);
      this.#ensure(2);
      this.#view.setUint16(this.#length, Number(value), true);
      this.#length += 2;
      return;
    }
    if (value <= 0xffff_ffffn) {
      this.pushByte(4);
      this.#ensure(4);
      this.#view.setUint32(this.#length, Number(value), true);
      this.#length += 4;
      return;
    }

    this.pushByte(8);
    this.#ensure(8);
    this.#view.setBigUint64(this.#length, value, true);
    this.#length += 8;
  }

  writeF64(value: number): void {
    this.#ensure(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  writeString(value: string, cacheKind: "mapKey" | "string"): void {
    if (value.length === 0) {
      this.writeVaruint(0);
      return;
    }

    const encoded =
      cacheKind === "mapKey"
        ? getCachedUtf8(mapKeyUtf8Cache, value)
        : getCachedUtf8(stringUtf8Cache, value);
    this.writeVaruint(encoded.byteLength);
    this.pushBytes(encoded);
  }

  #ensure(additionalBytes: number): void {
    const required = this.#length + additionalBytes;
    if (required <= this.#buffer.byteLength) {
      return;
    }

    let nextSize = this.#buffer.byteLength;
    while (nextSize < required) {
      nextSize *= 2;
    }

    const nextBuffer = new Uint8Array(nextSize);
    nextBuffer.set(this.#buffer);
    this.#buffer = nextBuffer;
    this.#view = new DataView(nextBuffer.buffer);
  }
}

class ByteReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  isEof(): boolean {
    return this.#offset >= this.#bytes.byteLength;
  }

  readByte(): number | null {
    if (this.#offset >= this.#bytes.byteLength) {
      return null;
    }
    const byte = this.#bytes[this.#offset];
    this.#offset += 1;
    return byte;
  }

  readVaruint(): number | null {
    let result = 0;
    let multiplier = 1;

    while (true) {
      const byte = this.readByte();
      if (byte === null) {
        return null;
      }

      result += (byte & 0x7f) * multiplier;
      if (result > Number.MAX_SAFE_INTEGER) {
        return null;
      }

      if ((byte & 0x80) === 0) {
        return result;
      }

      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        return null;
      }
    }
  }

  readSmallestU64(): bigint | null {
    const size = this.readByte();
    if (size === null) {
      return null;
    }

    if (size === 1) {
      const value = this.readByte();
      return value === null ? null : BigInt(value);
    }

    if (size === 2) {
      if (this.#offset + 2 > this.#bytes.byteLength) {
        return null;
      }
      const value = this.#view.getUint16(this.#offset, true);
      this.#offset += 2;
      return BigInt(value);
    }

    if (size === 4) {
      if (this.#offset + 4 > this.#bytes.byteLength) {
        return null;
      }
      const value = this.#view.getUint32(this.#offset, true);
      this.#offset += 4;
      return BigInt(value);
    }

    if (size === 8) {
      if (this.#offset + 8 > this.#bytes.byteLength) {
        return null;
      }
      const value = this.#view.getBigUint64(this.#offset, true);
      this.#offset += 8;
      return value;
    }

    return null;
  }

  readF64(): number | null {
    if (this.#offset + 8 > this.#bytes.byteLength) {
      return null;
    }
    const value = this.#view.getFloat64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  readString(): string | null {
    const length = this.readVaruint();
    if (length === null) {
      return null;
    }

    if (this.#offset + length > this.#bytes.byteLength) {
      return null;
    }

    const start = this.#offset;
    this.#offset += length;
    return textDecoder.decode(this.#bytes.subarray(start, start + length));
  }

  readBinary(): Uint8Array | null {
    const length = this.readVaruint();
    if (length === null) {
      return null;
    }

    if (this.#offset + length > this.#bytes.byteLength) {
      return null;
    }

    const start = this.#offset;
    this.#offset += length;
    return this.#bytes.slice(start, start + length);
  }
}

function writeRootValue(value: RecurramValue, writer: ByteWriter): void {
  if (Array.isArray(value)) {
    writer.pushByte(MESSAGE_ARRAY);
    writer.writeVaruint(value.length);
    for (let index = 0; index < value.length; index += 1) {
      writeValue(value[index], writer);
    }
    return;
  }

  if (isPlainMap(value)) {
    writer.pushByte(MESSAGE_MAP);
    const keys = Object.keys(value);
    writer.writeVaruint(keys.length);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      writer.pushByte(KEY_LITERAL);
      writer.writeString(key, "mapKey");
      writeValue(value[key], writer);
    }
    return;
  }

  writer.pushByte(MESSAGE_SCALAR);
  writeValue(value, writer);
}

function writeValue(value: RecurramValue, writer: ByteWriter): void {
  if (value === null) {
    writer.pushByte(TAG_NULL);
    return;
  }

  if (typeof value === "boolean") {
    writer.pushByte(value ? TAG_BOOL_TRUE : TAG_BOOL_FALSE);
    return;
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

      if (value >= 0) {
        writer.pushByte(TAG_U64);
        writer.writeSmallestU64(BigInt(value));
        return;
      }

      writer.pushByte(TAG_I64);
      writer.writeSmallestU64(encodeZigZag(BigInt(value)));
      return;
    }

    writer.pushByte(TAG_F64);
    writer.writeF64(value);
    return;
  }

  if (typeof value === "bigint") {
    if (value >= 0n) {
      if (value > MAX_U64) {
        throw new Error("u64 overflow");
      }
      writer.pushByte(TAG_U64);
      writer.writeSmallestU64(value);
      return;
    }

    if (value < MIN_I64 || value > MAX_I64) {
      throw new Error("i64 overflow");
    }
    writer.pushByte(TAG_I64);
    writer.writeSmallestU64(encodeZigZag(value));
    return;
  }

  if (typeof value === "string") {
    writer.pushByte(TAG_STRING);
    if (value.length === 0) {
      writer.pushByte(STRING_EMPTY);
      return;
    }
    writer.pushByte(STRING_LITERAL);
    writer.writeString(value, "string");
    return;
  }

  if (value instanceof Uint8Array) {
    writer.pushByte(TAG_BINARY);
    writer.writeVaruint(value.byteLength);
    writer.pushBytes(value);
    return;
  }

  if (Array.isArray(value)) {
    writer.pushByte(TAG_ARRAY);
    writer.writeVaruint(value.length);
    for (let index = 0; index < value.length; index += 1) {
      writeValue(value[index], writer);
    }
    return;
  }

  if (!isPlainMap(value)) {
    throw new Error("unsupported value type");
  }

  writer.pushByte(TAG_MAP);
  const keys = Object.keys(value);
  writer.writeVaruint(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    writer.writeString(key, "mapKey");
    writeValue(value[key], writer);
  }
}

function readArrayValue(
  reader: ByteReader,
): RecurramValue[] | typeof DECODE_FAIL {
  const length = reader.readVaruint();
  if (length === null) {
    return DECODE_FAIL;
  }

  const out = new Array<RecurramValue>(length);
  for (let index = 0; index < length; index += 1) {
    const item = readValue(reader);
    if (item === DECODE_FAIL) {
      return DECODE_FAIL;
    }
    out[index] = item;
  }
  return out;
}

function readMapValue(
  reader: ByteReader,
  hasRootKeyMode: boolean,
): { [key: string]: RecurramValue } | typeof DECODE_FAIL {
  const length = reader.readVaruint();
  if (length === null) {
    return DECODE_FAIL;
  }

  const out: { [key: string]: RecurramValue } = {};
  for (let index = 0; index < length; index += 1) {
    if (hasRootKeyMode) {
      const mode = reader.readByte();
      if (mode !== KEY_LITERAL) {
        return DECODE_FAIL;
      }
    }

    const key = reader.readString();
    if (key === null) {
      return DECODE_FAIL;
    }
    const value = readValue(reader);
    if (value === DECODE_FAIL) {
      return DECODE_FAIL;
    }
    out[key] = value;
  }

  return out;
}

function readValue(reader: ByteReader): DecodeValue {
  const tag = reader.readByte();
  if (tag === null) {
    return DECODE_FAIL;
  }

  if (tag === TAG_NULL) {
    return null;
  }
  if (tag === TAG_BOOL_FALSE) {
    return false;
  }
  if (tag === TAG_BOOL_TRUE) {
    return true;
  }
  if (tag === TAG_I64) {
    const raw = reader.readSmallestU64();
    return raw === null ? DECODE_FAIL : decodeZigZag(raw);
  }
  if (tag === TAG_U64) {
    const value = reader.readSmallestU64();
    return value === null ? DECODE_FAIL : value;
  }
  if (tag === TAG_F64) {
    const value = reader.readF64();
    return value === null ? DECODE_FAIL : value;
  }
  if (tag === TAG_STRING) {
    const mode = reader.readByte();
    if (mode === STRING_EMPTY) {
      return "";
    }
    if (mode === STRING_LITERAL) {
      const value = reader.readString();
      return value === null ? DECODE_FAIL : value;
    }
    return DECODE_FAIL;
  }
  if (tag === TAG_BINARY) {
    const value = reader.readBinary();
    return value === null ? DECODE_FAIL : value;
  }
  if (tag === TAG_ARRAY) {
    return readArrayValue(reader);
  }
  if (tag === TAG_MAP) {
    return readMapValue(reader, false);
  }
  return DECODE_FAIL;
}

function encodeZigZag(value: bigint): bigint {
  if (value >= 0n) {
    return value << 1n;
  }
  return (-value << 1n) - 1n;
}

function decodeZigZag(value: bigint): bigint {
  if ((value & 1n) === 0n) {
    return value >> 1n;
  }
  return -((value >> 1n) + 1n);
}

function isPlainMap(
  value: RecurramValue,
): value is { [key: string]: RecurramValue } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (value instanceof Uint8Array || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getCachedUtf8(
  cache: Map<string, Uint8Array>,
  value: string,
): Uint8Array {
  if (value.length > 64) {
    return textEncoder.encode(value);
  }

  const cached = cache.get(value);
  if (cached) {
    return cached;
  }

  const encoded = textEncoder.encode(value);
  if (cache.size >= ENCODE_CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(value, encoded);
  return encoded;
}
