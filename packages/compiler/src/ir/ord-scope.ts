/* ORDER-RECORD SCOPE ANALYSIS (report only; nothing is rewritten). A JS class's INFERRED fields (IrClassDef.ordered) take their key order from a per-instance
 * record (`sc_ord`: 1 + n bytes per instance, orderRecordPlanOf). The question this answers: for which classes is that order provably the same on every instance,
 * so the record could become a per-class constant, and how much of it is a provable constant PREFIX when the whole is not.
 *
 *  - PREFIX of a class's constructor: the statements from the top that are straight-line (no branch, loop, try, return, call that is handed `this`), in which an
 *    inferred field is written by a top-level `this.f = v`. Every instance that finishes construction wrote those fields, in that order, before anything else
 *    could observe them (nothing in the prefix lets `this` escape), so their order is a per-class constant.
 *  - A field is FIXED when its first write is in that prefix and no write anywhere (any function) is a `delete` of it. Every other written inferred field is LATE:
 *    written under a condition, after an escape point, or in another function (a method, a getter, a subclass constructor).
 *  - STRICT: the class is standalone (no base, nobody extends it), has no LATE field and no delete: the whole record is then a constant.
 * SCRIPTC_ORDSCOPE=1 prints one `ORDSCOPE class=<name> k=<index> root=<root> names=<n> rec=<bytes> fixed=<f> late=<l> deletes=<d> standalone=<0|1> strict=<0|1>
 * late-fields=[...]` line per class that owns an order record, and the emitters count the instances of each class (tests/perf/labord/scr_labord.h). */
import type { IrFunction, IrModule } from "./nodes.js";
import { orderRecordPlanOf } from "./nodes.js";

export interface OrdScope {
  className: string;
  root: string;
  names: number;
  recBytes: number;
  fixed: string[];
  late: string[];
  deletes: string[];
  standalone: boolean;
  strict: boolean;
}

const isThis = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { kind?: string }).kind === "varRef" && String((e as { localId?: string }).localId).startsWith("this.");

/** Does `n` hand `this` to anything (a call argument, a receiver, a stored value)? A read of one of its own fields does not. */
function escapesThis(n: unknown): boolean {
  if (n === null || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some(escapesThis);
  const node = n as Record<string, unknown>;
  if (isThis(node)) return true;
  for (const k of Object.keys(node)) {
    if (node["kind"] === "fieldGet" && k === "obj" && isThis(node[k])) continue;
    if (escapesThis(node[k])) return true;
  }
  return false;
}

export function ordScope(mod: IrModule): OrdScope[] {
  const classes = mod.classes ?? [];
  if (classes.length === 0) return [];
  const plan = orderRecordPlanOf(classes);
  const extended = new Set<string>();
  for (const c of classes) if (c.base !== undefined) extended.add(c.base);
  const fnByName = new Map<string, IrFunction>(mod.functions.map((f) => [f.name, f]));
  const deletes = new Map<string, Set<string>>(); // root -> fields
  const writers = new Map<string, Map<string, Set<string>>>(); // root -> field -> function names that write it
  const walk = (n: unknown, fn: IrFunction): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x, fn); return; }
    const node = n as Record<string, unknown>;
    if (node["kind"] === "fieldSet" && typeof node["className"] === "string") {
      const root = plan.rootOf(node["className"]);
      const field = node["field"] as string;
      if (root !== null && plan.ordinalOf(node["className"], field) !== null) {
        if (node["unset"] === true) (deletes.get(root) ?? deletes.set(root, new Set()).get(root)!).add(field);
        const m = writers.get(root) ?? writers.set(root, new Map()).get(root)!;
        (m.get(field) ?? m.set(field, new Set()).get(field)!).add(fn.name);
      }
    }
    for (const k of Object.keys(node)) { const v = node[k]; if (v !== null && typeof v === "object") walk(v, fn); }
  };
  for (const fn of mod.functions) walk(fn.body, fn);

  const out: OrdScope[] = [];
  for (const c of classes) {
    const rec = plan.recordBytes(c.name);
    if (rec === 0) continue;
    const root = plan.rootOf(c.name)!;
    if (root !== c.name) continue; // the record lives in the root; subclasses share it (reported through the root's instance count plus theirs)
    const names = plan.namesOf(c.name);
    const ctor = fnByName.get(`%${c.name}.constructor`);
    const prefixFixed: string[] = [];
    let ctorFixedWriters = new Set<string>();
    if (ctor !== undefined && Array.isArray(ctor.body)) {
      for (const st of ctor.body as unknown as Record<string, unknown>[]) {
        const kind = st["kind"];
        if (kind === "fieldSet" && isThis(st["obj"]) && st["unset"] !== true) {
          if (escapesThis(st["value"])) break;
          const f = st["field"] as string;
          if (plan.ordinalOf(c.name, f) !== null && !prefixFixed.includes(f)) prefixFixed.push(f);
        } else if ((kind === "varDecl" || kind === "assign" || kind === "exprStmt") && !escapesThis(st)) continue;
        else break;
      }
      ctorFixedWriters = new Set([ctor.name]);
    }
    const fixed: string[] = [];
    const late: string[] = [];
    for (const f of names) {
      const ws = writers.get(root)?.get(f);
      if (ws === undefined) continue; // never written: absent on every instance
      const onlyCtorPrefix = prefixFixed.includes(f) && [...ws].every((w) => ctorFixedWriters.has(w));
      // a field the constructor's prefix writes first may still be rewritten later (same key, same place): the order is fixed by the FIRST write
      const firstInPrefix = prefixFixed.includes(f);
      if ((onlyCtorPrefix || firstInPrefix) && !(deletes.get(root)?.has(f) ?? false)) fixed.push(f);
      else late.push(f);
    }
    const standalone = c.base === undefined && !extended.has(c.name);
    out.push({ className: c.name, root, names: names.length, recBytes: rec, fixed, late, deletes: [...(deletes.get(root) ?? [])], standalone, strict: standalone && late.length === 0 && (deletes.get(root)?.size ?? 0) === 0 });
  }
  return out;
}

/** Index of each class with a record, in module order: the counter slot the emitters use. */
export function reportOrdScope(mod: IrModule): void {
  if (process.env["SCRIPTC_ORDSCOPE"] !== "1") return;
  let k = 0;
  for (const s of ordScope(mod)) {
    process.stderr.write(`ORDSCOPE class=${s.className} k=${k++} root=${s.root} names=${s.names} rec=${s.recBytes} fixed=${s.fixed.length} late=${s.late.length} deletes=${s.deletes.length} standalone=${s.standalone ? 1 : 0} strict=${s.strict ? 1 : 0} late-fields=[${s.late.join(",")}]\n`);
  }
}

const slotMemo = new WeakMap<IrModule, Map<string, number>>();
/** The counter slot of the record root of `className` (the same index reportOrdScope prints), or -1. Only meaningful under SCRIPTC_ORDSCOPE=1. */
export function ordScopeSlot(mod: IrModule, className: string): number {
  if (process.env["SCRIPTC_ORDSCOPE"] !== "1") return -1;
  let m = slotMemo.get(mod);
  if (m === undefined) {
    m = new Map();
    let k = 0;
    for (const s of ordScope(mod)) m.set(s.className, k++);
    slotMemo.set(mod, m);
  }
  const root = orderRecordPlanOf(mod.classes ?? []).rootOf(className);
  return root === null ? -1 : (m.get(root) ?? -1);
}
