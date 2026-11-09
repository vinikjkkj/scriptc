/* The short-key comparison behind a dyn object's key lookup (scr_json.c, scr_dyn_bytes_eq).
 *
 * Up to 16 bytes it answers with overlapping loads of the key's own length instead of a call to memcmp, and lengths 1-3, 4-7, 8-16 and
 * above 16 take different paths. The corpus row 24930 builds keys of every length from 1 to 20 at run time and, for every position in
 * each, looks up a second key that differs in that one byte only: the two must stay two distinct properties. That row must pass plain and
 * under --sanitize on both backends (the loads go through memcpy, so neither the sanitizer nor strict aliasing has anything to say).
 *
 * THE CONTROL THAT FIRES: -DSCR_OBJ_PLANT_BUG=<n> plants a defect in one branch (1: bytes past the first eight of a 9-16 byte key are
 * never compared; 2: the last bytes of a 4-7 byte key; 3: all but the first byte of a 1-3 byte key). Each planted build must DIFFER from
 * Node on the row (its own `bad` counter turns non-zero); without the plant it is byte-identical. */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const rowName = readdirSync(join(repoRoot, "tests/corpus")).find((n) => n.startsWith("24930-"))!;
const rowSrc = readFileSync(join(repoRoot, "tests/corpus", rowName), "utf8");

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
let nodeOut = "";
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "scriptc-dyn-obj-key-eq-"));
  const dir = join(work, "node");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), rowSrc, "utf8");
  nodeOut = (await run(process.execPath, [join(dir, "main.ts")], dir)).stdout;
}, 120_000);

async function build(name: string, backend: "c" | "llvm", flags: string, sanitize: boolean): Promise<string> {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), rowSrc, "utf8");
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

describe.each(["c", "llvm"] as const)("the short-key comparison (%s)", (backend) => {
  test("every length 1-20, every single-byte difference: Node's answers, plain and sanitized", async () => {
    // The sanitizer runtime (asan) does not link under zig cc on Windows (lld-link: undefined symbol __asan_memcpy, a toolchain fact that
    // has nothing to do with the comparison), so that lane runs the plain build only; the loads go through memcpy either way.
    for (const sanitize of process.platform === "win32" ? [false] : [false, true]) {
      const bin = await build(`ok-${backend}-${sanitize ? "san" : "plain"}`, backend, "", sanitize);
      const r = await run(bin, [], work);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(nodeOut);
    }
  }, 900_000);
  test.each([1, 2, 3])("CONTROL: planted defect %i makes the row differ from Node", async (n) => {
    const bin = await build(`plant${n}-${backend}`, backend, `-DSCR_OBJ_PLANT_BUG=${n}`, false);
    const r = await run(bin, [], work);
    expect(r.stdout).not.toBe(nodeOut);
    expect(r.stdout).toMatch(/checks 630 bad [1-9]/);
  }, 600_000);
});
