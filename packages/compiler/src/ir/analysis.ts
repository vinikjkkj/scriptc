/* IR analyses shared by both backends.
 *
 * These are pure functions over the IR — no emitter state, no target
 * knowledge — so the C and LLVM lanes can reach the same conclusion from
 * the same code instead of each carrying its own copy of the reasoning.
 * A divergence between the lanes here would be a divergence in SEMANTICS,
 * which is exactly the class of bug the differential corpus is least
 * likely to catch quickly (both lanes have to be wrong in the same way to
 * agree, but only one has to be wrong to diverge from Node). */
import type { IrExpr } from "./nodes.js";

/** True when evaluating `e` cannot overwrite the binding `receiverLocalId`.
 *
 * This is the precondition for BORROWING a container receiver instead of
 * retaining it: the emitters evaluate the receiver first and then the
 * index/value operands, so a borrow is only sound if nothing evaluated
 * afterwards can reassign the binding the borrow is resting on. JS
 * evaluation order is unchanged either way — this only decides who owns
 * the reference while the access happens.
 *
 * Deliberately a small WHITELIST rather than a blacklist. Every arm below
 * is a form that cannot call user code and cannot assign anything except
 * through `assignExpr`/`incDec`, which are checked by name. Anything not
 * listed — a call, a field read that might trap, a dyn operation, an await
 * — answers false and the caller keeps the owned snapshot. Getting this
 * wrong in the conservative direction costs a retain/release pair; getting
 * it wrong in the permissive direction is a use-after-free, so the default
 * is `false` and new arms are added only with a reason.
 *
 * `incDec` is safe without checking its target: it is numeric-only, so it
 * can never write a bytes- or array-typed binding. `assignExpr` CAN, so it
 * is checked against the receiver explicitly and its value recursed into —
 * an assignment nested under a ternary or a logical operator still
 * produces the index while overwriting the receiver. */
export function isStableReceiverOperand(e: IrExpr, receiverLocalId: string): boolean {
  switch (e.kind) {
    case "numLit":
    case "boolLit":
    case "strLit":
    case "unitLit":
    case "varRef":
    case "incDec":
      return true;
    case "assignExpr":
      return e.localId !== receiverLocalId && isStableReceiverOperand(e.value, receiverLocalId);
    case "bin":
    case "logical":
      return (
        isStableReceiverOperand(e.left, receiverLocalId) &&
        isStableReceiverOperand(e.right, receiverLocalId)
      );
    case "unary":
    case "toBool":
      return isStableReceiverOperand(e.operand, receiverLocalId);
    case "ternary":
      return (
        isStableReceiverOperand(e.cond, receiverLocalId) &&
        isStableReceiverOperand(e.then, receiverLocalId) &&
        isStableReceiverOperand(e.else_, receiverLocalId)
      );
    case "bytesIntrinsic":
      // Only the non-allocating, non-throwing reads, and only over a plain
      // binding: these cannot run user code, so they cannot reassign the
      // receiver. Their own arguments are checked the same way.
      return (
        (e.method === "get" || e.method === "length" || e.method === "byteLength") &&
        e.receiver.kind === "varRef" &&
        e.args.every((arg) => isStableReceiverOperand(arg, receiverLocalId))
      );
    default:
      return false;
  }
}

/** True when evaluating `e` cannot WRITE the binding `localId`.
 *
 * The precondition for MOVING a non-boxed local's own reference into an
 * operand instead of retaining a second one — see the accumulator fast
 * path in the C and LLVM assign lowerings.
 *
 * A NON-BOXED local is nameable from exactly one place: the function that
 * declares it. A capture would have made it `boxed` (IrLocal.boxed: "the
 * variable lives in a refcounted box; all access, including in the
 * declaring function, goes through the box"), so no call, no closure and
 * no runtime helper reached from this expression can reassign it. That
 * leaves the writes spelled INSIDE this expression tree: `assignExpr`,
 * `incDec`, and the `assign`/`varDecl` statements a `seqExpr` region
 * carries. The caller is responsible for the non-boxed precondition; this
 * function only looks for the spellings.
 *
 * Structural rather than a per-kind whitelist ON PURPOSE. IrExpr has well
 * over a hundred arms and grows; a whitelist that forgets one is merely
 * conservative, but a BLACKLIST that forgets one is a use-after-free. A
 * generic walk of the node graph cannot forget an arm, because it never
 * enumerates them: it descends every own property of every object and
 * every element of every array, and answers false the moment it meets a
 * node whose `kind` is a writer naming `localId`. Bodies reached only by
 * NAME (a `call`'s callee, a `closure`'s function) are correctly not
 * descended into — they cannot name a non-boxed local of this frame. */
export function writesLocal(e: IrExpr, localId: string): boolean {
  const seen = new Set<object>();
  const walk = (n: unknown): boolean => {
    if (n === null || typeof n !== "object") return false;
    if (seen.has(n)) return false;
    seen.add(n);
    if (Array.isArray(n)) return n.some(walk);
    const rec = n as Record<string, unknown>;
    const kind = rec["kind"];
    if (
      (kind === "assignExpr" || kind === "assign" || kind === "incDec" || kind === "varDecl") &&
      rec["localId"] === localId
    ) {
      return true;
    }
    for (const k in rec) {
      if (walk(rec[k])) return true;
    }
    return false;
  };
  return walk(e);
}
