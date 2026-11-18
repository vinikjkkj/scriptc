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
  // For a candidate the analysis judged deferrable, in the statement list that holds it:
  //     h1 = <hoisted read 1>; h2 = ...;                   (in evaluation order, at the ORIGINAL position)
  //     if (guard over the callee values) R.K = lazy(F')   else R.K = F'()
  // where F' is F with every hoisted read replaced by a captured local, and a call `G.m(args)` replaced by
  // `typeof h_m === "function" ? Reflect.apply(h_m, h_G, [args]) : h_m(args)` (the receiver and the method read once, at install; `this` and the not-a-function
  // TypeError preserved). A nested member inside F is built into F' the same way, eagerly (its reads were hoisted into the parent's install).
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  /** LAB ONLY (a positive control, never a feature): SCRIPTC_LAZYINIT_BREAK=lateread performs the hoisted reads when the thunk runs, skipguard installs lazily
   * without testing the callee. A row that does not DIFFER under the matching break does not test that mechanism. */
  const brk = process.env["SCRIPTC_LAZYINIT_BREAK"] ?? "";
  const out2 = { lazy: 0, guardedEager: 0, skipped: 0, hoistedReads: 0 };
  const done = new Set<string>(); // functions this pass built: never rewritten again
  const removed = new Set<string>(); // originals this pass replaced and dropped
  let serial = 0;
  const DYN_T = { kind: "dyn" };
  const STR_T = { kind: "string" };
  const BOOL_T = { kind: "bool" };
  const L = (loc: unknown): unknown => loc;

  interface Hoist { id: string; init: unknown; callee?: string[] | undefined }
  const rewriteMember = (owner: IrFunction, stmt: Node): unknown[] | undefined => {
    const c = isCandidate(stmt);
    if (c === undefined) return undefined;
    const F = fnByName.get(c.fnName);
    if (F === undefined) return undefined;
    const top = analyse(c.fnName, owner.name, c.key, 0);
    if (!top.lazy) return undefined;
    const stripToCall = (x: unknown): Node => { let y = x; while (kindOf(y) === "dynFrom") y = (y as Node)["value"]; return y as Node; };
    const withCallee = (arg: unknown, callee: Node): Node => { const cp = clone(arg as Node); stripToCall(cp)["callee"] = callee; return cp; };
    const call = stripToCall(((stmt["expr"] as Node)["args"] as Node[])[2]);
    const origClosure = call["callee"] as Node;
    const hoists: Hoist[] = [];
    const stack: Set<string>[] = [];
    const outerCaps = new Set<string>(((F.captures as unknown[]) ?? []).map((x) => String((x as Node)["localId"])));
    const newFns: IrFunction[] = [];
    let failed = "";
    const fail = (why: string): never => {
      failed = why;
      throw new Refuse(why);
    };
    const use = (id: string): void => { for (const s2 of stack) s2.add(id); };
    const mkHoist = (init: Node, callee?: string[]): string => {
      if (kindOf(init) === undefined) fail("hoist of a non-node");
      const t = init["type"] as Node | undefined;
      if (t === undefined || t["kind"] !== "dyn") fail("hoisted read is not a dyn value");
      const id = `lzh${serial++}.0`;
      hoists.push({ id, init, callee });
      use(id);
      return id;
    };
    const ref = (id: string, loc: unknown): Node => ({ kind: "varRef", localId: id, type: DYN_T, loc: L(loc) });
    const stripDyn = (e: unknown): unknown => { let x = e; while (kindOf(x) === "dynFrom") x = (x as Node)["value"]; return x; };
    const isOuter = (id: string, fnCaps: Set<string>): boolean => isGlobalId(id) || (fnCaps.has(id) && outerCaps.has(id));
    const textsOf = (m: string): string[] => {
      const set = closuresByKey.get(m);
      if (set === undefined) return fail(`no closure stored under ${m}`);
      return [...set].map((fnName) => fnText.get(fnName) ?? fail(`closure ${fnName} carries no source text`));
    };
    // rewrite one expression/statement tree of function `fn` (clone-and-replace)
    const rw = (n: unknown, fnCaps: Set<string>): unknown => {
      if (Array.isArray(n)) return rwList(n, fnCaps);
      if (!isNode(n)) return n;
      const k = n["kind"];
      if (k === "closure") return clone(n); // body runs at call time, as in the eager program
      if (k === "varRef" && isOuter(n["localId"] as string, fnCaps)) return ref(mkHoist(clone(n)), n["loc"]);
      if (k === "dynKeyGet") {
        const r = stripDyn(n["value"]);
        if (kindOf(r) === "varRef" && isOuter((r as Node)["localId"] as string, fnCaps) && kindOf(n["key"]) === "strLit") return ref(mkHoist(clone(n)), n["loc"]);
      }
      if (k === "dynInvoke") {
        const r = stripDyn(n["recv"]);
        if (kindOf(r) !== "varRef" || !isOuter((r as Node)["localId"] as string, fnCaps) || n["methodKey"] != null) return fail("dyn call shape");
        const m = n["method"] as string;
        const texts = textsOf(m);
        const hr = mkHoist(clone(r as Node));
        const hm = mkHoist({ kind: "dynKeyGet", key: { kind: "strLit", value: m, type: STR_T, loc: L(n["loc"]) }, value: ref(hr, n["loc"]), type: DYN_T, loc: L(n["loc"]) }, texts);
        const args = (n["args"] as unknown[]).map((a) => rw(a, fnCaps));
        const callName = n["calleeName"] as string;
        const loc = n["loc"];
        return {
          kind: "ternary",
          cond: { kind: "strEq", negated: false, left: { kind: "libCall", fn: "dyn.typeof", args: [ref(hm, loc)], type: STR_T, loc: L(loc) }, right: { kind: "strLit", value: "function", type: STR_T, loc: L(loc) }, type: BOOL_T, loc: L(loc) },
          then: { kind: "libCall", fn: "dyn.reflectApply", args: [ref(hm, loc), ref(hr, loc), { kind: "dynArrLit", elems: clone(args), type: DYN_T, loc: L(loc) }], type: DYN_T, loc: L(loc) },
          else_: { kind: "dynCall", callee: ref(hm, loc), calleeName: callName, args: clone(args), type: n["type"], loc: L(loc) },
          type: n["type"],
          loc: L(loc),
        };
      }
      const o: Node = {};
      for (const key of Object.keys(n)) o[key] = key === "loc" || key === "type" ? n[key] : rw(n[key], fnCaps);
      return o;
    };
    const buildFn = (fn: IrFunction, closureNode: Node): Node => {
      const fnCaps = new Set<string>(((fn.captures as unknown[]) ?? []).map((x) => String((x as Node)["localId"])));
      const mine = new Set<string>();
      stack.push(mine);
      const body = rwBody(fn.body as unknown[], fnCaps);
      stack.pop();
      const name = `${fn.name}$lz${serial++}`;
      const addCaps: IrParam[] = [...mine].map((id) => ({ localId: id, name: id, type: DYN_T as never }));
      const nf: IrFunction = { ...clone(fn), name, body: body as never, captures: [...(clone(fn.captures) ?? []), ...addCaps], locals: [...clone(fn.locals), ...addCaps.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false, boxed: true as const }))] } as IrFunction;
      newFns.push(nf);
      done.add(name);
      return { ...clone(closureNode), fnName: name, captures: [...((closureNode["captures"] as string[]) ?? []), ...mine] };
    };
    const rwBody = (list: unknown[], fnCaps: Set<string>): unknown[] => rwList(list, fnCaps);
    const rwList = (list: unknown[], fnCaps: Set<string>): unknown[] => {
      const res: unknown[] = [];
      for (const st of list) {
        const nc = isNode(st) ? isCandidate(st) : undefined;
        if (nc !== undefined && stack.length > 0 && fnByName.get(nc.fnName) !== undefined) {
          // a nested member: its function is rebuilt with the same hoisting, and called eagerly where it stood
          const G = fnByName.get(nc.fnName)!;
          const e = (st as Node)["expr"] as Node;
          const a = e["args"] as Node[];
          const gCall = stripToCall(a[2]);
          const gClosure = buildFn(G, gCall["callee"] as Node);
          res.push({ ...clone(st as Node), expr: { ...clone(e), args: [rw(a[0], fnCaps), clone(a[1]), withCallee(a[2], gClosure)] } });
          continue;
        }
        res.push(rw(st, fnCaps));
      }
      return res;
    };
    let rootClosure: Node;
    try {
      rootClosure = buildFn(F, origClosure);
    } catch (err) {
      if (!(err instanceof Refuse)) throw err;
      return undefined;
    }
    void failed;
    if (brk === "lateread") {
      const rootFn = newFns[newFns.length - 1]!; // buildFn pushes the root LAST (nested are pushed while it is built)
      const hs = new Set(hoists.map((h) => h.id));
      rootFn.captures = (rootFn.captures ?? []).filter((c2) => !hs.has(c2.localId));
      (rootFn.body as unknown[]).unshift(...hoists.map((h) => ({ kind: "varDecl", localId: h.id, init: h.init, loc: stmt["loc"] })));
      (rootClosure["captures"] as string[]) = (rootClosure["captures"] as string[]).filter((c2) => !hs.has(c2));
      hoists.length = 0;
    }
    // the receiver: evaluated once, first (it may itself have effects)
    const pre: unknown[] = [];
    const recvExpr = (((stmt["expr"] as Node)["args"] as Node[])[0]) as Node;
    let recv: Node = recvExpr;
    if (kindOf(recvExpr) !== "varRef") {
      const rid = `lzr${serial++}.0`;
      owner.locals.push({ id: rid, name: rid, type: DYN_T as never, mutable: false } as never);
      pre.push({ kind: "varDecl", localId: rid, init: clone(recvExpr), loc: stmt["loc"] });
      recv = ref(rid, stmt["loc"]);
    }
    for (const h of hoists) {
      owner.locals.push({ id: h.id, name: h.id, type: DYN_T as never, mutable: false, boxed: true } as never);
      pre.push({ kind: "varDecl", localId: h.id, init: h.init, loc: stmt["loc"] });
    }
    let guard: Node | undefined;
    for (const h of hoists) {
      if (h.callee === undefined || brk === "skipguard") continue;
      let any: Node | undefined;
      for (const text of h.callee) {
        const t: Node = { kind: "libCall", fn: "dyn.fnSrcIs", args: [ref(h.id, stmt["loc"]), { kind: "strLit", value: text, type: STR_T, loc: L(stmt["loc"]) }], type: BOOL_T, loc: L(stmt["loc"]) };
        any = any === undefined ? t : { kind: "logical", op: "||", left: any, right: t, type: BOOL_T, loc: L(stmt["loc"]) };
      }
      guard = guard === undefined ? any : { kind: "logical", op: "&&", left: guard, right: any as Node, type: BOOL_T, loc: L(stmt["loc"]) };
    }
    const loc = stmt["loc"];
    const keyNode = ((stmt["expr"] as Node)["args"] as Node[])[1] as Node;
    // ONE straight-line statement (the candidate sits in a sequence expression, whose statements may not branch): the runtime runs the thunk now when the guard is false
    const guardNode: Node = guard ?? { kind: "boolLit", value: true, type: BOOL_T, loc: L(loc) };
    const lazy: Node = { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySetLazy", args: [clone(recv), clone(keyNode), { kind: "dynFrom", value: clone(rootClosure), type: DYN_T, loc: L(loc) }, guardNode], type: { kind: "void" }, loc: L(loc) }, loc: L(loc) };
    for (const nf of newFns) mod.functions.push(nf);
    // drop the originals nothing else creates
    const drop = (name: string): void => {
      if ((refs.get(name) ?? 0) <= 1) {
        const i = mod.functions.findIndex((x) => x.name === name);
        if (i >= 0) {
          mod.functions.splice(i, 1);
          removed.add(name);
        }
      }
    };
    drop(c.fnName);
    out2.hoistedReads += hoists.length;
    out2.lazy++;
    return [...pre, lazy];
  };

  if (mode === "on") {
    const walkLists = (n: unknown, owner: IrFunction): void => {
      if (Array.isArray(n)) {
        for (let i = 0; i < n.length; i++) {
          const el = n[i];
          if (isNode(el) && el["kind"] === "exprStmt") {
            const rep = rewriteMember(owner, el);
            if (rep !== undefined) {
              n.splice(i, 1, ...rep);
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
    if (out2.lazy > 0 && process.env["SCRIPTC_LAZYINIT_LOG"] === "1") process.stderr.write(`LAZYINIT rewrite lazy=${out2.lazy} hoistedReads=${out2.hoistedReads} newFunctions=${done.size} passMs=${Date.now() - t0}\n`);
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
