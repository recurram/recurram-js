import assert from "node:assert/strict";
import test from "node:test";

// Bypass the Node.js runtime guard by importing loadWasmBackend directly.
// This is intentional: the guard exists to steer Node.js users toward the
// faster N-API backend, not because WASM is broken in Node.js.
import { loadWasmBackend } from "../dist/runtime/wasm-backend.js";

/** @type {import("../dist/runtime/types.js").RuntimeBackend} */
let backend;

test("loads WASM backend", async () => {
  backend = await loadWasmBackend();
  assert.equal(backend.kind, "wasm");
});

test("encodes and decodes transport JSON", async () => {
  const input =
    '{"t":"map","v":[["id",{"t":"u64","v":"1"}],["name",{"t":"string","v":"alice"}]]}';
  const bytes = backend.encodeTransportJson(input);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);

  const json = backend.decodeToTransportJson(bytes);
  const parsed = JSON.parse(json);
  assert.equal(parsed.t, "map");
});

test("encodes with schema", async () => {
  const schema = JSON.stringify({
    schemaId: 1,
    name: "User",
    fields: [
      { number: 1, name: "id", logicalType: "u64", required: true },
      { number: 2, name: "name", logicalType: "string", required: false },
    ],
  });
  const value =
    '{"t":"map","v":[["id",{"t":"u64","v":"1"}],["name",{"t":"string","v":"alice"}]]}';
  const bytes = backend.encodeWithSchemaTransportJson(schema, value);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
});

test("encodes batch transport JSON", async () => {
  const values = JSON.stringify([
    {
      t: "map",
      v: [
        ["id", { t: "u64", v: "1" }],
        ["name", { t: "string", v: "alice" }],
      ],
    },
    {
      t: "map",
      v: [
        ["id", { t: "u64", v: "2" }],
        ["name", { t: "string", v: "bob" }],
      ],
    },
  ]);
  const bytes = backend.encodeBatchTransportJson(values);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
});

test("session encoder encodes and patches", async () => {
  const session = backend.createSessionEncoder();
  const first = session.encodeTransportJson(
    '{"t":"map","v":[["id",{"t":"u64","v":"1"}],["role",{"t":"string","v":"admin"}]]}',
  );
  const patch = session.encodePatchTransportJson(
    '{"t":"map","v":[["id",{"t":"u64","v":"1"}],["role",{"t":"string","v":"member"}]]}',
  );
  assert.ok(first instanceof Uint8Array && first.length > 0);
  assert.ok(patch instanceof Uint8Array && patch.length > 0);

  session.reset();
  const afterReset = session.encodeTransportJson(
    '{"t":"map","v":[["id",{"t":"u64","v":"9"}],["role",{"t":"string","v":"owner"}]]}',
  );
  assert.ok(afterReset instanceof Uint8Array && afterReset.length > 0);
});
