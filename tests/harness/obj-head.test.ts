/* The dyn head of a boxed standalone class instance, on BOTH backends.
 *
 * A class the program can box lays out its instances as { rc, head word (kind | class slot), fields }: the instance IS its dyn value. The C emitter
 * spells the head as struct members; the LLVM emitter spells it as one i64 at byte 8, and the two must say the same thing to the runtime
 * (scr_runtime.h: scr_dyn_inst_is_head / scr_dyn_inst_cls). Three layers:
 *   1. the LLVM head WORD, compiled against the real runtime header: kind 12, the head marker, the class slot -- and the planted controls (a word
 *      without the marker, a word with the wrong kind) must FAIL the same check, so a green result is not a check that cannot fire;
 *   2. the emitted .ll of a program with head classes: the struct carries the extra i64 right after rc, every head class's `new` stores its own
 *      word, the table and the init call exist -- and a planted mutation of the stored word makes the checker report it;
 *   3. behaviour: programs that box, hold, release and cycle head instances answer what Node answers, plain and under the RC audit (--sanitize),
 *      C and LLVM. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { llHeadWord } from "../../packages/compiler/src/backend/llvm/classes.js";

const root = join(import.meta.dirname, "../..");
const cli = join(root, "packages/cli/dist/main.js");
const rtSrc = join(root, "packages/runtime/src");
const linux = process.platform === "linux";
const dir = mkdtempSync(join(tmpdir(), "scriptc-objhead-test-"));

/** Compile and run a C probe that reads `word` as a head instance's second word through the runtime header's accessors. */
function probe(word: string, slot: number): { status: number | null; out: string } {
  const src = join(dir, `probe-${word}.c`);
  writeFileSync(
    src,
    `#include "scr_runtime.h"
#include <stdio.h>
#include <string.h>
static const ScrDynClass k0, k1, k2, k3;
const ScrDynClass *const *scr_dyn_head_tbl; /* the runtime's own table pointer, set here instead of by scr_dyn_head_classes */
int main(void) {
  static const ScrDynClass *const tbl[] = { &k0, &k1, &k2, &k3 };
  scr_dyn_head_tbl = tbl;
  struct { size_t rc; unsigned long long w; } o = { 1, ${word}ULL };
  ScrDyn *d = (ScrDyn *)&o;
  if (d->kind != SCR_DYN_OBJINST) { puts("kind"); return 1; }
  if (!scr_dyn_inst_is_head(d)) { puts("marker"); return 2; }
  if (scr_dyn_inst_cls(d) != tbl[${slot}]) { puts("slot"); return 3; }
  if (scr_dyn_inst_o(d) != (void *)d) { puts("self"); return 4; }
  puts("ok");
  return 0;
}
`,
  );
  const exe = join(dir, `probe-${word}`);
  const cc = spawnSync("clang", ["-w", "-std=c11", "-I", rtSrc, src, "-Wl,--unresolved-symbols=ignore-all", "-o", exe], { encoding: "utf8" });
  if (cc.status !== 0) return { status: -1, out: cc.stderr.slice(0, 400) };
  const r = spawnSync(exe, [], { encoding: "utf8" });
  return { status: r.status, out: r.stdout.trim() };
}

describe.skipIf(!linux)("the LLVM head word, against the runtime's accessors", () => {
  test("slot 0..3: kind 12, marker set, class slot as stamped", () => {
    for (const slot of [0, 1, 2, 3]) expect(probe(llHeadWord(slot), slot), `slot ${slot}`).toEqual({ status: 0, out: "ok" });
  });
  test("the flag bits (possible root / root once the container bit is set) do not disturb the class slot, and byte 13 carries them", () => {
    for (const bits of [0x4000, 0x2000]) {
      expect(probe(llHeadWord(3, bits), 3), `bits ${bits.toString(16)}`).toEqual({ status: 0, out: "ok" });
    }
    // the release arm reads byte 13: 0x80 head, 0x40 always a root, 0x20 a root once the bit is set
    const byte13 = (w: string): number => Number((BigInt(w) >> 40n) & 0xffn);
    expect(byte13(llHeadWord(1, 0))).toBe(0x80);
    expect(byte13(llHeadWord(1, 0x4000))).toBe(0xc0);
    expect(byte13(llHeadWord(1, 0x2000))).toBe(0xa0);
  });
  test("planted controls: a word with no marker, with the wrong kind, with the wrong slot all fail", () => {
    const good = BigInt(llHeadWord(2));
    expect(probe((good & ~(0x8000n << 32n)).toString(), 2).out).toBe("marker"); // bit 7 of byte 13 cleared
    expect(probe(((good & ~0xffffffffn) | 11n).toString(), 2).out).toBe("kind"); // kind 11, not 12
    expect(probe(llHeadWord(1), 2).out).toBe("slot"); // stamped slot 1, read as 2
  });
});

/** The emitted-.ll checker: every `%sc_o_*` struct of a head class has `i64, i64` at its start and its `new` stores the word for its own slot. */
function checkHeads(ll: string): string[] {
  const errs: string[] = [];
  const table = /@sc_head_tbl = internal constant \[(\d+) x ptr\]/.exec(ll);
  if (table === null) return ["no @sc_head_tbl"];
  if (!/call void @scr_dyn_head_classes\(ptr @sc_head_tbl, i64 \d+\)/.test(ll)) errs.push("no scr_dyn_head_classes call in main");
  const stamps = [...ll.matchAll(/define internal ptr @sc_new_(\w+)\(\)[\s\S]*?store i64 (\d+), ptr %hdp ; dyn head: [^\n]*flags 0x([0-9a-f]+) \| class index (\d+)/g)];
  if (stamps.length !== Number(table[1])) errs.push(`${stamps.length} stamped classes for a ${table[1]}-entry table`);
  for (const m of stamps) {
    if (m[2] !== llHeadWord(Number(m[4]), parseInt(m[3]!, 16))) errs.push(`class ${m[1]} stores ${m[2]}, expected ${llHeadWord(Number(m[4]), parseInt(m[3]!, 16))}`);
    if (!new RegExp(`%sc_o_${m[1]} = type \\{ i64, i64[,} ]`).test(ll)) errs.push(`class ${m[1]}: struct does not start with i64, i64`);
  }
  return errs;
}

const PROGRAMS: Record<string, string> = {
  // A gated class (dyn fields only: the container bit) whose instances are boxed: a bit-clear instance dies by plain release, and an instance that
  // is later handed a container pointing back at itself (the flip) is a garbage cycle the collector must still find.
  flip: `class Col { name: string; meta: any; idx: number; constructor(i: number) { this.name = "c" + i; this.meta = null; this.idx = i; } }
const hold: any[] = [];
let s = 0;
for (let r = 0; r < 30000; r++) {
  const c = new Col(r);
  const a: any = c;
  hold.push(a);
  if (r % 3 === 0) c.meta = a; // the instance holds itself: a one-member garbage cycle once the bit flips
  else if (r % 3 === 1) c.meta = "leaf" + r;
  if (hold.length > 40) { s += hold.length; hold.length = 0; }
}
const k: any = new Col(5);
console.log(s, k.idx, k.name, k.meta);
`,
  cycles: `class Cyc { next: Cyc | null; tag: any; idx: number; constructor(i: number) { this.next = null; this.tag = null; this.idx = i; } }
class Col { name: string; meta: any; idx: number; constructor(i: number) { this.name = "c" + i; this.meta = null; this.idx = i; } }
const hold: any[] = [];
let s = 0;
for (let r = 0; r < 20000; r++) {
  const a = new Cyc(r); const b = new Cyc(r + 1);
  a.next = b; b.next = a;
  hold.push(a as any); hold.push(b as any);
  const c = new Col(r); c.meta = { k: r };
  hold.push(c as any);
  if (hold.length > 30) { s += hold.length; hold.length = 0; }
}
const k: any = new Col(7); const k2: any = k; const k3: any = k2;
console.log(s, k3.idx, k.name);
`,
  narrow: `class P { n: number; tag: any; constructor(n: number) { this.n = n; this.tag = null; } get(): number { return this.n * 2; } }
class Q { n: number; tag: any; constructor(n: number) { this.n = n; this.tag = null; } get(): number { return this.n + 1; } }
const xs: any[] = [new P(3), new Q(4), new P(5)];
let s = 0;
let ps = 0;
for (let i = 0; i < xs.length; i++) {
  const x = xs[i];
  if (x instanceof P) { s += x.get(); ps++; }
  else if (x instanceof Q) s += x.get() * 100;
}
console.log(s, ps, xs.length, String(xs[1] instanceof P), typeof xs[0]);
`,
};

describe.skipIf(!linux)("head classes on both backends", () => {
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", timeout: 600_000 });
  for (const [name, src] of Object.entries(PROGRAMS)) {
    const entry = join(dir, `${name}.ts`);
    writeFileSync(entry, src);
    const want = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], { encoding: "utf8" });
    for (const backend of ["c", "llvm"]) {
      for (const mode of [[], ["--sanitize"]]) {
        test(`${name}: ${backend}${mode.length ? " " + mode[0] : ""} answers what node answers`, { timeout: 900_000 }, () => {
          const out = join(dir, `${name}.${backend}${mode.length ? ".san" : ""}`);
          const r = run(["build", entry, "--backend", backend, ...mode, "-o", out]);
          expect(r.status, r.stderr.slice(0, 600)).toBe(0);
          const got = spawnSync(out, [], { encoding: "utf8", timeout: 120_000 });
          expect(got.status, got.stderr.slice(0, 600)).toBe(0);
          expect(got.stdout).toBe(want);
        });
      }
    }
  }
  test("the emitted .ll of a head program passes the checker, and a planted mutation does not", { timeout: 600_000 }, () => {
    const sub = join(dir, "keep");
    mkdirSync(sub, { recursive: true });
    const entry = join(dir, "cycles.ts");
    const r = run(["build", entry, "--backend", "llvm", "--keep-c", "-o", join(sub, "cycles.bin")]);
    expect(r.status, r.stderr.slice(0, 600)).toBe(0);
    const ll = readFileSync(join(sub, "cycles.ll"), "utf8");
    expect(checkHeads(ll)).toEqual([]);
    const word = /store i64 (\d+), ptr %hdp/.exec(ll)![1]!;
    expect(checkHeads(ll.replace(`store i64 ${word}, ptr %hdp`, `store i64 ${BigInt(word) + 1n}, ptr %hdp`)).length).toBeGreaterThan(0); // wrong word
    expect(checkHeads(ll.replace(/(%sc_o_\w+ = type \{ i64), i64,/, "$1,")).length).toBeGreaterThan(0); // struct without the head slot
  });
});
