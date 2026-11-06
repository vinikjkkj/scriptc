import { BOOL, F64, UNDEFINED_T, isIntegerKeyName } from "../../ir/nodes.js";
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
    // Integer-like names print first and ascending whatever the list says, so they are never listed.
    if (!f || isIntegerKeyName(name)) return false;
    if (shape.keyListAll === true) return !f.name.startsWith("%") && !f.name.startsWith("__@");
    return f.type.kind === "union" && L.armTag(f.type.unionId, UNDEFINED_T) >= 0;
  };
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  const ord = (op: "has" | "count" | "empty", ordinal?: number): IrExpr =>
    ({ kind: "recordOrd", op, obj: obj(), shapeId, ...(ordinal !== undefined ? { ord: ordinal } : {}), type: op === "count" ? F64 : BOOL, loc });
  // A late-writable field that no construction wrote (not in `order`) is reachable through the list too.
  const lateNames = order.filter(lateOk);
  for (const f of shape.fields) {
    if (!order.includes(f.name) && lateOk(f.name)) lateNames.push(f.name);
  }
  // The construction-order code alone: what an unlisted shape runs, and all an instance that wrote no key late needs.
  const plain: IrStmt[] = [];
  for (const name of order) {
    const into: IrStmt[] = [];
    fillOne(name, into);
    plain.push({ kind: "block", body: into, loc });
  }
  if (lateNames.length === 0) { tgt.push(...plain); return; }
  const full: IrStmt[] = [];
  for (const name of order) {
    const into: IrStmt[] = [];
    fillOne(name, into);
    if (lateOk(name)) {
      full.push({
        kind: "if",
        cond: { kind: "unary", op: "!", operand: ord("has", ordOf(name)), type: BOOL, loc },
        then: [{ kind: "block", body: into, loc }],
        else_: null,
        loc,
      });
    } else {
      full.push({ kind: "block", body: into, loc });
    }
  }
  addLocal("ol.i", "ol_i");
  const iRef = (): IrExpr => ({ kind: "varRef", localId: "ol.i", type: F64, loc });
  const loopBody: IrStmt[] = [];
  for (const name of lateNames) {
    const into: IrStmt[] = [];
    fillOne(name, into);
    loopBody.push({
      kind: "if",
      cond: { kind: "recordOrd", op: "isAt", obj: obj(), shapeId, ord: ordOf(name), idx: iRef(), type: BOOL, loc },
      then: [{ kind: "block", body: into, loc }],
      else_: null,
      loc,
    });
  }
  loopBody.push({ kind: "assign", localId: "ol.i", value: { kind: "bin", op: "+", left: iRef(), right: num(1), type: F64, loc }, loc });
  full.push({
    kind: "block",
    body: [
      { kind: "varDecl", localId: "ol.i", init: num(0), loc },
      { kind: "while", cond: { kind: "bin", op: "<", left: iRef(), right: ord("count"), type: BOOL, loc }, body: loopBody, loc },
    ],
    loc,
  });
  tgt.push({ kind: "if", cond: ord("empty"), then: plain, else_: full, loc });
}

/**
 * The statements that fill the key list of a freshly built COPY (a spread literal or an object rest), in the order JavaScript
 * gives it: the literal's parts in written order, a spread contributing its source's own keys in the source's order. The
 * destination's `shapeId` carries `keyListAll`, so every field is listed and the list alone names the order.
 *
 * `parts` is the literal's written pieces (plain names and the one spread). A source that itself has a key list contributes its
 * construction-order keys (those not in its list, the present ones) and then its list; any other source its declared order.
 */
export type CopyPart = { name: string } | { spread: string; names: string[]; ref: IrExpr };

export function copyListStmts(
  L: Lowerer,
  dstId: string,
  dst: () => IrExpr,
  parts: CopyPart[],
  loc: SrcLoc,
  newLocal: () => string,
): IrStmt[] {
  const D = L.shapes.get(dstId)!;
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  const ordD = (n: string): number => D.fields.findIndex((f) => f.name === n);
  const optional = (sh: IrRecordShape, n: string): boolean => {
    const f = sh.fields.find((x) => x.name === n);
    return !!f && f.type.kind === "union" && L.armTag(f.type.unionId, UNDEFINED_T) >= 0;
  };
  const note = (n: string): IrStmt => ({
    kind: "exprStmt",
    expr: { kind: "recordOrd", op: "note", obj: dst(), shapeId: dstId, ord: ordD(n), type: BOOL, loc },
    loc,
  });
  const and = (a: IrExpr | null, b: IrExpr): IrExpr =>
    a === null ? b : ({ kind: "logical", op: "&&", left: a, right: b, type: BOOL, loc } as unknown as IrExpr);
  const out: IrStmt[] = [];
  for (const part of parts) {
    if ("name" in part) {
      if (ordD(part.name) >= 0) out.push(note(part.name));
      continue;
    }
    const srcId = part.spread;
    const S = L.shapes.get(srcId)!;
    const src = (): IrExpr => JSON.parse(JSON.stringify(part.ref)) as IrExpr;
    const ordS = (n: string): number => S.fields.findIndex((f) => f.name === n);
    const sListable = (n: string): boolean => S.keyList === true && !isIntegerKeyName(n) && (S.keyListAll === true || optional(S, n));
    const names = part.names.filter((n) => ordD(n) >= 0 && ordS(n) >= 0);
    // The source's construction-order keys that are present and not in its list.
    for (const n of names) {
      let cond: IrExpr | null = null;
      if (optional(S, n)) cond = { kind: "recordKeyPresent", obj: src(), shapeId: srcId, field: n, type: BOOL, loc };
      if (sListable(n)) {
        cond = and(cond, { kind: "unary", op: "!", operand: { kind: "recordOrd", op: "has", obj: src(), shapeId: srcId, ord: ordS(n), type: BOOL, loc }, type: BOOL, loc });
      }
      out.push(cond === null ? note(n) : { kind: "if", cond, then: [note(n)], else_: null, loc });
    }
    if (S.keyList === true) {
      const listable = names.filter(sListable);
      if (listable.length > 0) {
        const i = newLocal();
        const iRef = (): IrExpr => ({ kind: "varRef", localId: i, type: F64, loc });
        const body: IrStmt[] = [
          ...listable.map((n): IrStmt => ({
            kind: "if",
            cond: { kind: "recordOrd", op: "isAt", obj: src(), shapeId: srcId, ord: ordS(n), idx: iRef(), type: BOOL, loc },
            then: [note(n)],
            else_: null,
            loc,
          })),
          { kind: "assign", localId: i, value: { kind: "bin", op: "+", left: iRef(), right: num(1), type: F64, loc }, loc },
        ];
        out.push({
          kind: "block",
          body: [
            { kind: "varDecl", localId: i, init: num(0), loc },
            { kind: "while", cond: { kind: "bin", op: "<", left: iRef(), right: { kind: "recordOrd", op: "count", obj: src(), shapeId: srcId, type: F64, loc }, type: BOOL, loc }, body, loc },
          ],
          loc,
        });
      }
    }
  }
  return out;
}
