/* DEAD-SOURCE ARRAY CROSSINGS.
 *
 * A typed array handed to a dynamic callee is deep-copied (toDynHelper) and the copy remembers its source (scr_dyn_origin_mark), so a
 * write through the copy and a recovery of the original reach the object the program still names. That origin takes a reference on the
 * source, which keeps the typed array alive for as long as the copy lives -- in a server that queues a thousand pending queries, the
 * padded parameter list of every one of them, twice (typed and dyn).
 *
 * This pass finds the crossings where the source cannot be named afterwards, and marks the `dynFrom` with `srcDead`. The emitters call
 * the `_own` variant of the mark for it, which skips the mark when -- at runtime -- the source's only references are the local and the
 * crossing's operand temp (rc == 2). The test is deliberately narrow and purely syntactic:
 *
 *   - the operand is a `varRef` of an array-typed local declared in this function by a `varDecl` WITH an initializer;
 *   - that local is not boxed (no closure captures it), is not a parameter, and appears nowhere else in the function: its declaration and
 *     this one read are its only two mentions (no later read, no reassignment, no `captures` entry, no loop binding);
 *   - the declaration and the read sit in the same chain of enclosing loops, so the one read cannot run again with the same array
 *     (a read inside a loop of a local declared outside it is a use on every iteration).
 *
 * Anything the pass does not prove keeps today's full mark. The runtime check covers what it cannot see: an array also reachable through
 * another variable, an object field, a container or a closure has rc > 2 at the crossing and keeps the mark.
 * SCRIPTC_OWNXFER=0 turns the pass off; SCRIPTC_OWNXFER_FORCE=1 marks EVERY local-array crossing (the test's positive control: it must
 * diverge from Node on a used-after row). */
import type { IrFunction } from "./nodes.js";

const LOOPS = new Set(["while", "doWhile", "for", "forOf"]);

type AnyNode = Record<string, unknown>;

function isNode(v: unknown): v is AnyNode {
  return v !== null && typeof v === "object";
}

/** Marks the qualifying crossings of every function; returns how many were marked. */
export function markDeadSourceCrossings(functions: readonly IrFunction[]): number {
  const mode = process.env["SCRIPTC_OWNXFER"];
  if (mode === "0") return 0;
  const force = process.env["SCRIPTC_OWNXFER_FORCE"] === "1";
  let marked = 0;
  for (const fn of functions) {
    const locals = new Map<string, { boxed: boolean; param: boolean }>();
    for (const l of fn.locals ?? []) locals.set(l.id, { boxed: l.boxed === true, param: false });
    for (const p of fn.params ?? []) {
      const prev = locals.get(p.localId);
      locals.set(p.localId, { boxed: prev?.boxed === true, param: true });
    }
    const mentions = new Map<string, number>();
    const declLoops = new Map<string, readonly AnyNode[]>();
    const declWithInit = new Set<string>();
    const cands: { node: AnyNode; id: string; loops: readonly AnyNode[] }[] = [];
    const walk = (n: unknown, loops: readonly AnyNode[]): void => {
      if (Array.isArray(n)) {
        for (const x of n) walk(x, loops);
        return;
      }
      if (!isNode(n)) return;
      const kind = n["kind"];
      const inner = typeof kind === "string" && LOOPS.has(kind) ? [...loops, n] : loops;
      const lid = n["localId"];
      if (typeof lid === "string") mentions.set(lid, (mentions.get(lid) ?? 0) + 1);
      if (kind === "varDecl" && typeof lid === "string") {
        declLoops.set(lid, loops);
        if (n["init"] !== null && n["init"] !== undefined) declWithInit.add(lid);
      }
      if (kind === "closure" && Array.isArray(n["captures"])) {
        for (const c of n["captures"] as unknown[]) if (typeof c === "string") mentions.set(c, (mentions.get(c) ?? 0) + 1);
      }
      if (kind === "dynFrom") {
        const v = n["value"];
        if (isNode(v) && v["kind"] === "varRef" && v["nullTest"] !== true && isNode(v["type"]) && v["type"]["kind"] === "array" && typeof v["localId"] === "string") {
          cands.push({ node: n, id: v["localId"], loops });
        }
      }
      for (const k of Object.keys(n)) {
        if (k === "loc" || k === "type") continue;
        const child = n[k];
        if (child !== null && typeof child === "object") walk(child, inner);
      }
    };
    walk(fn.body, []);
    for (const c of cands) {
      if (force) {
        c.node["srcDead"] = true;
        marked++;
        continue;
      }
      const l = locals.get(c.id);
      if (l === undefined || l.boxed || l.param) continue;
      if (!declWithInit.has(c.id) || mentions.get(c.id) !== 2) continue;
      const dl = declLoops.get(c.id)!;
      if (dl.length !== c.loops.length || dl.some((x, i) => x !== c.loops[i])) continue;
      c.node["srcDead"] = true;
      marked++;
    }
  }
  return marked;
}
