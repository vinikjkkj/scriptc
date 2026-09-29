/* BUILDING A FRAGMENT: derived from the PRODUCT, not instrumented at the
 * producer.
 *
 * The obvious way to capture what a module consumed is to instrument every
 * place the Lowerer consumes something — a dozen call sites, each of which
 * has to be found, and each of which a later change can quietly stop going
 * through. That is an enumeration of the input, and this block has watched
 * that shape fail seven times in a day: four type kinds missing from a walk,
 * a bucket reading zero because a tap was absent, an entry inferred from
 * cost, a key that hand-spelled the fields it hashed.
 *
 * So almost nothing here is instrumented. The module's finished IR already
 * SAYS which shapes it references, which helpers it calls and which ids it
 * minted; the witness is read back out of the product. A consumption site
 * added to the Lowerer tomorrow is captured automatically, because whatever
 * it consumes still ends up in the IR.
 *
 * ONE exception, and it is the one a product cannot show: the overflow
 * grant's "asked, and answered NEITHER". A key consulted to no effect leaves
 * no trace in the IR precisely because nothing happened, so types.ts records
 * it at the consultation (overflowShapeKeysAsked). An absence has to be
 * captured where it occurs; everything else is read off what was produced.
 */

import { assertNoIdLeak, structuralForm, type ShapeLookup, type UnionLookup } from "./structural-form.js";
import type { HelperReuse, SymbolicMint } from "./fragment.js";

/** One entry of the mint log types.ts keeps, and the record the producer
 * consumes when building fragments for real. */
export interface MintRecord {
  id: string;
  phase: string;
  key: string;
}

/** The mint log, split into the populations a fragment treats differently.
 *
 * COLLECTION and TAIL belong to no module and come back as structural forms
 * rather than as mints: collection's are REPRODUCED on every build
 * (fragment.ts rule 1), and the tail's are minted after every module's bodies
 * are down. Only `byModule` becomes fragment content. */
export interface MintPartition {
  byModule: Map<string, SymbolicMint[]>;
  collection: Set<string>;
  tail: Set<string>;
  /** Mints from a phase this partition does not model. Never silently
   * dropped: an unrecognised phase means the emit pass grew a stage and the
   * replay assumption no longer holds. */
  unrecognised: { phase: string; count: number }[];
}

const idKind = (id: string): "record" | "union" => (id.startsWith("u") ? "union" : "record");
const idType = (id: string) =>
  idKind(id) === "union"
    ? ({ kind: "union", unionId: id } as const)
    : ({ kind: "record", shapeId: id } as const);

/** Split a mint log by phase.
 *
 * The phases are `collect`, `body:<file>`, `init:<file>`, `tail:<stage>` and
 * `discovery` — the shape setMintPhase already asserts on every build. The
 * discovery pass numbers from r0 into its own registry and is discarded, so
 * resetMintLog drops it before the emit pass starts; any that reach here are
 * counted as unrecognised rather than mixed in. */
export function partitionMints(
  log: readonly MintRecord[],
  shapes: ShapeLookup,
  unions: UnionLookup,
): MintPartition {
  const byModule = new Map<string, SymbolicMint[]>();
  const collection = new Set<string>();
  const tail = new Set<string>();
  const unknown = new Map<string, number>();
  const ordinals = new Map<string, number>();

  for (const rec of log) {
    const kind = idKind(rec.id);
    const form = assertNoIdLeak(
      structuralForm(idType(rec.id), shapes, unions),
      `${kind} ${rec.id} minted in phase ${rec.phase}`,
    );
    if (rec.phase === "collect") {
      collection.add(form);
      continue;
    }
    if (rec.phase.startsWith("tail:")) {
      tail.add(form);
      continue;
    }
    const loop = rec.phase.startsWith("body:") ? "body" : rec.phase.startsWith("init:") ? "init" : null;
    if (loop === null) {
      unknown.set(rec.phase, (unknown.get(rec.phase) ?? 0) + 1);
      continue;
    }
    const module = rec.phase.slice(rec.phase.indexOf(":") + 1);
    // The ordinal counts within (module, loop), which is the unit assembly
    // replays: each (loop, file) phase is entered exactly once, so the
    // sequence inside one is contiguous and reproducible.
    const slot = `${loop} ${module}`;
    const ordinal = ordinals.get(slot) ?? 0;
    ordinals.set(slot, ordinal + 1);
    const mint: SymbolicMint = { localId: rec.id, kind, structure: form, ordinal, loop };
    const list = byModule.get(module);
    if (list === undefined) byModule.set(module, [mint]);
    else list.push(mint);
  }
  return {
    byModule,
    collection,
    tail,
    unrecognised: [...unknown].map(([phase, count]) => ({ phase, count })),
  };
}

/** Every positional id a value REFERENCES, found by scanning rather than by
 * walking node kinds.
 *
 * A walk enumerates kinds, and enumerating kinds is how structural-form.ts
 * shipped with four unhandled ones. The property wanted here is "which ids
 * occur", and a scan answers that for every node shape including ones added
 * later. Matching the property NAME as well as the value keeps a user string
 * that happens to read like an id out of the result. */
export function referencedIds(value: unknown): Set<string> {
  const out = new Set<string>();
  const re = /"(?:shapeId|unionId)":"([ru][0-9]+)"/g;
  const json = JSON.stringify(value) ?? "";
  for (let m = re.exec(json); m !== null; m = re.exec(json)) out.add(m[1]!);
  return out;
}

/** Every function name a value CALLS, by the same scan-not-walk rule. */
export function calledFunctionNames(value: unknown): string[] {
  const out: string[] = [];
  const re = /"(?:callee|fnName)":"([^"]+)"/g;
  const json = JSON.stringify(value) ?? "";
  for (let m = re.exec(json); m !== null; m = re.exec(json)) out.push(m[1]!);
  return out;
}

/** What the module referenced but did not mint.
 *
 * Reading is a whole-program fact and not a fact about this module: the
 * entity exists because somebody ELSE minted it. If that module stops
 * minting it, these bodies name a shape the registry does not hold — which
 * is why the set is part of the key and not merely of the payload. */
export function deriveReadEntities(
  referenced: ReadonlySet<string>,
  minted: ReadonlySet<string>,
  shapes: ShapeLookup,
  unions: UnionLookup,
): { localId: string; kind: "record" | "union"; structure: string }[] {
  const out: { localId: string; kind: "record" | "union"; structure: string }[] = [];
  for (const id of [...referenced].sort()) {
    if (minted.has(id)) continue;
    const kind = idKind(id);
    out.push({
      localId: id,
      kind,
      structure: assertNoIdLeak(
        structuralForm(idType(id), shapes, unions),
        `${kind} ${id} read by a module`,
      ),
    });
  }
  return out;
}

/** Interned helpers the module CALLS but does not define.
 *
 * Keyed by INTERN KEY rather than by the `%obj.keys.3` name, which is
 * positional and means nothing in another build. The site count is not used
 * to rebuild anything — the call sites are already inside the stored bodies —
 * it exists so a mismatch is loud instead of inferred. */
export function deriveHelpersReused(
  calledNames: readonly string[],
  definedHere: ReadonlySet<string>,
  internKeyOf: (helperName: string) => string | undefined,
): HelperReuse[] {
  const sites = new Map<string, number>();
  for (const name of calledNames) {
    if (definedHere.has(name)) continue;
    const key = internKeyOf(name);
    if (key === undefined) continue; // an ordinary call, not an interned helper
    sites.set(key, (sites.get(key) ?? 0) + 1);
  }
  return [...sites]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([internKey, n]) => ({ internKey, sites: n }));
}
