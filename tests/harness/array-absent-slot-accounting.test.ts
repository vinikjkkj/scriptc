/* The ABSENT array slot, and every hand that touches one.
 *
 * A refcounted element slot can hold NULL. It always could: arrayNewLen
 * (`Array.from({ length: n })`) fills n of them, the growth half of
 * `a.length = n` appends more, and the tombstone write `a[i] = null as
 * unknown as T` — the GC-drop idiom a ring-buffer queue uses — now clears
 * one. What was never true is the claim in arrayNewLen's own doc comment
 * that "reads of unassigned slots trap": measured on main, reading one
 * SEGFAULTED (indexed read, for-of, and the console.log / JSON walkers all
 * handed the NULL to a field load), and `pop()` handed it to a typed local
 * where `p === null` folds to the constant false — a silent wrong answer,
 * the self-concealing shape.
 *
 * So the rule is: a READ refuses an absent slot at a named index, a COPY
 * propagates it (JS spreads and slices holes too), and a RELEASE walks past
 * it. This file is the totality check on that rule. Every function in the
 * two array files that interprets a slot as a POINTER must be classified
 * here, and its body must actually contain the mechanism its class claims.
 * A new array method that reads elements and forgets absence fails this
 * test rather than crashing three layers down in someone's program.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");

const arraySrc = read("packages/runtime/src/scr_array.c");
const copySrc = read("packages/runtime/src/scr_copying.c");
const headerSrc = read("packages/runtime/src/scr_runtime.h");

/** How a function is allowed to meet an absent slot. */
type Class = "refuses" | "propagates" | "releases" | "never";

interface Rule {
  readonly cls: Class;
  readonly why: string;
}

/** The mechanism each class must be able to point at in the body. `never`
 * points at nothing — it is a claim about the CALLERS, and carries its
 * argument in `why`. */
const MECHANISM: Record<Exclude<Class, "never">, RegExp> = {
  refuses: /scr_arr_trap_absent\(/,
  propagates: /scr_elem_retain_p\(|copying_arr_retain_slot\(|memcpy\(|memmove\(|p == NULL|== NULL \? /,
  releases: /scr_elem_release\(|p == NULL|p != NULL/,
};

const RULES: ReadonlyMap<string, Rule> = new Map([
  // ── the reads: a hole has no value to answer with ──────────────────────
  ["scr_arr_get_ref", {
    cls: "refuses",
    why: "the indexed read a[i], and through it for-of, map/filter/forEach and every walker (console.log, JSON.stringify, String()) — all of them route here in BOTH backends, which is why one branch fences the lot",
  }],
  ["scr_arr_pop_ref", {
    cls: "refuses",
    why: "hands the element OUT to a typed slot, whose type has no null: `p === null` on the result folds to the constant false, so a hole would read as a live object",
  }],
  ["scr_arr_shift_ref", { cls: "refuses", why: "pop's mirror at the front, same reason" }],

  // ── the copies: JS spreads and slices holes, so do we ──────────────────
  ["scr_arr_copy_ref", {
    cls: "propagates",
    why: "get_ref's copy twin, and the only read that does not refuse — the emitters' spread / pushSpread loops use it so `[...a]` cannot trap where `a.slice()` succeeds",
  }],
  ["scr_arr_slice", { cls: "propagates", why: "a shallow copy of a range; a hole stays a hole" }],
  ["scr_arr_splice", { cls: "propagates", why: "moves slots out wholesale (memcpy/memmove), no retain to trip over" }],
  ["scr_arr_copy_within", { cls: "propagates", why: "the ring-buffer compaction shape copyWithin(0, head) is EXACTLY a run of tombstones being overwritten" }],
  ["scr_arr_fill_ref", { cls: "propagates", why: "writes over holes — filling an array of absent slots is the new Array(n) idiom; the value itself may be absent too" }],
  ["scr_elem_retain_p", { cls: "propagates", why: "the one spelling of the element retain, and the one place the NULL guard has to live" }],
  ["copying_arr_retain_slot", { cls: "propagates", why: "the same guard for toReversed / toSpliced / toSorted / with" }],

  // ── the releases: a hole owns nothing ──────────────────────────────────
  ["scr_elem_release", { cls: "releases", why: "the one spelling of the element release; an absent slot owns nothing" }],
  ["scr_arr_release", { cls: "releases", why: "teardown walks every slot through scr_elem_release" }],
  ["scr_arr_truncate", { cls: "releases", why: "`a.length = n` drops the tail through scr_elem_release" }],
  ["scr_arr_set_slot", { cls: "releases", why: "unlink-then-release of the slot a write displaces — including a tombstone written twice" }],
  ["scr_arr_trace_v", { cls: "releases", why: "the cycle collector's trace: an absent slot is not an edge, so it is skipped rather than visited with NULL" }],

  // ── the ones a hole cannot reach, and why ──────────────────────────────
  ["scr_arr_ref_eq", {
    cls: "propagates",
    why: "indexOf / includes: scr_str_eq dereferences BOTH sides, so an absent slot (or needle) short-circuits to pointer identity before the STR arm",
  }],
  ["scr_arr_join", {
    cls: "never",
    why: "the compiler refuses join on ref-element arrays (SC1090) and the arm traps as an internal error; the STR arm is reachable only for string[], and its own absent slots are caught by that trap being a trap",
  }],
  ["scr_str_raw", {
    cls: "never",
    why: "String.raw over two arrays the FRONTEND builds literal-by-literal; neither can carry a hole",
  }],
  ["scr_arr_push_slot", { cls: "never", why: "append only: it never reads an existing slot" }],
  ["scr_arr_unshift_slot", { cls: "never", why: "append at the front: memmove of opaque slots, no read" }],
  ["scr_arr_pop_slot", { cls: "never", why: "hands the raw slot to the typed pop_* wrappers; pop_ref is the one that refuses" }],
  ["scr_arr_shift_slot", { cls: "never", why: "same, for shift_ref" }],
  ["scr_arr_reverse", { cls: "never", why: "slots only swap positions inside the array: no count moves and no pointer is ever dereferenced, so a hole rides along untouched" }],
  ["copying_arr_copy_slot", { cls: "never", why: "one line of delegation to copying_arr_retain_slot" }],
  ["copying_arr_new_like", { cls: "never", why: "allocates the destination; it reads the element KIND, never a slot" }],
  ["copying_elem_is_ref", { cls: "never", why: "the element-kind predicate; it never sees a slot at all" }],
  ["scr_arr_to_reversed", { cls: "never", why: "delegates every slot to copying_arr_copy_slot" }],
  ["scr_arr_to_spliced", { cls: "never", why: "same" }],
  ["scr_arr_with_ref", { cls: "never", why: "slice plus one copying_arr_retain_slot of the incoming value, both of which already guard" }],
  ["scr_arr_index_of_ref", { cls: "never", why: "the loop delegates every comparison to scr_arr_ref_eq" }],
  ["scr_arr_includes_ref", { cls: "never", why: "indexOf(v) >= 0, and nothing else" }],
  ["scr_elem_is_ref", { cls: "never", why: "the element-kind predicate; it never sees a slot at all" }],
  ["scr_arr_new", { cls: "never", why: "the constructor: it records the element kind and allocates; there are no slots yet" }],
  ["scr_arr_new_ref", { cls: "never", why: "the same for SCR_ELEM_REF, plus the retain/release/trace function pointers" }],
]);

/** Top-level C function definitions: a signature that starts at column 0 and
 * ends at the first `}` in column 0. Good enough for these two files, and it
 * FAILS LOUD (an empty harvest) if either ever stops looking like this. */
function functions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^[A-Za-z_][A-Za-z0-9_ *]*?([A-Za-z_][A-Za-z0-9_]*)\(([^;]*?)\)\s*\{$/gm;
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length;
    const end = src.indexOf("\n}", start);
    out.set(m[1]!, src.slice(start, end < 0 ? src.length : end));
  }
  return out;
}

const bodies = new Map([...functions(arraySrc), ...functions(copySrc)]);

/** Does this body interpret a slot as a POINTER — i.e. can it meet a hole?
 * The tell is that it distinguishes the REFERENCE element kinds at all: a
 * scalar accessor (`scr_arr_get_f64`, `scr_arr_index_of_bool`) reads
 * `a->data[i]` too, and 0.0 is a perfectly good double. */
function touchesRefSlot(body: string): boolean {
  return /slot_to_ptr\(|elem_retain|elem_release|elem_is_ref|SCR_ELEM_(STR|ARR|BYTES|REF)/.test(body);
}

describe("the absent array slot", () => {
  test("the harvest found both files", () => {
    // A parse that silently stops matching is the only way this suite can go
    // blind, so it is the first assertion.
    expect(bodies.size).toBeGreaterThan(40);
    expect(bodies.has("scr_arr_get_ref")).toBe(true);
    expect(bodies.has("copying_arr_retain_slot")).toBe(true);
  });

  test("every function that can meet a hole is classified", () => {
    const unclassified = [...bodies]
      .filter(([name, body]) => touchesRefSlot(body) && !RULES.has(name))
      .map(([name]) => name);
    expect(unclassified).toEqual([]);
  });

  test("every classification points at a mechanism actually in the body", () => {
    const broken: string[] = [];
    for (const [name, rule] of RULES) {
      const body = bodies.get(name);
      if (body === undefined) {
        broken.push(`${name}: classified but no longer exists`);
        continue;
      }
      if (rule.cls === "never") continue;
      if (!MECHANISM[rule.cls].test(body)) {
        broken.push(`${name}: classified "${rule.cls}" but its body has no ${MECHANISM[rule.cls]}`);
      }
      expect(rule.why.length).toBeGreaterThan(20);
    }
    expect(broken).toEqual([]);
  });

  test("only the three reads refuse, and they all do", () => {
    const refusing = [...bodies]
      .filter(([, body]) => /scr_arr_trap_absent\(/.test(body))
      .map(([name]) => name)
      .sort();
    expect(refusing).toEqual(["scr_arr_get_ref", "scr_arr_pop_ref", "scr_arr_shift_ref"]);
  });

  test("the copy read exists on both sides of the header", () => {
    expect(headerSrc).toMatch(/void \*scr_arr_copy_ref\(ScrArr \*a, double i\);/);
    expect(arraySrc).toMatch(/void \*scr_arr_copy_ref\(ScrArr \*a, double i\) \{/);
  });
});

/* ── the two lanes, reconciled ──────────────────────────────────────────
 * The tombstone write is a statement kind of its own (arrayClear), and the
 * absent VALUE it stores has one spelling per backend. Both are places a
 * second implementation has been added silently before on this tree. */
describe("arrayClear and the absent value, in both backends", () => {
  const files = {
    nodes: read("packages/compiler/src/ir/nodes.ts"),
    validate: read("packages/compiler/src/ir/validate.ts"),
    emitStmts: read("packages/compiler/src/backend/emission/emit-stmts.ts"),
    emitExprs: read("packages/compiler/src/backend/emission/emit-exprs.ts"),
    emitter: read("packages/compiler/src/backend/emission/emitter.ts"),
    llvm: read("packages/compiler/src/backend/llvm/emitter.ts"),
    intInfer: read("packages/compiler/src/library/int-infer.ts"),
    lowerer: read("packages/compiler/src/frontend/lowering/lowerer.ts"),
    lowerExprs: read("packages/compiler/src/frontend/lowering/lower-exprs.ts"),
  };

  test("every statement visitor handles arrayClear", () => {
    // The failure mode a new IrStmt kind actually has: one visitor forgets it
    // and the miss shows up as a wrong answer somewhere else entirely.
    const missing = Object.entries(files)
      .filter(([k]) => ["validate", "emitStmts", "llvm", "intInfer"].includes(k))
      .filter(([, src]) => !src.includes(`case "arrayClear"`))
      .map(([k]) => k);
    expect(missing).toEqual([]);
    expect(files.lowerer).toMatch(/"arraySet", "arrayClear",/);
    expect(files.nodes).toMatch(/kind: "arrayClear"; arr: IrExpr; index: IrExpr; loc: SrcLoc/);
    expect(files.lowerExprs).toMatch(/kind: "arrayClear", arr, index, loc:/);
  });

  test("the ABSENT value has exactly one spelling per backend", () => {
    // arrayNewLen, setLength's growth arm and arrayClear all push it. Before
    // this it was written out four times across the two emitters, and only
    // some of those copies knew about the interned undefined arm.
    expect(files.emitter).toMatch(/absentElemC\(elem: IrType\): string \{/);
    expect(files.llvm).toMatch(/absentElemLl\(elem: IrType\): string \{/);
    expect(files.emitExprs.match(/E\.absentElemC\(/g) ?? []).toHaveLength(2);
    expect(files.emitStmts.match(/E\.absentElemC\(/g) ?? []).toHaveLength(1);
    expect(files.llvm.match(/this\.absentElemLl\(/g) ?? []).toHaveLength(3);
  });

  test("both backends read spreads with the COPY accessor", () => {
    // `[...a]` and `b.push(...a)` must not trap where `a.slice()` succeeds.
    // The QUOTED spelling only — the emitted symbol name, not the prose
    // around it, so a comment cannot move this count.
    expect(files.emitExprs.match(/"scr_arr_copy_ref"/g) ?? []).toHaveLength(2);
    expect(files.llvm.match(/"scr_arr_copy_ref"/g) ?? []).toHaveLength(1);
  });
});
