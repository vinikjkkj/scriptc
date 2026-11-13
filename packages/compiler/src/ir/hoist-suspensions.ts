/* HOIST THE SUSPENSIONS OUT OF STATEMENT HEADERS the state machine cannot resume into.
 *
 * A resume label may sit inside a statement's operands only where the statement evaluates them once, at its root (an expression
 * statement, a declaration, an assignment, a return, an `if`/`switch` head). The other positions re-enter or sit between machinery:
 * a `throw` value, a `for (x of <await>)` iterable, the condition of `while`/`do-while`/`for`, and the operands of the keyed and
 * array-clear stores. A function that carried an await in one of them used to take the fiber lane; with the fiber lane gone the
 * await is moved out instead, into statements the plan accepts:
 *
 *   throw E                          ->  const t = E; throw t
 *   for (v of E) body                ->  const t = E; for (v of t) body
 *   while (E) body                   ->  for (;;) { const c = E; if (c) {} else break; body }
 *   for (init; E; upd) body          ->  for (init; ; upd) { const c = E; if (c) {} else break; body }
 *   do body while (E)                ->  let c = true; for (; c; c = E) body        (`continue` still reaches the condition)
 *   obj[k] = E / arr[i] = clear ...  ->  every operand, in evaluation order, into a hidden local first
 *
 * Evaluation order is preserved (JS evaluates the header operands left to right before acting) and each operand is evaluated once.
 * Only statements whose header holds a suspension are touched, so every other function is byte-identical. Idempotent. */
import type { IrExpr, IrFunction, IrStmt, IrType } from "./nodes.js";
import { containsSuspension } from "./liveness.js";

export function hoistSuspendingHeaders(fn: IrFunction): void {
  let counter = 0;
  const used = new Set(fn.locals.map((l) => l.id));
  const fresh = (type: IrType, mutable: boolean): string => {
    let id = `%hoist.${counter++}`;
    while (used.has(id)) id = `%hoist.${counter++}`;
    used.add(id);
    fn.locals.push({ id, name: "%hoist", type, mutable });
    return id;
  };
  const hoist = (e: IrExpr): { decl: IrStmt; ref: IrExpr } => {
    const id = fresh(e.type, false);
    return {
      decl: { kind: "varDecl", localId: id, init: e, loc: e.loc },
      ref: { kind: "varRef", localId: id, type: e.type, loc: e.loc },
    };
  };
  const sus = (...es: (IrExpr | null)[]): boolean => es.some((e) => e !== null && containsSuspension(e));
  const list = (stmts: IrStmt[]): IrStmt[] => {
    const out: IrStmt[] = [];
    for (const s of stmts) out.push(...one(s));
    return out;
  };
  const listOrNull = (stmts: IrStmt[] | null): IrStmt[] | null => (stmts === null ? null : list(stmts));
  const single = (s: IrStmt | null): IrStmt | null => {
    if (s === null) return null;
    const r = one(s);
    return r.length === 1 ? r[0]! : { kind: "block", body: r, loc: s.loc };
  };
  const BOOL: IrType = { kind: "bool" };
  const condHead = (cond: IrExpr): IrStmt[] => {
    const c = hoist(cond);
    return [c.decl, { kind: "if", cond: c.ref, then: [], else_: [{ kind: "break", loc: cond.loc }], loc: cond.loc }];
  };
  const one = (s: IrStmt): IrStmt[] => {
    switch (s.kind) {
      case "throw": {
        if (!sus(s.value)) return [s];
        const h = hoist(s.value);
        return [h.decl, { ...s, value: h.ref }];
      }
      case "forOf": {
        const body = list(s.body);
        if (!sus(s.iterable)) return [{ ...s, body }];
        const h = hoist(s.iterable);
        return [h.decl, { ...s, iterable: h.ref, body }];
      }
      case "while": {
        const body = list(s.body);
        if (!sus(s.cond)) return [{ ...s, body }];
        return [{ kind: "for", init: null, cond: null, update: null, body: [...condHead(s.cond), ...body], ...(s.labels !== undefined ? { labels: s.labels } : {}), loc: s.loc }];
      }
      case "doWhile": {
        const body = list(s.body);
        if (!sus(s.cond)) return [{ ...s, body }];
        const id = fresh(BOOL, true);
        const ref: IrExpr = { kind: "varRef", localId: id, type: BOOL, loc: s.loc };
        return [
          { kind: "varDecl", localId: id, init: { kind: "boolLit", value: true, type: BOOL, loc: s.loc }, loc: s.loc },
          {
            kind: "for",
            init: null,
            cond: ref,
            update: { kind: "assign", localId: id, value: s.cond, loc: s.loc },
            body,
            ...(s.labels !== undefined ? { labels: s.labels } : {}),
            loc: s.loc,
          },
        ];
      }
      case "for": {
        const body = list(s.body);
        const init = single(s.init);
        const update = single(s.update);
        if (s.cond === null || !sus(s.cond)) return [{ ...s, init, update, body }];
        return [{ ...s, init, cond: null, update, body: [...condHead(s.cond), ...body] }];
      }
      case "arrayClear": {
        if (!sus(s.arr, s.index)) return [s];
        const a = hoist(s.arr);
        const i = hoist(s.index);
        return [a.decl, i.decl, { ...s, arr: a.ref, index: i.ref }];
      }
      case "recordKeySet": {
        if (!sus(s.obj, s.key, s.value)) return [s];
        const o = hoist(s.obj);
        const k = hoist(s.key);
        const v = hoist(s.value);
        return [o.decl, k.decl, v.decl, { ...s, obj: o.ref, key: k.ref, value: v.ref }];
      }
      case "recordKeyDelete": {
        if (!sus(s.obj, s.key)) return [s];
        const o = hoist(s.obj);
        const k = hoist(s.key);
        return [o.decl, k.decl, { ...s, obj: o.ref, key: k.ref }];
      }
      case "if":
        return [{ ...s, then: list(s.then), else_: listOrNull(s.else_) }];
      case "block":
        return [{ ...s, body: list(s.body) }];
      case "switch":
        return [{ ...s, cases: s.cases.map((c) => ({ ...c, body: list(c.body) })) }];
      case "tryCatch":
        return [{ ...s, tryBody: list(s.tryBody), catchBody: listOrNull(s.catchBody), finallyBody: listOrNull(s.finallyBody) }];
      default:
        return [s];
    }
  };
  fn.body = list(fn.body);
}
