/* LARGE ARRAY DATA COMES OFF THE CRT HEAP, AND THIS IS WHAT SAYS SO.
 *
 * scr_arr_grow doubles, and realloc on a heap whose neighbours are busy
 * cannot extend in place: every step allocates, copies, and frees. An array
 * reaching octave 15 also allocated at 7, 8, 9 ... 14 and abandoned all of
 * them, and each abandoned block is exactly one size class SMALLER than the
 * request that follows it, so nothing later can fit the hole it left. On a
 * zapo history sync that one line moves 1,582.6 MiB at 0.00% survival.
 *
 * Above SCR_ARR_VM_MIN the buffer is backed by its own reservation and grows
 * by COMMITTING, so there is no abandoned block, no copy on grow, and the
 * whole range goes back to the OS on free.
 *
 * WHAT IS ASSERTED, and the first one is why the rest mean anything:
 *
 *   THE PATH RAN. `promoted` must be non-zero. Two arms of one binary
 *   printing the same answer is NOT evidence that the reservation path
 *   executed -- a promotion that never happened prints the same answer. The
 *   runtime prints NOTHING PROMOTED by name when it did not, and the OFF arm
 *   below is the control that shows the counter can read zero.
 *
 *   THE OVERFLOW PATH RAN. An array past SCR_ARR_VM_RESERVE has to copy back
 *   OUT to the heap, and that path runs on no ordinary workload. The fixture
 *   builds one deliberately, so `overflow` must be exactly 1.
 *
 *   THE ANSWER IS UNCHANGED. Same binary, SCR_ARRAY_VM=0 -- an ENV knob, so
 *   both arms carry identical code layout and the comparison has no
 *   confound. Element values are checked, not just lengths: a buffer of the
 *   right length with the wrong contents is what a bad promotion copy
 *   produces and what a length check cannot see.
 *
 * No megabyte or timing figure is asserted here. RSS on this host is bimodal
 * (+-12.63% mode-blind) and a gate fixture cannot produce a readable one;
 * that measurement belongs to tests/perf/zapo-rest and its rig.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const src = join(repoRoot, "tests/fixtures/array-vm/grow.ts");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const rcAudit = process.env["SCRIPTC_RC_AUDIT"] === "1";

/* The reservation path is compiled out under SCR_RC_AUDIT -- that lane exists
 * to prove every logical free is a real free through free(). Skipping loudly
 * beats asserting a zero that means "not compiled". */
const armable = !rcAudit && !sanitize;

/* Arithmetic, not whatever it printed first: ten sizes all correct, and the
 * write-through check marks every thousandth of 200,000 elements. */
const EXPECTED = "array-vm 10/10 neg=200\n";

interface Vm {
  readonly promoted: number;
  readonly overflow: number;
  readonly refused: number;
}

function parseVm(stderr: string): Vm | null {
  const m = /^\[arrvm] promoted=(\d+) overflow=(\d+) refused=(\d+)/m.exec(
    stderr.replace(/\r\n/g, "\n"),
  );
  if (m === null) return null;
  return { promoted: Number(m[1]), overflow: Number(m[2]), refused: Number(m[3]) };
}

describe.skipIf(!armable)("large array data is reservation-backed", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(readFileSync(join(repoRoot, "packages/runtime/src/scr_array.c")))
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `array-vm-${key}`);
  let bin = "";

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    /* The counters' REPORT is behind a build flag, because its atexit() is an
     * ambient symbol and library-mode audits for exactly that -- it failed
     * that audit in both emission arms on the first full gate after it
     * landed. The env knob still selects it at run time; this makes the code
     * present to select. */
    const prev = process.env["SCRIPTC_PROF_CFLAGS"];
    process.env["SCRIPTC_PROF_CFLAGS"] = "-DSCR_ARR_VM_STAT=1";
    let result;
    try {
      result = await compile(src, { outPath: join(dir, exeName("grow")), outDir: dir });
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
      else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
    }
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    bin = result.binaryPath;
  }, 900_000);

  async function run(extra: Readonly<Record<string, string>> = {}) {
    const { stdout, stderr } = await execFileAsync(bin, [], {
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, SCR_ARRAY_VM_STAT: "1", ...extra },
    });
    return { stdout: stdout.replace(/\r\n/g, "\n"), stderr: stderr.replace(/\r\n/g, "\n") };
  }

  test("the reservation path runs, and the overflow path with it", async () => {
    const { stdout, stderr } = await run();
    expect(stdout).toBe(EXPECTED);
    const vm = parseVm(stderr);
    expect(vm, `no [arrvm] line in:\n${stderr}`).not.toBeNull();
    /* Armed at all -- without this every assertion below is vacuous. */
    expect(vm!.promoted).toBeGreaterThan(0);
    /* The fixture builds exactly one array past the reservation. */
    expect(vm!.overflow).toBe(1);
    /* A refusal means reserve or commit failed; it is sound but slow, and it
     * must not be happening routinely on a healthy host. */
    expect(vm!.refused).toBe(0);
    expect(stderr).not.toContain("NOTHING PROMOTED");
  }, 900_000);

  test("SCR_ARRAY_VM=0 is the same binary and the same answer", async () => {
    const { stdout, stderr } = await run({ SCR_ARRAY_VM: "0" });
    /* THE ANSWER IS IDENTICAL. */
    expect(stdout).toBe(EXPECTED);
    /* THE COUNTER CAN READ ZERO. This is what makes the non-zero above a
     * measurement rather than a constant. */
    const vm = parseVm(stderr);
    expect(vm).not.toBeNull();
    expect(vm!.promoted).toBe(0);
    expect(vm!.overflow).toBe(0);
    expect(stderr).toContain("NOTHING PROMOTED");
  }, 900_000);
});
