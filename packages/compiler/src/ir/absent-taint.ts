/* ABSENT-TAINT CENSUS (SCRIPTC_ABSENT_TAINT_CENSUS=1) -- stage 1 of the boundary-refusal repair, ANALYSIS ONLY: it reads the lowered IR and writes a report
 * to stderr; it changes no emitted byte.
 *
 * The question it answers: if a required field that a dyn value does not carry were held as `undefined` (as Node holds it) instead of refused at the
 * dyn->typed boundary, how far would "may be undefined" spread through the program, i.e. how many slots, locals, parameters and returns would have to
 * widen from `T` to `T | undefined`, and which functions would change signature?
 *
 * SEEDS. Every dynCheck (not a narrowBridge) whose target type reaches a record shape: each REQUIRED field (a field type with no undefined arm) of every
 * record shape reachable from the target (through unions, arrays and nested records) is a tainted SLOT.
 * PROPAGATION (a fixpoint over all functions; may-flow, so an over-approximation):
 *   - a read of a tainted slot (recordGet / recordGetAt / recordSrcGet / fieldGet) yields a tainted value;
 *   - a tainted value passes through varRef/assign/varDecl (locals), ternary / logical / nullish (right) / orDefault (right) / unionWrap / unionNarrow /
 *     upcast / downcast / seqExpr (result) / optChain (body) / awaitExpr;
 *   - a tainted value stored by recordLit / recordSet / fieldSet taints that slot; passed to a static call taints that parameter (the CALLER-WIDENING
 *     edge: the typed parameter has to widen); returned taints the function's return;
 *   - a tainted value stored into an array or handed to a closure / virtual call / constructor is counted as an UNRESOLVED sink (its target is not
 *     tracked by name): the report counts them separately, so a number that reads small cannot hide a spread through them.
 * A value that goes through arithmetic, comparison or a string operation is a NEW value, not an absent one, and stops the taint. */
import type { IrExpr, IrFunction, IrType } from "./nodes.js";

type ShapeLike = { fields: { name: string; type: IrType }[] };
type UnionLike = { arms: IrType[] };
export interface AbsentTaintHost {
  shapes: { get(id: string): ShapeLike | undefined };
  unions: { get(id: string): UnionLike | undefined };
}

type Node = Record<string, unknown> & { kind?: string };

export function absentTaintCensus(L: AbsentTaintHost, functions: IrFunction[]): void {
  const fnByName = new Map<string, IrFunction>();
  for (const f of functions) fnByName.set(f.name, f);
  const hasUndef = (t: IrType): boolean => {
    if (t.kind !== "union") return false;
    const d = L.unions.get((t as { unionId: string }).unionId);
    return !!d && d.arms.some((a) => a.kind === "undefinedT");
  };
  const slotKey = (shape: string, field: string): string => `${shape}.${field}`;
  const slots = new Set<string>();
  const seedSlots = new Set<string>();
  let crossings = 0, recordCrossings = 0;
  const locals = new Map<string, Set<string>>();
  const params = new Set<string>();
  const rets = new Set<string>();
  let unresolved = 0;
  const unresolvedKinds = new Map<string, number>();
  const note = (k: string): void => { unresolved++; unresolvedKinds.set(k, (unresolvedKinds.get(k) ?? 0) + 1); };

  // ---- seeds
  const visitType = (t: IrType, seen: Set<string>): void => {
    const k = t.kind as string;
    if (k === "record") {
      const id = (t as unknown as { shapeId: string }).shapeId;
      if (seen.has(id)) return;
      seen.add(id);
      const sh = L.shapes.get(id);
      if (!sh) return;
      for (const f of sh.fields) {
        if (f.name.startsWith("%")) continue;
        if (!hasUndef(f.type)) { slots.add(slotKey(id, f.name)); seedSlots.add(slotKey(id, f.name)); }
        visitType(f.type, seen);
      }
    } else if (k === "union") {
      const d = L.unions.get((t as unknown as { unionId: string }).unionId);
      for (const a of d?.arms ?? []) visitType(a, seen);
    } else if (k === "array") {
      visitType((t as unknown as { elem: IrType }).elem, seen);
    }
  };
  const walk = (n: unknown, f: (o: Node) => void): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x, f); return; }
    const o = n as Node;
    if (typeof o.kind === "string") f(o);
    for (const v of Object.values(o)) walk(v, f);
  };
  const seenNodes = new WeakSet<object>();
  for (const fn of functions) {
    walk(fn.body, (o) => {
      if (seenNodes.has(o)) return;
      seenNodes.add(o);
      if (o.kind === "dynCheck" && o["narrowBridge"] !== true) {
        crossings++;
        const before = seedSlots.size;
        const t = o["type"] as IrType;
        visitType(t, new Set());
        if (t.kind === "record" || t.kind === "union" || t.kind === "array") if (seedSlots.size >= before) recordCrossings++;
      }
    });
  }
  const seedCount = slots.size;

  // ---- propagation
  const localSet = (fn: string): Set<string> => { let s = locals.get(fn); if (!s) { s = new Set(); locals.set(fn, s); } return s; };
  let changed = true;
  const add = (set: Set<string>, k: string): void => { if (!set.has(k)) { set.add(k); changed = true; } };
  let cur = "";
  const tainted = (e: unknown): boolean => {
    if (e === null || typeof e !== "object") return false;
    const o = e as Node;
    switch (o.kind) {
      case "recordGet": case "recordGetAt": case "recordSrcGet":
        return slots.has(slotKey(o["shapeId"] as string, o["field"] as string));
      case "fieldGet":
        return slots.has(slotKey(o["className"] as string, o["field"] as string));
      case "varRef": return localSet(cur).has(o["localId"] as string);
      case "assignExpr": return tainted(o["value"]);
      case "ternary": return tainted(o["then"]) || tainted(o["else_"]);
      case "logical": return tainted(o["left"]) || tainted(o["right"]);
      case "nullish": case "orDefault": return tainted(o["right"]);
      case "unionWrap": case "unionNarrow": case "upcast": case "downcast": case "awaitExpr": case "promiseVoidWiden": return tainted(o["value"] ?? o["expr"] ?? o["operand"]);
      case "seqExpr": return tainted(o["result"]);
      case "optChain": return tainted(o["body"]);
      case "call": return rets.has(o["callee"] as string);
      default: return false;
    }
  };
  while (changed) {
    changed = false;
    for (const fn of functions) {
      cur = fn.name;
      const seen2 = new WeakSet<object>();
      walk(fn.body, (o) => {
        if (seen2.has(o)) return;
        seen2.add(o);
        switch (o.kind) {
          case "varDecl": if (o["init"] && tainted(o["init"])) add(localSet(cur), o["localId"] as string); break;
          case "assign": case "assignExpr": if (tainted(o["value"])) add(localSet(cur), o["localId"] as string); break;
          case "return": if (o["value"] && tainted(o["value"])) add(rets, cur); break;
          case "recordSet": if (tainted(o["value"])) { const k = slotKey(o["shapeId"] as string, o["field"] as string); if (!slots.has(k)) { slots.add(k); changed = true; } } break;
          case "fieldSet": if (tainted(o["value"])) { const k = slotKey(o["className"] as string, o["field"] as string); if (!slots.has(k)) { slots.add(k); changed = true; } } break;
          case "recordLit": {
            const sid = (o["type"] as { shapeId?: string } | undefined)?.shapeId;
            for (const fl of (o["fields"] as { name: string; value: unknown }[] | undefined) ?? []) {
              if (sid !== undefined && tainted(fl.value)) { const k = slotKey(sid, fl.name); if (!slots.has(k)) { slots.add(k); changed = true; } }
            }
            break;
          }
          case "call": {
            const callee = fnByName.get(o["callee"] as string);
            const args = (o["args"] as unknown[]) ?? [];
            args.forEach((a, i) => {
              if (!tainted(a)) return;
              if (callee && callee.params[i]) add(params, `${callee.name}#${String(i)}`);
              else note("call-to-unknown");
            });
            break;
          }
          case "callValue": case "virtualCall": case "new": case "dynCall": case "dynInvoke":
            for (const a of (o["args"] as unknown[]) ?? []) if (tainted(a)) note(o.kind as string);
            break;
          case "arraySet": if (tainted(o["value"])) note("arraySet"); break;
          case "arrayLit": for (const el of (o["elems"] as unknown[]) ?? (o["elements"] as unknown[]) ?? []) if (tainted(el)) note("arrayLit"); break;
          default: break;
        }
      });
    }
    // a tainted parameter taints the local that names it
    for (const k of params) {
      const [name, idx] = k.split("#");
      const fn = fnByName.get(name!);
      const p = fn?.params[Number(idx)];
      if (fn && p) { const s = localSet(fn.name); if (!s.has(p.localId)) { s.add(p.localId); changed = true; } }
    }
  }

  // ---- report
  const sigChanged = new Set<string>();
  for (const k of params) sigChanged.add(k.split("#")[0]!);
  for (const r of rets) sigChanged.add(r);
  const originOf = (fn: IrFunction): string => {
    const f = (fn as unknown as { loc?: { file?: string } }).loc?.file ?? "";
    if (f.includes("zapo-rest-mysql")) return "app";
    if (f.includes("/provenance/") && f.includes("zapo")) return "zapo-js";
    if (f.includes("mysql2")) return "mysql2";
    if (f.includes("store-mysql")) return "store-mysql";
    return f === "" ? "?" : "other";
  };
  const byOrigin = new Map<string, number>();
  const taintedLocalCount = [...locals.values()].reduce((a, s) => a + s.size, 0);
  const fnWithLocal = [...locals.entries()].filter(([, s]) => s.size > 0).map(([n]) => n);
  const affected = new Set<string>([...sigChanged, ...fnWithLocal]);
  for (const n of affected) { const fn = fnByName.get(n); if (fn) byOrigin.set(originOf(fn), (byOrigin.get(originOf(fn)) ?? 0) + 1); }
  const w = (s: string): void => { process.stderr.write(`ABSENTTAINT ${s}\n`); };
  w(`functions=${String(functions.length)} dynCheckCrossings=${String(crossings)} recordTargetCrossings=${String(recordCrossings)}`);
  w(`seedSlots=${String(seedSlots.size)} slotsTainted=${String(slots.size)} (propagated beyond seeds: ${String(slots.size - seedCount)})`);
  w(`localsTainted=${String(taintedLocalCount)} paramsTainted=${String(params.size)} returnsTainted=${String(rets.size)}`);
  w(`functionsChangingSignature=${String(sigChanged.size)} functionsWithTaintedLocal=${String(fnWithLocal.length)} affectedFunctions=${String(affected.size)}`);
  w(`affectedByOrigin=${JSON.stringify(Object.fromEntries(byOrigin))}`);
  w(`unresolvedSinks=${String(unresolved)} ${JSON.stringify(Object.fromEntries(unresolvedKinds))}`);
  for (const n of [...affected].sort()) w(`FN ${n} sig=${sigChanged.has(n) ? "1" : "0"}`);
  for (const k of [...params].sort()) w(`PARAM ${k}`);
  for (const k of [...slots].sort()) w(`SLOT ${k} ${seedSlots.has(k) ? "seed" : "flow"}`);
}
export type { IrExpr };
