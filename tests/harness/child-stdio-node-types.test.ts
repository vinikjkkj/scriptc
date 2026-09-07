/* Child stdio under REAL @types/node — the sibling of
 * stream-node-types.test.ts, and the same bug shape one level up.
 *
 * The async child surface (spawn's piped stdout/stderr, child.on("exit"),
 * the childStream listeners) has a working lowering and a corpus program
 * that proves it: tests/corpus/1565-spawn-pipe-streams.ts. But the corpus
 * compiles against the SHIPPED FALLBACK declarations, where spawn returns a
 * plain `ChildProcess`. Under real @types/node the tuple-stdio overload
 * returns `ChildProcessByStdio<I, O, E>` instead — a different SYMBOL NAME
 * for the same runtime handle — and the whole surface fenced. The same
 * program shape measured 0 refusal sites under the fallback and 4 under
 * @types/node 24.13.3, so the corpus could not see it.
 *
 * This pins the CAPABILITY end: the fixture compiles under @types/node and
 * its output matches Node byte for byte, through all three read forms.
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
/* POSIX spelling: renderAll reports forward-slash paths on every host. */
const nodeTypesDir = join(repoRoot, "tests/fixtures/node-types").split("\\").join("/");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

test("node-types: piped child stdio lowers under @types/node and matches Node", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "scriptc-child-nt-"));
  const entry = join(nodeTypesDir, "child-stdio.ts");
  const result = await compile(entry, {
    outPath: join(outDir, exeName("child-stdio")),
    outDir,
    sanitize,
  });
  expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
  if (!result.ok) return;
  const { stdout } = await execFileAsync(result.binaryPath);
  const { stdout: oracle } = await execFileAsync(process.execPath, [entry]);
  expect(stdout).toBe(oracle);
});
