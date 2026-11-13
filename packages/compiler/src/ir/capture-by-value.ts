/* CAPTURE BY VALUE: a captured local that is never written after it is first set needs no shared cell.
 *
 * Every captured local is boxed (a refcounted ScrBox shared by the declaring function and every closure that names
 * it), because a write through one capture has to be visible through all the others. A local that is written exactly
 * once, by its own declaration (or never, for a parameter), and whose declaration runs before any closure that names
 * it exists, has nothing to share: each closure can hold a counted copy of the value instead of a counted reference
 * to a cell. That removes one 40-byte box (plus its allocation, header and teardown) per captured local per
 * declaration, which on the redis bench is the second-largest object population after closures themselves.
 *
 * THIS PASS ONLY DECIDES. It clears `boxed` on the local in the declaring function and in every closure body that
 * names it; the emitters read "a capture whose local is not boxed" as "held by value" (the closure slot carries a
 * tagged counted pointer, see SCR_CAP_DYN / SCR_CAP_CLO in scr_runtime.h).
 *
 * WHAT QUALIFIES, all of it required:
 *  - the local is boxed, not a forward-captured const (`tdz`), not a hidden `%` local;
 *  - its type is `dyn`, `func` or a class instance (`object`): the reference kinds the closure core can release from a tagged slot (a dyn
 *    value through one installed hook, a closure directly, an instance through the arm-descriptor pair a box would carry). Other reference
 *    kinds are the next stage; scalars would need no release but a double does not fit a tagged slot;
 *  - exactly ONE node writes it, and that node is its `varDecl` with an initializer (or it is a parameter nothing
 *    writes). Writers are every node that carries the local as an assignment target: assign, assignExpr, incDec,
 *    forOf, a catch binding. Closure bodies are searched for writers too, through the whole forwarding chain;
 *  - every closure creation that names it sits LATER in the same statement list as the declaration, or inside a
 *    statement that does (so the declaration has run on every path to the creation). A closure created before the
 *    declaration, inside the declaration's own initializer, or in a different case or arm of the code is left boxed;
 *  - every closure function that names it is created at exactly the sites this pass followed (a lifted body reached
 *    from anywhere else could see the value before it is set).
 *
 * SCRIPTC_CAPVAL=off turns the pass off, which is the A/B arm: the same compiler tree, one environment variable. */

import type { IrExpr, IrFunction, IrLocal, IrModule } from "./nodes.js";

const WRITERS: ReadonlySet<string> = new Set(["assign", "assignExpr", "incDec", "forOf"]);
const BYVALUE_KINDS: ReadonlySet<string> = new Set(["dyn", "func", "object"]);

interface ClosureSite {
  /** The function whose body holds the creation. */
  owner: IrFunction;
  node: { fnName: string; captures: string[] };
  /** Statement lists enclosing the creation, outermost first: [list, index of the statement the creation lives in]. */
  path: Array<[object, number]>;
}

interface FnFacts {
  /** local id -> number of writer nodes (varDecl counted separately). */
  writers: Map<string, number>;
  decls: Map<string, Array<{ list: object; index: number; hasInit: boolean }>>;
  closures: ClosureSite[];
}

function collect(fn: IrFunction): FnFacts {
  const facts: FnFacts = { writers: new Map(), decls: new Map(), closures: [] };
  const bump = (id: string): void => void facts.writers.set(id, (facts.writers.get(id) ?? 0) + 1);
  const path: Array<[object, number]> = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        path.push([n, i]);
        const el = n[i];
        if (el !== null && typeof el === "object" && !Array.isArray(el)) {
          const rec = el as Record<string, unknown>;
          if (rec["kind"] === "varDecl" && typeof rec["localId"] === "string") {
            const id = rec["localId"] as string;
            let l = facts.decls.get(id);
            if (l === undefined) facts.decls.set(id, (l = []));
            l.push({ list: n, index: i, hasInit: rec["init"] !== null && rec["init"] !== undefined });
          }
        }
        walk(el);
        path.pop();
      }
      return;
    }
    const rec = n as Record<string, unknown>;
    const kind = rec["kind"];
    if (typeof kind === "string") {
      if (WRITERS.has(kind) && typeof rec["localId"] === "string") bump(rec["localId"] as string);
      if (kind === "tryCatch" && typeof rec["catchLocalId"] === "string") bump(rec["catchLocalId"] as string);
      if (kind === "closure" && Array.isArray(rec["captures"]) && typeof rec["fnName"] === "string") {
        facts.closures.push({ owner: fn, node: rec as unknown as ClosureSite["node"], path: path.slice() });
      }
    }
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      walk(rec[k]);
    }
  };
  walk(fn.body);
  return facts;
}

/** Returns how many (declaring function, local) pairs were unboxed. */
export function captureByValue(mod: IrModule): number {
  const mode = process.env["SCRIPTC_CAPVAL"];
  if (mode === "off") return 0;
  // "force" is the positive control and nothing else: it skips the writer and dominance tests so a local written after capture IS unboxed,
  // which must break the rows that cover that shape (a closure then reads a stale copy).
  const force = mode === "force";
  const byName = new Map<string, IrFunction>();
  for (const f of mod.functions) byName.set(f.name, f);
  const facts = new Map<IrFunction, FnFacts>();
  for (const f of mod.functions) facts.set(f, collect(f));

  // How many creation sites name each closure function (a lifted body must have exactly one creator to be followed).
  const creators = new Map<string, number>();
  for (const f of mod.functions) for (const c of facts.get(f)!.closures) creators.set(c.node.fnName, (creators.get(c.node.fnName) ?? 0) + 1);

  let unboxed = 0;
  for (const owner of mod.functions) {
    const ownFacts = facts.get(owner)!;
    const capturedHere = new Set((owner.captures ?? []).map((c) => c.localId));
    const paramIds = new Set(owner.params.map((p) => p.localId));
    const localsById = new Map(owner.locals.map((l) => [l.id, l]));
    // candidates: locals this function owns (not forwarded captures) that its own closures capture
    const sitesOf = new Map<string, ClosureSite[]>();
    for (const c of ownFacts.closures) for (const id of c.node.captures) (sitesOf.get(id) ?? sitesOf.set(id, []).get(id)!).push(c);
    for (const [id, sites] of sitesOf) {
      if (capturedHere.has(id)) continue;
      const local = localsById.get(id);
      if (local === undefined || local.boxed !== true || local.tdz === true || local.name.startsWith("%")) continue;
      if (!BYVALUE_KINDS.has(local.type.kind)) continue;
      // exactly one writer: the declaration with an initializer, or a parameter nothing writes
      const decls = ownFacts.decls.get(id) ?? [];
      const writes = ownFacts.writers.get(id) ?? 0;
      if (writes !== 0 && !force) continue;
      let declAt: { list: object; index: number } | null = null;
      if (paramIds.has(id)) {
        if (decls.length !== 0) continue;
      } else {
        if (decls.length !== 1 || (!decls[0]!.hasInit && !force)) continue;
        declAt = decls[0]!;
      }
      // dominance: every creation sits after the declaration in the declaration's own statement list
      if (declAt !== null && !force) {
        const ok = sites.every((s) => s.path.some(([list, i]) => list === declAt!.list && i > declAt!.index));
        if (!ok) continue;
      }
      // follow the chain: every closure body that names it, and every closure those bodies create that forwards it
      const chain: IrFunction[] = [];
      const seen = new Set<IrFunction>();
      let ok = true;
      const follow = (site: ClosureSite): void => {
        const target = byName.get(site.node.fnName);
        if (target === undefined || seen.has(target) || !ok) return;
        if ((creators.get(site.node.fnName) ?? 0) !== 1) { ok = false; return; }
        seen.add(target);
        const cap = (target.captures ?? []).find((c) => c.localId === id);
        if (cap === undefined) { ok = false; return; }
        const tf = facts.get(target)!;
        if (((tf.writers.get(id) ?? 0) !== 0 && !force) || (tf.decls.get(id)?.length ?? 0) !== 0) { ok = false; return; }
        const tl = target.locals.find((l) => l.id === id);
        if (tl === undefined || tl.boxed !== true || tl.tdz === true || !BYVALUE_KINDS.has(tl.type.kind)) { ok = false; return; }
        chain.push(target);
        for (const c of tf.closures) if (c.node.captures.includes(id)) follow(c);
      };
      for (const s of sites) follow(s);
      if (!ok) continue;
      // commit: the owner's local and every body that names it hold the value, not a cell
      delete (local as { boxed?: true }).boxed;
      for (const t of chain) {
        const tl = t.locals.find((l: IrLocal) => l.id === id)!;
        delete (tl as { boxed?: true }).boxed;
      }
      unboxed++;
    }
  }
  return unboxed;
}

/** True for an expression that creates a closure (used by tests). */
export function isClosureExpr(e: IrExpr): boolean {
  return (e as { kind?: string }).kind === "closure";
}
