import assert from "node:assert/strict";
import test from "node:test";

import { createSessionEncoder, decode, encode, init } from "../dist/index.js";
import {
  createSessionEncoder as createAdvancedSessionEncoder,
  encodeBatch,
  encodeTransportJson,
  encodeWithSchema,
} from "../dist/advanced.js";

test("rejects wasm backend in node", async () => {
  await assert.rejects(
    async () => init({ prefer: "wasm" }),
    /WASM backend is intended for browser JS/,
  );
});

test("encodes and decodes with bigint and binary", async () => {
  const payload = {
    id: 123n,
    name: "alice",
    active: true,
    blob: new Uint8Array([1, 2, 3, 4]),
    scores: [1n, 2n, 3n],
  };

  const bytes = encode(payload);
  assert.ok(bytes.length > 0);

  const decoded = decode(bytes);
  assert.equal(decoded.id, 123n);
  assert.equal(decoded.name, "alice");
  assert.equal(decoded.active, true);
  assert.ok(decoded.blob instanceof Uint8Array);
  assert.deepEqual(Array.from(decoded.blob), [1, 2, 3, 4]);
  assert.deepEqual(decoded.scores, [1n, 2n, 3n]);
});

test("decodes from Buffer input", async () => {
  const bytes = encode({ id: 42n, name: "buffer" });
  const decoded = decode(Buffer.from(bytes));
  assert.equal(decoded.id, 42n);
  assert.equal(decoded.name, "buffer");
});

test("decodes u64 values above i64 range", async () => {
  const id = 9_223_372_036_854_775_808n;
  const decoded = decode(encode({ id }));
  assert.equal(decoded.id, id);
});

test("falls back when native fast decode sees string references", async () => {
  const bytes = encodeTransportJson(
    '{"t":"map","v":[["a",{"t":"string","v":"x"}],["b",{"t":"string","v":"x"}]]}',
  );
  const decoded = decode(bytes);
  assert.deepEqual(decoded, { a: "x", b: "x" });
});

test("rejects unsupported root values on the native fast path", async () => {
  assert.throws(() => encode(new Date()), /unsupported value type/);
  assert.throws(
    () => encode(Number.MAX_SAFE_INTEGER + 1),
    /unsafe integer number detected/,
  );
});

test("supports schema and batch APIs through the advanced entrypoint", async () => {
  const schema = {
    schemaId: 1,
    name: "User",
    fields: [
      {
        number: 1,
        name: "id",
        logicalType: "u64",
        required: true,
      },
      {
        number: 2,
        name: "name",
        logicalType: "string",
        required: false,
      },
    ],
  };

  const schemaBytes = encodeWithSchema(schema, { id: 1n, name: "alice" });
  assert.ok(schemaBytes.length > 0);

  const batchBytes = encodeBatch([
    { id: 1n, name: "alice" },
    { id: 2n, name: "bob" },
    { id: 3n, name: "carol" },
    { id: 4n, name: "dave" },
  ]);
  assert.ok(batchBytes.length > 0);
});

test("supports session encoder APIs", async () => {
  const session = createSessionEncoder({
    unknownReferencePolicy: "statelessRetry",
  });

  const first = session.encode({ id: 1n, role: "admin" });
  const patch = session.encodePatch({ id: 1n, role: "member" });
  const micro = session.encodeMicroBatch([
    { id: 1n, role: "admin" },
    { id: 2n, role: "member" },
    { id: 3n, role: "member" },
    { id: 4n, role: "admin" },
  ]);

  assert.ok(first.length > 0);
  assert.ok(patch.length > 0);
  assert.ok(micro.length > 0);

  session.reset();
  const afterReset = session.encode({ id: 9n, role: "owner" });
  assert.ok(afterReset.length > 0);
});

test("supports advanced session encoder APIs", async () => {
  const session = createAdvancedSessionEncoder();

  const first = session.encode({ id: 1n, role: "admin" });
  const patch = session.encodePatchTransportJson(
    '{"t":"map","v":[["id",{"t":"u64","v":"1"}],["role",{"t":"string","v":"member"}]]}',
  );

  assert.ok(first.length > 0);
  assert.ok(patch.length > 0);
});
