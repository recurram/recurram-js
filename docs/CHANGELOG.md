# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-03-25

Initial public release of the JavaScript and TypeScript bindings for Gowe.

### Added

- Node.js N-API and browser WASM backends behind a shared `init()` runtime selection API.
- High-level encode and decode APIs for `GoweValue`, schema-aware encoding, batch encoding, and session-based patch and micro-batch workflows.
- Transport JSON, compact JSON, and direct object fast paths for lower JS-side overhead in hot paths.
- TypeScript type exports for runtime options, schemas, session options, and transport-compatible values including `bigint` and `Uint8Array`.
- Rust bridge crates, N-API packaging, WASM packaging, Node test coverage, CI, npm publish automation, and release tag verification.

### Changed

- Renamed npm package from `gowe` to `@gowe/core` to publish under the `@gowe` scope, as the unscoped name was unavailable on npm.
- Raised the Node.js runtime baseline to `24+` across local tooling, documentation, and publish workflows.
- Expanded the public API with fast-mode helpers for compact encoding, raw transport JSON encoding, direct encoding, and additional session encoder variants.
- Optimized bridge, N-API, WASM, and TypeScript runtime paths to reduce overhead for encode, decode, batch, session, and compact transport operations.

### Fixed

- Corrected the Rust crate path used by the workspace so native builds resolve the bridge crate correctly.

[unreleased]: https://github.com/gowe-team/gowe-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gowe-team/gowe-js/releases/tag/v0.1.0
