/* DEAD MODULE-LEVEL INITIALIZERS. A file-scope `const X = <expr>` whose binding no reachable code ever reads, and whose initializer has no effect Node could
 * observe, is not built: its `assign` in the module's `%init.<i>` function is removed (the slot stays, never written, never read).
 *
 * READ. The IR names a global by its id ("%g.<q>.<name>") in a `varRef`; a re-export, a namespace object (`import * as ns`), `require` of the module as a value
 * and `export default` all lower to a read of that id, so every one of them is a read here WITHOUT special handling, and an export that nobody reads is not.
 * A read is any occurrence of the id as a string in any function body other than the `localId` of the one `assign` that initializes it. A binding with a second
 * write, a `tdz` flag (a read before the declarator throws), a mutable binding, or a use outside an `%init` top-level statement is kept.
 * The pass does nothing for a module that embeds the npm engine graph (an eval/island can name any binding), for a library build, or under
 * SCRIPTC_DEADINIT=off.
 *
 * PURE. The initializer must be provably free of effects Node can observe: no user code, no getter or proxy, no throw Node raises, no non-termination, no write to
 * anything that outlives the expression. Allowed: literals, reads of locals and of other non-tdz globals, record/array literals of pure parts, field reads of
 * static records, discriminated reads of a union whose every arm has the field, arithmetic/comparison/string operators over f64/bool/string, calls of module
 * functions whose bodies are themselves pure (memoized; recursion is refused), `forOf` over an array, and writes into a local that this function created from a
 * literal and never reassigns. The compiler's own REPRESENTATION traps (`unionNarrow`, `rec.width`, `downcast`: a check that the value fits a declared static
 * type) are not Node throws: Node performs no such check, so removing one agrees with Node.
 * Anything else keeps the initializer. SCRIPTC_DEADINIT=report prints one `DEADINIT drop|keep <id> [reason]` line per never-read candidate. */
import type { IrFunction, IrModule } from "./nodes.js";

type Node = Record<string, unknown>;

/** Per-function analysis context: locals created from a literal and never reassigned (safe to write into), and parameters known to hold a pure closure. */
interface Cx {
  fresh: Set<string>;
  callable: Set<string>;
  /** canonical for-loop counters in scope (initialised from a non-negative integer literal, only ever stepped by a positive literal) */
  counters: Set<string>;
}

export interface DeadInitResult {
  dropped: string[];
  kept: { id: string; reason: string }[];
}

const isNode = (n: unknown): n is Node => typeof n === "object" && n !== null && !Array.isArray(n);
const kindOf = (n: unknown): string => (isNode(n) && typeof n["kind"] === "string" ? (n["kind"] as string) : "");

/** Representation checks the static language adds: not Node-observable. */
const REPR_TRAP_CALL = /^%(union\.narrow|rec\.width)\./;

export function deadInitPass(mod: IrModule): DeadInitResult {
  const out: DeadInitResult = { dropped: [], kept: [] };
  const mode = process.env["SCRIPTC_DEADINIT"];
  if (mode === "off") return out;
  if (mod.embedded !== undefined || mod.lib !== undefined) return out;
  const globals = mod.globals ?? [];
  if (globals.length === 0) return out;
  const report = mode === "report";
  const fnByName = new Map<string, IrFunction>(mod.functions.map((f) => [f.name, f]));
  const unionById = new Map((mod.unions ?? []).map((u) => [u.id, u]));
  const shapeById = new Map((mod.records ?? []).map((r) => [r.id, r]));

  // 1. Candidate bindings and the occurrences of every global id.
  const candidates = new Map<string, { fn: IrFunction; idx: number }>();
  const ids = new Set(globals.filter((g) => !g.mutable && g.tdz !== true && !g.name.startsWith("%")).map((g) => g.id));
  const occ = new Map<string, number>(); // id -> occurrences as a string anywhere (assign.localId counted)
  const assigns = new Map<string, number>();
  const walk = (n: unknown): void => {
    if (typeof n === "string") {
      if (ids.has(n)) occ.set(n, (occ.get(n) ?? 0) + 1);
      return;
    }
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (!isNode(n)) return;
    if (n["kind"] === "assign" && typeof n["localId"] === "string" && ids.has(n["localId"] as string)) assigns.set(n["localId"] as string, (assigns.get(n["localId"] as string) ?? 0) + 1);
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      walk(n[k]);
    }
  };
  for (const fn of mod.functions) walk(fn.body);
  for (const fn of mod.functions) {
    if (!fn.name.startsWith("%init.") || !Array.isArray(fn.body)) continue;
    (fn.body as unknown as Node[]).forEach((st, idx) => {
      if (kindOf(st) === "assign" && typeof st["localId"] === "string" && ids.has(st["localId"] as string)) candidates.set(st["localId"] as string, { fn, idx });
    });
  }

  // 2. Purity, memoized per function.
  const fnPure = new Map<string, boolean | "pending">();
  const why = new Map<string, string>();
  let lastWhy = "";
  const no = (reason: string): false => {
    if (lastWhy === "") lastWhy = reason;
    return false;
  };

  const unionArmsHave = (unionId: string, field: string): boolean => {
    const u = unionById.get(unionId);
    if (u === undefined || u.arms.length === 0) return false;
    return u.arms.every((a) => a.kind === "record" && (shapeById.get((a as { shapeId: string }).shapeId)?.fields.some((f) => f.name === field) ?? false));
  };
  const unionAllRecords = (unionId: string): boolean => {
    const u = unionById.get(unionId);
    return u !== undefined && u.arms.length > 0 && u.arms.every((a) => a.kind === "record");
  };
  const scalarType = (t: unknown): boolean => isNode(t) && (t["kind"] === "f64" || t["kind"] === "bool" || t["kind"] === "string");

  const pureExpr = (e: unknown, cx: Cx): boolean => {
    if (!isNode(e)) return no("non-node expression");
    const k = e["kind"] as string;
    const sub = (x: unknown): boolean => pureExpr(x, cx);
    switch (k) {
      case "numLit":
      case "strLit":
      case "boolLit":
      case "unitLit":
      case "bigLit":
        return true;
      case "varRef": {
        const id = e["localId"] as string;
        if (id.startsWith("%g.")) {
          const g = globals.find((x) => x.id === id);
          return g !== undefined && g.tdz !== true ? true : no(`read of tdz global ${id}`);
        }
        return true;
      }
      case "recordLit": {
        const fields = e["fields"] as Node[];
        for (const f of fields) {
          if (f["viewSlot"] === true || f["drop"] === true || f["ownIf"] !== undefined) return no("recordLit member with a view slot / drop / conditional own flag");
          if (!sub(f["value"])) return false;
        }
        return true;
      }
      case "arrayLit":
        if ((e["spreads"] as unknown[] | undefined)?.length) return no("array literal with a spread");
        return (e["elems"] as unknown[]).every(sub);
      case "recordGet":
        return sub(e["obj"]);
      case "recordKeyGet":
        return sub(e["obj"]) && sub(e["key"]);
      case "recordOvfHas":
        return sub(e["obj"]) && sub(e["key"]);
      case "recordOvfSlotGet":
        return sub(e["obj"]) && sub(e["slot"]);
      case "recordGetAt":
        return sub(e["obj"]) && sub(e["index"]);
      case "recordOvfSlots":
      case "recordOvfKeys":
      case "recordKeyPresent":
      case "recordSlotFilled":
        return sub(e["obj"]);
      case "recordKeyPresentAt":
        return sub(e["obj"]) && sub(e["index"]);
      case "arrayGet":
        return sub(e["arr"]) && sub(e["index"]);
      case "unionDisc":
        return unionArmsHave(e["unionId"] as string, e["field"] as string) ? sub(e["value"]) : no("unionDisc over a union with an arm that lacks the field");
      case "unionKeyGet":
        return unionAllRecords(e["unionId"] as string) ? sub(e["key"]) && sub(e["value"]) : no("unionKeyGet over a non-record arm");
      case "unionWrap":
        return sub(e["value"]);
      case "bin":
        return scalarType((e["left"] as Node)["type"]) && scalarType((e["right"] as Node)["type"]) ? sub(e["left"]) && sub(e["right"]) : no("bin over a non-scalar operand");
      case "unary":
        return scalarType((e["operand"] as Node)["type"]) ? sub(e["operand"]) : no("unary over a non-scalar operand");
      case "strConcat":
      case "strEq":
      case "strCmp":
      case "logical":
        return sub(e["left"]) && sub(e["right"]);
      case "toBool":
        return sub(e["operand"]);
      case "ternary":
        return sub(e["cond"]) && sub(e["then"]) && sub(e["else_"]);
      case "arrIntrinsic": {
        const m = e["method"] as string;
        const recv = e["receiver"] as Node;
        if (m === "push" && kindOf(recv) === "varRef" && cx.fresh.has(recv["localId"] as string)) return (e["args"] as unknown[]).every(sub);
        if (m === "setLength" && kindOf(recv) === "varRef" && cx.fresh.has(recv["localId"] as string) && e["lenWrite"] !== true) {
          // preallocating a result array: the length must be provably valid (a RangeError in Node otherwise)
          const a0 = (e["args"] as Node[])[0];
          const ok0 = kindOf(a0) === "arrIntrinsic" && (a0 as Node)["method"] === "length" && sub((a0 as Node)["receiver"]);
          const ok1 = kindOf(a0) === "numLit" && Number.isInteger((a0 as Node)["value"]) && ((a0 as Node)["value"] as number) >= 0;
          const ok2 = kindOf(a0) === "bin" && (a0 as Node)["op"] === "+" && kindOf((a0 as Node)["left"]) === "varRef" && cx.counters.has(((a0 as Node)["left"] as Node)["localId"] as string) && kindOf((a0 as Node)["right"]) === "numLit" && Number.isInteger(((a0 as Node)["right"] as Node)["value"]) && (((a0 as Node)["right"] as Node)["value"] as number) >= 0;
          return (e["args"] as unknown[]).length === 1 && (ok0 || ok1 || ok2) ? true : no("setLength with an unproven length");
        }
        if ((m === "length" || m === "hasIndex" || m === "hasSlot" || m === "hasHoles") && e["lenWrite"] !== true) return sub(recv) && (e["args"] as unknown[]).every(sub);
        return no(`array intrinsic ${m}`);
      }
      case "call": {
        const callee = e["callee"] as string;
        const args = e["args"] as unknown[];
        const callable = new Set<number>();
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (kindOf(a) === "closure") {
            const c = a as Node;
            if ((c["captures"] as string[]).length > 0) return no("closure with captures");
            if (!fnIsPure(c["fnName"] as string)) return false;
            callable.add(i);
          } else if (!sub(a)) return false;
        }
        if (REPR_TRAP_CALL.test(callee)) return true;
        return fnIsPure(callee, callable) ? true : no(`call of impure or unknown function ${callee}`);
      }
      case "callValue": {
        const c = e["callee"] as Node;
        if (kindOf(c) === "varRef" && cx.callable.has(c["localId"] as string)) return (e["args"] as unknown[]).every(sub);
        return no("call of a closure value that is not a pure closure argument");
      }
      case "toString":
        return scalarType((e["operand"] as Node)["type"]) ? sub(e["operand"]) : no("toString over a non-scalar operand");
      case "mapNew": {
        const seed = e["seed"] as { key: unknown; value: unknown }[] | undefined;
        return (seed ?? []).every((p) => sub(p.key) && sub(p.value));
      }
      case "setNew":
        return e["seed"] === undefined ? true : no("Set constructed from an iterable");
      default:
        return no(k === "libCall" || k === "intrinsic" ? `expression kind ${k} ${String(e["fn"] ?? e["name"])}` : `expression kind ${k}`);
    }
  };

  const pureStmts = (body: unknown, cx: Cx): boolean => {
    if (!Array.isArray(body)) return no("non-array body");
    for (const st of body as Node[]) {
      const k = kindOf(st);
      switch (k) {
        case "varDecl": {
          const init = st["init"];
          if (init !== null && !pureExpr(init, cx)) return false;
          const ik = kindOf(init);
          if (init !== null && (ik === "recordLit" || ik === "arrayLit")) cx.fresh.add(st["localId"] as string);
          break;
        }
        case "assign":
          if ((st["localId"] as string).startsWith("%g.")) return no("write to a global");
          cx.fresh.delete(st["localId"] as string); // a reassigned local is no longer known fresh
          if (!pureExpr(st["value"], cx)) return false;
          break;
        case "exprStmt":
          if (!pureExpr(st["expr"], cx)) return false;
          break;
        case "return":
          if (st["value"] !== null && !pureExpr(st["value"], cx)) return false;
          break;
        case "if":
          if (!pureExpr(st["cond"], cx) || !pureStmts(st["then"], cx) || (st["else_"] !== null && !pureStmts(st["else_"], cx))) return false;
          break;
        case "block":
          if (!pureStmts(st["body"], cx)) return false;
          break;
        case "for": {
          if (!pureFor(st, cx)) return false;
          break;
        }
        case "forOf": {
          const it = st["iterable"] as Node;
          const t = it["type"] as Node | undefined;
          if (t === undefined || t["kind"] !== "array") return no("forOf over a non-array");
          if (!pureExpr(it, cx) || !pureStmts(st["body"], cx)) return false;
          break;
        }
        case "recordKeySet": {
          const o = st["obj"] as Node;
          if (kindOf(o) !== "varRef" || !cx.fresh.has(o["localId"] as string)) return no("keyed write into a record that is not a fresh local");
          if (!pureExpr(st["key"], cx) || !pureExpr(st["value"], cx)) return false;
          break;
        }
        case "arraySet": {
          const o = st["arr"] as Node;
          if (kindOf(o) !== "varRef" || !cx.fresh.has(o["localId"] as string)) return no("indexed write into an array that is not a fresh local");
          if (!pureExpr(st["index"], cx) || !pureExpr(st["value"], cx)) return false;
          break;
        }
        default:
          return no(`statement kind ${k}`);
      }
    }
    return true;
  };

  /** `for (let i = <num>; i < E; i = i + <positive literal>)` where E is a literal or the length of a local array the body never grows, and the body never writes i. */
  const pureFor = (st: Node, cx: Cx): boolean => {
    const init = st["init"] as Node | null, cond = st["cond"] as Node | null, update = st["update"] as Node | null;
    if (init === null || cond === null || update === null) return no("for without init, condition or update");
    const kInit = kindOf(init);
    if ((kInit !== "varDecl" && kInit !== "assign") || kindOf(init["kind"] === "varDecl" ? init["init"] : init["value"]) !== "numLit") return no("for counter not initialised from a literal");
    const i = init["localId"] as string;
    if (kindOf(cond) !== "bin" || (cond["op"] !== "<" && cond["op"] !== "<=") || kindOf(cond["left"]) !== "varRef" || (cond["left"] as Node)["localId"] !== i) return no("for condition is not counter < bound");
    const bound = cond["right"] as Node;
    let guarded: string | null = null;
    if (kindOf(bound) === "numLit") guarded = null;
    else if (kindOf(bound) === "arrIntrinsic" && bound["method"] === "length" && kindOf(bound["receiver"]) === "varRef") guarded = (bound["receiver"] as Node)["localId"] as string;
    else if (kindOf(bound) === "varRef" && !(bound["localId"] as string).startsWith("%g.")) guarded = bound["localId"] as string;
    else return no("for bound is neither a literal, a local, nor an array length");
    const boundIsArray = kindOf(bound) === "arrIntrinsic";
    if (kindOf(update) !== "assign" || update["localId"] !== i) return no("for update is not an assignment of the counter");
    const uv = update["value"] as Node;
    if (kindOf(uv) !== "bin" || uv["op"] !== "+" || kindOf(uv["left"]) !== "varRef" || (uv["left"] as Node)["localId"] !== i || kindOf(uv["right"]) !== "numLit" || !((uv["right"] as Node)["value"] as number > 0)) return no("for update is not counter + positive literal");
    // the body must not write the counter, nor change the length of the bounding array
    let tampered = false;
    const scan = (n: unknown): void => {
      if (tampered) return;
      if (Array.isArray(n)) { for (const x of n) scan(x); return; }
      if (!isNode(n)) return;
      const k = n["kind"];
      if ((k === "assign" || k === "varDecl") && (n["localId"] === i || (guarded !== null && n["localId"] === guarded))) tampered = true;
      if (k === "incDec" || k === "assignExpr") tampered = true;
      if (boundIsArray && guarded !== null && k === "arrIntrinsic" && kindOf(n["receiver"]) === "varRef" && (n["receiver"] as Node)["localId"] === guarded && n["method"] !== "length" && n["method"] !== "hasIndex" && n["method"] !== "hasSlot") tampered = true;
      if (boundIsArray && guarded !== null && k === "arraySet" && kindOf(n["arr"]) === "varRef" && (n["arr"] as Node)["localId"] === guarded) tampered = true;
      for (const key of Object.keys(n)) if (key !== "loc") scan(n[key]);
    };
    scan(st["body"]);
    if (tampered) return no("for body writes the counter or grows the bounding array");
    const initV = (kInit === "varDecl" ? init["init"] : init["value"]) as Node;
    if (!Number.isInteger(initV["value"]) || (initV["value"] as number) < 0) return no("for counter does not start at a non-negative integer");
    cx.counters.add(i);
    return pureExpr(cond, cx) && pureStmts(st["body"], cx);
  };

  function fnIsPure(name: string, callable: ReadonlySet<number> = new Set<number>()): boolean {
    const key = callable.size === 0 ? name : `${name}#${[...callable].join(",")}`;
    const memo = fnPure.get(key);
    if (memo === "pending") return no(`recursive function ${name}`);
    if (memo !== undefined) return memo;
    const fn = fnByName.get(name);
    if (fn === undefined) return no(`unknown function ${name}`);
    if (fn.async === true || fn.generator !== undefined || (fn.captures?.length ?? 0) > 0) return no(`generator, async or closure function ${name}`);
    fnPure.set(key, "pending");
    const saved = lastWhy;
    lastWhy = "";
    const ok = pureStmts(fn.body, { fresh: new Set<string>(), callable: new Set([...callable].map((ix) => fn.params[ix]?.localId ?? "")), counters: new Set<string>() });
    if (!ok) why.set(name, lastWhy);
    lastWhy = ok ? saved : saved === "" ? lastWhy : saved;
    fnPure.set(key, ok);
    return ok;
  }

  // 3. Decide, then drop. A global's initializer expression is checked in the context of its `%init` function (locals: none).
  const drops: { fn: IrFunction; idx: number; id: string }[] = [];
  for (const g of globals) {
    const c = candidates.get(g.id);
    if (c === undefined) continue;
    if ((occ.get(g.id) ?? 0) !== 1 || (assigns.get(g.id) ?? 0) !== 1) continue; // read somewhere, or written twice: not a candidate (not reported)
    lastWhy = "";
    const st = (c.fn.body as unknown as Node[])[c.idx]!;
    const ok = pureExpr(st["value"], { fresh: new Set<string>(), callable: new Set<string>(), counters: new Set<string>() });
    if (ok) {
      drops.push({ fn: c.fn, idx: c.idx, id: g.id });
      out.dropped.push(g.id);
      if (report) process.stderr.write(`DEADINIT drop ${g.id}\n`);
    } else {
      out.kept.push({ id: g.id, reason: lastWhy });
      if (report) process.stderr.write(`DEADINIT keep ${g.id}: ${lastWhy}\n`);
    }
  }
  // Remove back to front so the indices of one function stay valid.
  drops.sort((a, b) => b.idx - a.idx);
  for (const d of drops) (d.fn.body as unknown as Node[]).splice(d.idx, 1);
  return out;
}
