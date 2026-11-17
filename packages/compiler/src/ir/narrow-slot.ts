/* NARROW SLOTS, SCOPE ANALYSIS (report only; nothing is rewritten). Which standalone classes would take narrow numeric slots, by the rule the F1 design uses:
 * the number-slot facts (ir/num-slot.ts) with the SOURCE restriction relaxed, because a narrow slot stores whatever kind arrives (a non-number goes to the
 * overflow block), so a call result or a parameter qualifies once a read proves the field numeric.
 *
 *  - the class is standalone (no base, nobody extends it) and not runtime-provided;
 *  - the field is a dyn-typed declared field the class owns (not `%`/`#`/`__@`), with no absent/hidden/prototype-data treatment;
 *  - EVERY write is a fieldSet in the owner's constructor, or the synthesized `%C.%dynSet` / `%C.%dynClone` of a boxed class; at least one constructor write;
 *  - NUMERIC by use: some read of the field is an operand of dyn arithmetic / comparison / a number check, or a constructor write is an arithmetic /
 *    large-literal store, or a property read of a property the program writes as a number;
 *  - no struct view (`%class:<C>`) names the class, no unionDisc names the field.
 * A class is worth a narrow block when it has at least NARROW_MIN_FIELDS such fields (the mask word and the overflow pointer cost 16 B).
 * SCRIPTC_NARROW_WHY=1 prints one `NARROW class <name> fields=<n> [<list>]` line per class with at least one eligible field, and a refusal line per
 * constructor-written dyn field of an otherwise standalone class that failed a condition, with the reason. */
import type { IrClassDef, IrExpr, IrFunction, IrModule } from "./nodes.js";

export const NARROW_MIN_FIELDS = 4;
const NUM_USE_FNS: ReadonlySet<string> = new Set(["dyn.add", "dyn.lt", "dyn.le", "dyn.gt", "dyn.ge", "dyn.toNumber", "dyn.numberOf"]);
const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);

interface Facts {
  ctorWrites: IrExpr[];
  other: boolean;
  numericUse: boolean;
}

export interface NarrowScope {
  className: string;
  eligible: string[];
  refused: { field: string; reason: string }[];
}

export function narrowSlotScope(mod: IrModule): NarrowScope[] {
  const classes = mod.classes ?? [];
  const byName = new Map<string, IrClassDef>(classes.map((c) => [c.name, c]));
  const extended = new Set<string>();
  for (const c of classes) if (c.base !== undefined) extended.add(c.base);
  const facts = new Map<string, Facts>();
  const factsOf = (cls: string, field: string): Facts => {
    const k = `${cls}\0${field}`;
    let f = facts.get(k);
    if (f === undefined) facts.set(k, (f = { ctorWrites: [], other: false, numericUse: false }));
    return f;
  };
  const viewed = new Set<string>();
  const unionRead = new Set<string>();
  const numericProps = new Set<string>();
  for (const c of classes) for (const f of c.fields) if (f.type.kind === "f64" && !f.name.startsWith("%")) numericProps.add(f.name);

  const noteRead = (e: IrExpr): void => {
    if (e.kind === "fieldGet" && e.type.kind === "dyn") factsOf(e.className, e.field).numericUse = true;
  };
  const isThis = (e: IrExpr): boolean => e.kind === "varRef" && e.localId.startsWith("this.");
  const numericSource = (w: IrExpr): boolean => {
    if (w.kind === "dynFrom") {
      const x = w.value;
      if (x.kind === "numLit") return true;
      return x.kind === "bin" && ARITH_OPS.has(x.op) && x.type.kind === "f64";
    }
    if (w.kind === "libCall" && w.fn === "dyn.add") return true;
    if (w.kind === "dynKeyGet" && w.key.kind === "strLit" && !isThis(w.value)) return numericProps.has(w.key.value);
    if (w.kind === "fieldGet" && w.type.kind === "dyn" && !isThis(w.obj)) return numericProps.has(w.field);
    return false;
  };

  const walk = (n: unknown, fn: IrFunction): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, fn);
      return;
    }
    const node = n as Record<string, unknown>;
    const kind = node["kind"];
    if (kind === "fieldIncDec") numericProps.add(node["field"] as string);
    else if (kind === "fieldSet" && node["unset"] !== true) {
      const wv = node["value"] as IrExpr;
      if (numericSource(wv) || wv.type.kind === "f64") numericProps.add(node["field"] as string);
    }
    if (kind === "fieldSet" || kind === "fieldIncDec") {
      const cls = node["className"] as string;
      const field = node["field"] as string;
      const f = factsOf(cls, field);
      if (kind === "fieldSet" && node["unset"] !== true && fn.name === `%${cls}.constructor`) f.ctorWrites.push(node["value"] as IrExpr);
      else if (kind === "fieldSet" && node["unset"] !== true && (fn.name.endsWith(".%dynSet") || fn.name.endsWith(".%dynClone"))) void 0;
      else f.other = true;
    } else if (kind === "unionDisc" && typeof node["field"] === "string") unionRead.add(node["field"]);
    else if (kind === "libCall" && NUM_USE_FNS.has(node["fn"] as string)) for (const a of node["args"] as IrExpr[]) noteRead(a);
    else if (kind === "dynCheck" && (node["type"] as { kind: string }).kind === "f64") noteRead(node["value"] as IrExpr);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") {
        if (v.startsWith("%class:")) viewed.add(v.slice(7));
      } else if (v !== null && typeof v === "object") walk(v, fn);
    }
  };
  for (const fn of mod.functions) walk(fn.body, fn);

  const out: NarrowScope[] = [];
  for (const c of classes) {
    if (c.runtime === true || c.base !== undefined || extended.has(c.name) || byName.get(c.name) === undefined) continue;
    const eligible: string[] = [];
    const refused: { field: string; reason: string }[] = [];
    for (const f of c.fields) {
      if (f.type.kind !== "dyn" || f.name.startsWith("%") || f.name.startsWith("#") || f.name.startsWith("__@")) continue;
      const ff = facts.get(`${c.name}\0${f.name}`);
      if (ff === undefined || ff.ctorWrites.length === 0) continue;
      const no = (reason: string): void => void refused.push({ field: f.name, reason });
      if (ff.other) no("written outside the constructor");
      else if (c.absentInit?.includes(f.name) || c.absentFields?.includes(f.name) || c.hiddenFields?.includes(f.name) || c.dynFieldData?.some((d) => d.name === f.name)) no("absent/hidden/prototype-data field");
      else if (unionRead.has(f.name)) no("read through a union arm");
      else if (viewed.has(c.name)) no("a struct view reads the class");
      else if (!ff.numericUse && !ff.ctorWrites.some(numericSource)) no("no numeric use of any read and no numeric source");
      else eligible.push(f.name);
    }
    if (eligible.length > 0 || refused.length > 0) out.push({ className: c.name, eligible, refused });
  }
  return out;
}

export function reportNarrowScope(mod: IrModule): void {
  if (process.env["SCRIPTC_NARROW_WHY"] !== "1") return;
  for (const s of narrowSlotScope(mod)) {
    if (s.eligible.length > 0) process.stderr.write(`NARROW class ${s.className} fields=${s.eligible.length}${s.eligible.length >= NARROW_MIN_FIELDS ? " WORTH" : ""} [${s.eligible.join(",")}]\n`);
    for (const r of s.refused) process.stderr.write(`NARROW refuse ${s.className}.${r.field}: ${r.reason}\n`);
  }
}

export const NARROW_MAX_FIELDS = 16; // the presence mask is 16 bits

/** The pass: every standalone class with at least NARROW_MIN_FIELDS eligible fields keeps those fields in its layout list but gives them no storage (IrClassDef.narrow).
 * SCRIPTC_NARROW=off disables it (the A/B arm); a second run over an already narrowed module is a no-op. Returns the picks as "Class.field". */
export function narrowSlotPass(mod: IrModule): string[] {
  const classes = mod.classes ?? [];
  if (process.env["SCRIPTC_NARROW"] === "off" || classes.length === 0) return [];
  if (classes.some((c) => c.narrow !== undefined)) return [];
  const why = process.env["SCRIPTC_NARROW_WHY"] === "1";
  const picks: string[] = [];
  for (const sc of narrowSlotScope(mod)) {
    if (sc.eligible.length < NARROW_MIN_FIELDS) continue;
    const def = classes.find((c) => c.name === sc.className);
    if (def === undefined) continue;
    const fields = sc.eligible.slice(0, NARROW_MAX_FIELDS);
    const lanes: string[] = [];
    for (let k = 0; k < Math.ceil(fields.length / 2); k++) lanes.push(`%nwl:${def.name}:${k}`);
    const mask = `%nwm:${def.name}`;
    const ext = `%nwx:${def.name}`;
    def.fields = [...def.fields, ...lanes.map((n) => ({ name: n, type: { kind: "f64" as const } })), { name: mask, type: { kind: "f64" as const } }, { name: ext, type: { kind: "dyn" as const } }];
    def.narrow = { fields, lanes, mask, ext };
    for (const f of fields) picks.push(`${def.name}.${f}`);
    if (why) process.stderr.write(`narrow: pick ${def.name} (${fields.length} fields: ${fields.join(",")})\n`);
  }
  return picks;
}
