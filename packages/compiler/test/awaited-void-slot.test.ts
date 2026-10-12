/* A VALUE SLOT THE CHECKER KEEPS SYMBOLIC, BOUND AT `void`.
 *
 * WHAT IT IS FOR. Inside a generic body the checker hands out `Awaited<T>` and
 * a bare `T` as SYMBOLIC spellings — a conditional type and a type parameter —
 * and neither carries the `Void` FLAG at any instantiation. `isUnitOnlyTsType`
 * reads that flag, so it answered "no" for a slot the IR mapper had ALREADY
 * resolved to `void` through the live binding, and `lowerVarDecl` fenced the
 * slot with SC2001 instead of substituting the unit-only union. Two sites did
 * it: the INITIALIZED declaration (`const result = await run()`) and its
 * UNINITIALIZED sibling (`let result: T`). `isUnitOnlyBoundTsType` asks the
 * binding instead of the flag.
 *
 * WHY IT IS HERE AND NOT IN tests/perf. This file is inside the gate's
 * partition: vitest.config.ts includes `packages/*/test/**`, which is the same
 * glob gate-sharded.ps1 enumerates (its lines 597-608). `tests/perf/**` is in
 * neither, so a regression test there would never be run by the merge gate.
 *
 * THE DISCRIMINATING HALF is the first two tests. Each was shown RED by
 * reverting its own site back to the bare flag test and GREEN again on
 * restore; the restore was sha256-identical to the fixed file. A test that
 * passes with the fix reverted is not a regression test.
 *
 * THE ARMED HALF is `boundTypeParamOutsideAwaited`. It must still REFUSE. The
 * repair is deliberately narrow — it can turn a refusal into the substitution
 * and can never turn a substitution into a refusal — so the one way to pass
 * the first two tests cheaply and wrongly is to widen every `void` slot, or to
 * delete the fence. Either does it, and this case goes red when they do. It is
 * NOT a discriminator for THIS revert: it refuses on both trees. It discrimin-
 * ates over-widening, which is the other direction the fix could be wrong in.
 *
 * The counts here are `lowerToIr(...).diagnostics` — ONE of three numbers this
 * area reports. The CLI's `blockers:` heading and the summed per-site fences
 * are different counts over the same programs, and must not be compared. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { loadProgram } from "../src/frontend/program.js";

interface Lowered {
  /** `CODE message` per blocker, in order. Compared as a LIST, so a failure
   * prints the refusal's own text rather than a bare count. */
  readonly rows: readonly string[];
  /** `module` is non-null iff `diagnostics` is empty (LowerResult's contract);
   * asserted alongside the rows so a change that empties one without the other
   * cannot read as a pass. */
  readonly lowered: boolean;
}

/** Lower `source` as a standalone entry. `badType` writes its `tparam ...` why
 * line to console.error on the way to the diagnostic; it is captured so a RED
 * run prints the assertion rather than the trace. */
function lower(source: string): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-awvoid-"));
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

/** The generic whose awaited result is bound into a slot, instantiated TWICE —
 * once at a value type and once at `void`. Both arms must be present: with one
 * instantiation the binding is never ambiguous and the symbolic spelling never
 * has to be resolved. `decl` is the declaration under test. */
const twoArmed = (decl: string): string => `class Runner {
  async withTransaction<T>(run: () => Promise<T>): Promise<T> {
${decl}
    return result
  }
}
const r = new Runner()
const n = await r.withTransaction(async () => 7)
await r.withTransaction(async () => { console.log('void arm') })
console.log('n=' + n)
export {}
`;

/* ---- THE DISCRIMINATING HALF ------------------------------------------- */

test("an INITIALIZED generic slot bound at void substitutes the unit-only union", () => {
  // lower-stmts.ts, the initialized `lowerVarDecl` arm (the `isUnitOnlyTsType
  // || isUnitOnlyBoundTsType` test guarding `type = unitOnlyUnion(L.unions)`,
  // reached with `init` present). Revert that one site to the bare flag test
  // and this is the test that goes red.
  const got = lower(twoArmed("    const result = await run()"));
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

test("an UNINITIALIZED generic slot declared at a bound T substitutes the same union", () => {
  // lower-stmts.ts, the uninitialized arm of the same function. The sibling
  // site: the slot type comes from the ANNOTATION rather than an initializer,
  // and `Awaited<T>` is spelled as a bare `T`.
  const got = lower(twoArmed("    let result: T\n    result = await run()"));
  expect(got.rows).toEqual([]);
  expect(got.lowered).toBe(true);
});

/* ---- THE ARMED HALF ----------------------------------------------------- */

test("a type parameter outside the awaited shape still REFUSES at void", () => {
  // NOT a discriminator for the repair: this refuses on the fixed tree and on
  // the reverted one alike. It is the guard against the cheap wrong fix —
  // widening every void slot, or deleting the fence — either of which empties
  // this list and turns this test red.
  const got = lower(`function pass<T>(v: T): T { const held = v; return held }
const a = pass(7)
const b = pass<void>(undefined as void)
console.log('a=' + a)
console.log('b=' + String(b))
export {}
`);
  expect(got.rows).toEqual([
    "SC2001 values of type 'void' cannot be compiled yet (supported: number, string, " +
      "boolean, arrays, Maps, Sets, RegExp, functions, classes, records, unions of " +
      "those, and 'unknown')",
  ]);
  expect(got.lowered).toBe(false);
});

/* ---- THE UNCHANGED NEIGHBOURS ------------------------------------------- */

test("the value-only instantiation and the non-generic void await are unchanged", () => {
  // GREEN BY CONSTRUCTION for this repair — both lower clean on the parent
  // commit too — so neither is evidence that the fix works. They are here as
  // the blast-radius floor: the repair widens admission, and widening
  // admission changes every consumer of the admitted type, so the two shapes
  // that already reached `unitOnlyUnion` by the flag route must still do so.
  const valueOnly = lower(`class Runner {
  async withTransaction<T>(run: () => Promise<T>): Promise<T> {
    const result = await run()
    return result
  }
}
const r = new Runner()
const n = await r.withTransaction(async () => 7)
console.log('n=' + n)
export {}
`);
  expect(valueOnly.rows).toEqual([]);

  const nonGeneric = lower(`async function voidAsync(): Promise<void> { console.log('side effect') }
const x = await voidAsync()
console.log('done=' + String(x))
export {}
`);
  expect(nonGeneric.rows).toEqual([]);
});
