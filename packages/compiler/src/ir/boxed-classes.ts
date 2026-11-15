/* WHICH CLASSES CAN BE BOXED INTO DYN, decided before any struct is laid out.
 *
 * A class instance that crosses into the checked-dynamic tree is a SCR_DYN_OBJINST node pointing at it. A standalone class with a cycle header
 * can instead carry the dyn head itself (rc, kind, class index) so the instance IS its dyn value: no node. That costs one word on EVERY instance,
 * so only a class the program can box pays it. This pass answers "can box" as an over-approximation, which is safe in both directions: a class
 * in the answer that is never boxed pays one word for nothing, and a class missing from it still boxes (the runtime then allocates the
 * stand-alone node, exactly as before). Soundness never depends on this answer.
 *
 * The roots are the TYPES of every dyn conversion in the program (`dynFrom` value types, `dynCheck` target types); the closure then follows the
 * type structure the runtime's converters follow: a record, union, array, map, set, promise or function type reaches the classes it names, and
 * a class reaches the classes its fields name (a boxed instance's member table boxes a class-typed field lazily). */
import type { IrClassDef, IrModule, IrRecordShape, IrType, IrUnionDef } from "./nodes.js";

export function boxedClassNames(mod: IrModule): Set<string> {
  const classes = new Map<string, IrClassDef>();
  for (const c of mod.classes ?? []) classes.set(c.name, c);
  const records = new Map<string, IrRecordShape>();
  for (const r of mod.records ?? []) records.set(r.id, r);
  const unions = new Map<string, IrUnionDef>();
  for (const u of mod.unions ?? []) unions.set(u.id, u);

  const out = new Set<string>();
  const seenRec = new Set<string>();
  const seenUni = new Set<string>();
  const visit = (t: IrType | undefined): void => {
    if (t === undefined) return;
    const k = t as Record<string, unknown>;
    switch (t.kind) {
      case "object": {
        const name = (t as { className: string }).className;
        if (out.has(name)) return;
        out.add(name);
        for (const f of classes.get(name)?.fields ?? []) visit(f.type);
        return;
      }
      case "record": {
        const id = (t as { shapeId: string }).shapeId;
        if (seenRec.has(id)) return;
        seenRec.add(id);
        for (const f of records.get(id)?.fields ?? []) visit(f.type);
        return;
      }
      case "union": {
        const id = (t as { unionId: string }).unionId;
        if (seenUni.has(id)) return;
        seenUni.add(id);
        for (const a of unions.get(id)?.arms ?? []) visit(a);
        return;
      }
      default:
        // array / set / map / weakmap / promise / func: follow every type-valued member structurally
        for (const key of ["elem", "key", "value", "inner", "ret"]) {
          const v = k[key];
          if (v !== null && typeof v === "object" && "kind" in (v as object)) visit(v as IrType);
        }
        if (Array.isArray(k["params"])) for (const p of k["params"] as unknown[]) {
          if (p !== null && typeof p === "object" && "kind" in (p as object)) visit(p as IrType);
        }
    }
  };

  // The roots: every dyn conversion's source or target type, found by a structural walk (IrExpr has more arms than anyone should enumerate).
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const rec = n as Record<string, unknown>;
    if (rec["kind"] === "dynFrom") {
      const v = rec["value"] as { type?: IrType } | undefined;
      visit(v?.type);
    } else if (rec["kind"] === "dynCheck") {
      visit(rec["type"] as IrType | undefined);
    }
    for (const key in rec) walk(rec[key]);
  };
  for (const fn of mod.functions) walk(fn.body);
  return out;
}

/** The classes that carry the dyn head, with their class-table index (declaration order, so both backends agree). A class qualifies when it is
 * standalone (no base, no subclass, not runtime-provided), cycle-headered (traced) and boxable, AND the program can box it (boxedClassNames).
 * The index fits the 15 bits of the head's class slot; a program with more qualifying classes simply stops assigning (the rest keep stand-alone nodes). */
export const HEAD_CLASS_MAX = 0x7fff;
export function headClassPlan(
  mod: IrModule,
  isStandalone: (className: string) => boolean,
  isTraced: (className: string) => boolean,
  canBox: (className: string) => boolean,
): Map<string, number> {
  const plan = new Map<string, number>();
  if (process.env["SCRIPTC_NO_OBJ_HEAD"] === "1") return plan; // A/B control
  const boxed = boxedClassNames(mod);
  for (const c of mod.classes ?? []) {
    if (c.runtime || !boxed.has(c.name) || !isStandalone(c.name) || !isTraced(c.name) || !canBox(c.name)) continue;
    if (plan.size >= HEAD_CLASS_MAX) break;
    plan.set(c.name, plan.size);
  }
  return plan;
}
