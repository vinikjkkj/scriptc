/* THE ID-FREE STRUCTURAL FORM of a shape or a union.
 *
 * `r3541` names a record only inside the build that minted it. A per-module
 * lowering fragment therefore cannot store ids; it stores what the id NAMES,
 * expanded until nothing below the top level carries a number either.
 *
 * WHY EXPANDED, AND NOT ShapeRegistry.keyOf. keyOf spells a nested type as
 * "record:r3541", so it is structural exactly one level deep. This block's
 * first cross-build comparison used it and reported a confident wrong
 * answer: a perturbation minted one extra shape early, every nested
 * reference below it shifted by one, and 28 identical entities compared as
 * absent in each direction -- symmetric, plausible, and meaningless. Two
 * builds agree on the string below exactly when they minted the same
 * entity, whatever number each gave it.
 *
 * WHY IT WALKS THE IR AND NOT THE KEY STRING. Substituting ids inside
 * keyOf's output would be string surgery over a format nobody promised to
 * keep. This walks IrType directly, so a new type kind is a type error here
 * rather than a silently unexpanded "record:rN" riding through.
 *
 * CYCLES. A recursive shape references itself; the walk cuts with a De
 * Bruijn-style back-reference -- %back(k), k counted from the current
 * position back to the repeat -- so a recursive shape has exactly one
 * spelling regardless of where the walk entered it.
 *
 * WHAT IS DELIBERATELY EXCLUDED, and this is fragment.ts's rule 3 made
 * mechanical: ownmask, reqabsent and srcproto are OUTPUTS of armOwnMasks,
 * which runs after every body is down and is replayed on every build. A
 * fragment storing them would be storing a decision another library's code
 * is allowed to change. SHAPE_FIELD_ROLE below forces the question for
 * every field: adding one to IrRecordShape without classifying it is a type
 * error, because a union with no runtime enumeration fails silently and
 * this one is read by a cache.
 */

import type { IrRecordShape, IrType, IrUnionDef } from "../../ir/nodes.js";

/** Minimal lookups, so this is testable without constructing a registry. */
export interface ShapeLookup {
  get(shapeId: string): IrRecordShape | undefined;
}
export interface UnionLookup {
  get(unionId: string): IrUnionDef | undefined;
}

/** Every field of IrRecordShape, classified. The compiler rejects this
 * object if a field is added and not named here.
 *
 *   "identity"   part of what the shape IS before any cross-module pass;
 *                enters the structural form.
 *   "later-pass" written by a pass that runs after the last body and is
 *                replayed on every build; must NOT enter (rule 3).
 *   "id"         the positional name itself; never enters (rule 2).
 */
const SHAPE_FIELD_ROLE: Record<keyof IrRecordShape, "identity" | "later-pass" | "id"> = {
  id: "id",
  fields: "identity",
  tuple: "identity",
  indexValue: "identity",
  declaredOrder: "identity",
  tostr: "identity",
  builtin: "identity",
  ownmask: "later-pass",
  reqabsent: "later-pass",
  srcproto: "later-pass",
};

/** Every field of IrUnionDef, classified on the same rule. */
const UNION_FIELD_ROLE: Record<keyof IrUnionDef, "identity" | "later-pass" | "id"> = {
  id: "id",
  arms: "identity",
  armLits: "identity",
};

/** Exported so a test can assert the classification is exhaustive from the
 * TYPE rather than from a list somebody remembered to extend. */
export const structuralIdentityFields = {
  shape: (Object.keys(SHAPE_FIELD_ROLE) as (keyof IrRecordShape)[]).filter((k) => SHAPE_FIELD_ROLE[k] === "identity"),
  shapeExcluded: (Object.keys(SHAPE_FIELD_ROLE) as (keyof IrRecordShape)[]).filter((k) => SHAPE_FIELD_ROLE[k] !== "identity"),
  union: (Object.keys(UNION_FIELD_ROLE) as (keyof IrUnionDef)[]).filter((k) => UNION_FIELD_ROLE[k] === "identity"),
  unionExcluded: (Object.keys(UNION_FIELD_ROLE) as (keyof IrUnionDef)[]).filter((k) => UNION_FIELD_ROLE[k] !== "identity"),
};

const J = JSON.stringify;

/** The canonical id-free form of one type. */
export function structuralForm(
  type: IrType,
  shapes: ShapeLookup,
  unions: UnionLookup,
  path: readonly string[] = [],
): string {
  switch (type.kind) {
    case "record":
      return structuralFormOfShape(type.shapeId, shapes, unions, path);
    case "union":
      return structuralFormOfUnion(type.unionId, shapes, unions, path);
    case "array":
      return `array<${structuralForm(type.elem, shapes, unions, path)}>`;
    case "map":
      return `map<${structuralForm(type.key, shapes, unions, path)},${structuralForm(type.value, shapes, unions, path)}>`;
    case "set":
      return `set<${structuralForm(type.elem, shapes, unions, path)}>`;
    case "promise":
      return `promise<${structuralForm(type.inner, shapes, unions, path)}>`;
    case "weakmap":
      return `weakmap<${structuralForm(type.key, shapes, unions, path)},${structuralForm(type.value, shapes, unions, path)}>`;
    case "generator":
    case "asyncGenerator":
      return `${type.kind}<${structuralForm(type.yieldT, shapes, unions, path)},` +
        `${structuralForm(type.retT, shapes, unions, path)},${structuralForm(type.nextT, shapes, unions, path)}>`;
    case "func": {
      const params = type.params.map((t) => structuralForm(t, shapes, unions, path)).join(",");
      const tail = J({ rest: type.rest, restAbi: type.restAbi });
      return `func(${params})->${structuralForm(type.ret, shapes, unions, path)}${tail}`;
    }
    default:
      // Every other kind is a LEAF whose spelling carries no id: the
      // primitives, the unit arms, the opaque runtime classes. JSON of the
      // node is its identity.
      //
      // This default is a silent fallthrough by construction, and writing
      // this file proved the point: array/map/set/promise were handled and
      // weakmap, generator, asyncGenerator and func were NOT -- four kinds
      // that carry nested IrType and would have JSON-stringified a literal
      // `"shapeId":"r3541"` straight into a form whose entire purpose is to
      // contain no id. Enumerating correctly is not the defence;
      // assertNoIdLeak below is, because it catches the kinds nobody
      // remembered, including ones added after this was written.
      return J(type);
  }
}

/** The defence that does not depend on having enumerated correctly.
 *
 * A structural form exists to carry no positional id. If one leaked -- via
 * the default above, via a type kind added later, via a nested node shape
 * nobody expected -- the fragment would key on a number meaningful only
 * inside the build that wrote it, and two builds of the same source would
 * miss forever while two builds of DIFFERENT sources could collide. Both
 * failures are silent.
 *
 * `"shapeId":"` and `"unionId":"` appear only when JSON.stringify emitted a
 * record or union node, which is exactly the leak. Cheap: one indexOf per
 * minted id, paid once per fragment write. */
export function assertNoIdLeak(form: string, what: string): string {
  if (form.includes('"shapeId":"') || form.includes('"unionId":"')) {
    throw new Error(
      `compiler bug: the structural form of ${what} contains a positional id. ` +
        `A type kind carrying a nested IrType is not handled by structuralForm and fell ` +
        `through to JSON, so the id rode into a form that must contain none. ` +
        `Form begins: ${form.slice(0, 160)}`,
    );
  }
  return form;
}

function structuralFormOfShape(
  shapeId: string,
  shapes: ShapeLookup,
  unions: UnionLookup,
  path: readonly string[],
): string {
  const at = path.indexOf(shapeId);
  if (at >= 0) return `%back(${path.length - at})`;
  const shape = shapes.get(shapeId);
  // A shape the registry does not hold is a PLACEHOLDER the walk reached
  // before finalizeRecursive filled it. It is opaque by construction, and
  // saying so is not the same as pretending it has no structure: a fragment
  // carrying one is counted, never silently compared as equal.
  if (shape === undefined) return "%unresolved";
  const next = [...path, shapeId];
  const parts: string[] = [];
  for (const f of shape.fields) {
    parts.push(`${J(f.name)}:${structuralForm(f.type, shapes, unions, next)}`);
  }
  let out = `record{${parts.join(",")}}`;
  if (shape.tuple === true) out += "|tuple";
  if (shape.indexValue !== undefined) {
    out += `|index<${structuralForm(shape.indexValue, shapes, unions, next)}>`;
  }
  if (shape.declaredOrder !== undefined) out += `|order${J(shape.declaredOrder)}`;
  if (shape.tostr === true) out += "|tostr";
  if (shape.builtin !== undefined) out += `|builtin${J(shape.builtin)}`;
  // ownmask / reqabsent / srcproto are NOT here, deliberately: see the
  // header and SHAPE_FIELD_ROLE.
  return out;
}

function structuralFormOfUnion(
  unionId: string,
  shapes: ShapeLookup,
  unions: UnionLookup,
  path: readonly string[],
): string {
  const at = path.indexOf(unionId);
  if (at >= 0) return `%back(${path.length - at})`;
  const def = unions.get(unionId);
  if (def === undefined) return "%unresolved";
  const next = [...path, unionId];
  const arms = def.arms.map((a) => structuralForm(a, shapes, unions, next));
  let out = `union[${arms.join(",")}]`;
  if (def.armLits !== undefined) out += `|lits${J(def.armLits)}`;
  return out;
}

/** True when a structural form reached a placeholder the registry could not
 * resolve. Such a form is still comparable, but it is LESS discriminating
 * than a fully expanded one, so a fragment counts them rather than letting
 * them pass as ordinary matches. */
export function structuralFormIsOpaque(form: string): boolean {
  return form.includes("%unresolved");
}
