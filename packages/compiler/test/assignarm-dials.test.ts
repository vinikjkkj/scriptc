/* The five consumer rungs that give a NARROWED read of a widened keyed
 * read the answer its unit arm has, and the dials that price them.
 *
 * `keyedReadAtAssignSlot` takes `firstEncType = child.attrs.type` to its
 * undefined-armed width. tsc then narrows the assignment to the declared
 * type filtered by the type assigned, so the very next read of the binding
 * is spelled `string` and bridges through `checkedArmBridge` ->
 * `narrowedArmHelper` — a CHECKED extraction that throws the family
 * TypeError on the unit arm. That is loud and catchable, and for five
 * consumers it is also the wrong answer, because the consumer HAS one:
 *
 *   SCRIPTC_NULLARM_OFF=1   `v ?? d`            — the default, not a throw
 *   SCRIPTC_EQARM_OFF=1     `v === "lit"`       — false, not a throw
 *   SCRIPTC_SWLOCAL_OFF=1   `switch (v)`        — `default`, not a throw
 *   SCRIPTC_STRARM_OFF=1    `String(v)`, `+`    — "undefined", not a throw
 *   SCRIPTC_RECVARM_OFF=1   `v.length`          — Node's OWN TypeError text
 *   SCRIPTC_ASSIGNARM_OFF=1 the widening itself — every row aborts again
 *
 * THE HAZARD THIS FILE IS ARMED AGAINST is the one `switcharm-dials`
 * names: trading a runtime kill for a COMPILE-TIME refusal. The switch rung
 * rides `lowerUnionSwitch`, which refuses clause shapes the primitive
 * switch lowers happily, so every shape it would refuse must DECLINE — and
 * a decline has to be a byte-identical TU, not merely a program that still
 * compiles.
 *
 * The SECOND hazard is allocation. `estado-encswitch.md` §8.4 records that
 * `unionEq` against a literal allocates — `scr_union_new_ref` plus a
 * release around every compare — and asks that any block widening more
 * comparisons measure it. The literal-comparison rung does not use
 * `unionEq` at all: the tag test proves the arm, so the payload comes out
 * with a bare `unionNarrow` and the compare is the same `strEq` against the
 * same static literal the un-widened program emitted. That is asserted here
 * against the hand-written spelling, which does allocate and still does.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

const HEAD = `type Attrs = Record<string, string>;\n`;

/* One program per rung, each using ONLY that rung's consumer, so a dial
 * that changes a program it has no business in is visible as a byte
 * difference where there should be none. */
const P_NULL = `${HEAD}export function f(a: Attrs): string {
  let v: string | undefined;
  v = a.k;
  return v ?? "d";
}
console.log(f({ k: "x" }));
export {};
`;

const P_EQ = `${HEAD}export function f(a: Attrs): string {
  let v: string | undefined;
  v = a.k;
  return v === "msg" ? "y" : "n";
}
console.log(f({ k: "x" }));
export {};
`;

const P_SW = `${HEAD}export function f(a: Attrs): string {
  let v: string | undefined;
  v = a.k;
  switch (v) { case "msg": return "M"; default: return "D" }
}
console.log(f({ k: "x" }));
export {};
`;

const P_STR = `${HEAD}export function f(a: Attrs): string {
  let v: string | undefined;
  v = a.k;
  return String(v);
}
console.log(f({ k: "x" }));
export {};
`;

const P_RECV = `${HEAD}export function f(a: Attrs): number {
  let v: string | undefined;
  v = a.k;
  return v.length;
}
console.log(f({ k: "x" }));
export {};
`;

/* The clause shapes `lowerUnionSwitch` refuses, on a widened local: every
 * one DECLINES and keeps today's lowering. */
const DECLINERS = `${HEAD}const ALPHA = "alpha";
export function nonLiteral(a: Attrs): string {
  let v: string | undefined;
  v = a.k;
  switch (v) { case ALPHA: return "A"; default: return "D" }
}
export function fallsThrough(a: Attrs): string {
  let s = "";
  let v: string | undefined;
  v = a.k;
  switch (v) { case "p": s += "P"; case "q": s += "Q"; break; default: s += "D" }
  return s;
}
export function earlyBreak(a: Attrs): string {
  let s = "";
  let v: string | undefined;
  v = a.k;
  switch (v) { case "e": s += "E"; if (s.length === 1) break; s += "!"; break; default: s += "D" }
  return s;
}
console.log(nonLiteral({ k: "alpha" }), fallsThrough({ k: "p" }), earlyBreak({ k: "e" }));
export {};
`;

/* The HAND-WRITTEN union comparison — no keyed read anywhere, so no rung
 * in this family touches it. It is §8.4's allocating shape, and it is here
 * as the CONTROL for the claim that the widened one is cheaper. */
const HAND_EQ = `export function f(v: string | undefined): string {
  return v === "msg" ? "y" : "n";
}
console.log(f("msg"), f(undefined));
export {};
`;

const count = (tu: string, re: RegExp): number => (tu.match(re) ?? []).length;

/* The MISS path the emitter plants for a keyed read at a non-armed width. */
const TRAP = /scr_trap_fmt\("scriptc: TypeError: record has no key/g;
/* The interned per-union strict-equality helper — the allocating compare. */
const UNION_EQ = /\bsc_ue_\d+\(/g;
/* The allocation itself — one fresh tagged box. */
const UNION_NEW = /scr_union_new_ref\(/g;
/* Node's own receiver message, spelled by the recvarm rung. */
const NODE_RECV = /Cannot read properties of undefined \(reading 'length'\)/g;

const DIALS = [
  "SCRIPTC_ASSIGNARM_OFF",
  "SCRIPTC_NULLARM_OFF",
  "SCRIPTC_EQARM_OFF",
  "SCRIPTC_SWLOCAL_OFF",
  "SCRIPTC_STRARM_OFF",
  "SCRIPTC_RECVARM_OFF",
  "SCRIPTC_CASEEQ_OFF",
] as const;

let dir: string | undefined;
let seq = 0;

async function emit(program: string, off: readonly string[]): Promise<{ tu: string; diags: string[] }> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-assignarm-"));
  // The emitted TU carries its entry path in a comment on every function,
  // so two variants differ by their FILENAME before they differ by a
  // lowering — and a same-length name makes that difference one character
  // per function, which reads exactly like a real diff. The name is
  // normalised out of the text below; the tag is padded so the two paths
  // are the same length as well.
  const tag = String(seq++).padStart(4, "0");
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, program, "utf8");
  const saved = DIALS.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of DIALS) delete process.env[k];
    for (const k of off) process.env[k] = "1";
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend: "c",
      emitOnly: true,
    });
    if (!res.ok) return { tu: "", diags: res.diagnostics.map((x) => x.message) };
    const tu = await readFile(res.cPath, "utf8");
    return { tu: tu.split(`main-${tag}.ts`).join("main.ts").split(`program-${tag}`).join("program"), diags: [] };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/* The five CONSUMER dials. The widening itself (ASSIGNARM) and the union
 * desugar's own case-test lowering (CASEEQ) are separate concerns and get
 * their own tests. */
const ALL_OFF = DIALS.filter((d) => d !== "SCRIPTC_ASSIGNARM_OFF" && d !== "SCRIPTC_CASEEQ_OFF");

describe("the narrowed-read consumer rungs", () => {
  test("the widening removes the aborting keyed read from every consumer shape", async () => {
    for (const [name, program] of [
      ["nullish", P_NULL], ["eq", P_EQ], ["switch", P_SW], ["string", P_STR], ["member", P_RECV],
    ] as const) {
      const base = await emit(program, ["SCRIPTC_ASSIGNARM_OFF"]);
      expect(base.diags, name).toEqual([]);
      // Non-trivial: the read really does abort with the rung ablated.
      expect(count(base.tu, TRAP), name).toBeGreaterThan(0);

      const fixed = await emit(program, []);
      expect(fixed.diags, name).toEqual([]);
      expect(count(fixed.tu, TRAP), name).toBe(0);
    }
  }, 300_000);

  test("each consumer dial changes its OWN program and no other", async () => {
    const cases = [
      ["SCRIPTC_NULLARM_OFF", P_NULL],
      ["SCRIPTC_EQARM_OFF", P_EQ],
      ["SCRIPTC_SWLOCAL_OFF", P_SW],
      ["SCRIPTC_STRARM_OFF", P_STR],
      ["SCRIPTC_RECVARM_OFF", P_RECV],
    ] as const;
    for (const [dial, program] of cases) {
      const on = await emit(program, []);
      expect(on.diags, dial).toEqual([]);
      const mine = await emit(program, [dial]);
      expect(mine.diags, dial).toEqual([]);
      // Load-bearing: ablating it changes the emitted TU.
      expect(mine.tu, dial).not.toBe(on.tu);
      // ...and it is the ONLY one that does: with every consumer dial off,
      // the TU is the one this dial alone produced. A rung that fired on a
      // program it has no business in would show up here.
      const all = await emit(program, ALL_OFF);
      expect(all.diags, dial).toEqual([]);
      expect(all.tu, dial).toBe(mine.tu);
    }
  }, 600_000);

  test("Node's own receiver message is what the member read carries", async () => {
    const fixed = await emit(P_RECV, []);
    expect(fixed.diags).toEqual([]);
    expect(count(fixed.tu, NODE_RECV)).toBeGreaterThan(0);

    const off = await emit(P_RECV, ["SCRIPTC_RECVARM_OFF"]);
    expect(off.diags).toEqual([]);
    expect(count(off.tu, NODE_RECV)).toBe(0);
  }, 240_000);

  test("the literal comparison does NOT allocate — §8.4's lowering, built", async () => {
    // §8.4 names the HAND-WRITTEN spelling as the allocating one: `u ===
    // "msg"` on a `string | undefined` parameter, no switch anywhere, emits
    // `scr_union_new_ref` + a release around a `sc_ue_N` call. That is the
    // baseline, and `SCRIPTC_CASEEQ_OFF=1` is what it looks like.
    const hand = await emit(HAND_EQ, ["SCRIPTC_CASEEQ_OFF"]);
    expect(hand.diags).toEqual([]);
    expect(count(hand.tu, UNION_EQ)).toBeGreaterThan(0);
    expect(count(hand.tu, UNION_NEW)).toBeGreaterThan(0);

    // With the dial on, the same source interns no such helper: the tag test
    // proves the arm and the payload comes out with a bare unionNarrow, so
    // the compare is `scr_str_eq` against the static literal.
    const handCheap = await emit(HAND_EQ, []);
    expect(handCheap.diags).toEqual([]);
    expect(count(handCheap.tu, UNION_EQ)).toBe(0);
    expect(count(handCheap.tu, UNION_NEW)).toBeLessThan(count(hand.tu, UNION_NEW));

    // ...and so does the BRIDGED spelling this block's own rung serves —
    // a widened local whose read tsc narrowed to `string`.
    const mine = await emit(P_EQ, []);
    expect(mine.diags).toEqual([]);
    expect(count(mine.tu, UNION_EQ)).toBe(0);
  }, 300_000);

  test("the union switch's own case tests stopped allocating too", async () => {
    // §8.4's four allocations on zapo's inbound `<enc>` path are the union
    // DESUGAR's, not this family's: `lowerUnionSwitch` compares with
    // `unionEq`, which wraps the case literal into the union — a fresh box
    // per test. `SCRIPTC_CASEEQ_OFF=1` restores that; the default emits the
    // tag test plus a plain `strEq` against the static literal.
    const alloc = await emit(P_SW, ["SCRIPTC_CASEEQ_OFF"]);
    expect(alloc.diags).toEqual([]);
    expect(count(alloc.tu, UNION_EQ)).toBeGreaterThan(0);
    expect(count(alloc.tu, UNION_NEW)).toBeGreaterThan(0);

    const cheap = await emit(P_SW, []);
    expect(cheap.diags).toEqual([]);
    expect(count(cheap.tu, UNION_EQ)).toBe(0);
    // Strictly fewer boxes built, on the same program, for the same answer.
    expect(count(cheap.tu, UNION_NEW)).toBeLessThan(count(alloc.tu, UNION_NEW));
  }, 240_000);

  test("the clause shapes the desugar refuses DECLINE — byte-identically", async () => {
    const fixed = await emit(DECLINERS, []);
    expect(fixed.diags).toEqual([]);
    expect(fixed.tu.length).toBeGreaterThan(0);

    // "Declined" said about a LOWERING, not about a program that happened
    // to still compile: with every consumer dial off the TU is the same
    // bytes. (The assignment rung itself stays ON — it widens the slot; it
    // is the switch consumer that declines.)
    const base = await emit(DECLINERS, ALL_OFF);
    expect(base.diags).toEqual([]);
    expect(fixed.tu).toBe(base.tu);
  }, 300_000);
});
