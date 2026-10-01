/* THE FRAGMENT CENSUS ON A REAL BUILD.
 *
 * C — the non-entry attributed lowering a per-module fragment could reach —
 * is 250.3 s on zapo-rest/app182. That is a CEILING. Every module that hits
 * a refusal is not cacheable, so the delivered number is C times the
 * cacheable fraction, and nothing has measured that fraction.
 *
 * This runs the refusal checks over a finished lowering and reports the
 * table. It does NOT store anything: storage is a separate decision, and the
 * question "how much of C is reachable" has to be answerable before it is
 * worth making.
 *
 * WHAT IT IS VALID FOR, stated because the fragments it builds are
 * deliberately incomplete. Every refusal code is structural — version,
 * positional-id, form-collision, ordinal-collision, npm-static — and none of
 * them reads `helpersReused`, `edges` or `probes`. Those are left empty here
 * and the census is exact for the classes it counts. It would NOT be valid
 * for "can this fragment be replayed", which needs all three.
 *
 * ENV-GATED: SCRIPTC_FRAGMENT_CENSUS names the output path. It is a
 * SCRIPTC_* variable, so it is inside the early cache key and an
 * instrumented build cannot be served by an uninstrumented entry.
 *
 * AND IT REFUSES TO REPORT RATHER THAN REPORT ZEROS. The mint log only fills
 * when SCRIPTC_MINT_ORDER is set; without it every module would look like it
 * minted nothing and the census would read "everything cacheable" — the most
 * flattering answer the rig can produce, from an instrument that was never
 * switched on. That is the shape this block has hit a dozen times, so the
 * producer asks mintLogActive() first and says so instead.
 */

import { appendFileSync } from "node:fs";
import type { IrFunction, IrGlobal, IrRecordShape, IrUnionDef } from "../../ir/nodes.js";
import { mintLogActive, mintLogSnapshot } from "../types.js";
import {
  censusRecord,
  censusReport,
  fragmentUnusableReasons,
  newFragmentCensus,
  buildRefusesFragments,
  type FragmentCensus,
  type LoweringFragment,
  FRAGMENT_VERSION,
} from "./fragment.js";
import { deriveReadEntities, partitionMints, referencedIds } from "./fragment-build.js";
import { newStructuralFormCache } from "./structural-form.js";
import type { ShapeLookup, UnionLookup } from "./structural-form.js";

/** What the census needs from a finished lowering. Passed in rather than
 * reached for, so this is testable without constructing a Lowerer. */
export interface CensusInput {
  functions: readonly IrFunction[];
  globals: readonly IrGlobal[];
  shapes: ShapeLookup;
  unions: UnionLookup;
  /** tag -> module path, the inverse of Lowerer.fileTag. Globals carry their
   * declaring module in their id (`%g.<tag>...`), which is the only place
   * the attribution survives: IrGlobal has no loc. */
  moduleOfTag: ReadonlyMap<string, string>;
  npmStatic?: readonly string[] | "auto";
  program: string;
}

/** One module's outcome, UNCAPPED.
 *
 * The census report caps its refused-module list at 50 because a report is
 * not a log. This is not a report: it is the join key.
 *
 * C IS SECONDS AND THE CENSUS COUNTS MODULES, and those are different
 * denominators. 90% of modules cacheable can be 30% of C if the expensive
 * ones refuse -- and on this program one library file, spec/proto/index.js,
 * was 220 s of 1156 s attributed. Answering "what fraction of C is
 * reachable" with a module count would be a ratio measured in one
 * denominator and spent in another, which is the error this block has spent
 * the day removing. So every module's outcome is emitted and joined against
 * the per-file attribution, and the table reports SECONDS. */
export interface ModuleOutcome {
  module: string;
  cacheable: boolean;
  codes: string[];
}

export interface CensusResult {
  census: FragmentCensus;
  /** Every module, uncapped, for the C-weighted join. */
  outcomes: ModuleOutcome[];
  /** Globals whose id did not parse to a known tag. DERIVE THEN ASSERT: the
   * attribution is read off the product, and whatever the derivation failed
   * to place is reported rather than dropped into an arbitrary module. */
  unplacedGlobals: string[];
  /** Functions with no loc.file. Same rule. */
  unplacedFunctions: string[];
}

/* The file tag's REAL format, read from where it is minted rather than
 * guessed: lowerer.ts assigns `%m<i>.` to every module in moduleOrder and
 * the EMPTY STRING to the entry.
 *
 * The first version matched /^%g\.([^%]*)/ -- everything up to the first
 * '%'. On `%g.%m12.exports` that captures "" and resolves to the ENTRY's
 * tag, so every module global was attributed to the entry; on `%g.default`
 * it captures "default" and resolves to nothing, so every ENTRY global was
 * reported unplaced. Exactly backwards, and the only reason it surfaced is
 * that 1,014 unplaced globals was too many to pass over. */
const TAG_RE = /^%g\.(%m[0-9]+\.)?/;

/** Which module a global belongs to, from its id, or null.
 *
 * Null is a REFUSAL to guess. Placing an unattributable global in some
 * module would put a declaration into a fragment that does not own it, and
 * replaying that fragment would duplicate or lose it — silently, since the
 * emitted program is still well-formed. */
export function moduleOfGlobal(
  id: string,
  moduleOfTag: ReadonlyMap<string, string>,
): string | null {
  const m = TAG_RE.exec(id);
  if (m === null) return null;
  // Group 1 is absent for an entry global, and the entry's tag IS the empty
  // string -- so the two spellings have to be collapsed deliberately rather
  // than by `?? null`, which would make an entry global look unattributable.
  return moduleOfTag.get(m[1] ?? "") ?? null;
}

/** Run the refusal checks per module and build the census. */
export function collectCensus(input: CensusInput): CensusResult {
  // ONE cache for this census and no longer. It is keyed by shape id, and
  // an id means nothing outside the registry that minted it -- a cache that
  // outlived the census would serve this program's forms to the next one.
  const cache = newStructuralFormCache();
  const partition = partitionMints(mintLogSnapshot(), input.shapes, input.unions, cache);

  const fnsByModule = new Map<string, IrFunction[]>();
  const unplacedFunctions: string[] = [];
  for (const fn of input.functions) {
    const file = fn.loc?.file;
    if (file === undefined || file === "") {
      unplacedFunctions.push(fn.name);
      continue;
    }
    const list = fnsByModule.get(file);
    if (list === undefined) fnsByModule.set(file, [fn]);
    else list.push(fn);
  }

  const globalsByModule = new Map<string, IrGlobal[]>();
  const unplacedGlobals: string[] = [];
  for (const g of input.globals) {
    const mod = moduleOfGlobal(g.id, input.moduleOfTag);
    if (mod === null) {
      unplacedGlobals.push(g.id);
      continue;
    }
    const list = globalsByModule.get(mod);
    if (list === undefined) globalsByModule.set(mod, [g]);
    else list.push(g);
  }

  // Spread conditionally: exactOptionalPropertyTypes distinguishes "absent"
  // from "present and undefined", and the two mean different things here --
  // absent is "not evaluated at this layer", which the report says out loud.
  const outcomes: ModuleOutcome[] = [];
  const buildRefusals = buildRefusesFragments(
    input.npmStatic === undefined ? {} : { npmStatic: input.npmStatic },
  );
  const census = newFragmentCensus();
  const modules = new Set([...fnsByModule.keys(), ...partition.byModule.keys()]);

  for (const module of [...modules].sort()) {
    const functions = fnsByModule.get(module) ?? [];
    const globals = globalsByModule.get(module) ?? [];
    const mints = partition.byModule.get(module) ?? [];
    const minted = new Set(mints.map((m) => m.localId));
    const referenced = referencedIds({ f: functions, g: globals });

    const fragment: LoweringFragment = {
      version: FRAGMENT_VERSION,
      module,
      functions,
      globals,
      mints,
      edges: [],
      witness: {
        readEntities: deriveReadEntities(referenced, minted, input.shapes, input.unions, cache),
        // Empty, deliberately: no refusal code reads these, so the census is
        // exact for the classes it counts. See the header.
        helpersReused: [],
        reachableSubset: [],
        moduleGraph: [],
        overflowGranted: [],
        overflowDenied: [],
        overflowUnanswered: [],
      },
      probes: [],
    };

    const refusals = [...buildRefusals, ...fragmentUnusableReasons(fragment)];
    censusRecord(census, module, refusals, []);
    outcomes.push({
      module,
      cacheable: refusals.length === 0,
      codes: refusals.map((r) => r.code),
    });
  }

  return { census, outcomes, unplacedGlobals, unplacedFunctions };
}

/** Run and append the report, when asked. Never fails a build. */
export function flushFragmentCensus(input: CensusInput): void {
  const path = process.env["SCRIPTC_FRAGMENT_CENSUS"];
  if (path === undefined || path === "") return;
  const NL = String.fromCharCode(10);
  try {
    if (!mintLogActive()) {
      appendFileSync(
        path,
        "fragment census REFUSED for " + input.program + ": SCRIPTC_MINT_ORDER is not set, so the " +
          "mint log is empty and every module would report as having minted nothing. That reads as " +
          "'everything cacheable', which is the most flattering answer this rig can produce and would " +
          "come from an instrument that was never switched on." + NL,
      );
      return;
    }
    const r = collectCensus(input);
    const lines = [
      "program " + input.program,
      censusReport(r.census),
    ];
    // SAY WHAT WAS NOT EVALUATED rather than let a zero stand for it.
    // lowerToIr does not receive npmStatic, so the build-level refusal is
    // not checked here; reporting "npm-static 0" without this line would be
    // a measured-looking zero from a check that never ran.
    if (input.npmStatic === undefined) {
      lines.push("  note: build-level refusals (npm-static) were NOT evaluated at this layer; " +
        "the npm-static count above is 'not checked', not 'none'.");
    }
    if (r.unplacedGlobals.length > 0) {
      lines.push("  UNPLACED globals     " + String(r.unplacedGlobals.length) +
        "  (id did not parse to a known file tag; not assigned to any module)");
    }
    if (r.unplacedFunctions.length > 0) {
      lines.push("  UNPLACED functions   " + String(r.unplacedFunctions.length) + "  (no loc.file)");
    }
    appendFileSync(path, lines.join(NL) + NL);
    // The JOIN KEY, beside the report: one row per module, uncapped, so the
    // cacheable set can be weighted by the per-file attribution and the
    // answer can be given in SECONDS rather than in module count.
    const TAB = String.fromCharCode(9);
    const tsv = r.outcomes
      .map((o) => [o.module, o.cacheable ? "cacheable" : "refused", o.codes.join(",")].join(TAB))
      .join(NL);
    appendFileSync(path + ".modules.tsv", tsv + NL);
  } catch {
    // A census cannot fail a build.
  }
}
