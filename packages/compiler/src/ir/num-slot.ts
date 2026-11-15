/* NUMBER SLOTS: a checked-dynamic class field whose values are numbers outside the runtime's immortal small-integer range lives as a raw double.
 *
 * A dyn field holding a number holds a pointer to a 40-byte heap node (scr_json.c) that nothing else shares once the value leaves the
 * [-128, 1023] range. For a field that only the constructor writes, with a value that is a property read, an arithmetic result or a large
 * literal, the node is pure overhead: the field is split into TWO slots, its own dyn slot plus a hidden f64 half (IrClassDef.numSlots).
 * A number is stored raw in the half and the dyn slot holds THE immortal marker (scr_numslot_node); every other value is stored in the dyn
 * slot unchanged. A reader answers `slot == marker ? box(half) : retain(slot)`. Release, trace and retain never see the marker as
 * anything but an immortal dyn node, which is why the structural consumers (new, release, trace, clone) need no change; only the readers
 * and writers of the value do (fieldGet, fieldSet, the dyn member row), in both emitters.
 *
 * THE RULE (data-free, no class or field names). A field qualifies when ALL hold:
 *  - it is a dyn-typed, declared (not `%`, `#` or `__@`) field the class itself owns, with no absent/hidden/prototype-data treatment;
 *  - EVERY write to it anywhere in the module is a fieldSet inside its owner's constructor (no other function, no ++/--, no delete, no
 *    write through a subclass), and there is at least one; the synthesized `%C.%dynSet` / `%C.%dynClone` of a boxed class are the one
 *    exception (they write any kind of value and the split handles it, so they do not disqualify);
 *  - EVERY such write stores a value of one of these forms: (a) a property read (`dynKeyGet` with a literal key, or a `fieldGet`) whose
 *    receiver is not `this`; (b) a dyn arithmetic result or a boxed numeric arithmetic; (c) a boxed numeric literal outside [-128, 1023];
 *    NOT a call result, a copy of one of this's own fields, an index read, a parameter or an in-range literal (those are small or unbounded
 *    in kind and a slot would only add a transient box per read);
 *  - some read of the field in the module is a NUMERIC use (an operand of dyn arithmetic or comparison, or a number check): a field that is
 *    only ever a pointer (a buffer, a string) gains nothing from an f64 half;
 *  - no struct view (`%class:<C>` record source) names the class or a descendant, because a view reads the dyn slot at its offset, and no
 *    unionDisc names a field of that name, because it reads the live arm's slot directly (unionKeyGet never reads a class arm).
 *
 * SCRIPTC_NUMSLOT=off disables the pass (the A/B arm). SCRIPTC_NUMSLOT_WHY=1 prints one line per picked field to stderr, and one line per
 * constructor-written candidate field that was refused, with the reason. */

import type { IrClassDef, IrExpr, IrFunction, IrModule } from "./nodes.js";

const NUM_USE_FNS: ReadonlySet<string> = new Set(["dyn.add", "dyn.lt", "dyn.le", "dyn.gt", "dyn.ge", "dyn.toNumber", "dyn.numberOf"]);
const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);
const SMALL_LO = -128;
const SMALL_HI = 1023;

type Rule = "a" | "b" | "c";

function isThis(e: IrExpr): boolean {
  return e.kind === "varRef" && e.localId.startsWith("this.");
}

function ruleOf(v: IrExpr): Rule | null {
  switch (v.kind) {
    case "dynKeyGet":
      return v.key.kind === "strLit" && !isThis(v.value) ? "a" : null;
    case "fieldGet":
      return v.type.kind === "dyn" && !isThis(v.obj) ? "a" : null;
    case "libCall":
      return v.fn === "dyn.add" ? "b" : null;
    case "dynFrom": {
      const x = v.value;
      if (x.kind === "numLit") {
        const n = x.value;
        return !Number.isInteger(n) || n < SMALL_LO || n > SMALL_HI || Object.is(n, -0) ? "c" : null;
      }
      return x.kind === "bin" && ARITH_OPS.has(x.op) && x.type.kind === "f64" ? "b" : null;
    }
    default:
      return null;
  }
}

interface FieldFacts {
  ctorWrites: IrExpr[];
  other: boolean;
  numericUse: boolean;
}

export interface NumSlotPick {
  className: string;
  field: string;
  rule: string;
}

export function numSlotPass(mod: IrModule): NumSlotPick[] {
  const classes = mod.classes ?? [];
  if (process.env["SCRIPTC_NUMSLOT"] === "off" || classes.length === 0) return [];
  if (classes.some((c) => c.numSlots !== undefined)) return []; // idempotent: a module re-read from its kept IR already carries the split
  const why = process.env["SCRIPTC_NUMSLOT_WHY"] === "1";
  const byName = new Map<string, IrClassDef>(classes.map((c) => [c.name, c]));
  const origFields = new Map<string, IrClassDef["fields"]>(classes.map((c) => [c.name, c.fields]));

  /** The class that DECLARES `field` (the topmost base of `className` whose layout lists it). */
  const ownerOf = (className: string, field: string): string | null => {
    let cur = byName.get(className);
    if (cur === undefined || !cur.fields.some((f) => f.name === field)) return null;
    let owner = cur.name;
    while (cur.base !== undefined) {
      const b = byName.get(cur.base);
      if (b === undefined || !b.fields.some((f) => f.name === field)) break;
      owner = b.name;
      cur = b;
    }
    return owner;
  };

  const facts = new Map<string, FieldFacts>();
  const factsOf = (owner: string, field: string): FieldFacts => {
    const k = `${owner}\0${field}`;
    let f = facts.get(k);
    if (f === undefined) {
      f = { ctorWrites: [], other: false, numericUse: false };
      facts.set(k, f);
    }
    return f;
  };
  const viewed = new Set<string>();
  /** Field names read by unionDisc (it reads the slot of whichever arm is live, class arms included). unionKeyGet reads only record and array arms: the emitters refuse a class arm there. */
  const unionRead = new Set<string>();

  const noteRead = (e: IrExpr): void => {
    if (e.kind !== "fieldGet" || e.type.kind !== "dyn") return;
    const o = ownerOf(e.className, e.field);
    if (o !== null) factsOf(o, e.field).numericUse = true;
  };

  const walk = (n: unknown, fn: IrFunction): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, fn);
      return;
    }
    const node = n as Record<string, unknown>;
    const kind = node["kind"];
    if (kind === "fieldSet" || kind === "fieldIncDec") {
      const className = node["className"] as string;
      const field = node["field"] as string;
      const owner = ownerOf(className, field);
      if (owner !== null) {
        const f = factsOf(owner, field);
        if (kind === "fieldSet" && node["unset"] !== true && fn.name === `%${owner}.constructor`) f.ctorWrites.push(node["value"] as IrExpr);
        // The synthesized dyn [[Set]] and clone of a boxed class write every field with an arbitrary value; a slot field takes any kind, so
        // they neither qualify nor disqualify (the emitters' fieldSet and fieldGet handle the split like any other site).
        else if (kind === "fieldSet" && node["unset"] !== true && (fn.name.endsWith(".%dynSet") || fn.name.endsWith(".%dynClone"))) void 0;
        else f.other = true;
      }
    } else if (kind === "unionDisc" && typeof node["field"] === "string") {
      unionRead.add(node["field"]);
    } else if (kind === "libCall" && NUM_USE_FNS.has(node["fn"] as string)) {
      for (const a of node["args"] as IrExpr[]) noteRead(a);
    } else if (kind === "dynCheck" && (node["type"] as { kind: string }).kind === "f64") {
      noteRead(node["value"] as IrExpr);
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") {
        if (v.startsWith("%class:")) viewed.add(v.slice(7));
      } else if (v !== null && typeof v === "object") walk(v, fn);
    }
  };
  for (const fn of mod.functions) walk(fn.body, fn);

  /** `c` is `anc` or descends from it. */
  const descendsFrom = (c: string, anc: string): boolean => {
    for (let cur = byName.get(c); cur !== undefined; cur = cur.base === undefined ? undefined : byName.get(cur.base)) {
      if (cur.name === anc) return true;
    }
    return false;
  };

  const picks: NumSlotPick[] = [];
  const halves = new Map<string, { field: string; half: string }[]>();
  for (const c of classes) {
    if (c.runtime === true) continue;
    for (const f of c.fields) {
      if (f.type.kind !== "dyn") continue;
      if (f.name.startsWith("%") || f.name.startsWith("#") || f.name.startsWith("__@")) continue;
      if (ownerOf(c.name, f.name) !== c.name) continue;
      const refuse = (reason: string): void => {
        if (why && facts.get(`${c.name}\0${f.name}`)?.ctorWrites.length) process.stderr.write(`numslot: refuse ${c.name}.${f.name}: ${reason}\n`);
      };
      const ff = facts.get(`${c.name}\0${f.name}`);
      if (ff === undefined || ff.ctorWrites.length === 0) continue;
      if (ff.other) {
        refuse("written outside the constructor");
        continue;
      }
      if (c.absentInit?.includes(f.name) || c.absentFields?.includes(f.name) || c.hiddenFields?.includes(f.name) || c.dynFieldData?.some((d) => d.name === f.name)) {
        refuse("absent/hidden/prototype-data field");
        continue;
      }
      if (unionRead.has(f.name)) {
        refuse("the field name is read through a union arm");
        continue;
      }
      if ([...viewed].some((v) => descendsFrom(v, c.name))) {
        refuse("a struct view reads the class");
        continue;
      }
      let rule: Rule | null = null;
      let ok = true;
      for (const w of ff.ctorWrites) {
        const r = ruleOf(w);
        if (r === null) {
          ok = false;
          break;
        }
        rule = rule ?? r;
      }
      if (!ok || rule === null) {
        refuse("a constructor write stores a call result, a copy, an index read, a parameter or an in-range literal");
        continue;
      }
      if (!ff.numericUse) {
        refuse("no numeric use of any read (a pointer-only field gains nothing)");
        continue;
      }
      picks.push({ className: c.name, field: f.name, rule });
      const l = halves.get(c.name) ?? [];
      l.push({ field: f.name, half: `%ns:${f.name}` });
      halves.set(c.name, l);
    }
  }
  if (picks.length === 0) return [];

  // Rebuild every layout base-first: base layout, the class's own original fields, then its own halves (the prefix property holds).
  const done = new Map<string, IrClassDef["fields"]>();
  const slotsOf = new Map<string, { field: string; half: string }[]>();
  const rebuild = (c: IrClassDef): void => {
    if (done.has(c.name)) return;
    const base = c.base === undefined ? undefined : byName.get(c.base);
    if (base !== undefined) rebuild(base);
    const orig = origFields.get(c.name)!;
    const own = base === undefined ? orig : orig.slice(origFields.get(base.name)!.length);
    const mine = halves.get(c.name) ?? [];
    c.fields = [...(base === undefined ? [] : done.get(base.name)!), ...own, ...mine.map((m) => ({ name: m.half, type: { kind: "f64" as const } }))];
    done.set(c.name, c.fields);
    const all = [...(base === undefined ? [] : (slotsOf.get(base.name) ?? [])), ...mine];
    if (all.length > 0) {
      c.numSlots = all;
      slotsOf.set(c.name, all);
    }
  };
  for (const c of classes) rebuild(c);
  if (why) for (const p of picks) process.stderr.write(`numslot: pick ${p.className}.${p.field} (rule ${p.rule})\n`);
  return picks;
}
