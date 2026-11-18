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
 *     fails the install runs the thunk at once and reads the globals live (dyn.keySetLazy with a false flag), the eager statement exactly. The guard is a run-time test, so no closed-world claim about other stores to `G.m` is made.
 *
 *    WHY A SOURCE-TEXT GUARD IS SOUND. The guard accepts any function value whose source text equals a pure callee's, including one built elsewhere in
 *    a different environment. That is safe only because calleePure accepts a callee that owns EVERY binding it names: it captures nothing from an enclosing
 *    function (`captures` empty, which also rules out a returned inner closure that forwards an outer binding), reads and writes no global, calls nothing,
 *    and writes only to objects it made. Such a function has no free variable, so its behaviour is a function of its text and its arguments alone: an
 *    identical text in another scope cannot read another environment. The guard decides only whether the CALL may be deferred; the call is made on the value
 *    that was read, so the result is that value's own closure. A callee that captures anything is refused (rows: the sample with a captured `let`, and the
 *    one whose returned closure names an outer binding).
 *
 * Anything else keeps the statement. SCRIPTC_LAZYINIT=report prints one `LAZYINIT lazy|keep <where> <key> [why]` line per candidate plus the whole-program store
 * inventory of every guarded callee key; SCRIPTC_LAZYINIT=why additionally prints the hoists and callees of each lazy verdict. Default (unset) = analysis not run. */
import type { IrFunction, IrModule, IrParam } from "./nodes.js";

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
  const t0 = Date.now();
  const out: LazyInitResult = { verdicts: [], inventory: [] };
  const mode = process.env["SCRIPTC_LAZYINIT"] ?? "on";
  if (mode !== "report" && mode !== "why" && mode !== "on") return out;
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
  const fnText = new Map<string, string>(); // closure function name -> its source text (a closure value that carries one)
  const refs = new Map<string, number>(); // closure function name -> creation sites
  const scan = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) scan(x);
      return;
    }
    if (!isNode(n)) return;
    const k = n["kind"];
    if (k === "closure" && typeof n["fnName"] === "string") refs.set(n["fnName"] as string, (refs.get(n["fnName"] as string) ?? 0) + 1);
    if (k === "dynFrom" && kindOf(n["value"]) === "closure" && isNode(n["fnSrc"]) && typeof (n["fnSrc"] as Node)["text"] === "string") fnText.set(((n["value"] as Node)["fnName"]) as string, (n["fnSrc"] as Node)["text"] as string);
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

  let calleeSample = "";
  const stripIr = (o: unknown, d = 0): unknown => (Array.isArray(o) ? o.map((x) => stripIr(x, d + 1)) : isNode(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "loc" && k !== "type" && k !== "fnSrc" && k !== "srcText").map(([k, v]) => [k, d > 8 ? "..." : stripIr(v, d + 1)])) : o);
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
              return refuse(`expression ${String(e["kind"])}${e["kind"] === "libCall" ? " " + String(e["fn"]) : ""}`);
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
              if (init !== null && init !== undefined) {
                if (kindOf(init) === "block") ((init as Node)["body"] as unknown[]).forEach(st);
                else st(init);
              }
              ex(s["cond"]);
              // canonical, bounded: update is `i = i + 1` (a positive literal step)
              const u = s["update"] as Node | undefined;
              const ub = u !== undefined ? (u["value"] as Node | undefined) : undefined;
              if (!(u !== undefined && kindOf(u) === "assign" && ub !== undefined && kindOf(ub) === "bin" && ub["op"] === "+" && kindOf(ub["right"]) === "numLit" && ((ub["right"] as Node)["value"] as number) > 0)) refuse("non-canonical loop");
              (s["body"] as unknown[]).forEach(st); return;
            }
            case "exprStmt": {
              let e = s["expr"] as Node;
              // `t[k] = v` with a dynamic key lowers to `seqExpr { varDecl r = t; varDecl k = <key>; result: sym.anySet(r, k, toString(k), v) }`
              if (kindOf(e) === "seqExpr") {
                for (const q of e["stmts"] as unknown[]) {
                  if (kindOf(q) !== "varDecl") refuse("seqExpr with a non-declaration");
                  const qn = q as Node;
                  declared.add(qn["localId"] as string);
                  if (qn["init"] !== null && qn["init"] !== undefined) {
                    ex(qn["init"]);
                    if (kindOf(qn["init"]) === "varRef" && fresh.has((qn["init"] as Node)["localId"] as string)) fresh.add(qn["localId"] as string);
                  }
                }
                e = e["result"] as Node;
              }
              if (kindOf(e) === "libCall" && (e["fn"] === "dyn.keySet" || e["fn"] === "sym.anySet")) {
                const a = e["args"] as Node[];
                const recv = a[0];
                if (kindOf(recv) !== "varRef" || !fresh.has((recv as Node)["localId"] as string)) refuse("write to a non-fresh object");
                a.slice(1).forEach(ex); return;
              }
              if (mode === "why" && calleeSample === "") calleeSample = `${fnName}: ${JSON.stringify(stripIr(s)).slice(0, 1400)}`;
              return refuse(`effectful expression statement (${kindOf(e)}${kindOf(e) === "libCall" ? " " + String(e["fn"]) : ""})`);
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
    if (!Array.isArray(a) || a.length !== 3 || kindOf(a[1]) !== "strLit") return undefined;
    let c0: unknown = a[2];
    while (kindOf(c0) === "dynFrom") c0 = (c0 as Node)["value"];
    if (kindOf(c0) !== "callValue") return undefined;
    const c = c0 as Node;
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
      const FN_BUILTIN_KEYS = new Set(["name", "length", "prototype", "caller", "arguments"]);
      const fnLocals = new Set<string>();
      const isFnLocal = (r: unknown): boolean => {
        let x: unknown = r;
        while (kindOf(x) === "dynFrom") x = (x as Node)["value"];
        return kindOf(x) === "varRef" && fnLocals.has((x as Node)["localId"] as string);
      };
      const mentionsProtoKey = (x: unknown): boolean => {
        if (Array.isArray(x)) return x.some(mentionsProtoKey);
        if (!isNode(x)) return false;
        if (x["kind"] === "strLit" && x["value"] === "__proto__") return true;
        return Object.keys(x).some((k) => k !== "loc" && k !== "type" && mentionsProtoKey(x[k]));
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
      const isFreshValue = (x0: unknown): boolean => {
        let x: unknown = x0;
        while (kindOf(x) === "dynFrom") x = (x as Node)["value"];
        const k = kindOf(x);
        if (k === "varRef") return fresh.has((x as Node)["localId"] as string); // an alias of a fresh local
        if (k === "closure" || k === "dynObjLit" || k === "arrayLit" || k === "dynArrLit") return true;
        return k === "libCall" && (x as Node)["fn"] === "dyn.objCreateProto";
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
          case "libCall":
            if (e["fn"] === "dyn.objCreateProto" && Array.isArray(e["args"]) && (e["args"] as unknown[]).length === 1 && isFreshRoot((e["args"] as unknown[])[0])) return;
            return refuse(`expression libCall ${String(e["fn"])}`);
          case "seqExpr":
            (e["stmts"] as unknown[]).forEach(st);
            return ex(e["result"]);
          case "dynCheck":
            return ex(e["value"]); // a representation cast of a hoistable value: hoisted with it, so it traps at the original position
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
            return refuse(`expression ${String(e["kind"])}${e["kind"] === "libCall" ? " " + String(e["fn"]) : ""}`);
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
              if (isFreshValue(init)) fresh.add(id); else fresh.delete(id);
              { let q: unknown = init; while (kindOf(q) === "dynFrom") q = (q as Node)["value"]; if (kindOf(q) === "closure") fnLocals.add(id); }
            }
            return;
          }
          case "assign": {
            const id = s["localId"] as string;
            if (isGlobalId(id)) refuse("writes a global");
            if (captured.has(id)) refuse(`writes the captured binding ${id}`);
            ex(s["value"]);
            if (plainArg(s["value"])) plainLocals.add(id);
            if (isFreshValue(s["value"])) fresh.add(id); else fresh.delete(id);
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
              // A store that Node can reject (a strict-mode TypeError) must not move: the built-in names of a function, and the prototype link
              if (mentionsProtoKey(a[1])) refuse("store under the key __proto__");
              if (kindOf(a[1]) === "strLit" && FN_BUILTIN_KEYS.has((a[1] as Node)["value"] as string) && isFnLocal(a[0])) refuse(`store of the built-in key ${String((a[1] as Node)["value"])} on a function`);
              ex(a[1]); ex(a[2]); return;
            }
            if (e["fn"] === "dyn.defineProp") {
              if (!isFreshRoot(a[0])) refuse("defineProperty on a non-fresh object");
              if (kindOf(a[1]) !== "strLit") refuse("defineProperty with a computed key");
              ex(a[2]);
              if (kindOf(a[2]) !== "dynObjLit") refuse("defineProperty with a non-literal descriptor");
              // A descriptor Node REJECTS (a TypeError) must throw at the original position, so only descriptors that cannot be rejected are deferred:
              // accessor halves that are function values (a closure, or the result of a guarded callee that returns one) or undefined, and boolean flags.
              let hasAcc = false;
              let hasData = false;
              for (const fl of (a[2] as Node)["fields"] as Node[]) {
                const fk = (fl["key"] as Node)["value"] as string;
                let fv: unknown = fl["value"];
                while (kindOf(fv) === "dynFrom") fv = (fv as Node)["value"];
                const kk = kindOf(fv);
                if (fk === "get" || fk === "set") {
                  hasAcc = true;
                  if (!(kk === "closure" || kk === "dynInvoke" || (kk === "unitLit" && (fv as Node)["unit"] === "undefined"))) refuse(`descriptor ${fk} is not provably a function`);
                } else if (fk === "enumerable" || fk === "configurable" || fk === "writable") {
                  if (kk !== "boolLit") refuse(`descriptor ${fk} is not a boolean literal`);
                  if (fk === "writable") hasData = true;
                } else if (fk === "value") hasData = true;
                else refuse(`descriptor field ${fk}`);
              }
              if (hasAcc && hasData) refuse("descriptor mixes accessor and data fields");
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
  if (mode !== "on") for (const f of mod.functions) if (Array.isArray(f.body)) find(f.body, f.name, true);
  if (mode !== "on") {
    const l = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(" ");
    process.stderr.write(`LAZYINIT shapes (literal-key dyn.keySet value kinds, non-candidates) ${l}\n`);
    if (mode === "why" && sample !== "") process.stderr.write(`LAZYINIT sample ${sample}\n`);
  }
  for (const k of guardKeys) {
    const set = closuresByKey.get(k) ?? new Set<string>();
    out.inventory.push({ key: k, literalStores: literalStores.get(k) ?? 0, computedKeyStores: computedStores.n, closures: [...set].map((c) => ({ fnName: c, pure: calleePure(c) === "", why: calleePure(c) })) });
  }


  // ── the REWRITE (SCRIPTC_LAZYINIT=on) ──
  // A RUN of consecutive deferrable members (one statement list, nothing between them) is installed as ONE group:
  //     ok  = isPlainData(O, K) for every (outer binding O, literal key K) the members read  &&  fnSrcIs(O.m, <pure callee text>) for every called key m
  //     P_O = ok ? { K: O.K, ... } : O          (a snapshot of the keys read, taken ONCE at the position of the first member)
  //     B_O = O                                  (for an outer binding the members use as a plain value)
  //     keySetLazy(R, K, F', ok)                 for each member, F' = F with O replaced by P_O / B_O everywhere
  // Between two members of a run only fresh-object stores and other lazy installs happen (a store whose key is one of the snapshot keys ends the run), and a
  // plain data member is read without running code, so the snapshot equals what each member's own eager reads would have seen. When `ok` is false P_O IS O and
  // the runtime runs each thunk at once: F' then reads O live, which is the eager program exactly (getters, proxies, a replaced callee all land there).
  // F' keeps the shape of F: a read `O.K` becomes `P_O.K` and a call `O.m(a)` becomes `P_O.m(a)`, so the code is no larger than the original thunk's.
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  /** LAB ONLY (a positive control, never a feature): SCRIPTC_LAZYINIT_BREAK=lateread makes the thunk read the outer bindings live when it runs, skipguard
   * installs lazily without testing the callee. A row that does not DIFFER under the matching break does not test that mechanism. */
  const brk = process.env["SCRIPTC_LAZYINIT_BREAK"] ?? "";
  const out2 = { lazy: 0, groups: 0, guardedEager: 0, skipped: 0, hoistedReads: 0 };
  const done = new Set<string>(); // functions this pass built: never rewritten again
  const removed = new Set<string>(); // originals this pass replaced and dropped
  let serial = 0;
  const DYN_T = { kind: "dyn" };
  const STR_T = { kind: "string" };
  const BOOL_T = { kind: "bool" };
  const L = (loc: unknown): unknown => loc;
  const stripDyn = (e: unknown): unknown => { let x = e; while (kindOf(x) === "dynFrom") x = (x as Node)["value"]; return x; };

  interface Use { id: string; node: Node; keys: Map<string, string[] | undefined>; bare: boolean; pid: string; bid: string }
  const lazyMemo = new Map<unknown, boolean>();
  const lazyCand = (stmt: unknown): boolean => {
    const m = lazyMemo.get(stmt);
    if (m !== undefined) return m;
    const c = isCandidate(stmt);
    const r = c !== undefined && fnByName.get(c.fnName) !== undefined && analyse(c.fnName, "", c.key, 0).lazy;
    lazyMemo.set(stmt, r);
    return r;
  };
  const recvOf = (stmt: Node): Node => ((stmt["expr"] as Node)["args"] as Node[])[0] as Node;
  const simpleRecv = (stmt: Node): boolean => kindOf(stripDyn(recvOf(stmt))) === "varRef";

  const rewriteRun = (owner: IrFunction, run: Node[]): unknown[] | undefined => {
    const uses = new Map<string, Use>();
    const okId = `lzok${serial++}.0`;
    const idType = new Map<string, Node>([[okId, BOOL_T]]);
    const stack: Set<string>[] = [];
    const newFns: IrFunction[] = [];
    const origNames: string[] = [];
    let outerCaps = new Set<string>();
    const fail = (why: string): never => {
      throw new Refuse(why);
    };
    const use = (id: string): void => { for (const s2 of stack) s2.add(id); };
    const refT = (id: string, loc: unknown): Node => ({ kind: "varRef", localId: id, type: idType.get(id) ?? DYN_T, loc: L(loc) });
    const isOuter = (id: string, fnCaps: Set<string>): boolean => isGlobalId(id) || (fnCaps.has(id) && outerCaps.has(id));
    const textsOf = (m: string): string[] => {
      const set = closuresByKey.get(m);
      if (set === undefined) return fail(`no closure stored under ${m}`);
      return [...set].map((fnName) => fnText.get(fnName) ?? fail(`closure ${fnName} carries no source text`));
    };
    const useOf = (r: Node): Use => {
      const id = r["localId"] as string;
      let u = uses.get(id);
      if (u === undefined) {
        const t = r["type"] as Node | undefined;
        if (t === undefined || t["kind"] !== "dyn") fail("outer binding is not a dyn value");
        u = { id, node: clone(r), keys: new Map(), bare: false, pid: `lzp${serial++}.0`, bid: `lzb${serial++}.0` };
        uses.set(id, u);
      }
      return u;
    };
    const rw = (n: unknown, fnCaps: Set<string>): unknown => {
      if (Array.isArray(n)) return rwList(n, fnCaps);
      if (!isNode(n)) return n;
      const k = n["kind"];
      if (k === "closure") return clone(n); // body runs at call time, as in the eager program
      if (brk !== "lateread") {
        if (k === "varRef" && isOuter(n["localId"] as string, fnCaps)) {
          const u = useOf(n);
          u.bare = true;
          use(u.bid);
          return refT(u.bid, n["loc"]);
        }
        if (k === "dynKeyGet" && kindOf(n["key"]) === "strLit") {
          const r = stripDyn(n["value"]);
          if (kindOf(r) === "varRef" && isOuter((r as Node)["localId"] as string, fnCaps)) {
            const u = useOf(r as Node);
            u.keys.set(((n["key"] as Node)["value"] as string), undefined);
            use(u.pid);
            return { ...clone(n), value: refT(u.pid, n["loc"]) };
          }
        }
        if (k === "dynInvoke") {
          const r = stripDyn(n["recv"]);
          if (kindOf(r) !== "varRef" || !isOuter((r as Node)["localId"] as string, fnCaps) || n["methodKey"] != null) return fail("dyn call shape");
          const m = n["method"] as string;
          const u = useOf(r as Node);
          u.keys.set(m, textsOf(m));
          use(u.pid);
          const o: Node = {};
          for (const key of Object.keys(n)) o[key] = key === "loc" || key === "type" ? n[key] : key === "recv" ? refT(u.pid, n["loc"]) : rw(n[key], fnCaps);
          return o;
        }
      }
      const o: Node = {};
      for (const key of Object.keys(n)) o[key] = key === "loc" || key === "type" ? n[key] : rw(n[key], fnCaps);
      return o;
    };
    const buildFn = (fn: IrFunction, closureNode: Node): Node => {
      const fnCaps = new Set<string>(((fn.captures as unknown[]) ?? []).map((x) => String((x as Node)["localId"])));
      const mine = new Set<string>();
      stack.push(mine);
      const body = rwList(fn.body as unknown[], fnCaps);
      stack.pop();
      const name = `${fn.name}$lz${serial++}`;
      const addCaps: IrParam[] = [...mine].map((id) => ({ localId: id, name: id, type: (idType.get(id) ?? DYN_T) as never }));
      const nf: IrFunction = { ...clone(fn), name, body: body as never, captures: [...(clone(fn.captures) ?? []), ...addCaps], locals: [...clone(fn.locals), ...addCaps.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false, boxed: true as const }))] } as IrFunction;
      newFns.push(nf);
      origNames.push(fn.name);
      done.add(name);
      return { ...clone(closureNode), fnName: name, captures: [...((closureNode["captures"] as string[]) ?? []), ...mine] };
    };
    const rwList = (list: unknown[], fnCaps: Set<string>): unknown[] => {
      const res: unknown[] = [];
      for (const st of list) {
        const nc = isNode(st) ? isCandidate(st) : undefined;
        if (nc !== undefined && stack.length > 0 && fnByName.get(nc.fnName) !== undefined) {
          // a nested member: its function is rebuilt the same way and installed lazily too, under the group's flag
          const G = fnByName.get(nc.fnName)!;
          const e = (st as Node)["expr"] as Node;
          const a = e["args"] as Node[];
          const gCall = stripDyn(a[2]) as Node;
          const gClosure = buildFn(G, gCall["callee"] as Node);
          use(okId);
          const loc = (st as Node)["loc"];
          res.push({ kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySetLazy", args: [rw(a[0], fnCaps), clone(a[1]), { kind: "dynFrom", value: gClosure, type: DYN_T, loc: L(loc) }, refT(okId, loc)], type: { kind: "void" }, loc: L(loc) }, loc: L(loc) });
          continue;
        }
        res.push(rw(st, fnCaps));
      }
      return res;
    };
    try {
      const members: { recv: Node; key: Node; closure: Node; stmt: Node }[] = [];
      for (const stmt of run) {
        const c = isCandidate(stmt)!;
        const F = fnByName.get(c.fnName)!;
        outerCaps = new Set<string>(((F.captures as unknown[]) ?? []).map((x) => String((x as Node)["localId"])));
        const call = stripDyn(((stmt["expr"] as Node)["args"] as Node[])[2]) as Node;
        members.push({ recv: recvOf(stmt), key: ((stmt["expr"] as Node)["args"] as Node[])[1] as Node, closure: buildFn(F, call["callee"] as Node), stmt });
      }
      // a store that could alias one of the snapshot keys ends the run
      for (const m of members) {
        const kk = (m.key["value"] as string);
        for (const u of uses.values()) if (u.keys.has(kk)) fail(`member key ${kk} is also a snapshot key`);
      }
      const loc = run[0]!["loc"];
      const pre: unknown[] = [];
      const lit = (v: string): Node => ({ kind: "strLit", value: v, type: STR_T, loc: L(loc) });
      const kget = (u: Use, key: string): Node => ({ kind: "dynKeyGet", key: lit(key), value: clone(u.node), type: DYN_T, loc: L(loc) });
      // the first receiver is evaluated before the group's reads (it may have effects); later receivers are plain variables
      const recvs: Node[] = [];
      members.forEach((m, i) => {
        if (i === 0 && kindOf(stripDyn(m.recv)) !== "varRef") {
          const rid = `lzr${serial++}.0`;
          owner.locals.push({ id: rid, name: rid, type: DYN_T as never, mutable: false } as never);
          pre.push({ kind: "varDecl", localId: rid, init: clone(m.recv), loc: L(loc) });
          recvs.push(refT(rid, loc));
        } else recvs.push(clone(m.recv));
      });
      const plain: Node[] = [];
      const src: Node[] = [];
      for (const u of uses.values()) {
        for (const [key, texts] of u.keys) {
          plain.push({ kind: "libCall", fn: "dyn.isPlainData", args: [clone(u.node), lit(key)], type: BOOL_T, loc: L(loc) });
          if (texts !== undefined && brk !== "skipguard") {
            let any: Node | undefined;
            for (const text of texts) {
              const t: Node = { kind: "libCall", fn: "dyn.fnSrcIs", args: [kget(u, key), lit(text)], type: BOOL_T, loc: L(loc) };
              any = any === undefined ? t : { kind: "logical", op: "||", left: any, right: t, type: BOOL_T, loc: L(loc) };
            }
            src.push(any as Node);
          }
        }
      }
      // a BALANCED conjunction (a deep left chain would overflow the validator's recursion), in order: every plain test before any source-text test
      const tree = (xs: Node[]): Node => {
        if (xs.length === 1) return xs[0]!;
        const mid = xs.length >> 1;
        return { kind: "logical", op: "&&", left: tree(xs.slice(0, mid)), right: tree(xs.slice(mid)), type: BOOL_T, loc: L(loc) };
      };
      const terms = [...plain, ...src];
      const okInit: Node = terms.length === 0 ? { kind: "boolLit", value: true, type: BOOL_T, loc: L(loc) } : tree(terms);
      const newLocals: Record<string, unknown>[] = [];
      const decl = (id: string, init: Node, type: Node): void => {
        newLocals.push({ id, name: id, type, mutable: false, boxed: true });
        pre.push({ kind: "varDecl", localId: id, init, loc: L(loc) });
      };
      decl(okId, okInit, BOOL_T);
      for (const u of uses.values()) {
        if (u.keys.size > 0) {
          const fields = [...u.keys.keys()].map((key) => ({ key: lit(key), value: kget(u, key) }));
          decl(u.pid, { kind: "ternary", cond: refT(okId, loc), then: { kind: "dynObjLit", fields, type: DYN_T, loc: L(loc) }, else_: clone(u.node), type: DYN_T, loc: L(loc) }, DYN_T);
        }
        if (u.bare) decl(u.bid, clone(u.node), DYN_T);
      }
      for (const nl of newLocals) owner.locals.push(nl as never);
      members.forEach((m, i) => {
        pre.push({ kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySetLazy", args: [recvs[i]!, clone(m.key), { kind: "dynFrom", value: m.closure, type: DYN_T, loc: L(loc) }, refT(okId, loc)], type: { kind: "void" }, loc: L(loc) }, loc: L(m.stmt["loc"]) });
      });
      for (const nf of newFns) mod.functions.push(nf);
      for (const name of origNames) {
        if ((refs.get(name) ?? 0) <= 1) {
          const i = mod.functions.findIndex((x) => x.name === name);
          if (i >= 0) {
            mod.functions.splice(i, 1);
            removed.add(name);
          }
        }
      }
      out2.hoistedReads += [...uses.values()].reduce((a, u) => a + u.keys.size + (u.bare ? 1 : 0), 0);
      out2.lazy += members.length;
      out2.groups++;
      return pre;
    } catch (err) {
      if (!(err instanceof Refuse)) throw err;
      return undefined;
    }
  };

  if (mode === "on") {
    const walkLists = (n: unknown, owner: IrFunction): void => {
      if (Array.isArray(n)) {
        for (let i = 0; i < n.length; i++) {
          const el = n[i];
          if (isNode(el) && el["kind"] === "exprStmt" && lazyCand(el)) {
            const run: Node[] = [el];
            for (let j = i + 1; j < n.length; j++) {
              const nx = n[j];
              if (!(isNode(nx) && nx["kind"] === "exprStmt" && lazyCand(nx) && simpleRecv(nx))) break;
              run.push(nx);
            }
            const rep = rewriteRun(owner, run);
            if (rep !== undefined) {
              n.splice(i, run.length, ...rep);
              i += rep.length - 1;
              continue;
            }
          }
          walkLists(el, owner);
        }
        return;
      }
      if (!isNode(n)) return;
      for (const key of Object.keys(n)) if (key !== "loc" && key !== "type") walkLists(n[key], owner);
    };
    for (const f of [...mod.functions]) {
      if (done.has(f.name) || removed.has(f.name) || !Array.isArray(f.body)) continue;
      walkLists(f.body, f);
    }
    if (out2.lazy > 0 && process.env["SCRIPTC_LAZYINIT_LOG"] === "1") process.stderr.write(`LAZYINIT rewrite lazy=${out2.lazy} groups=${out2.groups} sharedReads=${out2.hoistedReads} newFunctions=${done.size} passMs=${Date.now() - t0}\n`);
  }

  const countNested = (v: LazyVerdict): number => 1 + v.nested.reduce((a, n) => a + countNested(n), 0);
  const lines: string[] = [];
  if (calleeSample !== "") lines.push(`LAZYINIT callee-sample ${calleeSample}`);
  for (const v of out.verdicts) {
    lines.push(`LAZYINIT ${v.lazy ? "lazy" : "keep"} ${v.where} ${v.key}${v.lazy ? "" : `: ${v.why}`}${v.nested.length > 0 ? ` (nested ${v.nested.filter((n) => n.lazy).length}/${v.nested.length})` : ""}`);
    if (mode === "why" && v.lazy) lines.push(`LAZYINIT   hoists ${[...new Set(v.hoists)].join(", ")}; callees ${v.callees.join(", ")}`);
  }
  for (const i of out.inventory) lines.push(`LAZYINIT inventory key=${i.key} literalStores=${i.literalStores} programComputedKeyStores=${i.computedKeyStores} closures=${i.closures.map((c) => `${c.fnName}:${c.pure ? "pure" : `impure(${c.why})`}`).join(",")}`);
  const lazyN = out.verdicts.filter((v) => v.lazy).length;
  lines.push(`LAZYINIT summary candidates=${out.verdicts.length} lazy=${lazyN} keep=${out.verdicts.length - lazyN} totalWithNested=${out.verdicts.reduce((a, v) => a + countNested(v), 0)}`);
  if (mode !== "on") process.stderr.write(lines.join("\n") + "\n");
  return out;
}
