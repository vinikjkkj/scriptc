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
 * 2. NO POSITIONAL ID IS STORED AS A LITERAL. r3541 names a shape only
 *    inside the build that minted it. Fragments store structural identity
 *    instead, fully EXPANDED so nothing below the top level carries a
 *    number either — the distinction that made this block's first tail
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
  /** Shapes this module READ from the registry without minting them. */
  shapesRead: string[];
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
  // EVERY witness field, including empty ones: an omitted empty list and a
  // field that did not exist hash identically otherwise, which is exactly how
  // a newly added witness field silently stops being part of the key.
  for (const s of w.shapesRead) put("shape-read", s);
  for (const h of w.helpersReused) put("helper-reused", h.internKey + ":" + String(h.sites));
  for (const r of w.reachableSubset) put("reachable", r);
  for (const m of w.moduleGraph) put("module-graph", m.specifier + " -> " + (m.resolved ?? "(unresolved)"));
  for (const g of w.overflowGranted) put("ovf-granted", g);
  for (const d of w.overflowDenied) put("ovf-denied", d);
  for (const u of w.overflowUnanswered) put("ovf-unanswered", u);
  return hash.digest("hex");
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

/** Structural validation on READ, before a fragment is trusted.
 *
 * Returns the reasons it cannot be used; empty means usable. A reason is
 * never a build failure — an unusable fragment is a miss — but it must never
 * be a silent one either, so each is a sentence a log can carry. */
export function fragmentUnusableReasons(fragment: LoweringFragment): string[] {
  const out: string[] = [];
  if (fragment.version !== FRAGMENT_VERSION) {
    out.push("fragment version " + String(fragment.version) + " is not " + String(FRAGMENT_VERSION));
  }
  // RULE 2, checked rather than trusted: a stored positional id is a number
  // that means nothing outside the build that wrote it.
  const positional = /^[ru][0-9]+$/;
  for (const mint of fragment.mints) {
    if (positional.test(mint.structure)) {
      out.push("mint " + String(mint.ordinal) + " stores the positional id " + mint.structure +
        " instead of a structure");
      break;
    }
  }
  const seen = new Set<string>();
  for (const mint of fragment.mints) {
    const slot = mint.loop + ":" + String(mint.ordinal);
    if (seen.has(slot)) {
      out.push("two mints share ordinal " + slot + ", so the replay order is ambiguous");
      break;
    }
    seen.add(slot);
  }
  return out;
}
