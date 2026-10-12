/* THE ARRAY SIBLING OF THE `new Map()` CONTEXTUAL-UNION DEFECT.
 *
 * WHAT IT IS FOR. `new Array()` carries no type-argument syntax: the no-arg
 * overload types the expression `any[]` whatever the annotation says, so
 * lower-classes asks the checker for the CONTEXTUAL type and adopts it. The
 * adoption test was `ctxMapped?.kind === "array"` over the WHOLE contextual
 * type, and a UNION does not satisfy that. `staticArr` stayed null and
 * `badType` fired `SC2011 values of type 'any[]' have no static
 * representation`, while the element type was sitting in one of the arms.
 *
 * `async` IS ONLY A PROXY, exactly as it was for Map. A `return` inside an
 * `async function f(): Promise<number[]>` is contextualised through
 * `Awaited<T>` and lands as `number[] | PromiseLike<number[]>`: the annotation
 * DOES cross the Promise, it crosses as a union ARM. `syncUnionOneArm` below
 * has no `async` anywhere in it and refused identically on the parent commit.
 *
 * THE ORDERING IS LOAD-BEARING, and it is load-bearing HARDER here than it was
 * for Map. `mapTypeOf` COLLAPSES a union whose arms map to the same IR type, so
 * `number[] | ReadonlyArray<number>` already satisfied the whole-type test and
 * already lowered. A draft that REPLACES that test with the arm walk instead of
 * falling through to it was built and MEASURED on this tree: it turned all
 * THREE collapse spellings (`ReadonlyArray<number>`, `readonly number[]`,
 * `Array<number>`) AND the plain non-union `number[]` from lowering into
 * SC2011 -- four lower-to-refuse conversions, the one thing this repair must
 * never do. Keeping the whole-type test FIRST is what makes the edit a strict
 * superset.
 *
 * THE DISCRIMINATING HALF is the first three tests: each goes RED when the
 * adoption site is reverted to the bare whole-type test.
 *
 * THE GUARD HALF is the two-arm test, and -- UNLIKE the Map sibling, where
 * SC2009 fenced that union upstream and the guard could only be a fence -- it
 * is a LIVE discriminator here. `number[] | string[]` reaches this constructor
 * on this tree and refuses with SC2011. Measured, not assumed: a variant of the
 * repair with `arrayArmCount >= 1` in place of `=== 1` was built and run, and
 * this program LOWERED under it -- silently typing every element one of two
 * incompatible ways. That variant is what this test catches.
 *
 * WHAT STAYS GREEN UNDER REVERT, said here rather than left to be discovered:
 * the collapse test and the floor test lower on the parent commit too. They are
 * the ordering fence and the floor, not discrimination.
 *
 * The counts here are `lowerToIr(...).diagnostics`, the same number
 * contextual-union-map.test.ts and awaited-void-slot.test.ts report. The CLI's
 * `blockers:` heading is a different count over the same programs. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { loadProgram } from "../src/frontend/program.js";

interface Lowered {
  /** `CODE message` per blocker, in order. Compared as a LIST so a failure
   * prints the refusal's own text rather than a bare count. */
  readonly rows: readonly string[];
  /** `module` is non-null iff `diagnostics` is empty (LowerResult's contract);
   * asserted alongside the rows so a change that empties one without the other
   * cannot read as a pass. */
  readonly lowered: boolean;
}

function lower(source: string): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-ctxunion-arr-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const realError = console.error;
  console.error = (): void => {};
  try {
    const load = loadProgram(entry);
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    return {
      rows: r.diagnostics.map((d) => `${d.code} ${d.message}`),
      lowered: r.module !== null,
    };
  } finally {
    console.error = realError;
  }
}

/* ---- THE DISCRIMINATING HALF -------------------------------------------- */

test("a SYNC union return type with one mappable arm adopts that arm", () => {
  // The minimal repro, and the proof that `async` was only a proxy: there is
  // no `async` in this program. Revert the adoption site in lower-classes.ts
  // to the bare whole-type test and this goes red with
  // `SC2011 values of type 'any[]' have no static representation`.
  const got = lower(`function f(): number[] | null {
  return new Array()
}
const a = f()
console.log(a === null ? 0 : a.length)
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

test("an ASYNC return of Promise<number[]> adopts the array arm", () => {
  // The contextual type here is `number[] | PromiseLike<number[]>`: exactly
  // one arm maps to an IR array, so the walk adopts it. If `PromiseLike<T>`
  // ever starts mapping to an array this becomes a two-arm union and goes
  // back to refusing -- the conservative direction, and the reason the count
  // is asserted by the guard rather than the first arm being taken.
  const got = lower(`async function f(): Promise<number[]> {
  return new Array()
}
async function main(): Promise<void> {
  const a = await f()
  console.log(a.length)
}
void main()
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

test("a union with `undefined` adopts the array arm too", () => {
  // The other everyday spelling of "one mappable arm". `undefined` is not the
  // same constituent as `null` (Undefined vs Null flags) and the walk must not
  // happen to work for only one of them.
  const got = lower(`function f(): string[] | undefined {
  return new Array()
}
const a = f()
console.log(a === undefined ? 0 : a.length)
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

/* ---- THE GUARD HALF, which here is LIVE --------------------------------- */

test("a union with TWO differently-mapped arms still REFUSES", () => {
  // The guard against the cheap wrong fix: "adopt the first arm that maps".
  // `number[]` and `string[]` are both arrays and the choice between them is
  // unobservable at this site, so the repair adopts NOTHING and SC2011 stands.
  //
  // THIS ONE DISCRIMINATES, and that is the difference from the Map sibling.
  // There, `Map<string, number> | Map<number, string>` was fenced UPSTREAM by
  // SC2009 before the constructor was reached, so the equivalent test was red
  // on every tree and could only be a fence. Here nothing fences it: the union
  // reaches the constructor and the refusal is SC2011 from this very site. A
  // build of this repair with `arrayArmCount >= 1` instead of `=== 1` was run
  // on this tree and this program LOWERED under it. So this test is the live
  // instrument for the guard, not a monument to it.
  const got = lower(`function f(): number[] | string[] {
  return new Array()
}
f()
export {}
`);
  expect(got.lowered).toBe(false);
  expect(got.rows.some((r) => r.startsWith("SC2011"))).toBe(true);
});

/* ---- THE ORDERING FENCE -------------------------------------------------- */

test("a union COLLAPSING to one array type keeps lowering (the ordering guard)", () => {
  // `number[]`, `Array<number>` and `ReadonlyArray<number>` map to the
  // identical IR array, so `mapTypeOf` answers "array" for the WHOLE union and
  // the pre-existing whole-type test already adopted it. All three spellings
  // lowered BEFORE this repair and must keep lowering.
  //
  // NOT a discriminator for the revert -- green on the parent commit too. It is
  // the one family here that was ever actually RED: a draft that replaced the
  // whole-type test with the arm walk found two mappable arms, declined, and
  // sent all three to `SC2011 values of type 'any[]' have no static
  // representation`. Measured, not reasoned about.
  for (const second of ["ReadonlyArray<number>", "readonly number[]", "Array<number>"]) {
    const got = lower(`function f(): number[] | ${second} {
  return new Array()
}
f()
export {}
`);
    expect(got.rows, second).toEqual([]);
    expect(got.lowered, second).toBe(true);
  }
});

/* ---- THE BLAST-RADIUS FLOOR ---------------------------------------------- */

test("the non-union annotation and the sibling containers are unchanged", () => {
  // GREEN BY CONSTRUCTION for this repair -- every one of these lowers (or
  // refuses) identically on the parent commit -- so none of them is evidence
  // that the fix works. They are the floor: the repair widens admission at a
  // site every `new Array()` passes through, and a widening that disturbs the
  // already-admitted shapes is not this repair.
  //
  // The non-union case is NOT idle even though it is green by construction,
  // and for TWO independent reasons: the draft that replaced the whole-type
  // test broke it (a non-union contextual type is not walked at all), and it
  // is the only case that proves the contextual consultation still happens at
  // all.
  const nonUnion = lower(`function f(): number[] {
  return new Array()
}
console.log(f().length)
export {}
`);
  expect(nonUnion.rows).toEqual([]);
  expect(nonUnion.lowered).toBe(true);

  // Only the CONSTRUCTOR form carried the defect. The array LITERAL under the
  // same union, and `new Array<number>()` with the type argument spelled, both
  // lowered on the parent commit: they never reached the contextual fallback.
  for (const body of ["[]", "new Array<number>()", "new Array(1, 2)"]) {
    const got = lower(`function f(): number[] | null {
  return ${body}
}
const a = f()
console.log(a === null ? 0 : a.length)
export {}
`);
    expect(got.rows, body).toEqual([]);
  }

  // SET DOES NOT CARRY THIS DEFECT. Re-measured on the parent commit rather
  // than inherited from the Map slice's note: `Set<string> | null` lowers
  // there. Nothing in this repair widens Set.
  const setUnion = lower(`function f(): Set<string> | null {
  return new Set()
}
const s = f()
console.log(s === null ? 0 : s.size)
export {}
`);
  expect(setUnion.rows).toEqual([]);

  // WEAKMAP REFUSES BY A DIFFERENT MECHANISM and is untouched by this repair.
  // Under a union it is SC2009 (the union shape is supported, the ARM is not);
  // bare it is SC2020 (no scriptc lowering for WeakMap at all). Neither is the
  // contextual-adoption fence, so widening that fence cannot move it -- and
  // this assertion is what would notice if it ever did.
  const weakUnion = lower(`function f(): WeakMap<object, number> | null {
  return new WeakMap()
}
f()
export {}
`);
  expect(weakUnion.lowered).toBe(false);
  expect(weakUnion.rows.some((r) => r.startsWith("SC2009"))).toBe(true);
  expect(weakUnion.rows.some((r) => r.startsWith("SC2011"))).toBe(false);
});
