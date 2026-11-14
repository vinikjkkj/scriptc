/* Static code layout: where each function of the program goes in the executable's text, decided from the program's own call graph, with no profile.
 *
 * A profile-driven order (scriptc build --layout-profile, then --layout-order) packs the code a run actually uses and measured -8.1 MiB (-10.45%) on the
 * redis bench peak, but it needs a run per app. This pass answers the same question from what the compiler already knows, as a best effort:
 *
 *   HOT      what the event loop runs: every function used as a VALUE (a lifted closure, a callback, a handler, an async continuation passed on) and everything
 *            reachable from those through calls and further closures, in DFS order from the handlers so a handler's callees sit next to it.
 *   MID      what the walk could not place (reached only through virtual dispatch, class tables, dyn calls...): kept in the original order, between the two.
 *            A wrong guess here costs nothing: a function the graph does not see stays where it was relative to its neighbours.
 *   STARTUP  what only the module-initialisation tree runs: reachable from the entry function and the %init.* functions through DIRECT calls, and from no
 *            handler. Top-level code, require-time setup and config parsing end up here.
 *   ERROR    what is reached only from catch/finally bodies, plus functions that do nothing but throw: placed last.
 *
 * The result is a rank per IR function name (HOT < MID < STARTUP < ERROR); both emitters write the program's functions in rank order (C: the function chunks;
 * LLVM: the define blocks). The graph is read from the IR bodies generically: a `callee` is a call edge, a `fnName` (closure creation) or any other
 * mention of a function name is a value edge, and a tryCatch's catch/finally bodies are walked into separate "error" edge sets.
 *
 * This only moves functions around: it never adds or removes one, and unknown code is left in place. SCRIPTC_STATIC_LAYOUT=0 turns it off (the A/B control). */
import type { IrFunction, IrModule } from "./nodes.js";

export const STATIC_HOT = 0;
export const STATIC_MID = 1_000_000;
export const STATIC_STARTUP = 2_000_000;
export const STATIC_ERROR = 3_000_000;

/** Keys whose string value is DATA (a literal's text), never a function name (the stable-names pass skips the same set). */
const DATA_KEYS = new Set(["value", "text", "raw", "cooked", "pattern", "flags", "source", "literal", "message", "chars", "bytes"]);

interface Refs {
  calls: Set<string>;
  vals: Set<string>;
  errCalls: Set<string>;
  errVals: Set<string>;
  throwsOnly: boolean;
}

function scan(fn: IrFunction, names: ReadonlySet<string>): Refs {
  const r: Refs = { calls: new Set(), vals: new Set(), errCalls: new Set(), errVals: new Set(), throwsOnly: false };
  const stack: { n: unknown; err: boolean }[] = [{ n: fn.body, err: false }];
  while (stack.length > 0) {
    const { n, err } = stack.pop()!;
    if (typeof n === "string") {
      if (names.has(n)) (err ? r.errVals : r.vals).add(n);
      continue;
    }
    if (n === null || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push({ n: n[i], err });
      continue;
    }
    const o = n as Record<string, unknown>;
    if (o["kind"] === "tryCatch") {
      stack.push({ n: o["tryBody"], err });
      stack.push({ n: o["catchBody"], err: true });
      stack.push({ n: o["finallyBody"], err: true });
      continue;
    }
    for (const k of Object.keys(o)) {
      if (k === "loc" || k === "type") continue;
      const v = o[k];
      if (typeof v === "string" && DATA_KEYS.has(k)) continue; // a literal's text; an object under `value` (an assignment's right-hand side) is walked
      if (k === "callee" && typeof v === "string") {
        if (names.has(v)) (err ? r.errCalls : r.calls).add(v);
        continue;
      }
      stack.push({ n: v, err });
    }
  }
  // a function whose whole body is one throw statement (an error helper)
  const body = fn.body as unknown;
  if (Array.isArray(body) && body.length > 0 && body.length <= 3) {
    const last = body[body.length - 1] as { kind?: string } | undefined;
    r.throwsOnly = last?.kind === "throw";
  }
  return r;
}

/** Rank per function name, or undefined when the pass is off or has nothing to say. */
export function staticLayoutRanks(mod: IrModule): Map<string, number> | undefined {
  if (process.env["SCRIPTC_STATIC_LAYOUT"] === "0") return undefined;
  const fns = mod.functions;
  if (fns.length < 2) return undefined;
  const names = new Set<string>(fns.map((f) => f.name));
  const index = new Map<string, number>();
  fns.forEach((f, i) => index.set(f.name, i));
  const refs = new Map<string, Refs>();
  for (const f of fns) refs.set(f.name, scan(f, names));

  // value-referenced functions are the handler roots
  const handlerRoots: string[] = [];
  const seenRoot = new Set<string>();
  for (const f of fns) {
    const r = refs.get(f.name)!;
    for (const v of r.vals) {
      if (v !== f.name && !seenRoot.has(v)) { seenRoot.add(v); handlerRoots.push(v); }
    }
  }
  handlerRoots.sort((a, b) => index.get(a)! - index.get(b)!);

  // HOT: DFS from the handlers through calls and values (normal edges), callees in the order the body names them
  const hot = new Set<string>();
  const hotOrder: string[] = [];
  const dfs = (root: string): void => {
    const st = [root];
    while (st.length > 0) {
      const f = st.pop()!;
      if (hot.has(f)) continue;
      hot.add(f);
      hotOrder.push(f);
      const r = refs.get(f);
      if (r === undefined) continue;
      const next = [...r.calls, ...r.vals].filter((x) => !hot.has(x));
      for (let i = next.length - 1; i >= 0; i--) st.push(next[i]!);
    }
  };
  for (const root of handlerRoots) dfs(root);

  // STARTUP: direct calls from the entry and the %init.* functions, minus HOT
  const startupRoots = fns.filter((f) => f.name === mod.entry || f.name.startsWith("%init")).map((f) => f.name);
  const startup = new Set<string>();
  const sst = [...startupRoots];
  while (sst.length > 0) {
    const f = sst.pop()!;
    if (startup.has(f)) continue;
    startup.add(f);
    const r = refs.get(f);
    if (r === undefined) continue;
    for (const c of r.calls) if (!startup.has(c)) sst.push(c);
  }
  for (const f of hot) startup.delete(f);

  // ERROR: reached only through catch/finally edges, or a function that only throws, and neither hot nor startup
  const reachedNormally = new Set<string>([...hot, ...startup]);
  const errOnly = new Set<string>();
  const est: string[] = [];
  for (const f of fns) {
    const r = refs.get(f.name)!;
    for (const c of [...r.errCalls, ...r.errVals]) if (!reachedNormally.has(c)) est.push(c);
  }
  while (est.length > 0) {
    const f = est.pop()!;
    if (errOnly.has(f) || reachedNormally.has(f)) continue;
    errOnly.add(f);
    const r = refs.get(f);
    if (r !== undefined) for (const c of [...r.calls, ...r.vals]) if (!errOnly.has(c) && !reachedNormally.has(c)) est.push(c);
  }
  for (const f of fns) if (refs.get(f.name)!.throwsOnly && !reachedNormally.has(f.name)) errOnly.add(f.name);

  const rank = new Map<string, number>();
  hotOrder.forEach((f, i) => rank.set(f, STATIC_HOT + i));
  for (const f of fns) {
    if (rank.has(f.name)) continue;
    const i = index.get(f.name)!;
    if (errOnly.has(f.name)) rank.set(f.name, STATIC_ERROR + i);
    else if (startup.has(f.name)) rank.set(f.name, STATIC_STARTUP + i);
    else rank.set(f.name, STATIC_MID + i + 1);
  }
  if (process.env["SCRIPTC_STATIC_LAYOUT_DEBUG"] === "1") {
    const t = staticLayoutTiers(rank);
    process.stderr.write(`[staticlayout] ${fns.length} functions: hot ${t.hot} mid ${t.mid} startup ${t.startup} error ${t.error}; entry ${mod.entry}\n`);
    if (fns.length <= 80) for (const [k, v] of [...rank.entries()].sort((a, b) => a[1] - b[1])) process.stderr.write(`[staticlayout]   ${v} ${k}\n`);
  }
  return rank;
}

/** Counts per tier, for logs and tests. */
export function staticLayoutTiers(rank: ReadonlyMap<string, number>): { hot: number; mid: number; startup: number; error: number } {
  const t = { hot: 0, mid: 0, startup: 0, error: 0 };
  for (const v of rank.values()) {
    if (v < STATIC_MID) t.hot++;
    else if (v < STATIC_STARTUP) t.mid++;
    else if (v < STATIC_ERROR) t.startup++;
    else t.error++;
  }
  return t;
}
