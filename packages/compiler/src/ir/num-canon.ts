/* Where a number-typed result must pass through scr_num_canon, and where it need not.
 *
 * scr_runtime.h gives `undefined` and an array hole a NaN bit pattern (the "NaN-marked" slot), and arithmetic and libm PROPAGATE an
 * operand's NaN payload, so every number-producing operation on a possibly-marked operand answers through scr_num_canon: one compare and
 * a select on each add, multiply, divide and floor. That is exactly what Node answers (a plain NaN), but when no operand can carry a
 * marker the result cannot either, and the select is dead weight: it is most of the cost of a straight-line numeric kernel.
 *
 * This is a per-function proof, shaped like the rest of the IR analyses (one walk, a fixed point over locals):
 *
 *  - a local is MARKER-FREE when it is an unboxed f64 local that is never a parameter and whose every definition is a marker-free
 *    expression: a literal, a marker-free local, an arithmetic expression over marker-free operands, a Math.* call over marker-free
 *    operands, an integer or f32 typed-array element, or an f64 typed-array element read straight into the local (every f64 element read
 *    that reaches anything but an arithmetic operand or an element write is canonicalised AT THE LOAD, so a forged payload in the bytes
 *    cannot become a marker);
 *  - a local is INTERNAL when, besides, every read of it is a place where the value's NaN BITS are unobservable: an operand of another
 *    arithmetic, comparison, bitwise or unary expression, a Math.* argument, a branch test, the value assigned to another internal
 *    local, or the value stored into a typed array (the store canonicalises it). Anything else (a call argument, a return, a field or
 *    slot store, a closure capture, a for-of binding) keeps the value canonical by demoting the local;
 *  - an arithmetic expression elides its canon when its operands are marker-free and its own result is consumed in one of those places.
 *
 * Two things the elision must NOT change: a NaN that reaches a typed-array store is written canonical (the store sets `canonStores`), and a
 * NaN that leaves the function does so canonical (an escaping use demotes). Everything else about a number is unchanged: the elided
 * expression computes the same IEEE result, only a NaN's sign and payload bits can differ, and those bits are read nowhere else. */
import type { IrExpr, IrFunction, IrStmt } from "./nodes.js";

export interface CanonPlan {
  /** Arithmetic nodes (bin, unary -, Math.* libCall) that skip scr_num_canon. */
  readonly elided: ReadonlySet<object>;
  /** `bytesIntrinsic get` nodes over an f64 element whose result is canonicalised at the load. */
  readonly canonLoads: ReadonlySet<object>;
  /** `bytesSet` statements whose value must be canonicalised before the store. */
  readonly canonStores: ReadonlySet<object>;
}

const EMPTY: CanonPlan = { elided: new Set(), canonLoads: new Set(), canonStores: new Set() };
const CACHE = new WeakMap<IrFunction, CanonPlan>();

type Ctx =
  | { k: "operand" } // a place that does not observe NaN bits: arithmetic/compare/bitwise operand, Math.* argument, branch test, discarded value
  | { k: "assign"; local: string } // the value of a definition of a local
  | { k: "store"; node: object } // the value of a typed-array element write
  | { k: "unsafe" };

interface Node {
  kind?: string;
  [k: string]: unknown;
}

const BITWISE: ReadonlySet<string> = new Set(["&", "|", "^", "<<", ">>", ">>>"]);
const SAFE: Ctx = { k: "operand" };
const UNSAFE: Ctx = { k: "unsafe" };

/** The plan for one function. Pure; cached per function object. */
export function canonPlanOf(fn: IrFunction): CanonPlan {
  const hit = CACHE.get(fn);
  if (hit !== undefined) return hit;
  const plan = computePlan(fn);
  CACHE.set(fn, plan);
  return plan;
}

/** An element read of a Float64Array (the other element kinds widen to a double that can never be a marker). */
function isF64Elem(n: Node): boolean {
  return isF64(n["type"]) && (n["receiver"] as { type?: { elem?: string } } | undefined)?.type?.elem === "f64";
}

function isF64(t: unknown): boolean {
  return (t as { kind?: string } | undefined)?.kind === "f64";
}

function computePlan(fn: IrFunction): CanonPlan {
  const params = new Set<string>(fn.params.map((p) => p.localId));
  for (const c of fn.captures ?? []) params.add(c.localId);
  const cand = new Set<string>();
  for (const l of fn.locals) {
    if (isF64(l.type) && l.boxed !== true && l.tdz !== true && !params.has(l.id)) cand.add(l.id);
  }

  const defs: { local: string; value: Node }[] = []; // every definition of a candidate local
  const bad = new Set<string>(); // locals no walk may treat as internal (no init, captured, for-of, ...)
  const uses: { local: string; ctx: Ctx }[] = []; // every read of a candidate local
  const exprs: { node: Node; ctx: Ctx }[] = []; // arithmetic nodes
  const loads: { node: Node; ctx: Ctx }[] = []; // f64 typed-array element reads
  const stores: { node: Node; value: Node }[] = []; // typed-array element writes

  const walk = (x: unknown, ctx: Ctx): void => {
    if (x === null || typeof x !== "object") return;
    if (Array.isArray(x)) {
      for (const y of x) walk(y, UNSAFE);
      return;
    }
    const n = x as Node;
    switch (n.kind) {
      case "varDecl":
      case "assign": {
        const local = n["localId"] as string;
        const value = (n.kind === "varDecl" ? n["init"] : n["value"]) as Node | null;
        if (cand.has(local)) {
          if (value === null) bad.add(local);
          else {
            defs.push({ local, value });
            walk(value, { k: "assign", local });
          }
        } else if (value !== null) walk(value, UNSAFE);
        return;
      }
      case "assignExpr": {
        const local = n["localId"] as string;
        if (cand.has(local)) {
          // The expression's value is the local's new value and flows into `ctx`: only a place blind to NaN bits keeps it internal.
          if (ctx.k !== "operand") bad.add(local);
          defs.push({ local, value: n["value"] as Node });
          walk(n["value"], { k: "assign", local });
        } else walk(n["value"], UNSAFE);
        return;
      }
      case "incDec": {
        const local = n["localId"] as string;
        if (cand.has(local) && ctx.k !== "operand") bad.add(local);
        return;
      }
      case "varRef": {
        const local = n["localId"] as string;
        if (cand.has(local)) uses.push({ local, ctx });
        return;
      }
      case "exprStmt":
        walk(n["expr"], SAFE);
        return;
      case "bin": {
        if (isF64(n["type"])) exprs.push({ node: n, ctx });
        // `===` / `!==` over numbers is scr_num_same: a marker equals a marker, so a NaN's bits ARE observed there.
        const eq = n["op"] === "===" || n["op"] === "!==";
        walk(n["left"], eq ? UNSAFE : SAFE);
        walk(n["right"], eq ? UNSAFE : SAFE);
        return;
      }
      case "unary": {
        if (isF64(n["type"]) && n["op"] === "-") exprs.push({ node: n, ctx });
        walk(n["operand"], SAFE);
        return;
      }
      case "toBool":
        walk(n["operand"], SAFE);
        return;
      case "libCall": {
        const args = n["args"] as Node[];
        const fnName = n["fn"] as string;
        if (fnName.startsWith("math.") && isF64(n["type"]) && args.every((a) => isF64((a as Node)["type"]))) {
          exprs.push({ node: n, ctx });
          for (const a of args) walk(a, SAFE);
        } else for (const a of args) walk(a, UNSAFE);
        return;
      }
      case "bytesIntrinsic": {
        const args = n["args"] as Node[];
        if (n["method"] === "get") {
          if (isF64Elem(n)) loads.push({ node: n, ctx });
          walk(n["receiver"], UNSAFE);
          for (const a of args) walk(a, SAFE);
          return;
        }
        walk(n["receiver"], UNSAFE);
        for (const a of args) walk(a, UNSAFE);
        return;
      }
      case "bytesSet": {
        stores.push({ node: n, value: n["value"] as Node });
        walk(n["arr"], UNSAFE);
        walk(n["index"], SAFE);
        walk(n["value"], { k: "store", node: n });
        return;
      }
      case "closure": {
        for (const id of (n["captures"] as string[] | undefined) ?? []) bad.add(id);
        return;
      }
      default: {
        if (typeof n["localId"] === "string" && cand.has(n["localId"] as string)) bad.add(n["localId"] as string);
        for (const [key, v] of Object.entries(n)) {
          if (key === "loc" || key === "type" || key === "kind") continue;
          walk(v, UNSAFE);
        }
      }
    }
  };
  walk(fn.body as IrStmt[], UNSAFE);

  // Optimistic start; demote until stable.
  const M = new Set<string>(cand);
  for (const b of bad) M.delete(b);
  const f64Elem = isF64Elem;
  const mf = (e: Node): boolean => {
    switch (e.kind) {
      case "numLit":
        return true;
      case "varRef":
        return M.has(e["localId"] as string);
      case "bin":
        // The bitwise six answer an integer whatever the operands are.
        if (BITWISE.has(e["op"] as string)) return isF64(e["type"]);
        return isF64(e["type"]) && mf(e["left"] as Node) && mf(e["right"] as Node);
      case "unary":
        return isF64(e["type"]) && e["op"] === "-" && mf(e["operand"] as Node);
      case "libCall":
        return (
          (e["fn"] as string).startsWith("math.") &&
          isF64(e["type"]) &&
          (e["args"] as Node[]).every((a) => isF64(a["type"]) && mf(a))
        );
      case "bytesIntrinsic": {
        if (e["method"] !== "get") return false;
        // an integer or f32 element is never a marker; an f64 element is made canonical at the load (see below)
        return !f64Elem(e) || loadOk.has(e);
      }
      case "incDec":
        return isF64(e["type"]) && M.has(e["localId"] as string);
      default:
        return false;
    }
  };
  // An f64 element read counts only when it is a direct definition of a candidate local (the emitter canonicalises it there).
  const loadOk = new Set<Node>();
  for (const d of defs) if (d.value.kind === "bytesIntrinsic" && d.value["method"] === "get" && f64Elem(d.value)) loadOk.add(d.value);
  const sink = (ctx: Ctx): boolean => ctx.k === "operand" || ctx.k === "store" || (ctx.k === "assign" && M.has(ctx.local));
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of defs) {
      if (M.has(d.local) && !mf(d.value)) {
        M.delete(d.local);
        changed = true;
      }
    }
    for (const u of uses) {
      if (M.has(u.local) && !sink(u.ctx)) {
        M.delete(u.local);
        changed = true;
      }
    }
  }

  const elided = new Set<object>();
  for (const e of exprs) if (mf(e.node) && sink(e.ctx)) elided.add(e.node);
  // An f64 element read answers the bytes' double as they are, so a forged payload (the NaN-marked undefined or hole pattern written as plain
  // bytes) would arrive as a marker. Where the value can reach anything that tells a marker from a NaN it is canonicalised AT THE LOAD:
  // everywhere except an arithmetic/compare/bitwise operand (the parent's own canon, or its comparison, absorbs the payload) and the value
  // of a typed-array write (an element-to-element copy keeps its bytes).
  const canonLoads = new Set<object>();
  for (const l of loads) if (l.ctx.k !== "operand" && l.ctx.k !== "store") canonLoads.add(l.node);
  const canonStores = new Set<object>();
  for (const s of stores) {
    const v = s.value;
    if (elided.has(v) || (v.kind === "varRef" && M.has(v["localId"] as string))) canonStores.add(s.node);
  }
  if (elided.size === 0 && canonLoads.size === 0) return EMPTY;
  return { elided, canonLoads, canonStores };
}

export type { IrExpr };
