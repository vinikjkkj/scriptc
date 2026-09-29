/* THE PER-MODULE LOWERING FRAGMENT — one module's share of lowering, stored
 * so a later build replays it instead of doing it again.
 *
 * Lowering answers ONE IrModule for the closed graph, and every pass that
 * rewrites shared layout runs after the last body is down. So a fragment is
 * not a compiled unit and never becomes one: it is the PRE-CROSS-MODULE
 * product of one module, and every cross-module pass is replayed on every
 * build over the assembled whole. Measured, those passes mint no positional
 * ids at all, so replaying them cannot perturb the id space they run over.
 *
 *
 * ====================================================================
 * HAZARD — THE KEY CANNOT SEE EVERY INSTRUMENT. READ THIS FIRST.
 * ====================================================================
 *
 * A fragment is invalidated by (a) every SCRIPTC_* environment variable
 * except the four cache-control names early-cache.ts exempts, (b) the
 * compiler's own dist tree, and (c) every filesystem observation the
 * frontend made, through the input-tracker probe taxonomy.
 *
 * It is NOT invalidated by an instrument that is none of those. Concretely,
 * and both of these have already cost this project real time:
 *
 *   - a header -included into a translation unit under tests/perf. The
 *     build cache key did not contain it, so editing the census served the
 *     previous answer out of a byte-identical executable.
 *   - a block measuring the compiler with SCRIPTC_CACHE_DIR set, which the
 *     briefs tell you to set. The build hit the early cache, skipped
 *     frontend and codegen, every counter read zero, and the TU on disk was
 *     the previous build's.
 *
 * The probe taxonomy closes part of this, and it is worth knowing exactly
 * which part: ANYTHING THE FRONTEND READS becomes a probe, so a header the
 * frontend reads does invalidate. What stays invisible is anything consumed
 * AFTER the frontend, and anything reached through a variable not named
 * SCRIPTC_*.
 *
 * So: if you are measuring this compiler, put your instrument behind a
 * SCRIPTC_* variable. If you cannot, assume the fragment is stale and pass
 * SCRIPTC_NO_CACHE. And prefer an instrument whose output is ABSENT when it
 * did not run over one that reports a number: a counter reading zero cannot
 * distinguish "ran and found nothing" from "never ran", while a missing log
 * is the one signal a served build cannot fake.
 *
 *
 * WHAT THIS IS WORTH, AND AGAINST WHICH TREE. C -- the non-entry attributed
 * lowering a fragment can reach -- was measured at 250.3 s on zapo-rest/app182,
 * arm A 229184b35 against arm B 147496b5a, both in one session with the same
 * tap. Arm B is now IN main (merged as 4e3990201), so 250.3 s is the C of the
 * tree this file sits in, not of some earlier one.
 *
 * C IS A PROPERTY OF ONE COMPOSITION. Measurements compose, and each changes
 * the measured value of the others: walkfuse's memo took 88% of its saving out
 * of the ENTRY, which is the part a fragment cannot reach, so the two are
 * complementary rather than substitutes. If another perf change lands, C is
 * RE-MEASURED, not scaled -- tests/perf/libcache/attrib-decide.mjs is the
 * reader, and it needs both arms in one window.
 *
 * And C is a CEILING on what a fragment could reach, not a promise: every
 * module that hits a refusal below is not cacheable. The census is what turns
 * the ceiling into a delivered number, and until it has run on a real build,
 * "the fragment works" and "the fragment delivers the 250 s" are different
 * claims with only the first one argued.
 *
 *
 * FAIL CLOSED. A cache can be wrong two ways and only one is tolerable:
 * missing a hit is COST, serving a wrong hit is CORRUPTION. Every refusal
 * below therefore becomes a MISS — the fragment is unusable, the module
 * re-lowers, nothing incorrect ships. No future decision about fragments
 * should land on the other side of that line, and fragmentFormCollisions is
 * the precedent: it refuses a case the compiler DELIBERATELY creates rather
 * than widening the identity to accommodate it.
 *
 * AND EVERY REFUSAL IS COUNTED, not merely taken. A refusal nobody counts is
 * indistinguishable from a refusal that never happens, which is how a cache
 * reports working while delivering a fraction of what it was costed at. The
 * refusal codes are a closed union bound to a runtime array in BOTH
 * directions, so a new one gets its own census bucket and cannot hide inside
 * an "other" total.
 *
 *
 * THREE RULES, each asserted somewhere rather than only stated.
 *
 * 1. A FRAGMENT OWNS NO COLLECTION ID. Collection runs before any body, as
 *    one whole-program phase, and on zapo-rest/app182 it mints 57.3% of all
 *    positional ids (3,210 of 5,598). Those ids belong to no module. They
 *    are REPRODUCED on every build — collection runs whether or not
 *    anything was cached — and must never be replayed out of a fragment. A
 *    fragment that owned them would be wrong the first time somebody added
 *    a module, and wrong SILENTLY, because the resulting numbering is still
 *    self-consistent. assertFragmentOwnsNoCollectionIds is the check, and
 *    it ships with the serializer rather than after it, because the failure
 *    it catches arrives months later in somebody else's commit.
 *
 * 2. NO POSITIONAL ID IS STORED AS AN IDENTITY -- but ids DO appear as
 *    local references, and the difference is the whole of how replay works.
 *    The stored bodies are the module's real IR, so they are full of
 *    `r3541`. What makes that safe is that every such id is resolvable from
 *    the fragment's own DICTIONARY: `mints` for what this module minted,
 *    `witness.readEntities` for what it referenced and another module
 *    minted. Assembly walks the bodies and rewrites each id to whatever the
 *    new build calls the same STRUCTURE.
 *
 *    An id that is in neither list is unresolvable, and rewriting would
 *    either leave it pointing at an unrelated shape or drop it -- both
 *    silent. fragmentUnresolvableIds is the guard, and it checks the
 *    PRODUCT (which ids actually occur in the bodies) rather than trusting
 *    that the producer remembered to record them.
 *
 *    The structures themselves carry no number at any depth — the distinction that made this block's first tail
 *    comparison report a confident wrong answer, because ShapeRegistry.keyOf
 *    spells a nested type as "record:r3541" and is therefore structural
 *    only one level deep.
 *
 * 3. NOTHING A LATER PASS REWRITES IS STORED. No re-picked declaredOrder,
 *    no unified merge, no armed ownmask, no elided width helper, no
 *    refilled helper body. Those are outputs of the cross-module passes,
 *    which run again on every build; storing one would be storing a
 *    decision another library's code is allowed to change.
 */

import { createHash } from "node:crypto";
import { structuralFormIsOpaque } from "./structural-form.js";
import type { FrontendInputProbe } from "../input-tracker.js";
import type { IrFunction, IrGlobal } from "../../ir/nodes.js";

/** Bump when any shape below changes meaning. A fragment whose version does
 * not match is a MISS, never a best-effort read: the failure mode of
 * misreading one is a silently wrong binary. */
export const FRAGMENT_VERSION = 1;

/** A positional id, replaced by the thing it names.
 *
 * `structure` is the id-free expansion: every nested shape and union
 * reference substituted by its own expansion, cycles cut by a De Bruijn
 * back-reference so a recursive shape still has exactly one spelling. Two
 * builds agree on this string exactly when they minted the same entity,
 * whatever number each of them gave it. */
export interface SymbolicMint {
  /** THE ID THIS BUILD USED, as a local reference only.
   *
   * Not an identity claim -- `structure` is the identity. This is the
   * dictionary entry that lets assembly rewrite `r3541` where it occurs in
   * the stored bodies. Without it a fragment cannot be replayed at all: the
   * bodies name ids and nothing maps them to what they mean. That omission
   * survived the first draft of this file and was found by writing the
   * control for the replay, not by writing the replay. */
  localId: string;
  /** Which counter this came from. */
  kind: "record" | "union";
  /** The id-free structural expansion. Never an rN or uN. */
  structure: string;
  /** Where in this module's own mint sequence it fell. Assembly replays
   * these in order, per module, in moduleOrder, which is what reproduces the
   * numbering a from-scratch build produces: the emit pass is
   * `for (const fp of parts)` twice over moduleOrder, and each (loop, file)
   * phase is entered exactly once (measured, 201 runs across 201 phases). */
  ordinal: number;
  /** Which loop minted it. The two file loops do not overlap — last body
   * mint 2226, first init mint 2227 on the measured program — so assembly
   * replays every body group before any init group. */
  loop: "body" | "init";
}

/** An interned helper the module REUSED rather than minted.
 *
 * Recorded because reuse is a fact about the whole program and not about
 * this module: the helper existed because some other module interned it
 * first. If that module is gone, or no longer interns it, this fragment's
 * bodies call a function nobody defines. Stored by intern key, never by the
 * `%obj.keys.3` name, which is positional. */
export interface HelperReuse {
  /** The interning key — shape identity plus result type, id-free. */
  internKey: string;
  /** How many call sites in this module reached it. A count rather than a
   * list, because the sites are already inside the stored bodies; this
   * exists so a mismatch is loud instead of inferred. */
  sites: number;
}

/** What the module CONSUMED but did not produce.
 *
 * This is the half a cache gets wrong by omission. A fragment recording only
 * what it found is wrong for the same reason input-tracker.ts keeps FAILED
 * probes: the absence of an answer is part of the answer, and a later build
 * that would now answer differently has to miss. */
export interface FragmentWitness {
  /** Entities this module REFERENCED that another module minted.
   *
   * Shapes AND unions: the first draft recorded only shapes, which left
   * every union a body names unresolvable at assembly. Each carries its
   * local id for the same reason a mint does -- it is a dictionary entry,
   * not an identity.
   *
   * Reading is also a whole-program FACT, not a fact about this module: the
   * entity existed because somebody else minted it. If that module is gone,
   * or no longer mints it, this fragment's bodies reference a shape the
   * registry does not hold. */
  readEntities: { localId: string; kind: "record" | "union"; structure: string }[];
  /** Helpers reused rather than minted (see HelperReuse). */
  helpersReused: HelperReuse[];
  /** The reachable-set members this module's bodies were gated on. The
   * reachable set is a whole-program fixpoint, so a module whose reachable
   * subset moved must re-lower even when its own bytes did not. */
  reachableSubset: string[];
  /** Module-graph facts consumed: each specifier this module resolved and
   * what it resolved to. A resolution that moves is a different program even
   * when every byte read still matches. */
  moduleGraph: { specifier: string; resolved: string | null }[];
  /** THE OVERFLOW GRANT, ALL THREE ANSWERS.
   *
   * Positive answers alone are not enough, and this is the file's own rule
   * turned on itself. The grant is consulted per shape key and answers
   * GRANTED, DENIED, or neither. A fragment storing only the grants would
   * replay happily into a build where a key that was previously neither has
   * since become denied, and the shape would carry an overflow the program
   * must not have. Measured inert on zapo-rest (after-discovery 0,
   * new-in-emit 0, three runs) — which is a reason to expect few entries and
   * never a reason to omit the negative ones. */
  overflowGranted: string[];
  overflowDenied: string[];
  /** Keys this module ASKED about that answered neither. The third state,
   * recorded for exactly the same reason as the second. */
  overflowUnanswered: string[];
}

/** One module's pre-cross-module lowering product. */
export interface LoweringFragment {
  version: number;
  /** The module this is for, as the frontend named it. */
  module: string;
  /** The module's lowered functions, verbatim, BEFORE any cross-module pass.
   * Positional ids inside these bodies are rewritten at assembly from the
   * mint table; see rule 2. */
  functions: IrFunction[];
  /** Globals the module declared. */
  globals: IrGlobal[];
  /** Ids this module minted, in its own mint order (see SymbolicMint). */
  mints: SymbolicMint[];
  /** The discovery pass's edge relation for this module: which emitted
   * function names its bodies reached. Assembly unions these and recomputes
   * the reachability fixpoint rather than trusting any module's view of it. */
  edges: { from: string; to: string }[];
  /** What it consumed but did not produce. */
  witness: FragmentWitness;
  /** Every filesystem observation attributable to this module. */
  probes: FrontendInputProbe[];
}

/** The digest a fragment is stored under and found by.
 *
 * Built from the SAME two whole-build fingerprints the early cache uses,
 * plus this module's own probes and witness. Inheriting them is the point:
 * an allowlist of "things that should invalidate" is written from what its
 * author remembered, and the next instrument added is the one that is not on
 * it. See the HAZARD at the top for what this still cannot see.
 *
 * The two fingerprints are passed in rather than read here, so this module
 * stays testable without a filesystem and without a process environment. */
export function fragmentKey(input: {
  environmentFingerprint: string;
  implementationFingerprint: string;
  fragment: Pick<LoweringFragment, "version" | "module" | "probes" | "witness">;
}): string {
  const hash = createHash("sha256").update("scriptc-lowering-fragment-v1");
  const NUL = String.fromCharCode(0);
  const put = (label: string, value: string): void => {
    hash.update(NUL).update(label).update(NUL).update(value);
  };
  put("version", String(input.fragment.version));
  put("env", input.environmentFingerprint);
  put("impl", input.implementationFingerprint);
  put("module", input.fragment.module);
  // Probes arrive sorted by the tracker. Sorting them again here would hide
  // a tracker regression instead of surfacing it, so they go in as given and
  // their order is part of the identity.
  for (const p of input.fragment.probes) put("probe", JSON.stringify(p));
  const w = input.fragment.witness;
  // EVERY WITNESS FIELD, AND EVERY FIELD OF EVERY ENTRY, by walking the
  // object rather than spelling it.
  //
  // This used to hand-spell the composite entries -- `h.internKey + ":" +
  // h.sites`, `m.specifier + " -> " + m.resolved`. A field added to
  // HelperReuse or to a moduleGraph entry would then have been invisible to
  // the KEY while cacheVerificationDivergences, which stringifies the whole
  // array, still caught it. That is backwards: the key decides whether a
  // fragment is reused at all, and the verifier only runs afterwards on
  // builds that opted into it. The looser check must never be the one that
  // gates reuse.
  //
  // It is the day's rule applied to itself: GUARD THE PROPERTY OF THE
  // OUTPUT, NOT THE COMPLETENESS OF THE INPUT. A list of fields is a claim
  // about what exists today; canonicalJson is true as long as the value is.
  for (const field of Object.keys(w).sort()) {
    put("witness." + field, canonicalJson((w as unknown as Record<string, unknown>)[field]));
  }
  return hash.digest("hex");
}

/** JSON with object keys sorted at every depth.
 *
 * Plain JSON.stringify preserves INSERTION order, so two builds that
 * populated the same witness entry in a different order would hash
 * differently and miss forever -- a cache that never hits is only a slow
 * bug, but it is still a bug, and it would look like the fragment never
 * matching rather than like a serializer defect. Arrays keep their order:
 * for a witness, order is content. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const o = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue; // absent and explicitly-undefined hash alike
    parts.push(JSON.stringify(k) + ":" + canonicalJson(o[k]));
  }
  return "{" + parts.join(",") + "}";
}

/** RULE 1, ASSERTED: a fragment owns no collection id.
 *
 * `collectionStructures` is the id-free expansion of everything the
 * COLLECTION phase minted on this build. A fragment claiming to have minted
 * one of those claims ownership of whole-program work, and replaying it
 * would mint the entity twice — once by collection, which runs regardless,
 * and once from the fragment.
 *
 * It throws rather than warning, because the failure does not announce
 * itself: the resulting numbering is self-consistent and the emitted program
 * is valid, merely not the program the source describes. */
export function assertFragmentOwnsNoCollectionIds(
  fragment: Pick<LoweringFragment, "module" | "mints">,
  collectionStructures: ReadonlySet<string>,
): void {
  const owned: string[] = [];
  for (const mint of fragment.mints) {
    if (collectionStructures.has(mint.structure)) owned.push(mint.structure);
  }
  if (owned.length === 0) return;
  const shown = owned.slice(0, 3).map((s) => (s.length > 90 ? s.slice(0, 90) + "..." : s));
  throw new Error(
    "compiler bug: lowering fragment for " + fragment.module + " claims to have minted " +
      String(owned.length) + " positional id(s) that the COLLECTION phase mints. Collection runs " +
      "before any body, as one whole-program phase, and its ids belong to no module: they are " +
      "reproduced on every build, never replayed from a fragment. Replaying these mints each " +
      "entity twice and renumbers everything after it, in a program that still validates. " +
      "First: " + shown.join(" | "),
  );
}

/** RULE 2's real guard: every positional id the BODIES actually use must be
 * resolvable from the fragment's own dictionary.
 *
 * GUARD THE PROPERTY OF THE OUTPUT, NOT THE COMPLETENESS OF THE INPUT. A
 * producer that forgot to record an entity leaves an id in the bodies with
 * no dictionary entry; assembly would then rewrite it to nothing, or leave
 * it pointing at whatever the new build happens to call r3541. Both are
 * silent, and both ship. Checking which ids OCCUR is true whatever the
 * producer remembered -- including for entity kinds added later, which is
 * how the same discipline caught four unhandled type kinds in
 * structural-form.ts.
 *
 * Scanning the serialized bodies rather than walking IrExpr on purpose: a
 * walk enumerates node kinds, and this file's whole thesis is that
 * enumerations of the input go stale. A regex over the JSON sees every id
 * regardless of which node carried it.
 *
 * Returns the unresolvable ids, in first-seen order. Empty means replayable. */
export function fragmentUnresolvableIds(
  fragment: Pick<LoweringFragment, "functions" | "globals" | "mints" | "witness">,
): string[] {
  const known = new Set<string>();
  for (const m of fragment.mints) known.add(m.localId);
  for (const r of fragment.witness.readEntities) known.add(r.localId);
  const serialized = JSON.stringify({ f: fragment.functions, g: fragment.globals });
  const out: string[] = [];
  const seen = new Set<string>();
  // Ids appear as the VALUE of shapeId/unionId properties. Matching the
  // property name as well as the value keeps a user string that merely looks
  // like "r12" from being reported as a dangling shape.
  const re = /"(?:shapeId|unionId)":"([ru][0-9]+)"/g;
  for (let m = re.exec(serialized); m !== null; m = re.exec(serialized)) {
    const id = m[1]!;
    if (known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** THE MIRROR OF assertNoIdLeak, and the other half of the same pair.
 *
 * assertNoIdLeak proves no id got INTO a structural form. This proves no two
 * distinct entities came OUT of one. Both failures are fatal and they fail
 * in opposite directions: a leaked id makes two builds of the same source
 * miss forever, which is slow; a collision makes the dictionary map two
 * different entities onto ONE id at assembly, which puts a value of one
 * shape into another shape's slot with no diagnostic and no build failure.
 * An incomplete form is exactly as fatal as a leaky one.
 *
 * THIS IS NOT HYPOTHETICAL, and the known case is in the registry's own
 * words: "two INDEPENDENT structurally identical recursive declarations
 * intern as distinct shapes, so values of one fence at the other slots with
 * the ordinary shape-mismatch diagnostic" (ShapeRegistry.recIds). Per
 * declaration identity is deliberate -- tsc admits the assignment and the
 * exact-shape stance reports it -- so two ids that are structurally equal
 * are a thing this compiler MEANS. structuralForm cannot see the difference,
 * because the difference is the declaration site and not the structure.
 *
 * So a fragment containing such a pair is UNUSABLE, not wrong: it is a miss,
 * the module re-lowers, and nothing ships incorrectly. Widening the form to
 * carry a declaration discriminator would be the way to cache those modules
 * too, and it is deliberately not done here -- a discriminator is a second
 * identity, and a second identity is a second thing to get wrong.
 *
 * OPAQUE forms count, and count harder. A form that reached an unresolved
 * placeholder is less discriminating by construction, so two of them
 * colliding is the likeliest way this fires; they are reported separately so
 * the reason is legible rather than inferred.
 *
 * The shape of this check is the tail comparator one place forward: there it
 * printed DISTINCT EXPANDED KEYS beside the entity count -- 105 of 105 --
 * precisely so a key collision could not fake agreement. Here it is
 * distinct(forms) == count(entities), and a mismatch refuses. */
export function fragmentFormCollisions(
  fragment: Pick<LoweringFragment, "mints" | "witness">,
): { structure: string; localIds: string[]; opaque: boolean }[] {
  const byForm = new Map<string, string[]>();
  const add = (localId: string, structure: string): void => {
    const got = byForm.get(structure);
    if (got === undefined) byForm.set(structure, [localId]);
    else if (!got.includes(localId)) got.push(localId);
  };
  for (const m of fragment.mints) add(m.localId, m.structure);
  for (const r of fragment.witness.readEntities) add(r.localId, r.structure);
  const out: { structure: string; localIds: string[]; opaque: boolean }[] = [];
  for (const [structure, localIds] of byForm) {
    if (localIds.length < 2) continue;
    out.push({ structure, localIds, opaque: structuralFormIsOpaque(structure) });
  }
  return out;
}

/** Every way a fragment can be refused, as a closed set WITH a runtime
 * enumeration.
 *
 * A census that classified refusals by parsing their MESSAGES would go stale
 * the first time somebody reworded one, and a new refusal would land in
 * whatever bucket the parser defaulted to. The codes are the classification;
 * the messages are for humans. */
export const FRAGMENT_REFUSAL_CODES = [
  "version",
  "positional-id",
  "form-collision",
  "ordinal-collision",
] as const;
export type FragmentRefusalCode = (typeof FRAGMENT_REFUSAL_CODES)[number];

/* Bound in BOTH directions: the Record forces the array to cover every union
 * member, and the union type forces every array entry to be a member. Either
 * alone lets the two drift, and a drifted enumeration is the silent-default
 * failure this file keeps finding. */
const CODES_COVER_UNION: Record<FragmentRefusalCode, true> = {
  version: true,
  "positional-id": true,
  "form-collision": true,
  "ordinal-collision": true,
};
void CODES_COVER_UNION;

export interface FragmentRefusal {
  code: FragmentRefusalCode;
  message: string;
}

/* THE FRAGMENT CENSUS — how much of C the cache actually delivers.
 *
 * C = 250.3 s is the work a per-module fragment COULD reach, and it assumes
 * the library modules are cacheable. Every module that hits a refusal is not.
 * If structurally identical recursive declarations are common in this graph
 * -- and proto, bson and mongodb are exactly the kind of code that generates
 * them -- a slice of C evaporates, and nothing would say so.
 *
 * So refusals are COUNTED, not merely taken. This is the same lesson the rest
 * of this file keeps learning, applied before it hurts: a refusal nobody
 * counts is indistinguishable from a refusal that never happens, and the
 * difference between "the fragment works" and "the fragment delivers the
 * 250 s" is exactly this table.
 *
 * Counted BY CODE, never by parsing a message, and the codes are a closed
 * union bound to a runtime array -- so a refusal added later gets its own
 * bucket automatically instead of vanishing into an "other" total. That is
 * the failure this file has now hit six times in one form or another.
 */
export interface FragmentCensus {
  /** Modules a fragment was attempted for. */
  attempted: number;
  /** ...of which usable. */
  cacheable: number;
  /** ...of which refused, by code. Every code always present, so a zero is
   * a MEASURED zero and not an absent key -- the distinction that cost this
   * block a retraction. */
  refusedByCode: Record<FragmentRefusalCode, number>;
  /** Collisions that were between OPAQUE forms, counted separately because
   * they are the likeliest cause and the cheapest to act on. */
  opaqueCollisions: number;
  /** The modules refused, so a high fraction can be investigated rather than
   * merely reported. Capped: a census is not a log. */
  refusedModules: string[];
}

const CENSUS_MODULE_CAP = 50;

export function newFragmentCensus(): FragmentCensus {
  const refusedByCode = {} as Record<FragmentRefusalCode, number>;
  for (const code of FRAGMENT_REFUSAL_CODES) refusedByCode[code] = 0;
  return { attempted: 0, cacheable: 0, refusedByCode, opaqueCollisions: 0, refusedModules: [] };
}

/** Record one module's outcome. The ONLY way the census moves, so a call site
 * that forgets to record is a module missing from `attempted` rather than a
 * silent mis-attribution. */
export function censusRecord(
  census: FragmentCensus,
  module: string,
  refusals: readonly FragmentRefusal[],
  collisions: readonly { opaque: boolean }[] = [],
): void {
  census.attempted++;
  if (refusals.length === 0) {
    census.cacheable++;
    return;
  }
  // A module refused for several reasons counts under EACH, so the buckets
  // sum to at least the refused count rather than exactly it. Stated because
  // a reader who assumes they partition will mis-add them.
  for (const r of refusals) census.refusedByCode[r.code]++;
  for (const c of collisions) if (c.opaque) census.opaqueCollisions++;
  if (census.refusedModules.length < CENSUS_MODULE_CAP) census.refusedModules.push(module);
}

/** The census as the line a run reports. Deliberately one line per number
 * with the DENOMINATOR beside it: a refusal count without an attempted count
 * cannot be read. */
export function censusReport(census: FragmentCensus): string {
  const refusedTotal = census.attempted - census.cacheable;
  const pct = (n: number): string =>
    census.attempted === 0 ? "n/a" : ((100 * n) / census.attempted).toFixed(1) + "%";
  const lines = [
    "fragment census",
    "  modules attempted   " + String(census.attempted),
    "  cacheable           " + String(census.cacheable) + "  " + pct(census.cacheable),
    "  refused             " + String(refusedTotal) + "  " + pct(refusedTotal),
  ];
  for (const code of FRAGMENT_REFUSAL_CODES) {
    lines.push("    " + code.padEnd(18) + String(census.refusedByCode[code]));
  }
  lines.push("  opaque collisions   " + String(census.opaqueCollisions) +
    "  (subset of form-collision; the likeliest cause)");
  lines.push("  note: a module refused for several reasons counts under each, " +
    "so the per-code numbers sum to at least the refused total.");
  return lines.join(String.fromCharCode(10));
}

/** Structural validation on READ, before a fragment is trusted.
 *
 * Returns the reasons it cannot be used; empty means usable. A reason is
 * never a build failure — an unusable fragment is a MISS, see FAIL CLOSED
 * — but it must never be a silent one either, so each carries a CODE for the
 * census and a sentence a log can carry. */
export function fragmentUnusableReasons(fragment: LoweringFragment): FragmentRefusal[] {
  const out: FragmentRefusal[] = [];
  if (fragment.version !== FRAGMENT_VERSION) {
    out.push({ code: "version", message: "fragment version " + String(fragment.version) + " is not " + String(FRAGMENT_VERSION) });
  }
  // RULE 2, checked rather than trusted: a stored positional id is a number
  // that means nothing outside the build that wrote it.
  const positional = /^[ru][0-9]+$/;
  for (const mint of fragment.mints) {
    if (positional.test(mint.structure)) {
      out.push({ code: "positional-id", message: "mint " + String(mint.ordinal) + " stores the positional id " + mint.structure + " instead of a structure" });
      break;
    }
  }
  // A COLLISION makes a fragment unusable rather than wrong: two entities
  // sharing one form would be mapped onto one id at assembly. Reported here
  // so the module simply re-lowers.
  for (const c of fragmentFormCollisions(fragment)) {
    out.push({
      code: "form-collision",
      message:
        (c.opaque ? "an OPAQUE structural form " : "a structural form ") +
        "is shared by " + String(c.localIds.length) + " distinct entities (" +
        c.localIds.join(", ") + "), so assembly would map them onto one id: " +
        (c.structure.length > 80 ? c.structure.slice(0, 80) + "..." : c.structure),
    });
    break;
  }
  const seen = new Set<string>();
  for (const mint of fragment.mints) {
    const slot = mint.loop + ":" + String(mint.ordinal);
    if (seen.has(slot)) {
      out.push({ code: "ordinal-collision", message: "two mints share ordinal " + slot + ", so the replay order is ambiguous" });
      break;
    }
    seen.add(slot);
  }
  return out;
}
