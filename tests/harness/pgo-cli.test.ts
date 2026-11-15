/* `scriptc build --pgo` and the beside-the-entry order file.
 *
 *   splitArgv                 -- the --pgo-run word splitter (no shell): quotes, escapes, the unterminated-quote error;
 *   layoutStaleWarning        -- 30 program functions listed and under 60% still defined, and neither bound alone;
 *   the CLI refusals          -- --pgo needs --pgo-run and exactly one of --pgo-signal / --pgo-no-signal; a signal that never matches fails;
 *   --pgo end to end (C and LLVM)
 *                             -- writes <entry>.scriptc-order.txt, the final binary prints what the plain build prints, a plain build applies the
 *                                file and says so once, --no-layout-order does not;
 *   a STALE file              -- 40 names the program does not have: the build succeeds, the output is unchanged, the warning prints once; a file
 *                                that still matches prints none (the positive control for the warning). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { layoutMatchStats, layoutStaleWarning, parseLayoutOrder } from "../../packages/compiler/src/backend/layout-order.js";
import { splitArgv } from "../../packages/cli/src/pgo.js";

const cli = join(import.meta.dirname, "../../packages/cli/dist/main.js");
const linux = process.platform === "linux";

describe("splitArgv", () => {
  test("words, quotes and escapes", () => {
    expect(splitArgv("a b  c")).toEqual(["a", "b", "c"]);
    expect(splitArgv(`node 'a b' "c d" e\\ f`)).toEqual(["node", "a b", "c d", "e f"]);
    expect(splitArgv(`sh -c 'echo "hi" | cat'`)).toEqual(["sh", "-c", `echo "hi" | cat`]);
    expect(splitArgv(`x "a\\"b"`)).toEqual(["x", `a"b`]);
    expect(splitArgv("")).toEqual([]);
    expect(splitArgv(`a '' b`)).toEqual(["a", "", "b"]);
  });
  test("an unterminated quote is an error, and nothing is expanded", () => {
    expect(() => splitArgv(`a 'b`)).toThrow(/unterminated/);
    expect(() => splitArgv(`a "b`)).toThrow(/unterminated/);
    expect(splitArgv("echo $HOME * > f | g")).toEqual(["echo", "$HOME", "*", ">", "f", "|", "g"]);
  });
});

describe("layoutStaleWarning", () => {
  const names = (n: number, prefix = "sc_f"): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join("\n");
  const stats = (listed: number, found: number): { listed: number; found: number } => ({ listed, found });
  test("fires below 60% of 30 or more program functions, and only then", () => {
    expect(layoutStaleWarning("o.txt", stats(30, 17))).toMatch(/only 17 \(57%\) still exist/); // positive control
    expect(layoutStaleWarning("o.txt", stats(30, 18))).toBeNull(); // exactly 60%
    expect(layoutStaleWarning("o.txt", stats(29, 0))).toBeNull(); // too few names to judge
    expect(layoutStaleWarning("o.txt", stats(100, 100))).toBeNull();
  });
  test("counts program functions (sc_*) only: the runtime's scr_* names live in other objects", () => {
    const order = parseLayoutOrder(`${names(40)}\n${names(500, "scr_x")}`);
    const defined = new Set(Array.from({ length: 40 }, (_, i) => `sc_f${i}`));
    expect(layoutMatchStats(order, defined)).toEqual({ listed: 40, found: 40 });
    expect(layoutMatchStats(order, new Set())).toEqual({ listed: 40, found: 0 });
  });
});

describe.skipIf(!linux)("the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-pgo-test-"));
  const app = join(dir, "app.ts");
  const SRC = (suffix: string): string => `function steady${suffix}(x: number): number {
  return x * 3 + 1;
}
function startup${suffix}(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  return s;
}
console.log("boot", startup${suffix}(100));
console.log("ready");
let acc = 0;
for (let i = 0; i < 60000000; i++) acc = (acc + steady${suffix}(i)) % 1000003;
console.log("done", acc);
`;
  writeFileSync(app, SRC(""));
  const run = (args: string[], cwd = dir): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 600_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  test("refusals: --pgo-run, the signal choice, a signal that never matches", () => {
    let r = run(["build", app, "--pgo"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/needs --pgo-run/);
    r = run(["build", app, "--pgo", "--pgo-run", "{bin}"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/exactly one of --pgo-signal/);
    r = run(["build", app, "--pgo", "--pgo-run", "{bin}", "--pgo-signal", "x", "--pgo-no-signal"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/exactly one of --pgo-signal/);
    r = run(["build", app, "--pgo", "--pgo-run", "{bin}", "--pgo-signal", "("]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not a regular expression/);
  });

  for (const backend of ["c", "llvm"]) {
    test(`--pgo end to end, ${backend}: order file, identical output, applied once, --no-layout-order`, { timeout: 900_000 }, () => {
      const sub = join(dir, backend);
      mkdirSync(sub, { recursive: true });
      const entry = join(sub, "app.ts");
      writeFileSync(entry, SRC(""));
      const plainBin = join(sub, "plain.bin");
      const orderFile = join(sub, "app.scriptc-order.txt");
      rmSync(orderFile, { force: true });
      // plain first: no order file beside the entry yet
      let r = run(["build", entry, "--backend", backend, "-o", plainBin]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toMatch(/layout order applied/);
      const want = execFileSync(plainBin, [], { encoding: "utf8" });
      // --pgo
      const pgoBin = join(sub, "pgo.bin");
      r = run(["build", entry, "--backend", backend, "--pgo", "--pgo-run", "{bin}", "--pgo-signal", "^ready", "-o", pgoBin]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toMatch(/pgo: 4\/4 ordered build/);
      expect(r.stderr).toMatch(/layout order applied/);
      expect(existsSync(orderFile)).toBe(true);
      const order = readFileSync(orderFile, "utf8");
      expect(order).toMatch(/^# scriptc layout order: \d+ functions/);
      expect(order).toMatch(/tier: last executed in epoch 1/); // the epoch signal reached the profiled program
      expect(execFileSync(pgoBin, [], { encoding: "utf8" })).toBe(want);
      expect(existsSync(`${pgoBin}.pgo-prof`)).toBe(false); // the instrumented binary is cleaned up
      // a plain build now picks the file up, once, with the same output
      const autoBin = join(sub, "auto.bin");
      r = run(["build", entry, "--backend", backend, "-o", autoBin]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr.match(/layout order applied/g)?.length).toBe(1);
      expect(execFileSync(autoBin, [], { encoding: "utf8" })).toBe(want);
      // --no-layout-order ignores it
      const offBin = join(sub, "off.bin");
      r = run(["build", entry, "--backend", backend, "--no-layout-order", "-o", offBin]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toMatch(/layout order applied/);
      expect(execFileSync(offBin, [], { encoding: "utf8" })).toBe(want);
    });

    test(`a stale order file never breaks the build or the output, ${backend}; the warning fires for it and not for a matching file`, { timeout: 900_000 }, () => {
      const sub = join(dir, `stale-${backend}`);
      mkdirSync(sub, { recursive: true });
      const entry = join(sub, "app.ts");
      writeFileSync(entry, SRC("V2")); // the functions are renamed (steadyV2, startupV2): the older names are gone
      const stale = join(sub, "stale.txt");
      writeFileSync(stale, `${Array.from({ length: 40 }, (_, i) => `sc_f_old${i}`).join("\n")}\n`);
      const refBin = join(sub, "ref.bin");
      let r = run(["build", entry, "--backend", backend, "--no-layout-order", "-o", refBin]);
      expect(r.status, r.stderr).toBe(0);
      const want = execFileSync(refBin, [], { encoding: "utf8" });
      const staleBin = join(sub, "stale.bin");
      r = run(["build", entry, "--backend", backend, "--layout-order", stale, "-o", staleBin]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toMatch(/lists 40 functions of this program and only 0 \(0%\) still exist/);
      expect(r.stderr.match(/warning: the layout order/g)?.length).toBe(1);
      expect(execFileSync(staleBin, [], { encoding: "utf8" })).toBe(want);
    });
  }
});
