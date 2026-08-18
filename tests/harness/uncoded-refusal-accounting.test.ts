/* No compiler-planted REFUSAL may leave through the uncoded throw, and the
 * reason it prints must be the one the predicate actually had.
 *
 * Two failures, both real, both found by measurement on zapo's own TU:
 *
 *   * `scr_throw_error_msg` carries no SC code. `scr_trap_trace_note` — the
 *     ONE place SCRIPTC_TRAP_TRACE hooks — is called from
 *     `scr_throw_error_msg_code` and nowhere else, and its first act is to
 *     return unless the code is SC-numeric. So a refusal emitted uncoded is
 *     invisible to the bracket census, to the `scr_trap` census, AND to the
 *     dynamic trace: three instruments and a run, all silent. zapo's TU held
 *     five (`getOrGenPreKeys`, `getOrGenSinglePreKey`, `getCollectionState`,
 *     `getCollectionStates`, `setCollectionStates`), uncounted for a week.
 *
 *   * the stranded box said "its parameters have no checked-dynamic form" for
 *     every decline, and on two of those five rows the parameters were fine —
 *     it was the RETURN (`promise<record>` whose record carries a
 *     `ReadonlyMap`). A message that names the wrong half of a signature
 *     sends the next reader to the wrong line.
 *
 * The allowlist is the `dyn-dispatch-accounting` pattern: a use of the
 * uncoded primitive is admitted only WITH a reason, and the reason must say
 * why the site is not a refusal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  canBoxFuncIntoDyn,
  strandedFuncReason,
  type IrRecordShape,
  type IrType,
  type IrUnionDef,
} from "../../packages/compiler/src/ir/nodes.js";

const repoRoot = join(import.meta.dirname, "../..");

/** Every emitter file that can plant a failure path in an emitted TU. */
const EMITTER_FILES = [
  "packages/compiler/src/backend/emission/emit-walkers.ts",
  "packages/compiler/src/backend/emission/emit-stmts.ts",
  "packages/compiler/src/backend/emission/emit-exprs.ts",
  "packages/compiler/src/backend/emission/emit-ws.ts",
  "packages/compiler/src/backend/emission/emit-async.ts",
  "packages/compiler/src/backend/emission/emit-shapes.ts",
  "packages/compiler/src/backend/llvm/dyn.ts",
  "packages/compiler/src/backend/llvm/emitter.ts",
  "packages/compiler/src/backend/llvm/ws.ts",
];

/** The uncoded throw is allowed only where the site is NOT a refusal. Keyed
 * by the emitted message's distinctive fragment, because that is what an
 * instrument reading a TU has to key on too. */
const UNCODED_ALLOWED: { fragment: string; why: string }[] = [
  {
    fragment: "chunk received a",
    why:
      "emit-async's stream 'data' flavor mismatch is a PARITY throw, not a refusal: " +
      "Node throws a TypeError at the same point, so it needs no scriptc code",
  },
];

function uncodedCallSites(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    // A COMMENT that names the primitive is documentation, not an emission —
    // and this file's own note about the primitive tripped the first version
    // of this test, which is the honest way to find out the filter was
    // missing.
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    // The EMITTED spelling, not a TypeScript call: the emitters build C and
    // .ll text, so the primitive appears inside template literals. `_code`
    // must not match, which is what the negative lookahead is for.
    if (/scr_throw_error_msg(?!_code)\b/.test(l)) out.push({ line: i + 1, text: t });
  }
  return out;
}

describe("no compiler-planted refusal is emitted uncoded", () => {
  for (const rel of EMITTER_FILES) {
    test(rel, () => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      const sites = uncodedCallSites(src);
      // A site is admitted when its line, or the message it builds nearby,
      // carries an allowlisted fragment. The window is the emitting
      // statement plus a few lines, because the message literal and the
      // call are usually two statements apart.
      const lines = src.split(/\r?\n/);
      const unexplained = sites.filter((s) => {
        const window = lines.slice(Math.max(0, s.line - 12), s.line + 2).join("\n");
        // `declare void @scr_throw_error_msg(...)` alone is not a call site;
        // the LLVM emitters declare what they use.
        if (/declare\s+void\s+@scr_throw_error_msg\b/.test(s.text)) return false;
        return !UNCODED_ALLOWED.some((a) => window.includes(a.fragment));
      });
      expect(
        unexplained.map((s) => `${rel}:${s.line}  ${s.text.slice(0, 120)}`),
        "an uncoded refusal is invisible to the bracket census, the trap census AND SCRIPTC_TRAP_TRACE",
      ).toEqual([]);
    });
  }
});

/* ── the reason must be the predicate's own ───────────────────────────── */

const STRING: IrType = { kind: "string" };
const F64: IrType = { kind: "f64" };
const BYTES: IrType = { kind: "bytes", elem: "u8" };

/** zapo's WaAppStateCollectionStoreState: the ReadonlyMap field is why the
 * record has no dyn conversion, and therefore why a promise OF it has none. */
const stateShape: IrRecordShape = {
  id: "r145",
  fields: [
    { name: "hash", type: BYTES },
    { name: "indexValueMap", type: { kind: "map", key: STRING, value: BYTES } },
    { name: "version", type: F64 },
  ],
};
/** zapo's PreKeyRecord: entirely convertible. */
const preKeyShape: IrRecordShape = {
  id: "r500",
  fields: [
    { name: "keyId", type: F64 },
    { name: "pub", type: BYTES },
  ],
};
/** The generator's return, `PreKeyRecord | Promise<PreKeyRecord>` — the arm
 * that cannot be validated back OUT of a dynamic value. */
const genRetUnion: IrUnionDef = {
  id: "u501",
  arms: [
    { kind: "record", shapeId: "r500" },
    { kind: "promise", inner: { kind: "record", shapeId: "r500" } },
  ],
} as unknown as IrUnionDef;

const shapes = new Map<string, IrRecordShape>([
  [stateShape.id, stateShape],
  [preKeyShape.id, preKeyShape],
  [updShape.id, updShape],
]);
const unions = new Map<string, IrUnionDef>([[genRetUnion.id, genRetUnion]]);
const getRecord = (id: string): IrRecordShape | undefined => shapes.get(id);
const getUnion = (id: string): IrUnionDef | undefined => unions.get(id);

/** `getCollectionState(collection: string): Promise<State>` — zapo's
 * `sc_dfs_2`. The parameter is a string and converts fine. */
const getCollectionState: IrType & { kind: "func" } = {
  kind: "func",
  params: [STRING],
  ret: { kind: "promise", inner: { kind: "record", shapeId: "r145" } },
};

/** `getOrGenPreKeys(count, generator)` — zapo's `sc_dfs_0`, which BOXES now.
 * Its generator parameter cannot be ADAPTED out of a dyn value (the arm
 * `Promise<PreKeyRecord>` has no out-direction validation), but it can be
 * EXACT-UNWRAPPED, and canDynCheckTo's func arm answers that — the same
 * answer nestedOk has always given the identical type one container down.
 * Kept here as the CONTROL for the row that closed. */
const getOrGenPreKeys: IrType & { kind: "func" } = {
  kind: "func",
  params: [F64, { kind: "func", params: [F64], ret: { kind: "union", unionId: "u501" } }],
  ret: { kind: "promise", inner: { kind: "array", elem: { kind: "record", shapeId: "r500" } } },
};

/** `setCollectionStates(updates: readonly WaAppStateCollectionStateUpdate[])`
 * — zapo's `sc_dfs_4`, and the row that still declines on a PARAMETER. The
 * array and the record are both fine; the same `ReadonlyMap` is the leaf,
 * measured by deleting it (probe d5b boxes, d5 does not). */
const updShape: IrRecordShape = {
  id: "r146",
  fields: [
    { name: "collection", type: STRING },
    { name: "hash", type: BYTES },
    { name: "indexValueMap", type: { kind: "map", key: STRING, value: BYTES } },
    { name: "version", type: F64 },
  ],
};

const setCollectionStates: IrType & { kind: "func" } = {
  kind: "func",
  params: [{ kind: "array", elem: { kind: "record", shapeId: "r146" } }],
  ret: { kind: "promise", inner: { kind: "void" } },
};

describe("strandedFuncReason names the half the predicate declined on", () => {
  test("a promise-of-record-with-a-Map RETURN is blamed on the return", () => {
    expect(canBoxFuncIntoDyn(getCollectionState, getRecord, getUnion)).toBe(false);
    const why = strandedFuncReason(getCollectionState, getRecord, getUnion);
    expect(why).toContain("its return");
    expect(why).not.toContain("parameter");
  });

  test("a PARAMETER carrying a Map is blamed on that parameter, by index", () => {
    expect(canBoxFuncIntoDyn(setCollectionStates, getRecord, getUnion)).toBe(false);
    expect(strandedFuncReason(setCollectionStates, getRecord, getUnion)).toContain("its parameter 1");
    expect(strandedFuncReason(setCollectionStates, getRecord, getUnion)).not.toContain("its return");
  });

  test("a generator PARAMETER whose return has a promise arm BOXES — exact unwrap is validation", () => {
    // This row used to be `false` here, and the reason was the whole finding
    // of block/dynfunc: canDynCheckTo's top-level func arm answered
    // canAdaptDynFuncTo while its own nested walker answered true, so one IR
    // type was checkable as a record field and uncheckable standing alone.
    // Both emitters have always emitted the exact-signature unwrap for a
    // NON-adaptable func target, and the frontend's `as` path has always
    // admitted one. Two of zapo's five stranded boxes were this and nothing
    // else.
    expect(canBoxFuncIntoDyn(getOrGenPreKeys, getRecord, getUnion)).toBe(true);
  });

  test("the fallback is reached only when the predicate and the reason disagree", () => {
    const boxable: IrType & { kind: "func" } = { kind: "func", params: [STRING], ret: { kind: "void" } };
    expect(canBoxFuncIntoDyn(boxable, getRecord, getUnion)).toBe(true);
    expect(strandedFuncReason(boxable, getRecord, getUnion)).toBe(
      "its signature has no checked-dynamic form",
    );
  });
});
