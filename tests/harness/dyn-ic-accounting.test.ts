/* The (class, key) -> member-row memo behind a keyed read of a boxed class instance (scr_dyn_oim.c, scr_dyn_objinst_member_get_lit).
 *
 * THE MEMO HAS NO EPOCH, BECAUSE NOTHING CAN INVALIDATE IT, and this file pins the premise that says so. The memo caches a pure function of
 * (class descriptor, key literal): the descriptors and their member tables are emitted `const` data (C: `const ScrDynClass`, LLVM: `internal
 * constant`), and no runtime code writes a class table. The per-instance questions (an own property shadowing a method, the field getter,
 * the absent datum) are asked on every read, outside the memo. A run-time writer of a class table would break exactly that, so it must fail
 * HERE and be dealt with before it lands (it would owe the memo an invalidation list, which today is empty).
 *
 * THREE GUARDS, EACH WITH A CONTROL THAT FIRES:
 *   1. the source scan: no store to a member row / table field in the runtime, and both emitters emit the descriptors const;
 *   2. -DSCR_IC_VERIFY: every memo hit is re-derived by the scan, exit 98 on a mismatch; the row program runs clean under it on both backends;
 *   3. -DSCR_IC_PLANT_STALE: the fill stores the WRONG row; under VERIFY the program must exit 98 (the verifier fires). Without the plant it
 *      exits 0, so the 98 is the plant's and not the program's.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const rtDir = join(repoRoot, "packages/runtime/src");

/** A store to a field of a class descriptor or one of its member rows: `x.members = `, `x->nmembers = `, `members[i].get = `, ... Not `==`. */
const TABLE_STORE = /(?:->|\.)(?:members|nmembers|statics|nstatics)\s*=(?!=)|members\[[^\]]+\]\.[A-Za-z_]+\s*=(?!=)|statics\[[^\]]+\]\.[A-Za-z_]+\s*=(?!=)/;

describe("class tables are never written at run time (the memo's premise)", () => {
  test("the scan matcher fires on a planted store (control)", () => {
    expect(TABLE_STORE.test("c->members = tbl;")).toBe(true);
    expect(TABLE_STORE.test("cls.nmembers = 3;")).toBe(true);
    expect(TABLE_STORE.test("c->members[i].get = f;")).toBe(true);
    expect(TABLE_STORE.test("if (c->nmembers == 3) {")).toBe(false);
  });
  test("no runtime unit stores to a class table or a member row", () => {
    const hits: string[] = [];
    for (const f of readdirSync(rtDir).filter((n) => n.endsWith(".c") || n.endsWith(".h"))) {
      const lines = readFileSync(join(rtDir, f), "utf8").split("\n");
      lines.forEach((ln, i) => {
        const code = ln.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
        if (TABLE_STORE.test(code)) hits.push(`${f}:${i + 1}: ${ln.trim()}`);
      });
    }
    expect(hits, `a runtime writer of a class table: the (class, key) memo owes an invalidation list for it\n${hits.join("\n")}`).toEqual([]);
  });
  test("both emitters emit the descriptors const", () => {
    const c = readFileSync(join(repoRoot, "packages/compiler/src/backend/emission/emit-walkers.ts"), "utf8");
    expect(c).toMatch(/\$\{E\.link\}const ScrDynClass \$\{name\} = /);
    const ll = readFileSync(join(repoRoot, "packages/compiler/src/backend/llvm/emitter.ts"), "utf8");
    expect(ll).toMatch(/internal constant \[\$\{dynClassDescSyms\.length\} x ptr\]/);
  });
  test("the memo is reached only with an emitted string literal (an immortal interned static): a computed key never gets here", () => {
    // The emitters call the literal-key twin (sc_dyn_key_get_lit -> scr_dyn_objinst_member_get_lit) only through dynKeyGetUsesLitTwin,
    // which admits a key that is a `strLit` of string type. The memo keys on the ADDRESS of that string, which names its bytes forever
    // because the literal is immortal and interned once per program; a computed key's address can be recycled with other bytes.
    const nodes = readFileSync(join(repoRoot, "packages/compiler/src/ir/nodes.ts"), "utf8");
    expect(nodes).toMatch(/export function dynKeyGetUsesLitTwin\(mod: IrModule, key: IrExpr\): boolean \{\r?\n  if \(key\.kind !== "strLit" \|\| key\.type\.kind !== "string"\) return false;/);
    const oim = readFileSync(join(rtDir, "scr_dyn_oim.c"), "utf8");
    expect(oim).toMatch(/key->rc != SCR_STR_IMMORTAL/); // the verify build asserts the premise on every call
  });
});

interface Run { stdout: string; stderr: string; exitCode: number }
function run(cmd: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("dyn-ic row timed out")); }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout: out, stderr: err, exitCode: code ?? 0 }); });
  });
}

const rowSrc = readFileSync(
  join(repoRoot, "tests/corpus/24860-class-instance-keyed-reads-through-an-untyped-slot.ts"),
  "utf8",
);
let work = "";
let nodeOut = "";
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "scriptc-dyn-ic-"));
  const dir = join(work, "node");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), rowSrc, "utf8");
  nodeOut = (await run(process.execPath, [join(dir, "main.ts")], dir)).stdout;
}, 120_000);

async function build(name: string, backend: "c" | "llvm", flags: string): Promise<string> {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), rowSrc, "utf8");
  const prev = process.env["SCRIPTC_PROF_CFLAGS"];
  process.env["SCRIPTC_PROF_CFLAGS"] = flags;
  try {
    const built = await compile(join(dir, "main.ts"), { outPath: join(dir, exeName("program")), outDir: dir, backend });
    expect(built.ok, (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n")).toBe(true);
    return built.binaryPath!;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
    else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
  }
}

describe.each(["c", "llvm"] as const)("the memo, verified (%s)", (backend) => {
  test("every memo hit equals the scan, and the output is Node's", async () => {
    const bin = await build(`verify-${backend}`, backend, "-DSCR_IC_VERIFY");
    const r = await run(bin, [], work);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(nodeOut);
  }, 600_000);
  test("CONTROL: a planted wrong row makes the verifier fire (exit 98)", async () => {
    const bin = await build(`plant-${backend}`, backend, "-DSCR_IC_VERIFY -DSCR_IC_PLANT_STALE");
    const r = await run(bin, [], work);
    expect(r.exitCode).toBe(98);
    expect(r.stderr).toMatch(/IC VERIFY FAILED/);
  }, 600_000);
});
