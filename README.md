# Gowe (JS)

JavaScript/TypeScript bindings for `gowe-rust` with two backends:

- Node.js: N-API (`gowe-napi`)
- Browser/JS runtime: WebAssembly (`gowe-wasm`)

Integers decode as `bigint` by default (i64/u64 safe handling).

## Requirements

- Node.js 24+
- Rust stable
- `wasm-pack` for WASM builds

## Build

```bash
pnpm install
pnpm build
```

Build steps:

1. Build N-API addon (`native/gowe_napi.node`)
2. Build WASM package (`wasm/pkg/*`)
3. Build TypeScript output (`dist/*`)

## Formatting

```bash
pnpm format
pnpm format:check
```

## Test

```bash
pnpm test
```

What it validates:

- Rust bridge tests (`test:rust`)
- Node API tests (`test:node`) covering `init`, `encode`, `decode`, schema, batch, and session APIs
- TypeScript API usage against built output

## Usage (Node)

```ts
import {
  init,
  encode,
  decode,
  createSessionEncoder,
  toTransportJson,
  encodeTransportJson,
  type GoweValue,
} from "@gowe/core";

await init({ prefer: "napi" });

const value: GoweValue = {
  id: 1001n,
  name: "alice",
  active: true,
};

const bytes = encode(value);
const roundtrip = decode(bytes);

const session = createSessionEncoder();
const first = session.encode(value);
const patch = session.encodePatch({ ...value, name: "alicia" });

const prepared = toTransportJson(value);
const fastest = encodeTransportJson(prepared);
```

## High-throughput transport JSON APIs

For hot paths where you can prepare payloads ahead of time, use transport JSON APIs to reduce JS-side conversion overhead:

- `toTransportJson(value)` / `fromTransportJson(json)`
- `toTransportJsonBatch(values)`
- `encodeTransportJson(valueJson)` / `decodeToTransportJson(bytes)`
- `encodeBatchTransportJson(valuesJson)`

`SessionEncoder` also supports raw methods:

- `encodeTransportJson(valueJson)`
- `encodeBatchTransportJson(valuesJson)`
- `encodePatchTransportJson(valueJson)`
- `encodeMicroBatchTransportJson(valuesJson)`

## Usage (Browser)

```ts
import { init, encode, decode } from "@gowe/core";

await init({ prefer: "wasm" });

const bytes = encode({ id: 1n, role: "admin" });
const value = decode(bytes);
```

If you want to pass a custom WASM source, use `wasmInput`:

```ts
await init({ prefer: "wasm", wasmInput: "/assets/gowe_wasm_bg.wasm" });
```

## TypeScript types

Main exported types:

- `GoweValue`
- `Schema`, `SchemaField`
- `SessionOptions`

`GoweValue` includes `bigint` and `Uint8Array` support:

```ts
type GoweValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | GoweValue[]
  | { [key: string]: GoweValue };
```

## Publish to npm

The package is configured for npm publish and ships build artifacts from `dist/`, `native/`, and `wasm/pkg/`.

Local dry run:

```bash
pnpm build
pnpm pack
```

GitHub Actions publish:

1. Add repository secret `NPM_TOKEN`.
2. Bump `version` in `package.json`.
3. Create and push matching tag `v<version>`.

Example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow `.github/workflows/publish-npm.yml` verifies tag/version match and then runs `pnpm publish`.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
