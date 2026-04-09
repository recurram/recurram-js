import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { RuntimeBackend } from "./types.js";
import { createNodeRuntimeBackend, type NativeModule } from "./node-adapter.js";

export function loadNodeBackend(): RuntimeBackend {
  const require = createRequire(import.meta.url);
  const platformKey = `${process.platform}-${process.arch}`;
  const modulePath = fileURLToPath(
    new URL(`../../native/recurram_napi-${platformKey}.node`, import.meta.url),
  );
  const native = require(modulePath) as NativeModule;
  return createNodeRuntimeBackend(native);
}
