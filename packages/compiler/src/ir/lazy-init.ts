/* LAZY MODULE-LEVEL MEMBER INITIALIZERS: the ANALYSIS (verdicts only; nothing is rewritten yet).
 *
 * CANDIDATE. A statement `dyn.keySet(R, "K", callValue(closure F, []))` (F takes no parameters, `K` is a literal key): the member K of R is built by running the
 * zero-argument function F, which is how a generated table of constructors (`n.X = function(){ ...; return ctor }()`) lowers. Deferring F until the first read of
 * R.K is unobservable when F is HOISTABLE-PURE:
 *
 *  1. Every effect F performs lands on an object F itself created (a local function, its `prototype`, a local literal) and that no one else can reach before F
 *     returns: writes (`dyn.keySet`, `dyn.defineProp` with an accessor descriptor) whose receiver is rooted at such a local, closure creation, local assignments, `return`.
 *  2. Every read of state F did not create (a global binding, a field of a global object) is HOISTED: it can be performed at the original position instead of the
 *     deferred one and its value carried into F. That is EXACT, not an approximation: the read then happens at the very time the eager program performs it, in the
 *     same order relative to the other hoisted reads, and every effect between them is on a fresh object no read can observe. So no fact about what OTHER code writes
 *     later to the global is needed, which is what a points-to proof of `M.oneOfGetter` would have had to supply.
 *  3. A call `G.m(args)` on a global receiver (a dyn invoke) is allowed only when the callee value read at the original position is GUARDED at install time to be
 *     one of the closures stored under the key `m` anywhere in the program (a closure literal) that is statically pure for plain arguments (see calleePure), the
 *     arguments are plain literal data built inside F, and the callee returns a closure on every path (so a `defineProperty` accessor cannot throw late). When the guard
 *     fails the install falls back to the eager statement. The guard is a run-time test, so no closed-world claim about other stores to `G.m` is made.
 *
 * Anything else keeps the statement. SCRIPTC_LAZYINIT=report prints one `LAZYINIT lazy|keep <where> <key> [why]` line per candidate plus the whole-program store
 * inventory of every guarded callee key; SCRIPTC_LAZYINIT=why additionally prints the hoists and callees of each lazy verdict. Default (unset) = analysis not run. */
import type { IrFunction, IrModule } from "./nodes.js";

type Node = Record<string, unknown>;
const isNode = (n: unknown): n is Node => typeof n === "object" && n !== null && !Array.isArray(n);
const kindOf = (n: unknown): string => (isNode(n) && typeof n["kind"] === "string" ? (n["kind"] as string) : "");
const isGlobalId = (s: unknown): boolean => typeof s === "string" && s.startsWith("%g.");

export interface LazyVerdict {
  where: string;
  key: string;
  lazy: boolean;
  why: string;
  hoists: string[];
  callees: string[];
  nested: LazyVerdict[];
}
export interface LazyInitResult {
  verdicts: LazyVerdict[];
  inventory: { key: string; literalStores: number; computedKeyStores: number; closures: { fnName: string; pure: boolean; why: string }[] }[];
}

class Refuse extends Error {}
const refuse = (why: string): never => {
  throw new Refuse(why);
};

export function lazyInitPass(mod: IrModule): LazyInitResult {
  const out: LazyInitResult = { verdicts: [], inventory: [] };
  const mode = process.env["SCRIPTC_LAZYINIT"];
  if (mode !== "report" && mode !== "why") return out;
  if (mod.embedded !== undefined || mod.lib !== undefined) return out;
  const fnByName = new Map<string, IrFunction>(mod.functions.map((f) => [f.name, f]));

  // ── closures stored under a literal key anywhere (the guard set of a callee key) ──
  const closuresByKey = new Map<string, Set<string>>();
  const literalStores = new Map<string, number>();
  const computedStores = { n: 0 };
  const unwrapClosure = (e: unknown): string | undefined => {
    let x = e;
    while (kindOf(x) === "dynFrom" || kindOf(x) === "assignExpr") x = (x as Node)["value"];
    return kindOf(x) === "closure" ? ((x as Node)["fnName"] as string) : undefined;
  };
  const scan = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) scan(x);
      return;
    }
    if (!isNode(n)) return;
    const k = n["kind"];
    if (k === "libCall" && (n["fn"] === "dyn.keySet" || n["fn"] === "dyn.keySetSloppy") && Array.isArray(n["args"])) {
      const a = n["args"] as unknown[];
      if (kindOf(a[1]) === "strLit") {
        const key = (a[1] as Node)["value"] as string;
        literalStores.set(key, (literalStores.get(key) ?? 0) + 1);
        const c = unwrapClosure(a[2]);
        if (c !== undefined) (closuresByKey.get(key) ?? closuresByKey.set(key, new Set()).get(key)!).add(c);
      } else computedStores.n++;
    }
    if (k === "dynObjLit" && Array.isArray(n["fields"])) {
      for (const f of n["fields"] as Node[]) {
        if (kindOf(f["key"]) !== "strLit") continue;
        const key = (f["key"] as Node)["value"] as string;
        literalStores.set(key, (literalStores.get(key) ?? 0) + 1);
        const c = unwrapClosure(f["value"]);
        if (c !== undefined) (closuresByKey.get(key) ?? closuresByKey.set(key, new Set()).get(key)!).add(c);
      }
    }
    for (const key of Object.keys(n)) if (key !== "loc") scan(n[key]);
  };
  for (const f of mod.functions) scan(f.body);

  // ── a callee is pure for plain arguments ──
  const calleeMemo = new Map<string, string>(); // "" = pure, else the reason
  const calleePure = (fnName: string): string => {
    const m = calleeMemo.get(fnName);
    if (m !== undefined) return m;
    calleeMemo.set(fnName, "recursive");
    const f = fnByName.get(fnName);
    let r = "";
    if (f === undefined) r = "no body";
    else if (!Array.isArray(f.body)) r = "no body";
    else if (((f.captures as unknown[]) ?? []).length !== 0) r = "captures a binding of an enclosing function (it could change between install and first read)";
    else {
      try {
        const params = new Set<string>((f.params as unknown as { localId: string }[]).map((p) => p.localId));
        const fresh = new Set<string>();
        const declared = new Set<string>(params);
        let returnsClosure = false;
        const ex = (e: unknown): void => {
          if (!isNode(e)) return refuse("non-node expression");
          switch (e["kind"]) {
            case "numLit": case "strLit": case "boolLit": case "unitLit":
              return;
            case "varRef":
              if (isGlobalId(e["localId"])) refuse("reads a global");
              if (!declared.has(e["localId"] as string)) refuse("reads a binding it does not own");
              return;
            case "dynFrom": case "toString": case "unary":
              return ex(e["value"] ?? e["operand"]);
            case "bin":
              ex(e["left"]); return ex(e["right"]);
            case "recordLit":
              if (Array.isArray(e["fields"]) && (e["fields"] as unknown[]).length === 0) return;
              return refuse("non-empty recordLit");
            case "dynKeyGet":
              ex(e["key"]); return ex(e["value"]);
            case "libCall":
              if (e["fn"] === "dyn.lt" || e["fn"] === "dyn.le" || e["fn"] === "dyn.gt" || e["fn"] === "dyn.ge") { (e["args"] as unknown[]).forEach(ex); return; }
              return refuse(`libCall ${String(e["fn"])}`);
            default:
              return refuse(`expression ${String(e["kind"])}`);
          }
        };
        const st = (s: unknown): void => {
          if (!isNode(s)) return refuse("non-node statement");
          switch (s["kind"]) {
            case "varDecl":
              declared.add(s["localId"] as string);
              if (s["init"] !== null && s["init"] !== undefined) ex(s["init"]);
              return;
            case "assign": {
              const id = s["localId"] as string;
              if (isGlobalId(id)) refuse("writes a global");
              if (!declared.has(id)) refuse("writes a binding it does not own");
              if (params.has(id)) refuse("writes a parameter");
              const v = s["value"] as Node;
              ex(v);
              let inner: unknown = v;
              while (kindOf(inner) === "dynFrom") inner = (inner as Node)["value"];
              if (kindOf(inner) === "recordLit") fresh.add(id);
              return;
            }
            case "block":
              (s["body"] as unknown[]).forEach(st); return;
            case "for": {
              const init = s["init"];
              if (init !== null && init !== undefined) kindOf(init) === "block" ? ((init as Node)["body"] as unknown[]).forEach(st) : st(init);
              ex(s["cond"]);
              // canonical, bounded: update is `i = i + 1` (a positive literal step)
              const u = s["update"] as Node | undefined;
              const ub = u !== undefined ? (u["value"] as Node | undefined) : undefined;
              if (!(u !== undefined && kindOf(u) === "assign" && ub !== undefined && kindOf(ub) === "bin" && ub["op"] === "+" && kindOf(ub["right"]) === "numLit" && ((ub["right"] as Node)["value"] as number) > 0)) refuse("non-canonical loop");
              (s["body"] as unknown[]).forEach(st); return;
            }
            case "exprStmt": {
              const e = s["expr"] as Node;
              if (kindOf(e) === "libCall" && e["fn"] === "dyn.keySet") {
                const a = e["args"] as Node[];
                const recv = a[0];
                if (kindOf(recv) !== "varRef" || !fresh.has((recv as Node)["localId"] as string)) refuse("write to a non-fresh object");
                ex(a[1]); ex(a[2]); return;
              }
              return refuse("effectful expression statement");
            }
            case "return": {
              let v: unknown = s["value"];
              while (kindOf(v) === "dynFrom") v = (v as Node)["value"];
              if (kindOf(v) !== "closure") refuse("returns a non-closure");
              returnsClosure = true;
              return;
            }
            default:
              return refuse(`statement ${String(s["kind"])}`);
          }
        };
        (f.body as unknown[]).forEach(st);
        if (!returnsClosure) r = "never returns a closure";
      } catch (err) {
        if (!(err instanceof Refuse)) throw err;
        r = err.message;
      }
    }
    calleeMemo.set(fnName, r);
    return r;
  };

  // ── a candidate thunk is hoistable-pure ──
  const isCandidate = (st: unknown): { recv: Node; key: string; fnName: string } | undefined => {
    if (kindOf(st) !== "exprStmt") return undefined;
    const e = (st as Node)["expr"] as Node;
    if (kindOf(e) !== "libCall" || e["fn"] !== "dyn.keySet") return undefined;
    const a = e["args"] as Node[];
    if (!Array.isArray(a) || a.length !== 3 || kindOf(a[1]) !== "strLit" || kindOf(a[2]) !== "callValue") return undefined;
    const c = a[2] as Node;
    if (!Array.isArray(c["args"]) || (c["args"] as unknown[]).length !== 0 || kindOf(c["callee"]) !== "closure") return undefined;
    return { recv: a[0] as Node, key: ((a[1] as Node)["value"] as string), fnName: (c["callee"] as Node)["fnName"] as string };
  };
  const guardKeys = new Set<string>();

  const analyse = (fnName: string, where: string, key: string, depth: number): LazyVerdict => {
    const v: LazyVerdict = { where, key, lazy: false, why: "", hoists: [], callees: [], nested: [] };
    const f = fnByName.get(fnName);
    try {
      if (f === undefined || !Array.isArray(f.body)) refuse("no body");
      if ((f!.params as unknown[]).length !== 0) refuse("takes parameters");
      // A binding the thunk captures from its enclosing function is state the thunk did not create: READ it = a hoisted read (exact, as for a global), WRITE it = refused.
      const captured = new Set<string>(((f!.captures as unknown[]) ?? []).map((c) => (typeof c === "string" ? c : String((c as Node)["localId"] ?? (c as Node)["id"] ?? JSON.stringify(c)))));
      const locals = new Set<string>();
      const fresh = new Set<string>();
      const plainLocals = new Set<string>();
      const isFreshRoot = (r: unknown): boolean => {
        let x: unknown = r;
        while (kindOf(x) === "dynFrom") x = (x as Node)["value"];
        if (kindOf(x) === "varRef") return fresh.has((x as Node)["localId"] as string);
        if (kindOf(x) === "dynKeyGet" && kindOf((x as Node)["key"]) === "strLit" && ((x as Node)["key"] as Node)["value"] === "prototype") return isFreshRoot((x as Node)["value"]);
        return false;
      };
      const plainArg = (a: unknown): boolean => {
        let x: unknown = a;
        for (;;) {
          const k = kindOf(x);
          if (k === "dynFrom" || k === "assignExpr") x = (x as Node)["value"];
          else break;
        }
        const k = kindOf(x);
        if (k === "strLit" || k === "numLit" || k === "boolLit") return true;
        if (k === "arrayLit" || k === "dynArrLit") return ((x as Node)["elems"] as unknown[]).every(plainArg);
        if (k === "varRef") return plainLocals.has((x as Node)["localId"] as string);
        return false;
      };
      const ex = (e: unknown): void => {
        if (!isNode(e)) return refuse("non-node expression");
        switch (e["kind"]) {
          case "numLit": case "strLit": case "boolLit": case "unitLit": case "bigLit":
            return;
          case "varRef": {
            const id = e["localId"] as string;
            if (isGlobalId(id) || captured.has(id)) v.hoists.push(id);
            return;
          }
          case "dynFrom": case "toString": case "unary":
            return ex(e["value"] ?? e["operand"]);
          case "bin":
            ex(e["left"]); return ex(e["right"]);
          case "closure":
            return; // creation only; its body runs at call time, exactly as in the eager program
          case "arrayLit": case "dynArrLit":
            (e["elems"] as unknown[]).forEach(ex); return;
          case "dynObjLit":
            for (const fl of e["fields"] as Node[]) {
              if (kindOf(fl["key"]) !== "strLit") refuse("computed key in an object literal");
              ex(fl["value"]);
            }
            return;
          case "assignExpr": {
            const id = e["localId"] as string;
            if (isGlobalId(id)) refuse("writes a global");
            if (captured.has(id)) refuse(`writes the captured binding ${id}`);
            ex(e["value"]);
            if (plainArg(e["value"])) plainLocals.add(id);
            return;
          }
          case "dynKeyGet": {
            ex(e["key"]);
            let r: unknown = e["value"];
            while (kindOf(r) === "dynFrom") r = (r as Node)["value"];
            if (kindOf(r) === "varRef" && (isGlobalId((r as Node)["localId"]) || captured.has((r as Node)["localId"] as string)) && kindOf(e["key"]) === "strLit") {
              v.hoists.push(`${(r as Node)["localId"] as string}.${((e["key"] as Node)["value"] as string)}`);
              return;
            }
            if (isFreshRoot(r)) return;
            return refuse("read of a non-fresh, non-global object");
          }
          case "dynInvoke": {
            let r: unknown = e["recv"];
            while (kindOf(r) === "dynFrom") r = (r as Node)["value"];
            if (kindOf(r) !== "varRef" || !(isGlobalId((r as Node)["localId"]) || captured.has((r as Node)["localId"] as string)) || e["methodKey"] != null) return refuse("dyn call on a receiver that is neither a global nor a captured binding, or a runtime key");
            const m = e["method"] as string;
            const args = e["args"] as unknown[];
            args.forEach(ex);
            if (!args.every(plainArg)) refuse(`call ${m}: an argument is not plain literal data built in the thunk`);
            const set = closuresByKey.get(m);
            if (set === undefined || set.size === 0) refuse(`call ${m}: no closure literal is stored under that key anywhere`);
            const bad = [...set!].filter((c) => calleePure(c) !== "");
            if (bad.length > 0) refuse(`call ${m}: callee ${bad[0]} is not pure (${calleePure(bad[0]!)})`);
            guardKeys.add(m);
            v.callees.push(`${(r as Node)["localId"] as string}.${m}[${[...set!].join("|")}]`);
            v.hoists.push(`${(r as Node)["localId"] as string}.${m}`);
            return;
          }
          default:
            return refuse(`expression ${String(e["kind"])}`);
        }
      };
      const st = (s: unknown): void => {
        if (!isNode(s)) return refuse("non-node statement");
        switch (s["kind"]) {
          case "varDecl": {
            const id = s["localId"] as string;
            locals.add(id);
            const init = s["init"] as Node | null | undefined;
            if (init !== null && init !== undefined) {
              ex(init);
              let x: unknown = init;
              while (kindOf(x) === "dynFrom") x = (x as Node)["value"];
              if (kindOf(x) === "closure" || kindOf(x) === "dynObjLit" || kindOf(x) === "arrayLit") fresh.add(id);
            }
            return;
          }
          case "assign": {
            const id = s["localId"] as string;
            if (isGlobalId(id)) refuse("writes a global");
            if (captured.has(id)) refuse(`writes the captured binding ${id}`);
            ex(s["value"]);
            if (plainArg(s["value"])) plainLocals.add(id);
            return;
          }
          case "block":
            (s["body"] as unknown[]).forEach(st); return;
          case "exprStmt": {
            const nc = isCandidate(s);
            if (nc !== undefined) {
              if (!isFreshRoot(nc.recv)) refuse("nested member on a non-fresh receiver");
              const nv = analyse(nc.fnName, `${where}>`, nc.key, depth + 1);
              v.nested.push(nv);
              if (!nv.lazy) refuse(`nested member ${nc.key} is not deferrable: ${nv.why}`);
              return;
            }
            const e = s["expr"] as Node;
            if (kindOf(e) !== "libCall") return refuse(`expression statement ${kindOf(e)}`);
            const a = e["args"] as Node[];
            if (e["fn"] === "dyn.keySet") {
              if (!isFreshRoot(a[0])) refuse("write to a non-fresh object");
              ex(a[1]); ex(a[2]); return;
            }
            if (e["fn"] === "dyn.defineProp") {
              if (!isFreshRoot(a[0])) refuse("defineProperty on a non-fresh object");
              if (kindOf(a[1]) !== "strLit") refuse("defineProperty with a computed key");
              ex(a[2]);
              if (kindOf(a[2]) !== "dynObjLit") refuse("defineProperty with a non-literal descriptor");
              return;
            }
            return refuse(`libCall ${String(e["fn"])}`);
          }
          case "return":
            ex(s["value"]); return;
          default:
            return refuse(`statement ${String(s["kind"])}`);
        }
      };
      (f!.body as unknown[]).forEach(st);
      v.lazy = true;
    } catch (err) {
      if (!(err instanceof Refuse)) throw err;
      v.why = err.message;
    }
    return v;
  };

  // Candidates: every `dyn.keySet(R, "K", callValue(closure F, []))` anywhere in a function body (a statement, or an operand of a sequence expression, as a
  // generated table lowers to), except the ones nested in a candidate's own thunk (those are analysed as part of it). `shapes` counts what a keySet with a
  // literal key and a call value looks like when it is NOT a candidate, so a zero is explained.
  const shapes = new Map<string, number>();
  let sample = "";
  const asCand = (e: unknown): { recv: Node; key: string; fnName: string } | undefined => {
    if (kindOf(e) !== "libCall" || (e as Node)["fn"] !== "dyn.keySet") return undefined;
    return isCandidate({ kind: "exprStmt", expr: e });
  };
  const strip = (o: unknown, d = 0): unknown => (Array.isArray(o) ? o.map((x) => strip(x, d + 1)) : isNode(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "loc" && k !== "type" && k !== "fnSrc" && k !== "srcText").map(([k, v]) => [k, d > 6 ? "..." : strip(v, d + 1)])) : o);
  const nestedCands = new Set<unknown>();
  const find = (n: unknown, where: string, top: boolean): void => {
    if (Array.isArray(n)) { n.forEach((x) => find(x, where, top)); return; }
    if (!isNode(n)) return;
    const c = asCand(n);
    if (c !== undefined) {
      out.verdicts.push(analyse(c.fnName, where, c.key, 0));
      // do not descend into the thunk's own body: it is another function and is reached through mod.functions
    } else if (kindOf(n) === "libCall" && n["fn"] === "dyn.keySet" && Array.isArray(n["args"]) && (n["args"] as unknown[]).length === 3 && kindOf((n["args"] as unknown[])[1]) === "strLit") {
      let v: unknown = (n["args"] as unknown[])[2];
      while (kindOf(v) === "dynFrom") v = (v as Node)["value"];
      const sh = kindOf(v) === "callValue" ? `callValue(callee=${kindOf((v as Node)["callee"])},args=${((v as Node)["args"] as unknown[]).length})` : kindOf(v);
      shapes.set(sh, (shapes.get(sh) ?? 0) + 1);
      if (sh.startsWith("callValue") && sample === "") sample = JSON.stringify(strip(n)).slice(0, 1500);
    }
    for (const key of Object.keys(n)) if (key !== "loc") find(n[key], where, top);
  };
  void nestedCands;
  for (const f of mod.functions) if (Array.isArray(f.body)) find(f.body, f.name, true);
  {
    const l = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(" ");
    process.stderr.write(`LAZYINIT shapes (literal-key dyn.keySet value kinds, non-candidates) ${l}\n`);
    if (mode === "why" && sample !== "") process.stderr.write(`LAZYINIT sample ${sample}\n`);
  }
  for (const k of guardKeys) {
    const set = closuresByKey.get(k) ?? new Set<string>();
    out.inventory.push({ key: k, literalStores: literalStores.get(k) ?? 0, computedKeyStores: computedStores.n, closures: [...set].map((c) => ({ fnName: c, pure: calleePure(c) === "", why: calleePure(c) })) });
  }

  const countNested = (v: LazyVerdict): number => 1 + v.nested.reduce((a, n) => a + countNested(n), 0);
  const lines: string[] = [];
  for (const v of out.verdicts) {
    lines.push(`LAZYINIT ${v.lazy ? "lazy" : "keep"} ${v.where} ${v.key}${v.lazy ? "" : `: ${v.why}`}${v.nested.length > 0 ? ` (nested ${v.nested.filter((n) => n.lazy).length}/${v.nested.length})` : ""}`);
    if (mode === "why" && v.lazy) lines.push(`LAZYINIT   hoists ${[...new Set(v.hoists)].join(", ")}; callees ${v.callees.join(", ")}`);
  }
  for (const i of out.inventory) lines.push(`LAZYINIT inventory key=${i.key} literalStores=${i.literalStores} programComputedKeyStores=${i.computedKeyStores} closures=${i.closures.map((c) => `${c.fnName}:${c.pure ? "pure" : `impure(${c.why})`}`).join(",")}`);
  const lazyN = out.verdicts.filter((v) => v.lazy).length;
  lines.push(`LAZYINIT summary candidates=${out.verdicts.length} lazy=${lazyN} keep=${out.verdicts.length - lazyN} totalWithNested=${out.verdicts.reduce((a, v) => a + countNested(v), 0)}`);
  process.stderr.write(lines.join("\n") + "\n");
  return out;
}
