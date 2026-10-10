import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const tempDirs: string[] = [];

/** A path inside a fresh temporary directory, removed after each test. */
export function tempPath(file = "fleet.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-"));
  tempDirs.push(dir);
  return join(dir, file);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
