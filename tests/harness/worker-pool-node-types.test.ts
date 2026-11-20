/* The worker pool's promisified forms under REAL @types/node.
 *
 * The shipped fallback declarations carry no randomInt, pbkdf2 or promisified
 * zlib, so the differential corpus cannot reach them; this fixture does. The
 * program must compile statically and match Node byte for byte, on the C and
 * LLVM backends and with the pool forced to run every job on a worker
 * (SCR_WORK_INLINE_US=0) as well as with small jobs inline. */
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
const entry = join(repoRoot, "tests/fixtures/node-types/worker-pool.ts");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

for (const backend of ["c", "llvm"] as const) {
  test(`node-types: the promisified crypto and zlib forms match Node through the worker pool (${backend})`, async () => {
    const outDir = mkdtempSync(join(tmpdir(), `scriptc-pool-nt-${backend}-`));
    const result = await compile(entry, { outPath: join(outDir, exeName("pool")), outDir, sanitize, backend });
    expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
    if (!result.ok) return;
    const node = (await execFileAsync(process.execPath, [entry])).stdout;
    for (const inline of [undefined, "0"]) {
      const env = { ...process.env, ...(inline === undefined ? {} : { SCR_WORK_INLINE_US: inline }) };
      const { stdout } = await execFileAsync(result.binaryPath, [], { env });
      expect(stdout).toBe(node);
    }
  }, 300_000);
}
