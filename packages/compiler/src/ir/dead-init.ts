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
  /** locals proven never to be a view (a plain-record parameter confined in this function, see staticNonView) */
  nonView: Set<string>;
  /** locals initialised from a record literal (candidates for a staticNonView proof) */
  freshRec: Set<string>;
  /** iterator-state locals opened over a fresh array (`dyn.iterOpen(dynFrom(array))`) and the dyn locals read out of them */
  packs: Set<string>;
  plain: Set<string>;
  /** f64 locals initialised from the literal 0 (iterator indexes) */
  zero: Set<string>;
  /** the body of the function being analysed (undefined for a global initializer expression) */
  body?: unknown;
}
const mkCx = (body?: unknown): Cx => ({ fresh: new Set(), callable: new Set(), counters: new Set(), nonView: new Set(), freshRec: new Set(), packs: new Set(), plain: new Set(), zero: new Set(), body });

/** Parents under which a record operand is only READ: none of them can make the record a view (promotion happens only when a record is boxed into a dyn). */
const READ_PARENTS = new Set(["recordIsView", "recordView", "recordGet", "recordKeyGet", "recordGetAt", "recordOvfHas", "recordOvfSlotGet", "recordOvfSlots", "recordOvfKeys", "recordKeyPresent", "recordKeyPresentAt", "recordSlotFilled"]);

/** Every use of `id` inside `body`: how many are read-only (READ_PARENTS under key obj, plus `extra`), the calls it is passed to, and the raw count of string occurrences (any other use makes raw exceed the sum). */
function usesOf(body: unknown, id: string, extra?: (parent: Node, key: string, self: Node) => boolean): { raw: number; allowed: number; calls: { callee: string; idx: number }[]; bad: string[] } {
  const r = { raw: 0, allowed: 0, calls: [] as { callee: string; idx: number }[], bad: [] as string[] };
  const walk = (n: unknown, parent: Node | null, key: string): void => {
    if (Array.isArray(n)) {
      for (const x of n) {
        if (x === id) r.raw++;
        else walk(x, parent, key);
      }
      return;
    }
    if (!isNode(n)) return;
    if (n["kind"] === "varRef" && n["localId"] === id) {
      if (parent !== null && ((READ_PARENTS.has(kindOf(parent)) && key === "obj") || (extra?.(parent, key, n) ?? false))) r.allowed++;
      else if (parent !== null && kindOf(parent) === "call" && key === "args") {
        const ix = (parent["args"] as unknown[]).indexOf(n);
        if (ix >= 0) r.calls.push({ callee: parent["callee"] as string, idx: ix });
      } else r.bad.push(parent === null ? "root" : `${kindOf(parent)}.${key}`);
    }
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      const v = n[k];
      if (v === id) r.raw++;
      else walk(v, n, k);
    }
  };
  walk(body, null, "");
  return r;
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

  // 1b. STATIC NON-VIEW. A record of a view-granted shape is a "view" once it has been boxed into a dyn (scr_rec_view_promote) or was cast from one; a
  // record that only ever flows into read-only positions (READ_PARENTS) and was built by a record literal can never be one, so `recordIsView` on it is
  // false and the dyn fallback arm it guards is dead. Fail closed: any other use of the binding (stored, boxed, captured, returned) refuses the proof.
  const constMemo = new Map<string, boolean>();
  const paramMemo = new Map<string, boolean>();
  const callsConfined = (calls: { callee: string; idx: number }[]): boolean =>
    calls.every((c) => {
      const f = fnByName.get(c.callee);
      const pid = f?.params[c.idx]?.localId;
      return f !== undefined && pid !== undefined && paramConfined(f, pid);
    });
  function paramConfined(fn: IrFunction, pid: string): boolean {
    const key = `${fn.name}\0${pid}`;
    const memo = paramMemo.get(key);
    if (memo !== undefined) return memo;
    paramMemo.set(key, true); // co-inductive: a recursive pass-through is confined when everything else is
    const u = usesOf(fn.body, pid);
    const ok = (fn.captures?.length ?? 0) === 0 && u.raw === u.allowed + u.calls.length && callsConfined(u.calls);
    paramMemo.set(key, ok);
    return ok;
  }
  /** A const, non-tdz global assigned exactly once, by a record literal, whose every use is read-only. */
  // 1c. INIT ORDER. A record promoted to a view AFTER the candidate has been evaluated cannot make the candidate's `recordIsView` true. Module evaluation
  // order is the static order of the init functions when (a) every call of an `%init.K` is a top-level statement of an init function or of the entry,
  // (b) each init starts with the run-once guard `if (%loaded) return` and has no other `return`: then it is simulated exactly, depth first, marking an
  // init at its start (a guard hit on a cycle returns at once), and every top-level statement gets the time it first executes.
  const initFnByName = new Map<string, IrFunction>();
  let initCallsTotal = 0, initCallsTop = 0, initShapeOk = true;
  {
    const countAll = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(countAll); return; }
      if (!isNode(n)) return;
      if (n["kind"] === "call" && typeof n["callee"] === "string" && (n["callee"] as string).startsWith("%init.")) initCallsTotal++;
      for (const k of Object.keys(n)) if (k !== "loc") countAll(n[k]);
    };
    const hasReturn = (n: unknown): boolean => {
      if (Array.isArray(n)) return n.some(hasReturn);
      if (!isNode(n)) return false;
      if (n["kind"] === "return") return true;
      return Object.keys(n).some((k) => k !== "loc" && hasReturn(n[k]));
    };
    for (const fn of mod.functions) countAll(fn.body);
    for (const fn of mod.functions) {
      const isEntry = fn.name === (mod as { entry?: string }).entry;
      if (!(fn.name.startsWith("%init.") || isEntry) || !Array.isArray(fn.body)) continue;
      initFnByName.set(fn.name, fn);
      const body = fn.body as unknown as Node[];
      for (const st of body) {
        const ex = kindOf(st) === "exprStmt" ? (st["expr"] as Node) : undefined;
        if (ex !== undefined && kindOf(ex) === "call" && typeof ex["callee"] === "string" && (ex["callee"] as string).startsWith("%init.") && (ex["args"] as unknown[]).length === 0) initCallsTop++;
      }
      if (!isEntry) {
        const g = body[0];
        const guard = g !== undefined && kindOf(g) === "if" && g["else_"] === null && Array.isArray(g["then"]) && (g["then"] as Node[]).length === 1 && kindOf((g["then"] as Node[])[0]) === "return" && kindOf(g["cond"]) === "varRef";
        if (!guard || hasReturn(body.slice(1))) initShapeOk = false;
      }
    }
  }
  const stmtTime = new Map<string, number[]>(); // init -> the time each top-level statement first executes (-1: never)
  const finishTime = new Map<string, number>();
  if (initCallsTotal === initCallsTop && initShapeOk && (mod as { entry?: string }).entry !== undefined) {
    let clock = 0;
    const started = new Set<string>();
    const exec = (x: string): void => {
      const fn = initFnByName.get(x);
      if (fn === undefined || started.has(x)) return;
      started.add(x);
      const body = fn.body as unknown as Node[];
      const ts = new Array<number>(body.length).fill(-1);
      stmtTime.set(x, ts);
      body.forEach((st, j) => {
        const ex = kindOf(st) === "exprStmt" ? (st["expr"] as Node) : undefined;
        if (ex !== undefined && kindOf(ex) === "call" && typeof ex["callee"] === "string" && (ex["callee"] as string).startsWith("%init.")) exec(ex["callee"] as string);
        ts[j] = clock++;
      });
      finishTime.set(x, clock++);
    };
    exec((mod as { entry?: string }).entry!);
  }
  /** Does the candidate's init `cand` finish strictly before top-level statement `j` of init `k` first executes? Fail closed. */
  const lateWhy = (cand: string, k: string, j: number): string => {
    if (initCallsTotal !== initCallsTop) return `${initCallsTotal - initCallsTop} of ${initCallsTotal} init calls are not top-level statements`;
    if (!initShapeOk) return "an init lacks the run-once guard shape or has another return";
    if ((mod as { entry?: string }).entry === undefined) return "no entry";
    const fin = finishTime.get(cand), t = stmtTime.get(k)?.[j];
    if (cand === k) return "the use is in the candidate's own init";
    if (fin === undefined) return "the candidate's init is never reached from the entry";
    if (t === undefined) return `init ${k} is never reached from the entry`;
    return `${k} statement ${j} executes at ${t}, candidate init ${cand} finishes at ${fin}`;
  };
  const initFinishedBefore = (cand: string, k: string, j: number): boolean => {
    const fin = finishTime.get(cand), t = stmtTime.get(k)?.[j];
    return cand !== k && fin !== undefined && t !== undefined && t > fin;
  };
  let curCandInit = "";

  const nvWhy = new Map<string, string>();
  const plainGlobal = (id: string): boolean => {
    const mkey = `${id}|${curCandInit}`;
    const memo = constMemo.get(mkey);
    if (memo !== undefined) return memo;
    constMemo.set(mkey, false);
    let ok = false;
    const c = candidates.get(id);
    if (c !== undefined && (assigns.get(id) ?? 0) === 1 && ids.has(id)) {
      const st = (c.fn.body as unknown as Node[])[c.idx]!;
      const v = st["value"] as Node;
      if (kindOf(v) === "recordLit" && (v["fields"] as Node[]).every((f) => f["viewSlot"] !== true)) {
        let raw = 0, allowed = 0;
        const calls: { callee: string; idx: number }[] = [];
        const bad = new Set<string>();
        for (const fn of mod.functions) {
          // a top-level statement of an init function that boxes the record AFTER the candidate's init has finished is allowed
          const stmts = fn.name.startsWith("%init.") && Array.isArray(fn.body) ? (fn.body as unknown as Node[]) : null;
          const parts: { body: unknown; late: boolean }[] = stmts === null ? [{ body: fn.body, late: false }] : stmts.map((st, j) => ({ body: st, late: curCandInit !== "" && initFinishedBefore(curCandInit, fn.name, j) }));
          const u = { raw: 0, allowed: 0, calls: [] as { callee: string; idx: number }[], bad: [] as string[] };
          for (const part of parts) {
            const pu = usesOf(part.body, id, part.late ? (parent, key) => parent["kind"] === "dynFrom" && key === "value" : undefined);
            u.raw += pu.raw; u.allowed += pu.allowed; u.calls.push(...pu.calls);
            for (const b of pu.bad) u.bad.push(!part.late && stmts !== null && b === "dynFrom.value" ? `${b} (${lateWhy(curCandInit, fn.name, parts.indexOf(part))})` : b);
          }
          raw += u.raw; allowed += u.allowed; calls.push(...u.calls);
          for (const b of u.bad) bad.add(`${fn.name}:${b}`);
        }
        ok = raw === allowed + calls.length + 1 && callsConfined(calls);
        if (!ok) {
          const badCalls = calls.filter((c) => { const f = fnByName.get(c.callee); const pid = f?.params[c.idx]?.localId; return !(f !== undefined && pid !== undefined && paramConfined(f, pid)); }).map((c) => `call ${c.callee}#${c.idx}`);
          nvWhy.set(id, [...bad, ...badCalls].slice(0, 8).join("; ") || `raw=${raw} allowed=${allowed} calls=${calls.length}`);
        }
      } else nvWhy.set(id, "not a single-assignment record-literal const");
    }
    constMemo.set(mkey, ok);
    return ok;
  };
  const staticNonView = (e: unknown, cx: Cx): boolean => {
    if (kindOf(e) !== "varRef") return false;
    const id = (e as Node)["localId"] as string;
    if (cx.nonView.has(id)) return true;
    if (id.startsWith("%g.")) return plainGlobal(id);
    if (!cx.freshRec.has(id) || !cx.fresh.has(id) || cx.body === undefined) return false;
    // a local built from a record literal: reads, keyed writes into it, and (at the very end) boxing it as the function's return value
    const retDyn = new Set<unknown>();
    const scanRet = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(scanRet); return; }
      if (!isNode(n)) return;
      if (n["kind"] === "return" && isNode(n["value"])) {
        let v = n["value"] as Node;
        if (kindOf(v) === "dynCheck" && isNode(v["value"])) v = v["value"] as Node;
        if (kindOf(v) === "dynFrom") retDyn.add(v);
      }
      for (const k of Object.keys(n)) if (k !== "loc") scanRet(n[k]);
    };
    scanRet(cx.body);
    const u = usesOf(cx.body, id, (parent, key, self) => ((parent["kind"] === "recordKeySet" || parent["kind"] === "recordSet") && key === "obj") || (parent["kind"] === "dynFrom" && key === "value" && retDyn.has(parent) && self === parent["value"]));
    return u.raw === u.allowed + u.calls.length + 1 && u.calls.length === 0; // +1: the varDecl
  };
  /** `recordIsView(<statically non-view>)`: always false. */
  const isDeadViewCond = (c: unknown, cx: Cx): boolean => kindOf(c) === "recordIsView" && staticNonView((c as Node)["obj"], cx);

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
        if (isDeadViewCond(e["cond"], cx)) return sub(e["else_"]);
        return sub(e["cond"]) && sub(e["then"]) && sub(e["else_"]);
      case "libCall": {
        const fn = e["fn"] as string;
        const a = e["args"] as Node[];
        const isLocal = (x: unknown, set: Set<string>): boolean => kindOf(x) === "varRef" && set.has((x as Node)["localId"] as string);
        if (fn === "dyn.iterOpen") {
          // iterating a FRESH typed array boxed to a dyn: the array iterator over our own array, no user code, cannot throw (the existing forOf rule)
          let src: unknown = a[0];
          while (kindOf(src) === "ternary" && isDeadViewCond((src as Node)["cond"], cx)) src = (src as Node)["else_"];
          const t = isNode(src) && kindOf(src) === "dynFrom" ? ((src as Node)["value"] as Node)["type"] as Node | undefined : undefined;
          if (t !== undefined && t["kind"] === "array" && sub(src)) return true;
          let why = "";
          if (kindOf(src) === "ternary" && kindOf((src as Node)["cond"]) === "recordIsView") {
            const ov = ((src as Node)["cond"] as Node)["obj"] as Node;
            const oid = kindOf(ov) === "varRef" ? (ov["localId"] as string) : "";
            plainGlobal(oid);
            why = ` [recordIsView(${oid}) unresolved: ${nvWhy.get(oid) ?? "not a global"}]`;
          }
          return no(`dyn.iterOpen over something other than a boxed typed array${why}`);
        }
        if (fn === "dyn.iterVal" && isLocal(a[0], cx.packs) && kindOf(a[1]) === "varRef") return true;
        if (fn === "dyn.iterPack" && isLocal(a[0], cx.plain) && kindOf(a[1]) === "strLit") return true;
        return no(`expression kind libCall ${fn}`);
      }
      case "recordIsView":
        return sub(e["obj"]);
      case "runKindAt":
      case "runKeyAt":
        return sub(e["index"]);
      case "dynFrom": {
        // boxing a typed array/record: allocates, promotes the boxed records (a representation detail: nothing else holds the box), cannot throw
        const t = (e["value"] as Node)["type"] as Node | undefined;
        return t !== undefined && (t["kind"] === "array" || t["kind"] === "record") ? sub(e["value"]) : no("dynFrom of a non-container");
      }
      case "dynCheck":
        return sub(e["value"]); // a representation check (Node performs none)
      case "dynKeyGet": {
        const v = e["value"] as Node;
        return kindOf(v) === "varRef" && cx.plain.has(v["localId"] as string) && sub(e["key"]) ? true : no("dynKeyGet over a dyn that is not a plain iteration element");
      }
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
        const nv: number[] = [];
        for (let i = 0; i < args.length; i++) if (staticNonView(args[i], cx)) nv.push(i);
        return fnIsPure(callee, callable, nv) ? true : no(`call of impure or unknown function ${callee}`);
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
          const lid = st["localId"] as string;
          if (init !== null && (ik === "recordLit" || ik === "arrayLit")) cx.fresh.add(lid);
          if (ik === "recordLit") cx.freshRec.add(lid);
          if (ik === "libCall") {
            const f = (init as Node)["fn"];
            if (f === "dyn.iterOpen") cx.packs.add(lid);
            else if (f === "dyn.iterVal" || f === "dyn.iterPack") cx.plain.add(lid);
          } else if (ik === "numLit" && (init as Node)["value"] === 0) cx.zero.add(lid);
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
          if (isDeadViewCond(st["cond"], cx)) {
            if (st["else_"] !== null && !pureStmts(st["else_"], cx)) return false;
            break;
          }
          if (!pureExpr(st["cond"], cx) || !pureStmts(st["then"], cx) || (st["else_"] !== null && !pureStmts(st["else_"], cx))) return false;
          break;
        case "break":
          break;
        case "tryCatch": {
          // only the iterator-close shape: try { <pure> } finally { dyn.iterClose(pack) }
          const fin = st["finallyBody"] as Node[] | null;
          const one = Array.isArray(fin) && fin.length === 1 ? fin[0]! : undefined;
          const ce = one !== undefined && kindOf(one) === "exprStmt" ? (one["expr"] as Node) : undefined;
          const closes = ce !== undefined && kindOf(ce) === "libCall" && ce["fn"] === "dyn.iterClose" && kindOf((ce["args"] as Node[])[0]) === "varRef" && cx.packs.has(((ce["args"] as Node[])[0] as Node)["localId"] as string);
          if (st["catchBody"] !== null || st["catchLocalId"] !== null || !closes) return no("try statement that is not an iterator close");
          if (!pureStmts(st["tryBody"], cx)) return false;
          break;
        }
        case "while": {
          // the lowered for-of over a boxed fresh array: `while (true) { if (!iterStep(pack, i)) break; ...; i = i + 1 }`. It ends because iterStep
          // answers false at the array's end and the index only ever advances by that one assignment (no `continue` may skip it).
          const body = st["body"] as Node[];
          const c = st["cond"] as Node;
          const f0 = body[0];
          const sc = f0 !== undefined && kindOf(f0) === "if" ? (f0["cond"] as Node) : undefined;
          const step = sc !== undefined && kindOf(sc) === "unary" && sc["op"] === "!" ? (sc["operand"] as Node) : undefined;
          const sa = step !== undefined && kindOf(step) === "libCall" && step["fn"] === "dyn.iterStep" ? (step["args"] as Node[]) : undefined;
          const packOk = sa !== undefined && kindOf(sa[0]) === "varRef" && cx.packs.has((sa[0] as Node)["localId"] as string);
          const idxId = sa !== undefined && kindOf(sa[1]) === "varRef" ? ((sa[1] as Node)["localId"] as string) : "";
          const thenBrk = f0 !== undefined && f0["else_"] === null && Array.isArray(f0["then"]) && (f0["then"] as Node[]).length === 1 && kindOf((f0["then"] as Node[])[0]) === "break";
          if (kindOf(c) !== "boolLit" || c["value"] !== true || st["labels"] !== undefined || !packOk || !cx.zero.has(idxId) || !thenBrk) return no("while loop that is not an iterator-step loop");
          let bad = "";
          const scan = (n: unknown): void => {
            if (bad !== "") return;
            if (Array.isArray(n)) { n.forEach(scan); return; }
            if (!isNode(n)) return;
            const nk = n["kind"];
            if (nk === "continue" || nk === "labeled" || nk === "while" || nk === "doWhile") bad = `loop body with ${String(nk)}`;
            if (nk === "assign" && n["localId"] === idxId) {
              const v = n["value"] as Node;
              if (!(kindOf(v) === "bin" && v["op"] === "+" && kindOf(v["left"]) === "varRef" && (v["left"] as Node)["localId"] === idxId && kindOf(v["right"]) === "numLit" && (v["right"] as Node)["value"] === 1)) bad = "iterator index written other than +1";
            }
            if ((nk === "assign" || nk === "varDecl") && cx.packs.has(n["localId"] as string)) bad = "iterator state reassigned";
            if (nk === "incDec" || nk === "assignExpr") bad = "assignment expression in iterator loop";
            for (const key of Object.keys(n)) if (key !== "loc") scan(n[key]);
          };
          scan(body.slice(1));
          if (bad !== "") return no(bad);
          if (!pureStmts(body.slice(1), cx)) return false;
          break;
        }
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

  function fnIsPure(name: string, callable: ReadonlySet<number> = new Set<number>(), nonViewIdx: readonly number[] = []): boolean {
    const key = callable.size === 0 && nonViewIdx.length === 0 ? name : `${name}#${[...callable].join(",")}#nv${nonViewIdx.join(",")}`;
    const memo = fnPure.get(key);
    if (memo === "pending") return no(`recursive function ${name}`);
    if (memo !== undefined) return memo;
    const fn = fnByName.get(name);
    if (fn === undefined) return no(`unknown function ${name}`);
    if (fn.async === true || fn.generator !== undefined || (fn.captures?.length ?? 0) > 0) return no(`generator, async or closure function ${name}`);
    fnPure.set(key, "pending");
    const saved = lastWhy;
    lastWhy = "";
    const cx = mkCx(fn.body);
    cx.callable = new Set([...callable].map((ix) => fn.params[ix]?.localId ?? ""));
    for (const ix of nonViewIdx) {
      const pid = fn.params[ix]?.localId;
      if (pid !== undefined && paramConfined(fn, pid)) cx.nonView.add(pid);
    }
    const ok = pureStmts(fn.body, cx);
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
    curCandInit = c.fn.name;
    const st = (c.fn.body as unknown as Node[])[c.idx]!;
    const ok = pureExpr(st["value"], mkCx());
    if (ok) {
      drops.push({ fn: c.fn, idx: c.idx, id: g.id });
      out.dropped.push(g.id);
      if (report) process.stderr.write(`DEADINIT drop ${g.id}\n`);
    } else {
      out.kept.push({ id: g.id, reason: lastWhy });
      if (report) process.stderr.write(`DEADINIT keep ${g.id}: ${lastWhy}\n`);
    }
  }
  if (report) for (const [id, w] of nvWhy) process.stderr.write(`DEADINIT nonview-refused ${id}: ${w}\n`);
  // Remove back to front so the indices of one function stay valid.
  drops.sort((a, b) => b.idx - a.idx);
  for (const d of drops) (d.fn.body as unknown as Node[]).splice(d.idx, 1);
  return out;
}
