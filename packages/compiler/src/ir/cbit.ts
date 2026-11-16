/* CONTAINER BIT: which classes may skip the cycle collector while none of their fields holds a container.
 *
 * A dyn field can hold anything, so a class with dyn fields is cycle-capable by type, and every release of an instance is buffered as a possible root and every pass
 * walks all of its fields. Measured on the mysql bench (lab/cbit0, run 43811635606): mysql2's ColumnDefinition, Packet and TypedParameter never receive a container
 * in any dyn store (0 of 2.3M, 21.4M and 2.4M), yet they account for about 26% of scr_cyc_on_release calls and 40% of the collector's child visits.
 *
 * The gate is per INSTANCE and exact. A class qualifies statically (below); at run time every store of a dyn value into a field of such an instance tests the value's kind
 * and sets one bit in the instance's cycle header when it is not a leaf (undefined, null, bool, number, string, bytes, array buffer, bigint). While the bit is clear the
 * instance owns no edge a cycle could pass through: its release skips root buffering, its trace visits nothing, and its collector teardown releases the dyn fields itself
 * (the trace/teardown complement contract of scr_runtime.h, decided per instance). The first container store flips it for good; nothing ever clears it.
 *
 * A class qualifies when ALL hold:
 *  - it is a standalone class (no base, and nobody extends it), not runtime-provided, with no lazyCycle slots;
 *  - every field is a scalar, a string or a dyn field (nothing else can own a reference), and at least one is dyn;
 *  - it has no emitter mixin slot (the runtime writes it). A run-time property table (`%props`, filled by Object.defineProperty) is fine: its field is a dyn field whose
 *    only writer is the IR fieldSet of `cls.propsEnsure`, a container, so the first table sets the bit like any other container store (the table's contents are the
 *    table's own edges, not the instance's);
 *  - no struct view (`%class:<C>` source) names it, because a view could write a field without the store sites that set the bit.
 *
 * SCRIPTC_CBIT=off disables the pass (the A/B arm). SCRIPTC_CBIT_WHY=1 prints one line per gated class and per refused dyn-field class with the reason. */

import { EMITTER_MIXIN_FIELD_NAME, isRefCounted, type IrModule } from "./nodes.js";

export function cbitPass(mod: IrModule): string[] {
  const classes = mod.classes ?? [];
  if (process.env["SCRIPTC_CBIT"] === "off" || classes.length === 0) return [];
  if (classes.some((c) => c.cbit === true)) return []; // idempotent over a module re-read from its kept IR
  const why = process.env["SCRIPTC_CBIT_WHY"] === "1";
  const viewed = new Set<string>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (typeof v === "string") {
        if (v.startsWith("%class:")) viewed.add(v.slice(7));
      } else walk(v);
    }
  };
  for (const f of mod.functions) walk(f.body);
  const extended = new Set<string>();
  for (const c of classes) if (c.base !== undefined) extended.add(c.base);

  const gated: string[] = [];
  for (const c of classes) {
    const dynFields = c.fields.filter((f) => f.type.kind === "dyn").length;
    if (dynFields === 0 || c.runtime === true) continue;
    const refuse = (reason: string): void => {
      if (why) process.stderr.write(`cbit: refuse ${c.name}: ${reason}\n`);
    };
    if (c.base !== undefined || extended.has(c.name)) {
      refuse("part of a class hierarchy");
      continue;
    }
    if (c.lazyCycle !== undefined && c.lazyCycle.length > 0) {
      refuse("has instance-override slots (lazyCycle)");
      continue;
    }
    if (viewed.has(c.name)) {
      refuse("a struct view names the class");
      continue;
    }
    const bad = c.fields.find((f) => f.name === EMITTER_MIXIN_FIELD_NAME);
    if (bad !== undefined) {
      refuse(`field ${bad.name} is written by the runtime`);
      continue;
    }
    const other = c.fields.find((f) => f.type.kind !== "dyn" && f.type.kind !== "string" && isRefCounted(f.type));
    if (other !== undefined) {
      refuse(`field ${other.name} holds a ${other.type.kind}`);
      continue;
    }
    c.cbit = true;
    gated.push(c.name);
  }
  if (why) for (const g of gated) process.stderr.write(`cbit: gate ${g}\n`);
  return gated;
}
