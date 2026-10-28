/** Closed-world fence on checked casts from `unknown` into DATA records whose
 * field name collides with an accessor a crossed object answers live.
 *
 * An object-literal accessor crosses into a dyn value as a LIVE accessor
 * (emit-walkers.ts / llvm/dyn.ts install it with scr_dyn_obj_define_accessor).
 * A checked cast of such a value into a DATA record copies each member when
 * the cast runs, a record being a struct, so a getter the program later
 * changes is answered stale (`m.get(k) as { available: number }` after a
 * mutation). That copy is exact for every value that does not alias a getter,
 * so it is refused only where it can receive one of those objects: a target
 * data field whose name is an accessor key of a crossing shape AND whose type
 * is compatible with that getter's result.
 *
 * The set A is the accessor (key, shape) pairs of the record shapes a dyn
 * conversion reaches: the source type of every dynFrom node in the lowered
 * module, followed through record fields, array elements, union arms and
 * index values, filtered to shapes the converter walks (accessorShapeCrosses).
 * An accessor shape no dynFrom reaches never crosses, so it fences nothing.
 * The check runs once, after the whole module is lowered, over every
 * dynCheck node, so a cast in any function of the module is seen. A refusal
 * is a named compile error (the module is withdrawn), never a runtime throw.
 * Limit: a conversion the backend emits without a dynFrom node (a closure's
 * own parameters crossing when the closure is boxed) is not in A. The fence
 * covers the IR-level crossings this slice creates.
 */
import { accessorShapeCrosses, accessorSlotProp, typeKey, UNDEFINED_T, type IrType, type IrModule, type IrRecordShape, type SrcLoc } from "../../ir/nodes.js";
import type { ScrDiagnostic } from "../../diagnostics/diagnostic.js";
import { unsupportedDiag } from "../../diagnostics/diagnostic.js";

export interface DynRecordFenceHost {
  shapeGet(id: string): IrRecordShape | undefined;
  unionGet?(id: string): { arms: IrType[] } | undefined;
}

interface Crossing {
  key: string;
  shapeId: string;
  getType: IrType; // the getter's result (undefined for a setter-only property)
}

/** The shapes a dyn conversion can reach: every record shape named by the
 * source type of a dynFrom node, through record fields, array elements, union
 * arms and index values. An accessor shape outside this set never crosses, so
 * its keys are not a crossing (a program's unrelated getters do not fence it). */
function reachableShapes(host: DynRecordFenceHost, t: IrType, out: Set<string>, seen: Set<string>): void {
  if (t.kind === "array") return reachableShapes(host, t.elem, out, seen);
  if (t.kind === "promise") return reachableShapes(host, t.inner, out, seen);
  if (t.kind === "union") {
    if (seen.has(`u:${t.unionId}`)) return;
    seen.add(`u:${t.unionId}`);
    for (const a of host.unionGet?.(t.unionId)?.arms ?? []) reachableShapes(host, a, out, seen);
    return;
  }
  if (t.kind !== "record") return;
  if (seen.has(`r:${t.shapeId}`)) return;
  seen.add(`r:${t.shapeId}`);
  const shape = host.shapeGet(t.shapeId);
  if (!shape) return;
  out.add(shape.id);
  for (const f of shape.fields) reachableShapes(host, f.type, out, seen);
  if (shape.indexValue !== undefined) reachableShapes(host, shape.indexValue, out, seen);
}

/** A = (key, shape, getter result type) for every accessor of a shape that a
 * dyn conversion reaches and that the converter walks (accessorShapeCrosses). */
export function crossingAccessors(host: DynRecordFenceHost, mod: IrModule): Crossing[] {
  const converted = new Set<string>();
  const seen = new Set<string>();
  const sources: IrType[] = [];
  const visitConv = (v: unknown, seenObj: Set<object>): void => {
    if (v === null || typeof v !== "object" || seenObj.has(v)) return;
    seenObj.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "dynFrom") {
      const val = o["value"] as { type?: IrType } | undefined;
      if (val?.type !== undefined) sources.push(val.type);
    }
    if (Array.isArray(v)) for (const x of v) visitConv(x, seenObj);
    else for (const x of Object.values(o)) visitConv(x, seenObj);
  };
  visitConv(mod.functions, new Set());
  visitConv(mod.classes ?? [], new Set());
  visitConv(mod.globals ?? [], new Set());
  for (const t of sources) reachableShapes(host, t, converted, seen);
  const out: Crossing[] = [];
  for (const shapeId of converted) {
    const shape = host.shapeGet(shapeId);
    if (shape === undefined || !accessorShapeCrosses(shape)) continue;
    const getters = new Map<string, IrType>();
    const setters = new Set<string>();
    for (const f of shape.fields) {
      const acc = accessorSlotProp(f.name);
      if (acc === null) continue;
      if (acc.kind === "get" && f.type.kind === "func") getters.set(acc.prop, f.type.ret);
      if (acc.kind === "set") setters.add(acc.prop);
    }
    for (const [key, ret] of getters) out.push({ key, shapeId: shape.id, getType: ret });
    for (const key of setters) if (!getters.has(key)) out.push({ key, shapeId: shape.id, getType: UNDEFINED_T });
  }
  return out;
}

export function fenceDynRecordCasts(
  host: DynRecordFenceHost,
  mod: IrModule,
  pushDiag: (d: ScrDiagnostic) => void,
): number {
  const A = crossingAccessors(host, mod);
  if (A.length === 0) return 0;
  let refused = 0;
  const byKey = new Map<string, Crossing[]>();
  for (const c of A) {
    const l = byKey.get(c.key);
    if (l) l.push(c); else byKey.set(c.key, [c]);
  }
  const unionHas = (u: IrType & { kind: "union" }, got: IrType): boolean => {
    const def = host.unionGet?.(u.unionId);
    if (!def) return true; // unknown union: refuse conservatively
    return def.arms.some((a) => a.kind === "dyn" || typeKey(a) === typeKey(got) || (got.kind === "undefinedT" && a.kind === "undefinedT"));
  };
  const fits = (want: IrType, got: IrType): boolean => {
    if (want.kind === "dyn" || got.kind === "dyn") return true;
    if (typeKey(want) === typeKey(got)) return true;
    if (want.kind === "union") return unionHas(want, got);
    return false;
  };
  // Every accessor-bearing target a data record can reach, through records,
  // arrays and union arms, with the path to it (for the message).
  const seenShapes = new Set<string>();
  const hits = (t: IrType, path: string, out: string[]): void => {
    if (t.kind === "array") return hits(t.elem, `${path}[]`, out);
    if (t.kind === "union") {
      if (seenShapes.has(`u:${t.unionId}`)) return;
      seenShapes.add(`u:${t.unionId}`);
      const def = host.unionGet?.(t.unionId);
      for (const a of def?.arms ?? []) hits(a, path, out);
      return;
    }
    if (t.kind !== "record") return;
    const shape = host.shapeGet(t.shapeId);
    if (!shape) return;
    // A shape is visited ONCE per check (recursive shapes terminate); the first
    // hit names the site, so a second route to the same shape adds nothing.
    if (!seenShapes.has(shape.id)) {
      seenShapes.add(shape.id);
      for (const f of shape.fields) {
        if (accessorSlotProp(f.name) !== null) continue;
        const cs = byKey.get(f.name);
        if (cs) {
          for (const c of cs) {
            if (fits(f.type, c.getType)) out.push(`'${f.name}' of ${path} against accessor '${c.key}' of ${c.shapeId}`);
          }
        }
        hits(f.type, `${path}.${f.name}`, out);
      }
    }
  };
  // The generic walk: every object with kind "dynCheck" and a record-bearing
  // target. The module is plain data, so one reflective pass reaches every
  // site without a visitor per IR kind.
  const seenObj = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (seenObj.has(v)) return;
    seenObj.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "dynCheck" && o["type"] !== undefined) {
      const target = o["type"] as IrType;
      const reasons: string[] = [];
      hits(target, "the target", reasons);
      if (reasons.length > 0) {
        refused++;
        const loc = o["loc"] as SrcLoc;
        pushDiag(unsupportedDiag(
          "SC1090",
          loc,
          `a checked cast of 'unknown' into a DATA record whose field is also a live accessor on a crossed object: ` +
            `${reasons[0]}. The cast copies the member when it runs, so a later change to the getter would be answered stale. ` +
            `Read the accessor's value into a const and cast that instead.`,
        ));
      }
    }
    if (Array.isArray(v)) for (const x of v) visit(x);
    else for (const x of Object.values(o)) visit(x);
  };
  visit(mod.functions);
  visit(mod.classes ?? []);
  visit(mod.globals ?? []);
  return refused;
}
