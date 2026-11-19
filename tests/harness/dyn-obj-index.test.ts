/* The member indexes behind a dyn object's key lookup and a class's member lookup (scr_json.c): from 32 members a dyn object answers
 * through a hash of positions, from 16 members a class table does, and the class registry walk behind a hierarchy instance is memoised
 * per preorder position. Rows 25850 (a large dictionary: reads, `in`, overwrite, delete, re-add, accessors, past 65,535 members) and
 * 25851 (a class and its subclasses with many members, called by computed name through any) must match Node on both backends, plain and
 * sanitized, and -DSCR_OBJ_NOIDX (the pure scans) must match too.
 *
 * THE CONTROLS THAT FIRE (-DSCR_OBJ_PLANT_BUG=<n>): 3 makes an indexed dyn lookup answer the NEXT entry (row 25850 must differ), 4 makes an
 * indexed class lookup answer the next row (25851 must differ), 5 paints the LOOSEST containing class into the registry memo (25851 must
 * differ), 6 treats every OBJECT as plain in the keyed [[Get]] fast path (row 25852, a wrapper and a StringDecoder, must differ). A row that
 * does not move under its plant never reached the mechanism. Rows 25853-25857 are the primitive-wrapper reads (Object(prim) sees String / Number /
 * Boolean.prototype by read and by `in`, and its `constructor` names the builtin); 7 makes a wrapper read as a plain object again, 8 restores the old
 * `constructor` fence. */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const rowFile = (id: string): string => readdirSync(join(repoRoot, "tests/corpus")).find((n) => n.startsWith(id + "-"))!;
const rowSrcOf = (id: string): string => readFileSync(join(repoRoot, "tests/corpus", rowFile(id)), "utf8");
const IDS = ["25850", "25851", "25852", "25853", "25854", "25855", "25856", "25857"] as const;

interface Run { stdout: string; exitCode: number }
function run(cmd: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("dyn-obj-key-eq row timed out")); }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout: out, exitCode: code ?? 0 }); });
  });
}

let work = "";
const nodeOut: Record<string, string> = {};
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "scriptc-dyn-obj-key-eq-"));
  const dir = join(work, "node");
  mkdirSync(dir, { recursive: true });
  for (const id of IDS) {
    writeFileSync(join(dir, `${id}.ts`), rowSrcOf(id), "utf8");
    nodeOut[id] = (await run(process.execPath, [join(dir, `${id}.ts`)], dir)).stdout;
  }
}, 120_000);

async function build(id: string, name: string, backend: "c" | "llvm", flags: string, sanitize: boolean): Promise<string> {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), rowSrcOf(id), "utf8");
  const prev = process.env["SCRIPTC_PROF_CFLAGS"];
  if (flags === "") delete process.env["SCRIPTC_PROF_CFLAGS"];
  else process.env["SCRIPTC_PROF_CFLAGS"] = flags;
  try {
    const built = await compile(join(dir, "main.ts"), { outPath: join(dir, exeName("program")), outDir: dir, backend, sanitize });
    expect(built.ok, (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n")).toBe(true);
    return built.binaryPath!;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
    else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
  }
}

describe.each(["c", "llvm"] as const)("the member indexes (%s)", (backend) => {
  test.each(IDS)("row %s: Node's answers, plain, sanitized, and with the indexes compiled out", async (id) => {
    for (const [tag, flags, sanitize] of (process.platform === "win32"
      ? [["plain", "", false], ["noidx", "-DSCR_OBJ_NOIDX", false]]
      : [["plain", "", false], ["san", "", true], ["noidx", "-DSCR_OBJ_NOIDX", false]]) as [string, string, boolean][]) {
      const bin = await build(id, `ok-${id}-${backend}-${tag}`, backend, flags, sanitize);
      const r = await run(bin, [], work);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(nodeOut[id]);
    }
  }, 900_000);
  test.each([["25850", 3], ["25851", 4], ["25851", 5], ["25852", 6], ["25853", 7], ["25856", 8], ["25857", 7]] as const)("CONTROL: row %s under planted defect %i differs from Node", async (id, n) => {
    const bin = await build(id, `plant${n}-${id}-${backend}`, backend, `-DSCR_OBJ_PLANT_BUG=${n}`, false);
    const r = await run(bin, [], work);
    expect(r.stdout).not.toBe(nodeOut[id]);
  }, 600_000);
});
