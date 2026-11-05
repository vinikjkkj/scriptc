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
import type { IrRecordShape, IrType } from "../ir/nodes.js";

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

/** The INSTANCE lane: a boxed class instance (SCR_DYN_OBJINST) read through a record
 * type, the way Node reads it - `x as R` is erased, so every member R declares is
 * answered by the instance itself, a getter or a method or an inherited one included.
 *
 * It is NOT behind the dials. The dials guard kinds whose projection would
 * manufacture a wrong union tag or answer `length` for an array; an instance has a
 * member table (scr_dyn_objinst_member_get) and no other record arm can claim it, so
 * the lane is on for every record target that is not a tuple (a tuple's gate is the
 * ARRAY kind). Both the hard builder and the soft arm walker take it. The union
 * builder tries every CLASS arm before a record arm for an instance (see the
 * instance pass in its emitters), so a `Hdr | Rec` union keeps the class tag.
 *
 * `enabled` is moduleUsesInstanceRecordLane: a module with no boxable class or no checked
 * cast has no instance receiver to read, and keeps its exact TU.
 *
 * `allOwn` says the shape has an index signature: the projection then carries every
 * own enumerable key of the instance, which is the overflow Node would show. */
export function kindgateInstanceLane(shape: IrRecordShape, enabled: boolean): { allOwn: boolean } | null {
  if (!enabled || shape.tuple) return null;
  return { allOwn: shape.indexValue !== undefined };
}

/** The FUNCTION lane: a function value (a class value, an arrow, `x.constructor`) read through a record whose declared members are all
 * data properties a function owns and never changes - `name` and `length`. A function IS an object in JavaScript, so `fn as { name: string }`
 * answers the name; the projection is exact because those two properties are immutable, so the copy cannot go stale (the reason the
 * array/string wide lane stays off does not apply). FUNC receivers only, in the builder and in the union arm walker (a function does have a name), independent of the dials. */
/** A union whose ONLY non-unit arm is one record carrying a function-typed member (`BindOpts | undefined`): the
 * index of that arm, or null. With no sibling arm there is nothing for a function signature to disambiguate. */
export function soleRecordArmWithFuncMember(
  def: { readonly arms: readonly IrType[] },
  records: ReadonlyMap<string, IrRecordShape>,
  unions: ReadonlyMap<string, { readonly arms: readonly IrType[] }>,
): number | null {
  let found = -1;
  for (let i = 0; i < def.arms.length; i++) {
    const a = def.arms[i]!;
    if (a.kind === "undefinedT" || a.kind === "nullT") continue;
    if (found >= 0 || a.kind !== "record") return null;
    found = i;
  }
  if (found < 0) return null;
  const sh = records.get((def.arms[found] as IrType & { kind: "record" }).shapeId);
  if (sh === undefined || sh.tuple === true) return null;
  const hasFn = (t: IrType): boolean =>
    t.kind === "func" || (t.kind === "union" && (unions.get(t.unionId)?.arms ?? []).some((x) => x.kind === "func"));
  return sh.fields.some((f) => hasFn(f.type)) ? found : null;
}

/** The ENGINE lane: an object the embedded engine built (a `new Function` result's rows) read through a record by KIND, its declared
 * members answered by the engine's own [[Get]]. Open only in a module with engine functions; every other module keeps its exact TU. */
export function kindgateJsvalLane(shape: IrRecordShape, engineModule: boolean): { allOwn: boolean } | null {
  if (!engineModule || shape.tuple) return null;
  if (shape.fields.length === 0 && shape.indexValue === undefined) return null;
  return { allOwn: shape.indexValue !== undefined };
}

export function kindgateFuncLane(_soft: boolean, shape: IrRecordShape): boolean {
  return (
    !shape.tuple && shape.indexValue === undefined && shape.fields.length > 0 &&
    shape.fields.every((f) => f.name === "name" || f.name === "length")
  );
}
