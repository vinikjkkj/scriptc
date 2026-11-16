/* --layout-order applied by the LINKER: where the linker has an ordering-file option (GNU ld >= 2.43, lld) the emitted program TU stays in
 * natural order and shares one early-cache entry across every order file, so editing the order file costs the native compile and link only.
 *
 *   - a plain build, then a build with an order file, then one with the REVERSED file: the second and third report "early cache hit" and
 *     the program's functions land in the file's order in the binary each time (nm -n), with the output unchanged -- C and LLVM;
 *   - the positive controls: SCRIPTC_LAYOUT_EMIT_ORDER=1 (the emitters order the TU, as on zig cc) must MISS the cache for an order file
 *     the plain build never saw and must still order the binary and print the same output; SCRIPTC_LAYOUT_LINK_ORDER=0 likewise. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const cli = join(import.meta.dirname, "../../packages/cli/dist/main.js");

function linkerOrders(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const ld = execFileSync("clang", ["-print-prog-name=ld"], { encoding: "utf8" }).trim() || "ld";
    const help = execFileSync(ld, ["--help"], { encoding: "utf8" });
    return help.includes("--section-ordering-file") || help.includes("--symbol-ordering-file");
  } catch {
    return false;
  }
}

describe.skipIf(!linkerOrders())("layout order applied by the linker", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-linkorder-test-"));
  const cache = join(dir, "cache");
  mkdirSync(cache);
  const entry = join(dir, "app.ts");
  writeFileSync(
    entry,
    `function ra(n: number): number { return n < 2 ? n : ra(n - 1) + ra(n - 2) + 1; }
function rb(n: number): number { return n < 2 ? n : rb(n - 1) + rb(n - 2) + 2; }
function rc(n: number): number { return n < 2 ? n : rc(n - 1) + rc(n - 2) + 3; }
console.log(ra(20), rb(20), rc(20));
`,
  );
  const fwd = join(dir, "fwd.txt");
  const rev = join(dir, "rev.txt");
  writeFileSync(fwd, "sc_f_ra\nsc_f_rb\nsc_f_rc\n");
  writeFileSync(rev, "sc_f_rc\nsc_f_rb\nsc_f_ra\n");
  const run = (args: string[], env: Record<string, string> = {}): { status: number | null; stderr: string } => {
    const r = spawnSync(process.execPath, [cli, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 600_000,
      env: { ...process.env, SCRIPTC_CACHE_DIR: cache, ...env },
    });
    return { status: r.status, stderr: r.stderr };
  };
  const placed = (bin: string): string =>
    execFileSync("nm", ["-n", bin], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.split(" ")[2] ?? "")
      .filter((n) => /^sc_f_r[abc]$/.test(n))
      .join(" ");
  const hit = /early cache hit/;

  for (const backend of ["c", "llvm"]) {
    test(`an order edit hits the early cache and the binary follows the file, ${backend}`, { timeout: 900_000 }, () => {
      const plain = join(dir, `plain.${backend}`);
      let r = run(["build", entry, "--backend", backend, "--no-layout-order", "-o", plain]);
      expect(r.status, r.stderr).toBe(0);
      const want = execFileSync(plain, [], { encoding: "utf8" });
      for (const [name, file, order] of [["fwd", fwd, "sc_f_ra sc_f_rb sc_f_rc"], ["rev", rev, "sc_f_rc sc_f_rb sc_f_ra"]] as const) {
        const bin = join(dir, `${name}.${backend}`);
        r = run(["build", entry, "--backend", backend, "--layout-order", file, "-o", bin]);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stderr, `${name}: the order file must not miss the cache`).toMatch(hit);
        expect(placed(bin)).toBe(order);
        expect(execFileSync(bin, [], { encoding: "utf8" })).toBe(want);
      }
    });

    test(`controls, ${backend}: emitter-side ordering misses the cache for an unseen order file and still orders`, { timeout: 900_000 }, () => {
      const want = execFileSync(join(dir, `plain.${backend}`), [], { encoding: "utf8" });
      for (const env of [{ SCRIPTC_LAYOUT_EMIT_ORDER: "1" }, { SCRIPTC_LAYOUT_LINK_ORDER: "0" }]) {
        const bin = join(dir, `ctl.${backend}.${Object.keys(env)[0]}`);
        const r = run(["build", entry, "--backend", backend, "--layout-order", rev, "-o", bin], env);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stderr, JSON.stringify(env)).not.toMatch(hit);
        expect(placed(bin)).toBe("sc_f_rc sc_f_rb sc_f_ra");
        expect(execFileSync(bin, [], { encoding: "utf8" })).toBe(want);
      }
    });
  }
});
