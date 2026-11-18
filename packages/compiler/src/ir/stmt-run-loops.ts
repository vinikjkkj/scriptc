/* STATEMENT-RUN LOOPS: a run of consecutive statements that are the SAME statement except for string literals becomes one loop over a constant table.
 *
 * Table-building code is straight-line: a module initializer that defines thousands of accessors, stores thousands of defaults or fills a map writes one dynamic
 * call sequence per entry, ~700 bytes of machine code for `Object.defineProperty(proto, "_f", {get: M.oneOfGetter(t = ["f"]), set: M.oneOfSetter(t)})`, run ONCE and
 * resident at the startup peak. zapo's proto module has 2,920 of them. This pass finds a RUN of N >= MIN consecutive statements in one statement list whose canonical
 * text is identical once every string literal is abstracted, and replaces the run by
 *
 *     for (fi = 0; fi < N; fi++) { <the first statement, each string literal that differs across the run read as runKeyAt(table, fi)> }
 *
 * `runKeyAt(table, fi)` is the string literal table[fi] (an immortal interned literal, as strLit; ir/nodes.ts). A literal that is the same in every statement stays a
 * strLit in the loop body. The loop performs, in the order of the run, exactly the operations the unrolled statements performed: the same calls with the same
 * operands, so getters, setters, proxies and user code behave identically, an exception at row i leaves the state the first i rows made, and nothing about the
 * target is observable from the loop (the index is a fresh local). The emitters keep no runtime source positions (positions are comments and two env-gated
 * diagnostics), so collapsing the statements' `loc` changes no output. KEYED ON IR SHAPE ONLY: no module, package or name is mentioned.
 *
 * Qualifying statement (everything else stays unrolled, so the proof is local):
 *   - an `exprStmt` or `assign`, and big enough to be worth a loop (MIN_NODES nodes) and about dynamic values (a `dyn*` node or a `dyn.` library call), so a loop
 *     adds nothing measurable to what it already costs;
 *   - without a declaration, closure, await, yield, return, break, continue, throw, try or loop inside (a loop body must not change control flow or scope);
 *   - at least one string literal that differs across the run; every other field of every node, locals included, EQUAL (the canonical text is compared, locations
 *     and nothing else dropped), so a number, a local or a type that differs makes two statements different shapes: a near miss is not outlined.
 * Not in code that already repeats: a statement list inside a loop is skipped (hot), and async/generator functions are skipped (their frames are state machines).
 *
 * SCRIPTC_STMT_RUN_WHY=1 prints one `STMTRUN <function> rows N nodes M tables K` line per loop built (stderr). SCRIPTC_STMT_RUN_MIN: 0 turns the pass off; N >= 2 sets the run length for every statement size; unset = 2 for big statements (>= BIG_NODES), 4 for the others. */
import type { IrExpr, IrFunction, IrStmt, SrcLoc } from "./nodes.js";
import { F64, BOOL } from "./nodes.js";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);

const MIN_NODES = 16;
const BIG_NODES = 30;
const STMT_KINDS = new Set(["exprStmt", "assign", "varDecl", "if", "block", "return", "while", "for", "forOf", "forIn", "doWhile", "tryCatch", "break", "continue", "throw", "recordKeySet", "arraySet", "switch", "labeled"]);
const LOOP_KINDS = new Set(["while", "for", "forOf", "forIn", "doWhile"]);
/** Where a string literal may become a table read: any position that takes an arbitrary string expression. */
const FREE_PARENTS = new Set(["libCall.args", "call.args", "callValue.args", "dynInvoke.args", "arrayLit.elems", "dynFrom.value", "assignExpr.value", "assign.value"]);
/** Inside a qualifying statement: control flow, scope and suspension a loop body must not contain. */
const DENY_KINDS = new Set(["varDecl", "awaitExpr", "yield", "yieldStar", "return", "break", "continue", "throw", "tryCatch", "while", "for", "forOf", "forIn", "doWhile", "labeled", "switch", "block", "if"]);

export function stmtRunMin(): number | null {
  const v = process.env["SCRIPTC_STMT_RUN_MIN"];
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

interface Shape {
  /** canonical text with every string literal abstracted */
  text: string;
  /** the abstracted string literals, in traversal order */
  lits: string[];
  /** per literal: whether it sits where any string expression may stand (a call argument, an array element, a boxed value, an assigned value) */
  free: boolean[];
  nodes: number;
}

/** The shape of one statement, or null when it does not qualify. */
function shapeOf(st: unknown): Shape | null {
  if (!isObj(st) || (st["kind"] !== "exprStmt" && st["kind"] !== "assign")) return null;
  const lits: string[] = [];
  const free: boolean[] = [];
  let nodes = 0;
  let dyn = false;
  let ok = true;
  const canon = (n: unknown, parent: string, key: string): string => {
    if (Array.isArray(n)) return `[${n.map((x) => canon(x, parent, key)).join(",")}]`;
    if (!isObj(n)) return JSON.stringify(n) ?? "undefined";
    const kind = n["kind"];
    if (typeof kind === "string") {
      nodes++;
      if (DENY_KINDS.has(kind)) ok = false;
      if (kind.startsWith("dyn")) dyn = true;
      if (kind === "libCall" && typeof n["fn"] === "string" && (n["fn"] as string).startsWith("dyn.")) dyn = true;
      if (kind === "strLit" && typeof n["value"] === "string") {
        lits.push(n["value"]);
        free.push(FREE_PARENTS.has(`${parent}.${key}`));
        return `{strLit ${JSON.stringify(n["type"])}}`;
      }
    }
    let s = "{";
    for (const k of Object.keys(n).sort()) {
      if (k === "loc") continue;
      s += `${k}=${canon(n[k], typeof kind === "string" ? kind : parent, k)};`;
    }
    return s + "}";
  };
  const text = canon(st, "", "");
  return ok && dyn && nodes >= MIN_NODES && lits.length > 0 ? { text, lits, free, nodes } : null;
}

/** A copy of `n` whose string literals at the varying slots are runKeyAt reads of that slot's table (slots count strLit in the same traversal as shapeOf). */
function rewrite(n: unknown, varying: (string[] | null)[], next: { i: number }, index: () => IrExpr): unknown {
  if (Array.isArray(n)) return n.map((x) => rewrite(x, varying, next, index));
  if (!isObj(n)) return n;
  if (n["kind"] === "strLit" && typeof n["value"] === "string") {
    const slot = next.i++;
    const table = varying[slot];
    return table === null || table === undefined ? n : { kind: "runKeyAt", run: table, index: index(), type: n["type"], loc: n["loc"] };
  }
  const out: Obj = {};
  for (const k of Object.keys(n)) out[k] = rewrite(n[k], varying, next, index);
  return out;
}

export function outlineStmtRuns(functions: IrFunction[], minOverride: number | null = stmtRunMin()): number {
  if (minOverride === 0) return 0;
  let loops = 0;
  for (const fn of functions) {
    if (fn.async === true || fn.generator !== undefined) continue;
    const used = new Set(fn.locals.map((l) => l.id));
    const freshIndex = (): string => {
      let n = 0;
      while (used.has(`ri.${n}`)) n++;
      const id = `ri.${n}`;
      used.add(id);
      fn.locals.push({ id, name: "ri", type: F64, mutable: true });
      return id;
    };
    const processList = (list: IrStmt[]): void => {
      const shapes = list.map((s) => shapeOf(s));
      const out: IrStmt[] = [];
      let i = 0;
      while (i < list.length) {
        const s0 = shapes[i];
        let j = i + 1;
        if (s0 !== null && s0 !== undefined) {
          while (j < list.length && shapes[j] !== null && shapes[j]!.text === s0.text) j++;
        }
        const n = j - i;
        const need = minOverride !== null ? minOverride : s0 !== null && s0 !== undefined && s0.nodes >= BIG_NODES ? 2 : 4;
        // per slot: the table when the literal differs somewhere in the run
        let varying: (string[] | null)[] = [];
        if (s0 !== null && s0 !== undefined && n >= need) {
          varying = s0.lits.map((_, slot) => {
            const col: string[] = [];
            for (let t = i; t < j; t++) col.push(shapes[t]!.lits[slot]!);
            if (col.every((v) => v === col[0])) return null;
            return shapes.slice(i, j).every((sh) => sh!.free[slot]) ? col : ([] as string[]);
          });
        }
        // an empty table marks a varying literal in a position that must stay a literal: the run stays unrolled
        if (s0 !== null && s0 !== undefined && n >= need && varying.some((v) => v !== null) && !varying.some((v) => v !== null && v.length === 0)) {
          const loc = (list[i] as unknown as { loc: SrcLoc }).loc;
          const fi = freshIndex();
          const ref = (): IrExpr => ({ kind: "varRef", localId: fi, type: F64, loc }) as IrExpr;
          const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc }) as IrExpr;
          const body = [rewrite(list[i], varying, { i: 0 }, ref) as IrStmt];
          out.push({
            kind: "for",
            init: { kind: "varDecl", localId: fi, init: num(0), loc },
            cond: { kind: "bin", op: "<", left: ref(), right: num(n), type: BOOL, loc },
            update: { kind: "assign", localId: fi, value: { kind: "bin", op: "+", left: ref(), right: num(1), type: F64, loc }, loc },
            body,
            loc,
          } as unknown as IrStmt);
          loops++;
          if (process.env["SCRIPTC_STMT_RUN_WHY"] === "1") process.stderr.write(`STMTRUN ${fn.name} rows ${n} nodes ${s0.nodes} tables ${varying.filter((v) => v !== null).length}\n`);
          i = j;
        } else {
          out.push(list[i]!);
          i++;
        }
      }
      if (out.length !== list.length) {
        list.length = 0;
        list.push(...out);
      }
    };
    const visit = (n: unknown, inLoop: boolean): void => {
      if (Array.isArray(n)) {
        if (!inLoop && n.length >= 2 && n.every((x) => isObj(x) && typeof x["kind"] === "string" && STMT_KINDS.has(x["kind"] as string))) processList(n as IrStmt[]);
        for (const x of n) visit(x, inLoop);
        return;
      }
      if (!isObj(n)) return;
      const inner = inLoop || (typeof n["kind"] === "string" && LOOP_KINDS.has(n["kind"] as string));
      for (const k of Object.keys(n)) if (k !== "loc") visit(n[k], inner);
    };
    visit(fn.body, false);
  }
  return loops;
}
