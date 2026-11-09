/* MEASUREMENT ONLY (block/promo): the field-promotion census.
 * SCRIPTC_PROMO_CENSUS=<path> writes one JSON object describing, per class field held in a checked-dynamic slot, what every `fieldSet` of
 * it in the finished module stores BEFORE the box: the type a typed value had when it was boxed (`box:<typeKey>`), a self update
 * (`self:<op>` over a typed operand), a copy of the field itself, an untyped local or parameter (`dyn-flow`), or something else
 * (`other:<kind>`). A field is a promotion CANDIDATE when its writes all box one type T (or update themselves with T operands), and a
 * dyn-flow write is counted separately: only a whole-program flow proof can discharge it. Off by default and never consulted by the
 * compiler; this is scaffolding for the promotion design, not a shipping surface. */
import { writeFileSync } from "node:fs";
import { DYN, typeKey } from "./nodes.js";
import type { IrExpr, IrModule } from "./nodes.js";

type Cat = string;

function operandCat(e: IrExpr, cls: string, field: string): Cat {
  const x = e as unknown as { kind: string; value?: IrExpr; className?: string; field?: string; type?: { kind: string } };
  if (x.kind === "dynFrom" && x.value !== undefined) return `box:${typeKey((x.value as IrExpr).type)}`;
  if (x.kind === "fieldGet" && x.className === cls && x.field === field) return "self";
  if (x.kind === "numLit") return "box:f64";
  return x.type?.kind === "dyn" ? `dyn:${x.kind}` : `${x.kind}:${x.type?.kind ?? "?"}`;
}

export function promoCensus(mod: IrModule, outPath: string): void {
  const dynFields = new Map<string, Set<string>>();
  for (const c of mod.classes ?? []) {
    const f = (c as unknown as { fields?: { name: string; type: { kind: string } }[] }).fields ?? [];
    for (const fld of f) if (fld.type.kind === DYN.kind) {
      let s = dynFields.get(c.name);
      if (s === undefined) dynFields.set(c.name, (s = new Set()));
      s.add(fld.name);
    }
  }
  const rows = new Map<string, Map<Cat, number>>();
  const bump = (k: string, c: Cat): void => {
    let m = rows.get(k);
    if (m === undefined) rows.set(k, (m = new Map()));
    m.set(c, (m.get(c) ?? 0) + 1);
  };
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object" || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const n = v as { kind?: string; className?: string; field?: string; value?: IrExpr };
    if (n.kind === "fieldSet" && n.className !== undefined && n.field !== undefined && n.value !== undefined && dynFields.get(n.className)?.has(n.field)) {
      const val = n.value as unknown as { kind: string; fn?: string; args?: IrExpr[] };
      let cat: Cat;
      if (val.kind === "libCall" && typeof val.fn === "string" && /^dyn\.(add|sub|mul|div|mod|bitor|bitand|shl|shr)/.test(val.fn)) {
        const ops = (val.args ?? []).map((a) => operandCat(a, n.className!, n.field!));
        cat = `self:${val.fn}(${ops.join(",")})`;
      } else {
        cat = operandCat(n.value, n.className, n.field);
      }
      bump(`${n.className}.${n.field}`, cat);
    }
    for (const x of Object.values(v as object)) walk(x);
  };
  for (const f of mod.functions) walk(f.body);
  const out: Record<string, Record<string, number>> = {};
  for (const [k, m] of rows) out[k] = Object.fromEntries(m);
  writeFileSync(outPath, JSON.stringify({ dynFieldCount: [...dynFields.values()].reduce((a, s) => a + s.size, 0), fields: out }, null, 1));
}
