import { BOOL, F64, UNDEFINED_T } from "../../ir/nodes.js";
import type { IrExpr, IrRecordShape, IrStmt, SrcLoc } from "../../ir/nodes.js";
import type { Lowerer } from "./lowerer.js";

/**
 * Fill `tgt` for a record shape that carries a KEY LIST (IrRecordShape.keyList): the keys the shape's constructions wrote,
 * in `order`, then the keys written after construction, in the order they were first written (the instance's own list).
 *
 * `fillOne(name, into)` emits the per-key work for ONE field exactly as the unlisted path does (so every guard, mask test
 * and in-place registration it makes keeps working: each field gets its own statement array). A field that can be written
 * late (it has an undefined arm) is skipped in the static part when the instance lists it, and the list loop dispatches to
 * it by ordinal. The loop is bounded by the list's count, so an instance with no late writes pays one load.
 */
export function fillWithKeyList(
  L: Lowerer,
  shape: IrRecordShape,
  shapeId: string,
  obj: () => IrExpr,
  order: string[],
  fillOne: (name: string, into: IrStmt[]) => void,
  tgt: IrStmt[],
  loc: SrcLoc,
  addLocal: (localId: string, name: string) => void,
): void {
  const ordOf = (name: string): number => shape.fields.findIndex((f) => f.name === name);
  const lateOk = (name: string): boolean => {
    const f = shape.fields[ordOf(name)];
    return !!f && f.type.kind === "union" && L.armTag(f.type.unionId, UNDEFINED_T) >= 0;
  };
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  const ord = (op: "has" | "count" | "at", ordinal?: number, idx?: IrExpr): IrExpr =>
    ({ kind: "recordOrd", op, obj: obj(), shapeId, ...(ordinal !== undefined ? { ord: ordinal } : {}), ...(idx ? { idx } : {}), type: op === "has" ? BOOL : F64, loc });
  const lateNames: string[] = [];
  for (const name of order) {
    const into: IrStmt[] = [];
    fillOne(name, into);
    if (lateOk(name)) {
      lateNames.push(name);
      tgt.push({
        kind: "if",
        cond: { kind: "unary", op: "!", operand: ord("has", ordOf(name)), type: BOOL, loc },
        then: [{ kind: "block", body: into, loc }],
        else_: null,
        loc,
      });
    } else {
      tgt.push({ kind: "block", body: into, loc });
    }
  }
  // A late-writable field that no construction wrote (not in `order`) is reachable through the list too.
  for (const f of shape.fields) {
    if (!order.includes(f.name) && lateOk(f.name) && !f.name.startsWith("__@")) lateNames.push(f.name);
  }
  if (lateNames.length === 0) return;
  addLocal("ol.i", "ol_i");
  addLocal("ol.k", "ol_k");
  const iRef = (): IrExpr => ({ kind: "varRef", localId: "ol.i", type: F64, loc });
  const kRef = (): IrExpr => ({ kind: "varRef", localId: "ol.k", type: F64, loc });
  const loopBody: IrStmt[] = [
    { kind: "varDecl", localId: "ol.k", init: ord("at", undefined, iRef()), loc },
  ];
  for (const name of lateNames) {
    const into: IrStmt[] = [];
    fillOne(name, into);
    loopBody.push({
      kind: "if",
      cond: { kind: "bin", op: "===", left: kRef(), right: num(ordOf(name)), type: BOOL, loc },
      then: [{ kind: "block", body: into, loc }],
      else_: null,
      loc,
    });
  }
  loopBody.push({ kind: "assign", localId: "ol.i", value: { kind: "bin", op: "+", left: iRef(), right: num(1), type: F64, loc }, loc });
  tgt.push({
    kind: "block",
    body: [
      { kind: "varDecl", localId: "ol.i", init: num(0), loc },
      { kind: "while", cond: { kind: "bin", op: "<", left: iRef(), right: ord("count"), type: BOOL, loc }, body: loopBody, loc },
    ],
    loc,
  });
}
