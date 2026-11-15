/* Where a dyn number is KEPT, decided statically and shared by both emitters.
 *
 * A freshly computed dyn number that is stored into a dyn-typed class field lives as long as its holder; the runtime keeps one immortal box per
 * small integer (scr_json.c) and scr_dyn_keep swaps a fresh node for it. Arithmetic temporaries die at once and gain nothing, so the call is
 * emitted only at that store, and only when the stored expression is a computation that can answer a number and hands out a FRESH owned
 * value: a dyn call or invoke, a call or virtual call or value call whose type is dyn, a boxing of a number (or of a union that holds one), a dyn
 * arithmetic libCall. A value read out of a variable or a field is not fresh (it was kept, or not, where it was made), and a literal other than a
 * number, a boxed string, a boolean and an object can never be a number, so those emit nothing. */
import type { IrExpr } from "./nodes.js";

type DynCheckNode = Extract<IrExpr, { kind: "dynCheck" }>;

const DYN_ARITH: ReadonlySet<string> = new Set(["dyn.add"]); // the one dyn arithmetic whose result is itself dyn (JS `+` over dyn operands)

/** True when `value` (the value of a store into a field whose type is dyn) is a fresh dyn expression that can be a number. */
export function storesFreshDynNumber(value: IrExpr): boolean {
  if (value.type.kind !== "dyn") return false;
  switch (value.kind) {
    case "dynCall":
    case "dynInvoke":
    case "call":
    case "callValue":
    case "virtualCall":
      return true;
    case "dynFrom": {
      const k = value.value.type.kind;
      return k === "f64" || k === "union";
    }
    case "libCall":
      return DYN_ARITH.has(value.fn);
    default:
      return false;
  }
}

/** The check of a dyn-to-number-to-dyn round trip, when `e` is one: `dynFrom(dynCheck(v: dyn -> f64))`. The check is STRICT (it passes only a dyn whose
 * kind is the number kind, and throws the path-annotated TypeError for any other), and a dyn number node is never written after it is made, so the
 * round trip answers the very node it was given: both emitters run the check for its throw and then retain `v` instead of boxing a second node
 * (-0, NaN and every double survive because they are the same node). Only the f64 target folds: an integer target (i32, i64, ...) CONVERTS, and a
 * conversion changes what the box would hold. Returns the check, or null for any other shape. */
export function dynRoundTripShare(e: IrExpr): DynCheckNode | null {
  if (e.kind !== "dynFrom" || e.type.kind !== "dyn") return null;
  const c = e.value;
  if (c.kind !== "dynCheck" || c.type.kind !== "f64" || c.value.type.kind !== "dyn") return null;
  return c;
}
