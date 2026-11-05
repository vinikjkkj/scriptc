/** Closed-world fence on a record with SYMBOL-KEYED members crossing into the untyped world in a program that reads
 * symbol-keyed properties of untyped values.
 *
 * A record literal `{ [K]: v }` is a typed record whose member the checker names `__@K@<id>` (the late-bound spelling,
 * which carries the VARIABLE name and not the symbol). When it crosses into a checked-dynamic slot the converter keeps
 * the member under that spelling, as a hidden entry. The runtime's symbol-keyed property table (scr_symbol.c) is keyed
 * by the symbol VALUE, so a later `untyped[K]` read cannot find a member stored under the spelling: it would answer
 * `undefined` where Node answers the value. No runtime answer is exact without the symbol's identity, so a program that
 * has both is refused at compile time, at the crossing, by name. A program with only one of the two is untouched.
 *
 * Runs once over the final IR (iterative, like null-proto-fence.ts), only when the module holds a sym.dyn* read.
 */
import { type IrModule, type IrRecordShape, type SrcLoc } from "../../ir/nodes.js";
import type { ScrDiagnostic } from "../../diagnostics/diagnostic.js";
import { unsupportedDiag } from "../../diagnostics/diagnostic.js";

export interface SymbolRecordFenceHost {
  shapeGet(id: string): IrRecordShape | undefined;
}

const WELL_KNOWN = new Set([
  "toStringTag", "iterator", "asyncIterator", "toPrimitive", "hasInstance", "isConcatSpreadable", "match", "matchAll",
  "replace", "search", "species", "split", "unscopables", "dispose", "asyncDispose",
]);

/** The late-bound member names of a shape that stand for a USER symbol (not a well-known one, not an order marker). */
function userSymbolMembers(shape: IrRecordShape): string[] {
  const out: string[] = [];
  for (const f of shape.fields) {
    if (!f.name.startsWith("__@") || f.name.startsWith("__@ord@")) continue;
    const m = /^__@(.*)@\d+$/.exec(f.name);
    if (m !== null && WELL_KNOWN.has(m[1]!)) continue;
    out.push(f.name);
  }
  return out;
}

export function fenceSymbolRecordCrossings(
  host: SymbolRecordFenceHost,
  mod: IrModule,
  pushDiag: (d: ScrDiagnostic) => void,
): number {
  const crossings: { loc: SrcLoc; names: string[] }[] = [];
  let reads = 0;
  const seenObj = new Set<object>();
  const stack: unknown[] = [mod.globals ?? [], mod.classes ?? [], mod.functions];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (seenObj.has(v)) continue;
    seenObj.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "libCall" && typeof o["fn"] === "string") {
      const fn = o["fn"] as string;
      if (fn === "sym.dynGet" || fn === "sym.dynGetOpt" || fn === "sym.dynHas" || fn === "sym.dynHasOwn" || fn === "sym.dynOwnKeys") reads++;
    } else if (o["kind"] === "dynFrom") {
      const inner = o["value"] as { type?: { kind?: string; shapeId?: string } } | undefined;
      if (inner?.type?.kind === "record" && inner.type.shapeId !== undefined) {
        const shape = host.shapeGet(inner.type.shapeId);
        const names = shape === undefined ? [] : userSymbolMembers(shape);
        if (names.length > 0) crossings.push({ loc: o["loc"] as SrcLoc, names });
      }
    }
    const kids: unknown[] = Array.isArray(v) ? v : Object.values(o);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  if (reads === 0) return 0;
  for (const c of crossings) {
    pushDiag(unsupportedDiag(
      "SC1101",
      c.loc,
      "converting a record with a symbol-keyed member to 'unknown' in a program that reads symbol-keyed properties of 'unknown' values",
      `the member (${c.names.slice(0, 3).join(", ")}) crosses under its checker spelling, which the symbol-keyed read cannot match by identity, so the read would answer undefined where Node answers the value. ` +
        `Keep the object untyped from its creation (Object.create(null) and assign the symbol key), or read the member through its record type.`,
    ));
  }
  return crossings.length;
}
