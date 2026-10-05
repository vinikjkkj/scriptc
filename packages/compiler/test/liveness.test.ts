/* Liveness at suspension points — the three ways it went wrong first.
 *
 * Each test here pins a bug that a hand-written positive control caught
 * after the pass already looked right on simple input. Two of the three
 * were in the UNDER-approximating direction, which is the direction that
 * drops a live value from a coroutine frame — a use-after-free, not a
 * missing optimisation. They are cheap to reintroduce and expensive to
 * notice, so they get a test apiece over hand-built IR (no build needed).
 *
 * The IR here is deliberately minimal rather than realistic: the pass
 * never reads types, only the eight node kinds that name a local, so a
 * `varRef` standing in for a call keeps each case down to the shape under
 * test. */
import { expect, test } from "vitest";
import { F64, type IrExpr, type IrFunction, type IrType } from "../src/ir/nodes.js";
import { suspensionLiveness } from "../src/ir/liveness.js";

const loc = { file: "t.ts", start: 0, end: 0 };
const vr = (localId: string, type: IrType = F64): IrExpr => ({ kind: "varRef", localId, type, loc });
const aw = (value: IrExpr, type: IrType = F64): IrExpr => ({
  kind: "awaitExpr",
  value,
  type,
  loc,
});
const local = (id: string, boxed?: true) => ({
  id,
  name: id.split(".")[0]!,
  type: F64,
  mutable: true,
  ...(boxed === true ? { boxed } : {}),
});

const fn = (over: Partial<IrFunction>): IrFunction =>
  ({
    name: "f",
    params: [],
    returnType: F64,
    locals: [],
    body: [],
    async: true,
    ...over,
  }) as IrFunction;

/** The live set at the single suspension point, as plain local ids. */
function liveAtOnlyPoint(f: IrFunction): string[] {
  const r = suspensionLiveness(f);
  expect(r).not.toBeNull();
  expect(r!.points).toHaveLength(1);
  return [...r!.points[0]!.live].sort();
}

test("a for-of binding is dead on the back-edge, not live across the body's await", () => {
  // for (const it of items) { await it; }
  // `it` is read BEFORE the suspension and rebound by the header on every
  // pass. Propagating it around the back-edge made it live across every
  // suspension in the body — one bogus frame slot per enclosing loop.
  const f = fn({
    locals: [local("items.0"), local("it.0")],
    body: [
      {
        kind: "forOf",
        localId: "it.0",
        iterable: vr("items.0"),
        body: [{ kind: "exprStmt", expr: aw(vr("it.0")), loc }],
        loc,
      },
    ],
  });
  expect(liveAtOnlyPoint(f)).toEqual([]);
});

test("a return inside a guarded try keeps the finally's reads live", () => {
  // const keep = a; try { const r = await a; return r; } finally { await keep; }
  // The `return` does NOT leave the function: the finally runs first and
  // reads `keep`, so `keep` is live across the try's await. Discarding
  // liveOut at the return reported an EMPTY frame here.
  const f = fn({
    locals: [local("a.0"), local("keep.0"), local("r.0")],
    body: [
      { kind: "varDecl", localId: "keep.0", init: vr("a.0"), loc },
      {
        kind: "tryCatch",
        tryBody: [
          { kind: "varDecl", localId: "r.0", init: aw(vr("a.0")), loc },
          { kind: "return", value: vr("r.0"), loc },
        ],
        catchBody: null,
        catchLocalId: null,
        finallyBody: [{ kind: "exprStmt", expr: aw(vr("keep.0")), loc }],
        loc,
      },
    ],
  });
  const r = suspensionLiveness(f);
  expect(r).not.toBeNull();
  const inTry = r!.points.find((p) => p.live.has("keep.0"));
  expect(inTry, "the try's await must carry `keep` across for the finally").toBeDefined();
  expect(r!.frameLocals.has("keep.0")).toBe(true);
});

test("a loop reports one point per await, not one per fixpoint iteration", () => {
  // The body is walked repeatedly to reach a fixpoint; only the final walk
  // may record. Without that, this one-await loop reported a point per
  // iteration and every frame statistic was inflated.
  const f = fn({
    locals: [local("items.0"), local("it.0"), local("acc.0")],
    body: [
      { kind: "varDecl", localId: "acc.0", init: null, loc },
      {
        kind: "forOf",
        localId: "it.0",
        iterable: vr("items.0"),
        body: [
          { kind: "assign", localId: "acc.0", value: aw(vr("it.0")), loc },
        ],
        loc,
      },
      { kind: "return", value: vr("acc.0"), loc },
    ],
  });
  const r = suspensionLiveness(f);
  expect(r).not.toBeNull();
  expect(r!.points).toHaveLength(1);
});

test("a local dead after the suspension is not in the frame", () => {
  // const scratch = a; const r = await scratch; return r;
  const f = fn({
    locals: [local("a.0"), local("scratch.0"), local("r.0")],
    body: [
      { kind: "varDecl", localId: "scratch.0", init: vr("a.0"), loc },
      { kind: "varDecl", localId: "r.0", init: aw(vr("scratch.0")), loc },
      { kind: "return", value: vr("r.0"), loc },
    ],
  });
  expect(liveAtOnlyPoint(f)).toEqual([]);
  expect(suspensionLiveness(f)!.frameLocals.size).toBe(0);
});

test("a captured local stays live across a suspension even when reassigned", () => {
  // A boxed local is shared with a closure, so a write never kills it: the
  // frame must keep the box pointer regardless.
  const f = fn({
    locals: [local("acc.0", true), local("x.0")],
    body: [
      { kind: "assign", localId: "acc.0", value: aw(vr("x.0")), loc },
    ],
  });
  expect(liveAtOnlyPoint(f)).toEqual(["acc.0"]);
});

test("a suspension nested in a larger expression is flagged", () => {
  // `pre` is materialised before the suspension, so the frame holds it even
  // though the statement-level live set would not.
  const f = fn({
    locals: [local("pre.0"), local("p.0")],
    body: [
      {
        kind: "exprStmt",
        expr: {
          kind: "bin",
          op: "+",
          left: vr("pre.0"),
          right: aw(vr("p.0")),
          type: F64,
          loc,
        } as IrExpr,
        loc,
      },
    ],
  });
  const r = suspensionLiveness(f);
  expect(r).not.toBeNull();
  expect(r!.points[0]!.nestedInExpression).toBe(true);
  expect([...r!.points[0]!.live].sort()).toEqual(["p.0", "pre.0"]);
});

test("functions with no suspension point report null", () => {
  const f = fn({
    locals: [local("a.0")],
    body: [{ kind: "return", value: vr("a.0"), loc }],
  });
  expect(suspensionLiveness(f)).toBeNull();
});
