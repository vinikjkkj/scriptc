/* process.stdout / process.stderr WriteStream state reads under REAL
 * @types/node (the typed surface, not the fallback declarations the corpus
 * compiles against). The fixture reads writable, writableHighWaterMark,
 * writableEnded/Finished/ObjectMode/Corked, destroyed and closed on the
 * typed stream, through a let alias, and through the instanceof Stream
 * guard of the pgpass warn idiom. Its stdout must match Node byte for byte.
 */
import { mkdtempSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const nodeTypesDir = join(repoRoot, "tests/fixtures/node-types").split("\\").join("/");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

test("node-types: process stdio WriteStream state reads lower under @types/node and match Node", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "scriptc-pgw-nt-"));
  const entry = join(nodeTypesDir, "pgwritable-state.ts");
  const result = await compile(entry, {
    outPath: join(outDir, exeName("pgwritable-state")),
    outDir,
    sanitize,
  });
  expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
  if (!result.ok) return;
  const { stdout } = await execFileAsync(result.binaryPath);
  const { stdout: oracle } = await execFileAsync(process.execPath, [entry]);
  expect(stdout).toBe(oracle);
});
