/* The KIND-GATE control dials, and the one rule that decides which record
 * shapes take the wide lane — in ONE module, read by BOTH backends.
 *
 * Why this file exists at all. `SCRIPTC_KINDGATE_WIDE` and
 * `SCRIPTC_KINDGATE_MATCH` were born on the C lane (estado-kindgate.md)
 * while the LLVM lane still carried the matcher/builder PAIR, so there
 * was nowhere to put them there. Both lanes now emit one
 * `dynWalkerBody(t, name, B, soft)` behind two thin wrappers, and the
 * separation between "can this receiver satisfy this cast" and "which arm
 * does this value belong to" stopped being a BOUNDARY and became a
 * BOOLEAN. That is the hazard: an edit to the gate widens BOTH bodies
 * unless it says `soft ?`, and it has to say it in TWO files.
 *
 * So it says it in neither. `kindgateWideLane` is the whole decision —
 * the hard/soft split, the index-signature exclusion and the fieldless
 * exclusion — and each backend asks it rather than restating it. A future
 * edit to the rule lands on both lanes or on neither; there is no third
 * outcome to write a drift test for.
 *
 * The two dials themselves:
 *
 *   SCRIPTC_KINDGATE_WIDE    the HARD body only (!soft) — the builder.
 *                            Cannot move a union tag, because the arm
 *                            walker is untouched.
 *   SCRIPTC_KINDGATE_MATCH   the SOFT body as well — the arm decision.
 *                            This is what manufactures a silently wrong
 *                            union tag, and it is a CONTROL, never a
 *                            shipped default.
 *
 * Both ship OFF, and off they must emit ZERO bytes on either lane — the
 * proof is a byte diff of the emitted TU, not an assertion. Why they stay
 * off is estado-kindgate.md §3: a checked record cast MATERIALIZES, so a
 * widened array answers `length` right and `Array.isArray`, `typeof`,
 * `String()` and `JSON.stringify` wrong — 11 new SILENT divergences over
 * a generated 35-case surface population against 9 loud refusals turned
 * correct. */
import type { IrRecordShape } from "../ir/nodes.js";

/** The two dials, read once per emitter. */
export interface KindgateDials {
  /** The HARD (checked-builder) body's gate widens. */
  readonly wide: boolean;
  /** The SOFT (arm-walker) body's gate widens as well — the control. */
  readonly match: boolean;
}

/** Read the dials from the environment. MATCH implies WIDE: the matcher
 * control reuses the same projector, so asking for the soft half without
 * the hard one is not a state the emitters have to represent. */
export function readKindgateDials(env: NodeJS.ProcessEnv = process.env): KindgateDials {
  const match = env["SCRIPTC_KINDGATE_MATCH"] === "1";
  return { match, wide: match || env["SCRIPTC_KINDGATE_WIDE"] === "1" };
}

/** Both dials off — the shipped configuration, and the one every
 * byte-identity proof is taken against. */
export const KINDGATE_DIALS_OFF: KindgateDials = { wide: false, match: false };

/** The receiver kinds whose declared members this runtime CAN read, by
 * their `SCR_DYN_` suffix. The C lane spells them as enum names and the
 * LLVM lane as the numbers in `DK`; both take the list from here, so a
 * kind admitted on one lane cannot be refused on the other.
 *
 * OBJINST, MAP and BIG are absent on purpose: they carry no member table
 * and `sc_dyn_key_get` FENCES on all three rather than fabricate
 * `undefined` for a property Node reads fine — routing them here would
 * trade one loud refusal for a different loud refusal, not for a right
 * answer. NULL and UNDEF are absent because Node's message names the
 * property the program reached for first, and a projection reaches for
 * the shape's first declared field. */
export const KINDGATE_WIDE_KINDS = ["ARR", "STR", "BYTES", "ARRBUF", "NUM", "BOOL", "FUNC"] as const;

/** Does THIS record body, emitted in THIS discipline, take the wide lane?
 *
 * `soft` is the whole hard/soft split and the reason this is a function
 * and not a field: the hard body reads `wide`, the soft body reads
 * `match`, and neither backend gets to spell that conditional itself.
 *
 * A shape is excluded when it carries an index signature (a projection
 * carrying only declared keys would answer an empty overflow map where
 * Node has the array's own indices) or when it declares no field at all
 * (nothing to project). Tuple shapes never reach here — their gate is the
 * ARRAY kind, not the OBJECT one. */
export function kindgateWideLane(
  dials: KindgateDials,
  soft: boolean,
  shape: IrRecordShape,
): boolean {
  return (soft ? dials.match : dials.wide) && !shape.indexValue && shape.fields.length > 0;
}
