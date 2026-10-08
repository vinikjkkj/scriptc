/* THE HOP-EXEMPTION FENCE'S OWN GUARD.
 *
 * WHY THIS DETECTOR EXISTS AT ALL, because the fence it guards was added in
 * response to a defect rather than in anticipation of one. The LLVM admission
 * predicate exempts `libCall:async.hop` from the `nestedInExpression`
 * pre-filter, and the exemption is sound ONLY while the bare hop carries no
 * operand. That property is stated in ir/liveness.ts, in prose, about a desugar
 * the FRONTEND owns -- "a bare hop carries no operand at all, so there is no
 * promise to own across the park and nothing to take on the far side."
 *
 * One function away in the same file, `awaitInsideFinally` tested for
 * `awaitExpr || awaitUnionExpr` and was correct ONLY because the hop was
 * refused by KIND before the check was ever consulted. The slice that made the
 * hop lowerable retired that precondition with the same edit that needed it.
 * Nothing failed. It had to be read for, and the next one might not be.
 *
 * So the precondition is asserted where it is relied on -- and an assertion
 * that cannot fire is a comment with a stack trace attached. These cases plant
 * the violation and require a complaint back. Pure functions over IR-shaped
 * objects: no compiler, no linker, no toolchain, so they run everywhere and
 * nothing external can make them pass.
 */
import { describe, expect, test } from "vitest";
import type { IrFunction } from "../../packages/compiler/src/ir/nodes.js";
import {
  HopOperandFenceError,
  assertBareSuspendingLibCalls,
  operandBearingSuspendingLibCalls,
} from "../../packages/compiler/src/backend/llvm/coro.js";

/** An IR body holding one `async.hop` libCall with `argc` operands, wrapped in
 * the seqExpr the frontend's `await <non-promise>` desugar really builds -- so
 * the walk is exercised at depth rather than at the top level. */
const bodyWithHop = (argc: number): IrFunction =>
  ({
    name: "f",
    body: [
      {
        kind: "exprStmt",
        expr: {
          kind: "seqExpr",
          stmts: [
            { kind: "varDecl", localId: "l0", init: { kind: "num", value: 1 } },
            {
              kind: "exprStmt",
              expr: {
                kind: "libCall",
                fn: "async.hop",
                args: Array.from({ length: argc }, (_v, i) => ({ kind: "num", value: i })),
              },
            },
          ],
          result: { kind: "varRef", localId: "l0" },
        },
      },
    ],
  }) as unknown as IrFunction;

describe("the hop-operand fence is armed", () => {
  // GREEN FIRST. Without this the fence could be trivially red, and a detector
  // that rejects everything detects nothing.
  test("ACCEPTS the bare hop the exemption is predicated on", () => {
    expect(operandBearingSuspendingLibCalls(bodyWithHop(0))).toEqual([]);
    expect(() => assertBareSuspendingLibCalls(bodyWithHop(0))).not.toThrow();
  });

  test("ACCEPTS a body with no suspending libCall at all", () => {
    const fn = { name: "f", body: [{ kind: "exprStmt", expr: { kind: "num", value: 1 } }] };
    expect(() => assertBareSuspendingLibCalls(fn as unknown as IrFunction)).not.toThrow();
  });

  // RED. THE CASE THE FENCE EXISTS FOR: a future lowering gives the hop an
  // operand, and the exemption silently starts admitting a point whose operands
  // ARE materialised across the suspension.
  test("FIRES on a hop that carries one operand", () => {
    expect(operandBearingSuspendingLibCalls(bodyWithHop(1))).toEqual(["async.hop(1)"]);
    expect(() => assertBareSuspendingLibCalls(bodyWithHop(1))).toThrow(HopOperandFenceError);
    expect(() => assertBareSuspendingLibCalls(bodyWithHop(1)))
      .toThrow(/holds a suspending libCall WITH OPERANDS \(async\.hop\(1\)\)/);
  });

  test("the complaint names the function and says which way to fix it", () => {
    try {
      assertBareSuspendingLibCalls(bodyWithHop(2));
      throw new Error("the fence did not fire");
    } catch (e) {
      expect(e).toBeInstanceOf(HopOperandFenceError);
      const err = e as HopOperandFenceError;
      expect(err.fnName).toBe("f");
      expect(err.sites).toEqual(["async.hop(2)"]);
      // Not decoration: a fence that fires without naming the two exits leaves
      // the next reader to guess, and the cheap guess is to delete the fence.
      expect(err.message).toContain("POINT_KINDS_WITHOUT_AN_OPERAND");
    }
  });

  // IT MUST NOT FIRE ON A NON-EXEMPT SUSPENDING libCall. `async.awaitDyn` is a
  // registered suspender that this backend does NOT lower and does NOT exempt,
  // so its operands are none of this fence's business -- a fence that fires
  // outside its own precondition is noise, and noise is how a fence gets
  // deleted.
  test("does NOT fire on a suspending libCall the exemption never covered", () => {
    const fn = {
      name: "f",
      body: [
        {
          kind: "exprStmt",
          expr: { kind: "libCall", fn: "async.awaitDyn", args: [{ kind: "num", value: 1 }] },
        },
      ],
    };
    expect(() => assertBareSuspendingLibCalls(fn as unknown as IrFunction)).not.toThrow();
  });
});
