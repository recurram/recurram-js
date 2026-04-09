import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const targetDir = path.join(root, "native");
const platformKey = `${process.platform}-${process.arch}`;
const targetFile = path.join(targetDir, `recurram_napi-${platformKey}.node`);

const sourceFile = resolveSourceBinary(path.join(root, "target", "release"));

await mkdir(targetDir, { recursive: true });
await copyFile(sourceFile, targetFile);

function resolveSourceBinary(releaseDir) {
  if (process.platform === "darwin") {
    return path.join(releaseDir, "librecurram_napi.dylib");
  }
  if (process.platform === "linux") {
    return path.join(releaseDir, "librecurram_napi.so");
  }
  if (process.platform === "win32") {
    return path.join(releaseDir, "recurram_napi.dll");
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}
