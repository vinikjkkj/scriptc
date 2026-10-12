/* A CONTEXTUAL TYPE THAT ARRIVED CORRECT AND WAS THROWN AWAY BY THE SHAPE TEST.
 *
 * WHAT IT IS FOR. `new Map()` carries no type-argument syntax: the no-arg
 * overload pins `Map<any, any>` whatever the annotation says, so lower-classes
 * asks the checker for the CONTEXTUAL type and adopts it. The adoption test was
 * `ctxMapped?.kind === "map"` over the WHOLE contextual type. A UNION does not
 * satisfy that, so `function f(): Map<string, Uint8Array> | null { return new
 * Map() }` refused with `SC1090 Map keys of type 'any'` even though the key and
 * value types were sitting in one of the arms.
 *
 * `async` IS ONLY A PROXY. The shape that found this was an async function
 * returning `Promise<Map<K, V>>`: a `return` inside one is contextualised
 * through `Awaited<T>` and lands as `Map<K, V> | PromiseLike<Map<K, V>>`. The
 * annotation DOES cross the Promise -- it crosses as a union ARM. The
 * discriminator is the UNION, and `syncUnionOneArm` below proves it: no `async`
 * anywhere in that program and it refused identically.
 *
 * THE ORDERING IS LOAD-BEARING, and a first draft of the repair got it wrong.
 * `mapTypeOf` COLLAPSES a union whose arms all map to the same IR type --
 * ReadonlyMap<K, V> and Map<K, V> both return `mapOf(K, V)` -- so
 * `Map<string, number> | ReadonlyMap<string, number>` already satisfied the
 * whole-type test and already lowered. Replacing that test with an arm walk
 * (instead of falling through to one) turned that program from lowering into
 * `SC1090 Map keys of type 'any'`: a LOWER -> REFUSE conversion, which is the
 * one thing this repair must never do. `unionCollapsingToOneMapType` is that
 * case, kept as a test so the ordering cannot be undone.
 *
 * THE DISCRIMINATING HALF is `syncUnionOneArm`, `asyncPromiseOfMap` and
 * `unionWithUndefined`. Each goes RED when the adoption site is reverted to the
 * bare whole-type test.
 *
 * THE ARMED HALF is `twoDifferentlyMappedArms`. It must still REFUSE: adopting
 * an arbitrary arm of `Map<string, number> | Map<number, string>` would key the
 * table one of two incompatible ways and the wrong pick is silent. It is NOT a
 * discriminator on its own -- that union is today refused UPSTREAM by SC2009
 * before the constructor is lowered, so it reads red on every tree -- and that
 * is stated here rather than left for a reader to discover. It is the fence for
 * the day SC2009 stops firing.
 *
 * The counts here are `lowerToIr(...).diagnostics`, the same number
 * awaited-void-slot.test.ts reports. The CLI's `blockers:` heading and the
 * summed per-site fences are different counts over the same programs and must
 * not be compared with these. */
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
  const dir = mkdtempSync(join(tmpdir(), "scriptc-ctxunion-"));
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
  // `SC1090 Map keys of type 'any'`.
  const got = lower(`function f(): Map<string, Uint8Array> | null {
  return new Map()
}
const m = f()
console.log(m === null ? 0 : m.size)
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

test("an ASYNC return of Promise<Map<K, V>> adopts the map arm", () => {
  // The shape the defect was found in. The contextual type here is
  // `Map<string, Uint8Array> | PromiseLike<Map<string, Uint8Array>>`.
  const got = lower(`async function f(): Promise<Map<string, Uint8Array>> {
  return new Map()
}
async function main(): Promise<void> {
  const m = await f()
  console.log(m.size)
}
void main()
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

test("a union with `undefined` adopts the map arm too", () => {
  // The other everyday spelling of "one mappable arm". It is not the same
  // constituent as `null` (Undefined vs Null flags) and the walk must not
  // happen to work for only one of them.
  const got = lower(`function f(): Map<string, number> | undefined {
  return new Map()
}
const m = f()
console.log(m === undefined ? 0 : m.size)
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

/* ---- THE ARMED HALF ------------------------------------------------------ */

test("a union with TWO differently-mapped arms still REFUSES", () => {
  // The guard against the cheap wrong fix: adopt "the first arm that maps".
  // `Map<string, number>` and `Map<number, string>` are both maps and the
  // choice between them is unobservable at this site, so the repair adopts
  // NOTHING and the refusal stands.
  //
  // HONEST LIMIT: this refuses on the fixed tree AND on the reverted one AND
  // on a tree whose guard is broken, because SC2009 fences the union return
  // type before the constructor is reached. It is not a discriminator for the
  // guard; it is the regression fence for the day SC2009 stops firing. The
  // discriminating evidence for the guard is that `armCount === 1` is the only
  // adoption condition in the arm walk.
  const got = lower(`function f(): Map<string, number> | Map<number, string> {
  return new Map()
}
f()
export {}
`);
  expect(got.lowered).toBe(false);
  expect(got.rows.some((r) => r.startsWith("SC2009"))).toBe(true);
  expect(got.rows.some((r) => r.startsWith("SC1090"))).toBe(false);
});

test("a union COLLAPSING to one map type keeps lowering (the ordering guard)", () => {
  // ReadonlyMap<K, V> and Map<K, V> map to the identical IR type, so
  // `mapTypeOf` answers "map" for the WHOLE union and the pre-existing
  // whole-type test already adopted it. This program lowered BEFORE the repair
  // and must keep lowering.
  //
  // It is NOT a discriminator for the revert -- it is green on the parent
  // commit too. It is the one test here that was ever actually RED: a draft of
  // the repair replaced the whole-type test with the arm walk, found two
  // mappable arms, declined, and this program went to
  // `SC1090 Map keys of type 'any'`. Keeping the whole-type test FIRST and
  // falling through to the arm walk is what makes the repair a strict superset.
  const got = lower(`function f(): Map<string, number> | ReadonlyMap<string, number> {
  return new Map()
}
f()
export {}
`);
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

/* ---- THE BLAST-RADIUS FLOOR ---------------------------------------------- */

test("the non-union annotation and a plain Set are unchanged", () => {
  // GREEN BY CONSTRUCTION for this repair -- both lower on the parent commit
  // -- so neither is evidence that the fix works. They are the floor: the
  // repair widens admission at a site every `new Map()` passes through, and a
  // widening that disturbs the already-admitted shapes is not this repair.
  //
  // The Set arm is here because `new Set()` has a SIBLING of this code path.
  // It is recorded as already green: `function f(): Set<string> | null {
  // return new Set() }` lowers on the parent commit, so Set does not carry
  // this defect and nothing here widens it.
  const nonUnion = lower(`function f(): Map<string, Uint8Array> {
  return new Map()
}
console.log(f().size)
export {}
`);
  expect(nonUnion.rows).toEqual([]);

  const setUnion = lower(`function f(): Set<string> | null {
  return new Set()
}
const s = f()
console.log(s === null ? 0 : s.size)
export {}
`);
  expect(setUnion.rows).toEqual([]);
});
