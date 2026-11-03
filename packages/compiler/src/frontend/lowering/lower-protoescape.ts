/* The `prototype` object of a class value read through dyn, and what may be done with it.
 *
 * Reads of that object are exact (scr_dyn_class.c: one object per class or evaluation). A WRITE into it cannot be: an instance reaches
 * its members through its class, so `V.prototype.m = f` would never be seen by `new V().m()`. A write the lowering can see is refused
 * where it stands; a write it cannot see is one the object can reach by ESCAPING: passed as an argument, stored in a field, array,
 * object, Map or global, captured by a closure, returned. This pass follows the object from every `x.prototype` read (and every
 * local it is copied to) and refuses the first escape or write, naming the operation. Reads stay allowed.
 *
 * It also decides, per dyn write site, whether the site is SLOPPY (CommonJS source without "use strict", outside a class body):
 * only there is an assignment to a non-writable property ignored silently; everywhere else it throws (dyn.keySet vs dyn.keySetSloppy). */
import * as ts from "../ts7/adapter.js";
import type { IrFunction, SrcLoc } from "../../ir/nodes.js";
import { isCjsEntryFile } from "../program.js";

export interface ProtoEscape {
  loc: SrcLoc;
  what: string;
}

type N = Record<string, unknown> & { kind?: string; loc?: SrcLoc };

const MUTATORS = new Set(["dyn.keySet", "dyn.keySetSloppy", "dyn.keyDelete", "dyn.defineProp", "dyn.defineProps", "dyn.assign", "dyn.assignAll", "dyn.objCreateDescs", "dyn.reflectSet", "dyn.reflectDelete", "dyn.reflectDefine"]);
const READ_ONLY = new Set([
  "dyn.objKeys", "dyn.objValues", "dyn.objEntries", "dyn.hasOwn", "dyn.hasKey", "dyn.typeof", "dyn.instanceOf", "dyn.toString",
  "dyn.toStringCoerce", "dyn.objectToString", "dyn.forInKeys", "dyn.forInCertain", "dyn.forInPlain", "dyn.forInAccessor",
  "dyn.ownNamesFence", "dyn.ownNamesCtor", "dyn.arrLen", "dyn.looseEq", "dyn.numberOf", "dyn.toNumber", "dyn.errInstanceof",
]);
const READ_ONLY_CALLS = new Set(["%object.ownNames", "%object.keys", "%object.values", "%object.entries", "%object.hasOwn", "%object.isPrototypeOf"]);
const PROPAGATE = new Set(["ternary", "logical", "seqExpr", "upcast", "downcast", "unionNarrow"]);

function isSource(n: N): boolean {
  if (n.kind !== "dynKeyGet") return false;
  const k = n["key"] as N | undefined;
  return k?.kind === "strLit" && k["value"] === "prototype";
}

/** Every escape or write of a `prototype` object read through dyn, in function order. */
export function protoEscapes(functions: readonly IrFunction[]): ProtoEscape[] {
  const out: ProtoEscape[] = [];
  const seen = new Set<string>();
  const report = (loc: SrcLoc | undefined, what: string): void => {
    if (loc === undefined) return;
    const key = `${loc.file}:${loc.start}:${what}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ loc, what });
  };
  // A function-local id is keyed by its function; a module-level (global) id is shared by every function.
  const declaredOf = new Map<IrFunction, Set<string>>();
  for (const fn of functions) declaredOf.set(fn, new Set<string>([...fn.params.map((p) => p.localId), ...fn.locals.map((l) => l.id)]));
  const tainted = new Set<string>();
  const keyOf = (fn: IrFunction, id: string): string => (declaredOf.get(fn)!.has(id) ? `${fn.name}#${id}` : id);
  const isTIn = (fn: IrFunction, n: unknown): boolean => {
    if (n === null || typeof n !== "object") return false;
    const e = n as N;
    if (isSource(e)) return true;
    if (e.kind === "varRef") return tainted.has(keyOf(fn, e["localId"] as string));
    if (e.kind === "ternary") return isTIn(fn, e["then"]) || isTIn(fn, e["else_"]);
    if (e.kind === "logical") return isTIn(fn, e["left"]) || isTIn(fn, e["right"]);
    if (e.kind === "seqExpr") return isTIn(fn, e["result"]);
    if (e.kind === "upcast" || e.kind === "downcast" || e.kind === "unionNarrow") return isTIn(fn, e["value"]);
    return false;
  };
  // pass 1: every local or global a prototype object is copied into (any assignment, flow-insensitive), to a fixpoint
  for (let changed = true; changed; ) {
    changed = false;
    for (const fn of functions) {
      const stack: unknown[] = [fn.body];
      while (stack.length > 0) {
        const n = stack.pop();
        if (n === null || typeof n !== "object") continue;
        if (Array.isArray(n)) {
          for (const x of n) stack.push(x);
          continue;
        }
        const o = n as N;
        if ((o.kind === "varDecl" && isTIn(fn, o["init"])) || (o.kind === "assign" && isTIn(fn, o["value"]))) {
          const k = keyOf(fn, o["localId"] as string);
          if (!tainted.has(k)) {
            tainted.add(k);
            changed = true;
          }
        }
        for (const v of Object.values(o)) stack.push(v);
      }
    }
  }
  // pass 2: with the parent and the field each tainted expression sits in
  for (const fn of functions) {
    const isT = (n: unknown): boolean => isTIn(fn, n);
    const stack: { n: unknown; parent: N | null; field: string }[] = [{ n: fn.body, parent: null, field: "" }];
    while (stack.length > 0) {
      const { n, parent, field } = stack.pop()!;
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (let i = 0; i < n.length; i++) stack.push({ n: n[i], parent, field });
        continue;
      }
      const o = n as N;
      if (o.kind === "closure") {
        const caps = o["captures"] as string[] | undefined;
        if (caps?.some((id) => tainted.has(keyOf(fn, id)))) report(o.loc, "is captured by a closure");
      }
      if (parent !== null && isT(o)) {
        const pk = parent.kind ?? "";
        const ok =
          pk === "dynKeyGet" || pk === "dynHasKey" || pk === "dynTest" || pk === "dynScalarEq" || pk === "bin" || pk === "strEq" ||
          pk === "exprStmt" || pk === "if" || pk === "while" || PROPAGATE.has(pk) ||
          (pk === "dynInvoke" && field === "recv") ||
          (pk === "varDecl" && field === "init") ||
          (pk === "assign" && field === "value");
        if (!ok) {
          const at = o.loc ?? parent.loc;
          if (pk === "libCall") {
            const f = parent["fn"] as string;
            const args = parent["args"] as unknown[];
            if (MUTATORS.has(f) && args[0] === o) report(at, "is written to");
            else if (f.startsWith("console.") || f.startsWith("insp.") || READ_ONLY.has(f)) {
              /* a read */
            } else report(at, `is passed as an argument to ${f}`);
          } else if (pk === "call" && READ_ONLY_CALLS.has(String(parent["callee"]))) {
            /* a read-only reflection helper */
          } else if (pk === "call" || pk === "dynCall" || pk === "dynInvoke" || pk === "new" || pk === "newValue" || pk === "callIndirect") {
            report(at, `is passed as an argument to ${String(parent["callee"] ?? parent["method"] ?? parent["fn"] ?? pk)}`);
          } else if (pk === "return") report(at, "is returned");
          else if (pk === "fieldSet") report(at, "is stored in a field");
          else if (pk === "arrayLit" || pk === "dynArrLit" || pk === "dynObjLit" || pk === "recordLit") report(at, "is stored in an array or object");
          else if (pk === "dynFrom" || pk === "mapSet") report(at, "is stored in a container");
          else report(at, `reaches an operation this build cannot follow (${pk})`);
        }
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === "loc" || k === "type") continue;
        stack.push({ n: v, parent: o, field: k });
      }
    }
  }
  return out;
}

/** Is code at `pos` of `sf` in strict mode (ES module, "use strict" prologue on the file or an enclosing function, class body)? */
export function strictAt(sf: ts.SourceFile, pos: number): boolean {
  if (!isCjsEntryFile(sf)) return true;
  const hasUseStrict = (stmts: readonly ts.Statement[]): boolean => {
    for (const s of stmts) {
      if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) {
        if (s.expression.text === "use strict") return true;
        continue;
      }
      break;
    }
    return false;
  };
  if (hasUseStrict(sf.statements)) return true;
  let cur: ts.Node = sf;
  for (;;) {
    let next: ts.Node | undefined;
    ts.forEachChild(cur, (c) => {
      if (next === undefined && c.pos <= pos && pos < c.end) next = c;
      return undefined;
    });
    if (next === undefined) return false;
    cur = next;
    if (ts.isClassDeclaration(cur) || ts.isClassExpression(cur)) return true;
    if (ts.isFunctionLike(cur)) {
      const body = (cur as { body?: ts.Node }).body;
      if (body !== undefined && ts.isBlock(body) && hasUseStrict(body.statements)) return true;
    }
  }
}
