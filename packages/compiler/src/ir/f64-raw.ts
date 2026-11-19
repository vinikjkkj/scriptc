/* FLOAT64 FUNCTION VERSIONING. A numeric kernel that reads and writes the elements of Float64Array PARAMETERS at constant (or counted-loop) indices pays,
 * on every access, the element-kind test, the whole-index test and the bound test of scr_bytes_get_inl / scr_bytes_set_inl, plus a call on the LLVM lane.
 * zapo's GF(2^255-19) field arithmetic (feMul: 48 accesses, feSqr: 32, feAdd/feSub/feNeg: loops of 16) is exactly that shape and is 5% of a redis run.
 *
 * WHAT THE PASS DOES. For an eligible function it rewrites the body `B` to
 *
 *     if (p1.f64Ok(n1) && p2.f64Ok(n2) ...) { B' } else { B }
 *
 * where `f64Ok(n)` is `elem == F64 && len >= n` (a bytesIntrinsic, never throws) and B' is a copy of B whose accesses that the guard covers carry `raw`:
 * the emitters read and write them straight from memory. The else arm is the old code, so a receiver of another element kind or a shorter length takes
 * exactly the path it took before (the out-of-range read of Node's `undefined`, the ignored out-of-range write, the generic element switch).
 *
 * WHY ONE ENTRY GUARD IS SOUND.
 *  - the receiver is a PARAMETER that the body never assigns, so every `varRef` to it names the one value the caller passed;
 *  - a ScrBytes' `elem`, `len` and `data` never change after construction (scr_runtime.h: "ELEMENT count, fixed at construction"; there is no resize,
 *    transfer or detach), so a test at entry holds at every later access whatever the body does in between;
 *  - a raw access is only marked where its index is PROVEN integer and inside [0, n): a numeric literal, or a canonical counted-loop counter (initialised
 *    from a non-negative literal, stepped by +1 only in the loop's own update, compared `< N` / `<= N` against a literal, never assigned in the body),
 *    optionally plus or minus a literal.
 *
 * WHAT IT DOES NOT CHANGE: the values read and written, the order of every access and operation, ownership (the same params, the same releases), or the
 * canonicalisation of NaN (ir/num-canon.ts computes its plan over the whole function and so over both arms; a raw read is still canonicalised where the
 * plan says so).
 *
 * SCOPE. Only functions whose body is made of the node kinds below (a leaf numeric kernel: no call, closure, try, await, string or allocation) and that
 * hold at least MIN_ACCESSES covered accesses; a body over MAX_NODES is left alone (the code is emitted twice). SCRIPTC_F64RAW=off disables the pass, =report prints one `F64RAW <name> <sites> <guards>` line per versioned function to stderr, and =noguard
 * (a POSITIVE CONTROL for the test rows, never a mode to ship) ORs the guard with `true` (the guard still runs, so the data pointers are set) so the rows that hand a function a short array must differ. */
import { BOOL, F64 } from "./nodes.js";
import type { IrExpr, IrFunction, IrModule, IrStmt } from "./nodes.js";

type Node = Record<string, unknown>;

const MIN_ACCESSES = 4;
/** An access inside a counted loop runs many times: it weighs this much towards MIN_ACCESSES. */
const LOOP_WEIGHT = 4;
const MAX_NODES = 12000;
const MAX_LOOP_BOUND = 4096;
const MAX_INDEX = 1 << 20;

const ALLOWED: ReadonlySet<string> = new Set([
  "varDecl", "assign", "exprStmt", "if", "for", "while", "doWhile", "block", "return", "break", "continue", "bytesSet",
  "numLit", "boolLit", "varRef", "bin", "unary", "logical", "ternary", "toBool", "incDec", "assignExpr", "bytesIntrinsic", "libCall",
]);

function isNode(x: unknown): x is Node {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isF64Bytes(t: unknown): boolean {
  const k = t as { kind?: string; elem?: string } | undefined;
  return k?.kind === "bytes" && k.elem === "f64";
}

interface Range {
  lo: number;
  hi: number; // inclusive
}

interface Scan {
  ok: boolean;
  nodes: number;
  /** param local id -> the largest covered index + 1 */
  need: Map<string, number>;
  /** weighted count (see LOOP_WEIGHT) */
  covered: number;
  /** how many accesses were covered */
  sites: number;
}

/** The inclusive range an index expression is proven to stay in, or null. `ranges` holds the counters of the enclosing canonical loops. */
function indexRange(e: Node, ranges: ReadonlyMap<string, Range>): Range | null {
  switch (e["kind"]) {
    case "numLit": {
      const v = e["value"] as number;
      return Number.isInteger(v) && v >= 0 && v < MAX_INDEX ? { lo: v, hi: v } : null;
    }
    case "varRef":
      return ranges.get(e["localId"] as string) ?? null;
    case "bin": {
      const op = e["op"];
      if (op !== "+" && op !== "-") return null;
      const l = e["left"] as Node;
      const r = e["right"] as Node;
      if (r["kind"] !== "numLit" || !Number.isInteger(r["value"] as number)) return null;
      const lr = indexRange(l, ranges);
      if (lr === null) return null;
      const k = r["value"] as number;
      const lo = op === "+" ? lr.lo + k : lr.lo - k;
      const hi = op === "+" ? lr.hi + k : lr.hi - k;
      return lo >= 0 && hi < MAX_INDEX ? { lo, hi } : null;
    }
    default:
      return null;
  }
}

/** The counter of a canonical counted loop, with the range it takes inside the body, or null. */
function canonicalLoop(s: Node, bodyWrites: (id: string) => number): { id: string; range: Range } | null {
  const init = s["init"] as Node | null;
  const cond = s["cond"] as Node | null;
  const update = s["update"] as Node | null;
  if (init === null || cond === null || update === null) return null;
  if ((init["kind"] !== "varDecl" && init["kind"] !== "assign") || typeof init["localId"] !== "string") return null;
  const id = init["localId"] as string;
  const iv = (init["kind"] === "varDecl" ? init["init"] : init["value"]) as Node | null;
  if (iv === null || iv["kind"] !== "numLit" || !Number.isInteger(iv["value"] as number) || (iv["value"] as number) < 0) return null;
  if (cond["kind"] !== "bin" || (cond["op"] !== "<" && cond["op"] !== "<=")) return null;
  const cl = cond["left"] as Node;
  const cr = cond["right"] as Node;
  if (cl["kind"] !== "varRef" || cl["localId"] !== id || cr["kind"] !== "numLit" || !Number.isInteger(cr["value"] as number)) return null;
  let stepped = false;
  if (update["kind"] === "exprStmt") {
    const u = update["expr"] as Node;
    stepped = u["kind"] === "incDec" && u["op"] === "+" && u["localId"] === id;
  } else if (update["kind"] === "assign" && update["localId"] === id) {
    const v = update["value"] as Node;
    stepped =
      v["kind"] === "bin" && v["op"] === "+" &&
      (v["left"] as Node)["kind"] === "varRef" && (v["left"] as Node)["localId"] === id &&
      (v["right"] as Node)["kind"] === "numLit" && (v["right"] as Node)["value"] === 1;
  }
  if (!stepped || bodyWrites(id) !== 0) return null;
  const lo = iv["value"] as number;
  const bound = cr["value"] as number;
  const hi = cond["op"] === "<" ? bound - 1 : bound;
  if (hi < lo || hi > MAX_LOOP_BOUND) return null;
  return { id, range: { lo, hi } };
}

/** Walks `body`; `mark` (clone pass) is called with every covered access node. Returns the need map and whether every node kind is allowed. */
function scan(fn: IrFunction, body: IrStmt[], params: ReadonlySet<string>, mark: ((n: Node) => void) | null): Scan {
  const out: Scan = { ok: true, nodes: 0, need: new Map(), covered: 0, sites: 0 };
  // Locals written anywhere in the body (the loop counters must not be, outside their own update; the params must not be at all).
  const writes = new Map<string, number>();
  const countWrites = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) countWrites(y);
      return;
    }
    if (!isNode(x)) return;
    if ((x["kind"] === "assign" || x["kind"] === "assignExpr" || x["kind"] === "incDec" || x["kind"] === "varDecl") && typeof x["localId"] === "string") {
      writes.set(x["localId"] as string, (writes.get(x["localId"] as string) ?? 0) + 1);
    }
    for (const [k, v] of Object.entries(x)) if (k !== "loc" && k !== "type") countWrites(v);
  };
  countWrites(body);
  const locals = new Map(fn.locals.map((l) => [l.id, l]));
  const goodParam = (id: string): boolean => {
    if (!params.has(id) || writes.has(id)) return false;
    const l = locals.get(id);
    return l !== undefined && l.boxed !== true && l.tdz !== true && isF64Bytes(l.type);
  };
  const cover = (n: Node, recv: Node, idx: Node, ranges: ReadonlyMap<string, Range>): void => {
    if (recv["kind"] !== "varRef" || !goodParam(recv["localId"] as string)) return;
    const r = indexRange(idx, ranges);
    if (r === null) return;
    const id = recv["localId"] as string;
    out.need.set(id, Math.max(out.need.get(id) ?? 0, r.hi + 1));
    out.sites++;
    out.covered += ranges.size > 0 ? LOOP_WEIGHT : 1;
    mark?.(n);
  };
  const walk = (x: unknown, ranges: ReadonlyMap<string, Range>): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y, ranges);
      return;
    }
    if (!isNode(x)) return;
    const kind = x["kind"];
    if (typeof kind === "string") {
      out.nodes++;
      if (!ALLOWED.has(kind)) {
        out.ok = false;
        return;
      }
      if (kind === "libCall" && !String(x["fn"]).startsWith("math.")) {
        out.ok = false;
        return;
      }
      if (kind === "bytesIntrinsic") {
        const m = x["method"];
        if (m !== "get" && m !== "length") {
          out.ok = false;
          return;
        }
        if (m === "get" && (x["args"] as Node[]).length === 1 && !isBig(x)) cover(x, x["receiver"] as Node, (x["args"] as Node[])[0]!, ranges);
      }
      if (kind === "bytesSet") cover(x, x["arr"] as Node, x["index"] as Node, ranges);
      if (kind === "for") {
        const loop = canonicalLoop(x, (id) => countFor(x, id));
        walk(x["init"], ranges);
        walk(x["cond"], ranges);
        walk(x["update"], ranges);
        const inner = loop === null ? ranges : new Map(ranges).set(loop.id, loop.range);
        walk(x["body"], inner);
        return;
      }
    }
    for (const [k, v] of Object.entries(x)) if (k !== "loc" && k !== "type") walk(v, ranges);
  };
  walk(body, new Map());
  return out;
}

/** How many writes to `id` the `for` body (not its header) holds. */
function countFor(loop: Node, id: string): number {
  let n = 0;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (!isNode(x)) return;
    if ((x["kind"] === "assign" || x["kind"] === "assignExpr" || x["kind"] === "incDec" || x["kind"] === "varDecl") && x["localId"] === id) n++;
    for (const [k, v] of Object.entries(x)) if (k !== "loc" && k !== "type") walk(v);
  };
  walk(loop["body"]);
  return n;
}

function isBig(x: Node): boolean {
  return (x["type"] as { kind?: string } | undefined)?.kind === "bigint";
}

function cloneNode<T>(x: T): T {
  if (Array.isArray(x)) return x.map(cloneNode) as unknown as T;
  if (x !== null && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) o[k] = k === "loc" || k === "type" ? v : cloneNode(v);
    return o as T;
  }
  return x;
}

export interface F64RawStats {
  versioned: number;
  accesses: number;
}

export function f64RawPass(mod: IrModule): F64RawStats {
  const stats: F64RawStats = { versioned: 0, accesses: 0 };
  const mode = process.env["SCRIPTC_F64RAW"];
  if (mode === "off") return stats;
  for (const fn of mod.functions) {
    if (fn.async === true || fn.generator !== undefined || fn.params.length === 0 || fn.body.length === 0) continue;
    if ((fn.captures ?? []).length > 0) continue;
    const params = new Set(fn.params.map((p) => p.localId));
    const first = scan(fn, fn.body, params, null);
    if (!first.ok || first.nodes > MAX_NODES || first.covered < MIN_ACCESSES || first.need.size === 0) continue;
    const copy = cloneNode(fn.body);
    const second = scan(fn, copy, params, (n) => {
      n["raw"] = true;
    });
    if (second.sites !== first.sites) continue; // the two walks must agree, or leave the function alone
    const loc = fn.body[0]!.loc;
    let cond: IrExpr | null = null;
    for (const p of fn.params) {
      const need = first.need.get(p.localId);
      if (need === undefined) continue;
      const guard: IrExpr = {
        kind: "bytesIntrinsic",
        method: "f64Ok",
        receiver: { kind: "varRef", localId: p.localId, type: p.type, loc },
        args: [{ kind: "numLit", value: need, type: F64, loc }],
        type: BOOL,
        loc,
      };
      cond = cond === null ? guard : { kind: "logical", op: "&&", left: cond, right: guard, type: BOOL, loc };
    }
    const orig = fn.body;
    if (mode === "noguard") cond = { kind: "logical", op: "||", left: cond!, right: { kind: "boolLit", value: true, type: BOOL, loc }, type: BOOL, loc };
    if (mode === "report") process.stderr.write(`F64RAW ${fn.name} ${first.sites} ${[...first.need].map(([k, v]) => `${k}>=${v}`).join(",")}\n`);
    fn.body = [{ kind: "if", cond: cond!, then: copy, else_: orig, loc }];
    stats.versioned++;
    stats.accesses += first.sites;
  }
  return stats;
}

/** The parameter locals a versioned function reads or writes through `raw` accesses (the C emitter declares one data-pointer local for each). */
export function rawReceivers(fn: IrFunction): string[] {
  const out = new Set<string>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (!isNode(x)) return;
    if (x["raw"] === true) {
      const recv = (x["kind"] === "bytesSet" ? x["arr"] : x["receiver"]) as Node;
      if (recv["kind"] === "varRef") out.add(recv["localId"] as string);
    }
    for (const [k, v] of Object.entries(x)) if (k !== "loc" && k !== "type") walk(v);
  };
  walk(fn.body);
  return [...out];
}
