/* A checked-dynamic (`any`) value passed as an ARRAY HOF CALLBACK:
 * `names.filter(this.hasOwnProperty, this)`, `xs.map(handlers[kind])`.
 *
 * The desugared loop (lower-containers.ts, arrayHofHelper) wants a closure of
 * the loop's own signature, `(element, index, array) => result`. A dyn value has
 * no such type, so the callback used to refuse (SC2011, "values of type 'any'").
 * The adapter built here is that closure, over the dyn function:
 *
 *   - the callable gate runs ONCE, when the adapter is made: JS validates the
 *     callback before the first iteration, so a non-function throws Node's
 *     "<x> is not a function" even over an empty array. The gate is the dyn
 *     runtime's own (an empty dyn array's `forEach` runs scr_dyn_cb_check and
 *     visits nothing), so the message is the one the dyn path already answers;
 *   - each iteration boxes the element and the index and calls the dyn function
 *     with exactly the three values JS passes. The array crosses as a dyn VIEW
 *     of the receiver (scr_dyn_view: a write through it lands on the receiver),
 *     boxed ONCE per adapter and cached in a mutable capture, so a callback that
 *     ignores its third argument costs nothing per element and one that reads it
 *     sees the receiver itself;
 *   - the `this` of the call is whatever the ambient-receiver window holds: a
 *     thisArg is bound around the adapter by hofCallbackArg (bindThisClosure
 *     pushes it for the extent of every call), exactly Function.prototype.bind.
 *
 * Declined (null; the caller keeps its refusal): a parameter that does not box
 * faithfully (a record or class element would COPY into the dyn world, so the
 * callback would stop seeing the array's own element), and a receiver array
 * whose element kind has no live dyn view. */
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";
import {
  BOOL,
  DYN,
  F64,
  funcOf,
  isUnitType,
  type IrExpr,
  type IrLocal,
  type IrParam,
  type IrStmt,
  type IrType,
  type SrcLoc,
  typeKey,
} from "../../ir/nodes.js";

/** A callback parameter the dyn boxing takes faithfully: a dyn, a primitive, undefined/null,
 * or a union of those. (An array is not here: it would copy, and the third parameter has its own rule.) */
function primitiveParam(L: Lowerer, t: IrType): boolean {
  if (t.kind === "dyn" || t.kind === "f64" || t.kind === "bool" || t.kind === "string") return true;
  if (isUnitType(t)) return true;
  if (t.kind === "union") {
    const arms = L.unions.get(t.unionId)?.arms;
    return arms !== undefined && arms.every((a) => primitiveParam(L, a));
  }
  return false;
}

export function dynHofCallbackAdapter(
  L: Lowerer,
  fn: IrExpr,
  lead: readonly IrType[],
  arrT: IrType,
  loc: SrcLoc,
): (IrExpr & { type: IrType & { kind: "func" } }) | null {
  if (fn.type.kind !== "dyn") return null;
  if (arrT.kind !== "array") return null;
  // The array view exists for number, boolean, string and dyn elements only.
  const ek = arrT.elem.kind;
  if (ek !== "f64" && ek !== "bool" && ek !== "string" && ek !== "dyn") return null;
  for (const t of lead) if (!primitiveParam(L, t)) return null;
  const ptypes: IrType[] = [...lead, F64, arrT];
  const ret = DYN;
  const name = `%hof.dyncb.${ptypes.map((t) => typeKey(t)).join("|")}`;
  const ctx = L.ctx;
  if (!L.liftedFns.some((f) => f.name === name)) {
    const ps: IrParam[] = ptypes.map((type, i) => ({ localId: `p${i}.0`, name: `p${i}`, type }));
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const last = ps[ps.length - 1]!;
    const args: IrExpr[] = ps.map((p, i) => {
      if (i === ps.length - 1) return ref("ab.0", DYN);
      const v = ref(p.localId, p.type);
      return p.type.kind === "dyn" ? v : { kind: "dynFrom", value: v, type: DYN, loc };
    });
    const body: IrStmt[] = [
      {
        kind: "if",
        cond: { kind: "dynTest", test: "undefined", value: ref("ab.0", DYN), type: BOOL, loc },
        then: [
          {
            kind: "assign",
            localId: "ab.0",
            value: { kind: "dynFrom", value: ref(last.localId, last.type), type: DYN, loc },
            loc,
          },
        ],
        else_: null,
        loc,
      },
      {
        kind: "return",
        value: { kind: "dynCall", callee: ref("fd.0", DYN), calleeName: "callback", args, type: DYN, loc },
        loc,
      },
    ];
    const caps: IrParam[] = [
      { localId: "fd.0", name: "fd", type: DYN },
      { localId: "ab.0", name: "ab", type: DYN },
    ];
    L.liftedFns.push({
      name,
      params: ps,
      returnType: ret,
      captures: caps,
      locals: [
        { id: "fd.0", name: "fd", type: DYN, mutable: false, boxed: true },
        { id: "ab.0", name: "ab", type: DYN, mutable: true, boxed: true },
        ...ps.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      ],
      body,
      loc,
    });
  }
  // The creation site: hidden BOXED locals (a capture can only retain a box), the callable
  // gate, then the closure over them.
  const inits: IrStmt[] = [];
  const hold = (hid: string, init: IrExpr, mutable: boolean): string => {
    const n = ctx.localCounters.get(hid) ?? 0;
    ctx.localCounters.set(hid, n + 1);
    const id = `${hid}.${n}`;
    const local: IrLocal = { id, name: hid, type: init.type, mutable, boxed: true };
    ctx.locals.push(local);
    inits.push({ kind: "varDecl", localId: id, init, loc });
    return id;
  };
  const fdId = hold("%dyncbfn", fn, false);
  inits.push({
    kind: "exprStmt",
    expr: {
      kind: "dynInvoke",
      recv: { kind: "dynArrLit", elems: [], type: DYN, loc },
      method: "forEach",
      calleeName: "forEach",
      args: [{ kind: "varRef", localId: fdId, type: DYN, loc }],
      type: DYN,
      loc,
    },
    loc,
  });
  const abId = hold("%dyncbarr", dynUndefinedExpr(loc), true);
  const outT = funcOf(ptypes, ret) as IrType & { kind: "func" };
  return {
    kind: "seqExpr",
    stmts: inits,
    result: { kind: "closure", fnName: name, captures: [fdId, abId], type: outT, loc },
    type: outT,
    loc,
  } as IrExpr & { type: IrType & { kind: "func" } };
}
