/* --layout-order also orders the program's STRING LITERALS (immortal ScrStr statics in .data): the literals the ranked functions (and the data
 * tables) mention come first, a literal only an unranked function mentions comes after every other one. The REST app's 2.3 MB .data is 97%
 * resident because the executed code touches every 64 KiB fault-around window of it; clustering the hot literals leaves the cold ones' windows
 * unmapped (a planted program below reads the residency straight from /proc/<pid>/pagemap).
 *
 *   - THE ORDER: C and LLVM, GNU ld's section ordering and ld.lld's symbol ordering: every hot literal precedes every cold-only literal in
 *     the binary (nm -n), the output is unchanged, and the PLAIN build of the same program interleaves them (the control that the test can
 *     tell the two apart);
 *   - THE RESIDENCY: with the LLVM lane (the C lane's plain order is already by first reference for a small program) the ordered binary maps
 *     fewer .data pages than the plain one while it runs, and a literal no executed code reads is not resident in either (positive control). */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readSync, writeFileSync, readFileSync } from "node:fs";
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
const lldPresent = ((): boolean => {
  try {
    execFileSync("ld.lld", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

/** 40 functions alternating cold (never called) and hot (called), each over its own 9 KB literal, so the plain order interleaves them. */
function program(): { src: string; hot: string[]; cold: string[] } {
  const hot: string[] = [];
  const cold: string[] = [];
  const lines: string[] = [];
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let i = 0; i < 40; i++) {
    let lit = "";
    for (let k = 0; k < 9000; k++) lit += "abcdefghij"[rnd() % 10];
    const name = (i % 2 === 1 ? "hot" : "cold") + i;
    (i % 2 === 1 ? hot : cold).push(name);
    lines.push(`function ${name}(): number { return "${lit}".length; }`);
  }
  lines.push("let total = 0;");
  lines.push(`for (const f of [${hot.join(",")}]) total += f();`);
  lines.push(`if (process.argv.length > 99) { ${cold.map((n) => `total += ${n}();`).join(" ")} }`);
  lines.push("console.log(total);");
  lines.push('setTimeout(() => { console.log("done"); }, 4000);');
  return { src: lines.join("\n") + "\n", hot, cold };
}

describe.skipIf(!linkerOrders())("data literals follow the layout order", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-dataorder-test-"));
  const cache = join(dir, "cache");
  mkdirSync(cache);
  const { src, hot, cold } = program();
  const entry = join(dir, "app.ts");
  writeFileSync(entry, src);
  const order = join(dir, "order.txt");
  writeFileSync(order, hot.map((h) => `sc_f_${h}`).join("\n") + "\nsc_f__x25_main\nsc_f__x25_init_0\n");
  const build = (backend: "c" | "llvm", out: string, ordered: boolean, env: Record<string, string> = {}): void => {
    const r = spawnSync(process.execPath, [cli, "build", entry, "--backend", backend, ...(ordered ? ["--layout-order", order] : []), "-o", out], {
      cwd: dir,
      encoding: "utf8",
      timeout: 600_000,
      env: { ...process.env, SCRIPTC_CACHE_DIR: cache, ...env },
    });
    expect(r.status, r.stderr).toBe(0);
  };
  /** Literal symbols (the 9 KB ones) in address order, tagged by what the program's source says about them: lengths are all 9000, so the tag
   * comes from the order of definition: cold literals are interned from functions cold0, cold2, ... and hot ones from hot1, hot3, ... */
  const literalOrder = (bin: string): { sym: string; n: number }[] =>
    execFileSync("nm", ["-n", "-S", "-t", "d", bin], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.split(" "))
      .filter((p) => p.length === 4 && /^sc_lit_\d+$/.test(p[3]!) && Number(p[1]) >= 9000)
      .map((p) => ({ sym: p[3]!, n: Number(/\d+/.exec(p[3]!.slice(7))![0]) }));
  // interning order is the module's function order: literal k belongs to function k (cold for even k, hot for odd k)
  const isHot = (n: number): boolean => n % 2 === 1;
  const hotBeforeCold = (bin: string): boolean => {
    const seq = literalOrder(bin);
    expect(seq.length).toBe(40);
    const lastHot = seq.map((s) => isHot(s.n)).lastIndexOf(true);
    const firstCold = seq.map((s) => isHot(s.n)).indexOf(false);
    return lastHot < firstCold;
  };
  const kinds: [string, Record<string, string>][] = [["GNU ld section ordering (or lld when ld is old)", {}]];
  if (lldPresent) kinds.push(["ld.lld symbol ordering", { SCRIPTC_LAYOUT_FORCE_LLD: "1" }]);

  for (const backend of ["c", "llvm"] as const) {
    for (const [label, env] of kinds) {
      test(`${backend}: ${label}: every hot literal precedes every cold-only one, the plain build interleaves them, the output is unchanged`, () => {
        const plain = join(dir, `plain-${backend}-${label.length}`);
        const ord = join(dir, `ord-${backend}-${label.length}`);
        build(backend, plain, false, env);
        build(backend, ord, true, env);
        const o1 = spawnSync(plain, [], { encoding: "utf8", timeout: 60_000 });
        const o2 = spawnSync(ord, [], { encoding: "utf8", timeout: 60_000 });
        expect(o2.stdout).toBe(o1.stdout);
        expect(o2.status).toBe(0);
        if (backend === "llvm") expect(hotBeforeCold(plain), "control: the plain LLVM order interleaves hot and cold").toBe(false);
        expect(hotBeforeCold(ord)).toBe(true);
      }, 600_000);
    }
  }

  /** The .data (rw) mapping of a running process: [resident pages, pages in the mapping], read from /proc/<pid>/pagemap while it waits in setTimeout. */
  const residency = async (bin: string): Promise<{ resident: number; pages: number }> => {
    const child = spawn(bin, [], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const maps = readFileSync(`/proc/${child.pid}/maps`, "utf8").split("\n");
      const name = bin.split("/").pop()!;
      const rw = maps.map((l) => /^([0-9a-f]+)-([0-9a-f]+) rw\S+ \S+ \S+ \S+\s+(.*)$/.exec(l)).find((m) => m !== null && m[3]!.endsWith(name));
      expect(rw, "the rw mapping of the binary").toBeTruthy();
      const lo = parseInt(rw![1]!, 16);
      const hi = parseInt(rw![2]!, 16);
      const fd = openSync(`/proc/${child.pid}/pagemap`, "r");
      let resident = 0;
      let pages = 0;
      const buf = Buffer.alloc(8);
      for (let va = lo; va < hi; va += 4096) {
        readSync(fd, buf, 0, 8, (va / 4096) * 8);
        pages++;
        if ((buf.readBigUInt64LE(0) >> 63n) & 1n) resident++;
      }
      return { resident, pages };
    } finally {
      child.kill("SIGTERM");
    }
  };
  test("residency (LLVM lane): the ordered binary maps fewer .data pages than the plain one, and the plain one maps them all (positive control)", async () => {
    const plain = join(dir, "res-plain");
    const ord = join(dir, "res-ord");
    build("llvm", plain, false);
    build("llvm", ord, true);
    const a = await residency(plain);
    const b = await residency(ord);
    // plain: the alternating cold/hot literals put a touched literal in every 64 KiB window, so fault-around maps the whole section
    expect(a.resident).toBe(a.pages);
    // ordered: the 20 hot literals (180 KB) share a few windows; the cold ones (never read) stay unmapped
    expect(b.resident).toBeLessThan(a.resident * 0.75);
  }, 600_000);
});
