/* SHAPE UNIFICATION — the record width copy's identity defect, closed at
 * the layout instead of at the copy.
 *
 * `const n: Narrow = wide` is a RELABEL in TypeScript: `n` and `wide` name
 * the very same object, and a write through either is visible through the
 * other. scriptc's records are monomorphic C structs, so the flow lowers to
 * `%rec.width.N` — a FRESH struct with the destination's fields copied
 * across — and the program then holds two objects where JavaScript holds
 * one. Measured, `exit 0`, no diagnostic beyond SC6004's advice: node prints
 * `9 9` where we print `1 9` (tests/harness/record-width-copy.test.ts).
 *
 * The route taken here is the one that costs NOTHING at runtime. Where the
 * narrow shape can afford to CARRY the wider shape's extra members, the two
 * shapes become ONE shape — same struct, same offsets, all of them still
 * compile-time constants — and the copy that used to stand between them
 * collapses to the identity. Neither backend changes; no instance grows a
 * runtime tag; the pass is a rewrite of the frontend's shape table plus the
 * elision of a call. Its failure mode is exactly today's behaviour: an edge
 * it declines keeps the `%rec.width.N` copy it has now, unchanged.
 *
 * WHERE IT RUNS. Not in interning. `shapes` fills as bodies lower, and
 * recordWidthPlan/recordWidthHelper intern ON DEMAND, so the edge set is not
 * complete until the last body is down. It runs after lowering and before
 * the backend reads `mod.records` — after reconcileKeyOrders (whose
 * declaredOrder decisions are the input to the key-order obligation below)
 * and before reportRecordWidthCopies, so SC6004 falls silent at exactly the
 * sites this closed and keeps speaking at every one it did not.
 *
 * THE CAP IS +2 FIELDS, and it is what makes "carry the extra members"
 * honest. A one-field view of a 62-field message is what gets allocated in
 * a loop; growing it by sixty-one to spare a copy is a trade nobody asked
 * for. The measured components run to +109. Two is the width at which the
 * fix is invisible.
 *
 * ADMISSION IS PER EDGE, greedily, TIGHTEST UNION FIRST — not per component.
 * A component is a transitive closure; one wide member drags every narrow
 * one past the cap and the whole component drops. Taking the tightest edge
 * first grows the components that fit and leaves the rest as they were.
 *
 * AND IT IS A FIXPOINT, because merging changes field TYPES. A field of type
 * `r5` becomes `r_canon`, which can make two fields that disagreed today
 * agree tomorrow — and those are not corner cases: the disagreeing pair is
 * very often ITSELF a width pair this same pass unifies one level down.
 * Judging conflicts on the types as they are PRINTED declines components the
 * pass can serve. So admission and substitution iterate to convergence, and
 * only what survives that is a genuine conflict.
 *
 * TWO OBLIGATIONS THE GROWTH NUMBER HIDES.
 *
 *   OWN KEYS. A grown shape must not start reporting its added fields to
 *   Object.keys, JSON.stringify or Object.hasOwn. `{a: 1}` typed `{a:
 *   number}` has ONE key in JavaScript however wide the struct behind it is.
 *   The existing undefined-arm rule answers this exactly — and only — for an
 *   added field that is OPTIONAL-FLAVORED, because the unset field IS the
 *   undefined arm and every own-key surface already reads it that way. A
 *   required added field (`drop: number`) has no such arm, and the per-
 *   instance own-key MASK cannot stand in for one: byte 0 is a validity flag
 *   that only a dynCheck crossing writes, so an ordinary literal falls
 *   straight back to the undefined-arm rule the required field has no answer
 *   for. Arming the mask on the shape without a writer at every construction
 *   would trade an identity bug for an enumeration bug, which is not a
 *   trade. So THE EDGE IS DECLINED: every field this pass adds to any member
 *   is optional-flavored, and the completion it writes is literally
 *   recordWidthPlan's own `absent`/`absentDyn` arm.
 *   packages/compiler/test/per-instance-keys.test.ts is the oracle.
 *
 *   OWN-KEY ORDER. `JSON.stringify` prints declaredOrder, so the merged
 *   layout has to preserve EVERY member's own field order — the merged order
 *   restricted to a member's own fields must be that member's order, exactly.
 *   That is a topological merge of the members' orders, and a cycle between
 *   two of them (`{a, b}` against `{b, a}`) is a conflict like any other: the
 *   edge is declined. The merge is verified member by member after it is
 *   built, rather than trusted from the algorithm.
 *
 * WHAT IS OUT OF REACH, and stays that way. An edge is a candidate only when
 * every arm of its plan is a straight field copy, a nested width, or an
 * absent completion. Every other arm — `wrap`, `retag`, `arr`, `liftWrap`,
 * `funcAdapt`, `ovfCapture`, `dynIn`, `keyRead:*` — means the two shapes
 * disagree about a field's TYPE, which a shared layout cannot represent, and
 * tuples never relate by width at all. Those keep the copy. So do index-
 * signature shapes (the overflow is not a field list), builtin renderings
 * and shapes carrying internal `%` slots (both are part of a shape's
 * interned identity, and merging would move it).
 */
import { appendFileSync } from "node:fs";
import type { IrExpr, IrFunction, IrRecordShape, IrType, SrcLoc } from "../../ir/nodes.js";
import { internalSlotFields, typeKey, UNDEFINED_T } from "../../ir/nodes.js";
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";

/** The cap, in FIELDS a member may gain. Decided on measurement: it takes
 * the components where the extra members are a rounding error on the struct
 * and declines the ones where a one-field view would grow by eighty-one. */
const GROWTH_CAP = 2;

/** One candidate edge: an interned `%rec.width.N` whose whole plan is
 * copies, nested widths and absent completions. */
interface Edge {
  from: string;
  to: string;
  /** The interned helper's name — elided when the two ends merge. */
  helper: string;
}

/** What the pass did, for the report dial and for the tests. */
export interface UnifyOutcome {
  /** Interned record width helpers seen. */
  helpers: number;
  /** ...of those, edges whose every arm the layout can represent. */
  candidates: number;
  /** ...of those, edges admitted (their helper is now the identity). */
  admitted: number;
  /** Merged components, and the members in each. */
  components: string[][];
  /** Declined candidates, by the first rule that blocked them. */
  declined: Record<string, number>;
}

export function unifyWidthShapes(L: Lowerer, functions: IrFunction[]): UnifyOutcome {
  const notes: string[] = [];
  const note = (line: string): void => {
    if (process.env["SCRIPTC_UNIFY_WHY"]) notes.push(line);
  };
  const declined: Record<string, number> = {};
  const decline = (why: string): false => {
    declined[why] = (declined[why] ?? 0) + 1;
    return false;
  };

  // ── the candidate edges ────────────────────────────────────────────────
  // Nodes are shape ids and edges come from the interned width-helper table,
  // not from a re-walk of the program: the table IS the set of pairs the
  // program actually asked to copy.
  const edges: Edge[] = [];
  let helpers = 0;
  // Names a recordLit EVALUATES but does not store (`drop` entries) may not
  // become declared fields — the validator reads that as a silently dropped
  // store, and it is right to. Reserved per shape, before any admission.
  const dropNames = new Map<string, Set<string>>();
  collectDropNames(functions, L, dropNames);

  for (const [key, helper] of L.widthHelpers) {
    if (!key.startsWith("rec:")) continue;
    helpers++;
    const parts = key.split(":");
    if (parts.length !== 3) continue;
    const from = parts[1]!;
    const to = parts[2]!;
    if (from === to) continue;
    const why = mergeable(L, from) ?? mergeable(L, to);
    if (why !== null) {
      decline(why);
      note(`${from}->${to} ${why}`);
      continue;
    }
    const plan = L.recordWidthPlan(from, to);
    if (plan === null) {
      decline("no-plan");
      continue;
    }
    let ok = true;
    for (const arm of plan.values()) {
      if ("absent" in arm || "absentDyn" in arm) continue;
      if ("keyRead" in arm) {
        ok = decline("arm-keyread");
        break;
      }
      if (arm.lift.how !== "copy" && arm.lift.how !== "width") {
        ok = decline(`arm-${arm.lift.how}`);
        break;
      }
    }
    if (!ok) continue;
    edges.push({ from, to, helper });
  }

  // ── union-find, greedy, tightest first, to a fixpoint ──────────────────
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    let c = id;
    while (parent.get(c) !== undefined && parent.get(c) !== c) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const members = new Map<string, Set<string>>();
  const seed = (id: string): void => {
    if (parent.has(id)) return;
    parent.set(id, id);
    members.set(id, new Set([id]));
  };
  for (const e of edges) {
    seed(e.from);
    seed(e.to);
  }

  /** A field type's canonical key UNDER THE MERGE SO FAR: a record naming a
   * shape that has already been merged spells its component's root, so two
   * fields that disagree today and agree once the pass is done read equal
   * here. This is the whole reason admission is a fixpoint. */
  const canon = (t: IrType): string => canonKey(L, t, find, 0);
  /** The type's spelling AFTER the substitution this pass will perform: the
   * only thing that moves is a record's shape id, so two field types that
   * differ solely by a merged shape become the SAME type and the merged
   * slot has one type every reader already expects. What this does NOT
   * canonicalize is a union ID -- two unions whose arms become identical
   * keep their separate ids, and a shared slot would then be typed one of
   * them and read as the other. That residue is a conflict, and it is
   * counted apart from a genuine type disagreement. */
  const subst = (t: IrType): string => substKey(t, find, 0);

  const shapeOf = (id: string): IrRecordShape => L.shapes.get(id)!;
  const ownFields = (id: string): { name: string; type: IrType }[] => shapeOf(id).fields;
  const orderOf = (id: string): string[] => {
    const s = shapeOf(id);
    return s.declaredOrder ?? s.fields.map((f) => f.name);
  };

  /** Would merging these two components hold? The answer is a merged field
   * list, or a reason it is not one. */
  const tryMerge = (
    ra: string,
    rb: string,
  ): { fields: { name: string; type: IrType }[]; order: string[] } | string => {
    const ms = [...members.get(ra)!, ...members.get(rb)!];
    // The merged field list, by name, with the first member that declares a
    // name deciding its type — and every other member that declares it
    // having to AGREE, canonically.
    const byName = new Map<string, { name: string; type: IrType }>();
    for (const m of ms) {
      for (const f of ownFields(m)) {
        const had = byName.get(f.name);
        if (had === undefined) {
          byName.set(f.name, f);
          continue;
        }
        if (canon(had.type) !== canon(f.type)) return `conflict-field-type ${f.name}: ${canon(had.type)} vs ${canon(f.type)}`;
        if (subst(had.type) !== subst(f.type)) return `conflict-type-spelling ${f.name}: ${subst(had.type)} vs ${subst(f.type)}`;
      }
    }
    const names = [...byName.keys()];
    // THE CAP.
    for (const m of ms) {
      if (names.length - ownFields(m).length > GROWTH_CAP) return `over-cap ${m} +${names.length - ownFields(m).length}`;
    }
    // OBLIGATION 1 — every field this adds to any member must be optional-
    // flavored, so the unset slot IS the undefined arm and every own-key
    // surface answers what JavaScript answers.
    for (const m of ms) {
      const have = new Set(ownFields(m).map((f) => f.name));
      const reserved = dropNames.get(m);
      for (const n of names) {
        if (have.has(n)) continue;
        if (reserved?.has(n) === true) return `added-shadows-a-drop-entry ${n}`;
        const t = byName.get(n)!.type;
        if (absentable(L, t)) continue;
        // MEASUREMENT ONLY, and REPORT-ONLY by construction (the rewrite
        // below refuses to run under it): what obligation 1 costs, counted
        // instead of assumed. Admitting a required added field needs a
        // per-instance own-key mask WRITER at every record construction --
        // ownPresentCondC falls back to the undefined-arm rule on an
        // instance whose mask byte 0 is zero, and a required field has no
        // arm to fall back to, so it answers "present" for a key the
        // object does not have.
        if (process.env["SCRIPTC_UNIFY_COUNT_REQUIRED"] === "1") continue;
        // Split for the report, not for the rule: a SCALAR added field is
        // the one class the own-key mask could carry if it had a writer at
        // every construction, and counting it separately is how the cost of
        // not building that writer is stated rather than assumed.
        return `${t.kind === "f64" || t.kind === "bool" ? "added-field-required-scalar" : "added-field-required-other"} ${m}+${n}:${t.kind}`;
      }
    }
    // OBLIGATION 2 — one order that restricts to every member's own order.
    const order = mergeOrders(ms.map((m) => orderOf(m)), names);
    if (order === null) return `order-cycle ${ms.join(",")}`;
    for (const m of ms) {
      const have = new Set(ownFields(m).map((f) => f.name));
      const restricted = order.filter((n) => have.has(n));
      const want = orderOf(m);
      if (restricted.length !== want.length || restricted.some((n, i) => n !== want[i])) {
        return `order-not-preserved ${m}`;
      }
    }
    const fields = names
      .map((n) => byName.get(n)!)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { fields, order };
  };

  const admitted = new Set<Edge>();
  const merged = new Map<string, { fields: { name: string; type: IrType }[]; order: string[] }>();
  for (;;) {
    let best: { edge: Edge; result: { fields: { name: string; type: IrType }[]; order: string[] } } | null = null;
    for (const e of edges) {
      if (admitted.has(e)) continue;
      const ra = find(e.from);
      const rb = find(e.to);
      if (ra === rb) {
        // Already one component through some other edge: the helper is the
        // identity either way, so the edge is admitted for free.
        admitted.add(e);
        continue;
      }
      const r = tryMerge(ra, rb);
      if (typeof r === "string") continue;
      // TIGHTEST UNION FIRST: the smallest merged field list wins, then the
      // smallest growth, then the edge's own name so the choice is stable.
      if (
        best === null ||
        r.fields.length < best.result.fields.length ||
        (r.fields.length === best.result.fields.length && `${e.from}:${e.to}` < `${best.edge.from}:${best.edge.to}`)
      ) {
        best = { edge: e, result: r };
      }
    }
    if (best === null) break;
    const ra = find(best.edge.from);
    const rb = find(best.edge.to);
    const all = new Set([...members.get(ra)!, ...members.get(rb)!]);
    parent.set(rb, ra);
    members.set(ra, all);
    members.delete(rb);
    merged.delete(rb);
    merged.set(ra, best.result);
    admitted.add(best.edge);
  }

  // Everything that never made it, named by the first rule that blocked it —
  // re-asked once at the fixpoint, so the reasons reported are the ones that
  // actually survived rather than the ones a mid-run state produced.
  for (const e of edges) {
    if (admitted.has(e)) continue;
    const r = tryMerge(find(e.from), find(e.to));
    if (typeof r === "string") {
      decline(r.split(" ")[0]!);
      note(`${e.from}->${e.to} ${r}`);
    }
  }

  const components = [...members.values()].filter((s) => s.size > 1).map((s) => [...s].sort());
  const outcome: UnifyOutcome = {
    helpers,
    candidates: edges.length,
    admitted: admitted.size,
    components,
    declined,
  };
  // MEASUREMENT ONLY: one JSONL row per compilation, never consulted by the
  // compiler. SCRIPTC_UNIFY=0 is the OFF dial for a differential against the
  // copy this pass replaces.
  const report = process.env["SCRIPTC_UNIFY_REPORT"];
  if (report !== undefined && report !== "") {
    try {
      appendFileSync(
        report,
        JSON.stringify({
          prog: process.env["SCRIPTC_WIDTH_CENSUS_PROG"] ?? "",
          remainder: L.remainder,
          ...outcome,
          // The width census's own flows, and how many of them this closed.
          sites: L.allWidthSites.length,
          closedSites: L.allWidthSites.filter((s) => find(s.fromId) === find(s.toId)).length,
          // Every merged shape and the component it landed in, so the
          // width census's own site rows can be joined against it.
          roots: Object.fromEntries(
            components.flatMap((c) => c.map((id) => [id, c[0]!] as const)),
          ),
        }) + "\n",
      );
    } catch {
      /* the report never fails a build */
    }
  }
  if (process.env["SCRIPTC_UNIFY_WHY"]) {
    const prog = process.env["SCRIPTC_WIDTH_CENSUS_PROG"] ?? "";
    for (const e of edges) if (admitted.has(e)) notes.push(`${e.from}->${e.to} ADMITTED`);
    for (const n of notes) console.error(`[unify] ${prog} ${n}`);
  }
  if (process.env["SCRIPTC_UNIFY"] === "0") return outcome;
  // The counting dial admits edges this pass cannot correctly rewrite.
  if (process.env["SCRIPTC_UNIFY_COUNT_REQUIRED"] === "1") return outcome;
  if (components.length === 0) return outcome;

  // ── the rewrite ────────────────────────────────────────────────────────
  // One canonical id per component: the member with the most fields, so the
  // widest shape's layout is the one that does not move and the narrow ones
  // point at it. Ties go to the lowest-numbered id, for determinism.
  const remap = new Map<string, string>();
  for (const [root, ms] of members) {
    if (ms.size < 2) continue;
    const m = merged.get(root)!;
    const canonId = [...ms].sort((a, b) => {
      const d = shapeOf(b).fields.length - shapeOf(a).fields.length;
      return d !== 0 ? d : idNum(a) - idNum(b);
    })[0]!;
    // The canonical shape maps to ITSELF on purpose: a component whose
    // members disagree about more than one name (`{a,b}` against `{a,c}`)
    // grows the canonical too, and its own literals need completing exactly
    // like the narrow ones. The id rewrite that entry drives is a no-op.
    for (const id of ms) remap.set(id, canonId);
    const shape = shapeOf(canonId);
    // The canonical shape's OWN field types still name pre-merge shapes;
    // substitution below rewrites them in place along with everything else.
    shape.fields = m.fields;
    shape.declaredOrder = m.order;
    // A hidden per-instance slot any member carried, the whole component
    // carries: the members are one struct now.
    for (const id of ms) {
      const s = shapeOf(id);
      if (s.tostr) shape.tostr = true;
      if (s.ownmask) shape.ownmask = true;
      if (s.srcproto) shape.srcproto = true;
    }
  }

  // The helpers whose two ends landed in one component: the copy IS the
  // identity now, so the call goes and the function with it.
  const elided = new Set<string>();
  for (const e of edges) {
    if (find(e.from) === find(e.to)) elided.add(e.helper);
  }

  substitute(L, functions, remap, elided);

  // SC6004 speaks at the sites that still copy, and only those.
  {
    const kept = L.widthCopySites.filter((s) => canonOf(remap, s.fromId) !== canonOf(remap, s.toId));
    L.widthCopySites.length = 0;
    L.widthCopySites.push(...kept);
  }
  // A helper that no longer exists cannot carry a key-enumeration risk.
  for (const name of elided) L.keyRiskHelpers.delete(name);

  return outcome;
}

/** `r12` → 12, for a deterministic tie-break. */
function idNum(id: string): number {
  const n = Number(id.slice(1));
  return Number.isFinite(n) ? n : 0;
}

function canonOf(remap: Map<string, string>, id: string): string {
  return remap.get(id) ?? id;
}

/** A shape this pass may move at all. Tuples are positional and never width-
 * relate; an index signature carries an overflow map that is not a field
 * list; a builtin RENDERING and the internal `%` slot set are both part of a
 * shape's interned identity, and merging would move it under a value the
 * runtime itself builds. */
function mergeable(L: Lowerer, id: string): string | null {
  const s = L.shapes.get(id);
  if (!s) return "not-mergeable-unknown-shape";
  if (s.tuple) return "not-mergeable-tuple";
  if (s.indexValue !== undefined) return "not-mergeable-index-signature";
  if (s.builtin !== undefined) return "not-mergeable-builtin-rendering";
  if (internalSlotFields(s).length > 0 || s.fields.some((f) => f.name.startsWith("%"))) {
    return "not-mergeable-internal-slot";
  }
  return null;
}

/** Can an UNSET slot of this type spell "this instance does not have this
 * key"? Exactly recordWidthPlan's absent rule: an undefined-armed union, or
 * a dyn holding the dyn undefined. Nothing else, because nothing else is a
 * value every own-key surface already reads as absence. */
function absentable(L: Lowerer, t: IrType): boolean {
  if (t.kind === "dyn") return true;
  if (t.kind !== "union") return false;
  const def = L.unions.get(t.unionId);
  return def !== undefined && def.arms.some((a) => a.kind === "undefinedT");
}

/** The undefined value for an absentable slot — recordWidthPlan's `absent`
 * and `absentDyn` arms, written at a literal instead of at a copy. */
function absentValue(L: Lowerer, t: IrType, loc: SrcLoc): IrExpr {
  if (t.kind === "dyn") return dynUndefinedExpr(loc);
  if (t.kind !== "union") throw new Error("shape-unify bug: absent completion of a non-absentable field");
  const def = L.unions.get(t.unionId)!;
  const tag = def.arms.findIndex((a) => a.kind === "undefinedT");
  return {
    kind: "unionWrap",
    unionId: t.unionId,
    tag,
    value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
    type: t,
    loc,
  };
}

/** A type's spelling after the record substitution, with union ids left
 * exactly where they are — the test for "will these two type objects be
 * structurally identical once this pass has run?". */
function substKey(t: IrType, find: (id: string) => string, depth: number): string {
  if (depth > 32) return "…";
  switch (t.kind) {
    case "record":
      return `rec<${find(t.shapeId)}>`;
    case "array":
      return `array<${substKey(t.elem, find, depth + 1)}>`;
    case "map":
      return `map<${substKey(t.key, find, depth + 1)},${substKey(t.value, find, depth + 1)}>`;
    case "set":
      return `set<${substKey(t.elem, find, depth + 1)}>`;
    case "promise":
      return `promise<${substKey(t.inner, find, depth + 1)}>`;
    default:
      return typeKey(t);
  }
}

/** A type's identity UNDER a pending merge. Records answer their component's
 * root and stop — which is what terminates this on self-referential shapes —
 * and everything else expands structurally so that a union differing only in
 * a merged arm reads equal to its twin. */
function canonKey(L: Lowerer, t: IrType, find: (id: string) => string, depth: number): string {
  if (depth > 32) return "…";
  switch (t.kind) {
    case "record":
      return `rec<${find(t.shapeId)}>`;
    case "union": {
      const def = L.unions.get(t.unionId);
      if (!def) return `union<${t.unionId}>`;
      return `union[${def.arms.map((a) => canonKey(L, a, find, depth + 1)).join("|")}]`;
    }
    case "array":
      return `array<${canonKey(L, t.elem, find, depth + 1)}>`;
    case "map":
      return `map<${canonKey(L, t.key, find, depth + 1)},${canonKey(L, t.value, find, depth + 1)}>`;
    case "set":
      return `set<${canonKey(L, t.elem, find, depth + 1)}>`;
    case "promise":
      return `promise<${canonKey(L, t.inner, find, depth + 1)}>`;
    default:
      return typeKey(t);
  }
}

/** One order that restricts to every input order. Kahn's algorithm over the
 * precedence pairs the inputs state; null when two of them disagree, which
 * is a conflict like a field-type disagreement and declines the edge. The
 * available node with the earliest first appearance wins, so the merged
 * order reads like the members' own. */
function mergeOrders(orders: string[][], names: string[]): string[] | null {
  const first = new Map<string, number>();
  let seq = 0;
  for (const o of orders) for (const n of o) if (!first.has(n)) first.set(n, seq++);
  for (const n of names) if (!first.has(n)) first.set(n, seq++);
  const after = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();
  for (const n of names) {
    after.set(n, new Set());
    indeg.set(n, 0);
  }
  for (const o of orders) {
    for (let i = 0; i + 1 < o.length; i++) {
      const a = o[i]!;
      const b = o[i + 1]!;
      if (!after.has(a) || !after.has(b)) return null;
      if (after.get(a)!.has(b)) continue;
      after.get(a)!.add(b);
      indeg.set(b, indeg.get(b)! + 1);
    }
  }
  const out: string[] = [];
  const ready = names.filter((n) => indeg.get(n) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => first.get(a)! - first.get(b)!);
    const n = ready.shift()!;
    out.push(n);
    for (const m of after.get(n)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  return out.length === names.length ? out : null;
}

/** Every name a recordLit EVALUATES but does not store, per shape. Such a
 * name may not become a declared field of that shape (the validator reads a
 * drop entry over a declared field as a silently dropped store), so it is
 * reserved before admission rather than discovered at rewrite time. */
function collectDropNames(functions: IrFunction[], L: Lowerer, out: Map<string, Set<string>>): void {
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const o = n as Record<string, unknown>;
    if (o["kind"] === "recordLit") {
      const t = o["type"] as { kind?: string; shapeId?: string } | undefined;
      const fs = o["fields"];
      if (t?.kind === "record" && typeof t.shapeId === "string" && Array.isArray(fs)) {
        for (const f of fs as { name?: unknown; drop?: unknown }[]) {
          if (f.drop === true && typeof f.name === "string") {
            const s = out.get(t.shapeId) ?? new Set<string>();
            s.add(f.name);
            out.set(t.shapeId, s);
          }
        }
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(functions);
  walk(L.globalsList);
}

/** The whole-IR rewrite: every shape id its component's canonical id, every
 * literal of a shape that grew completed with the undefined arm for what it
 * gained, and every call of a helper whose two ends met replaced by its own
 * argument. Types inside the shape and union tables move too — a merged
 * shape reached only as another shape's FIELD type is otherwise left naming
 * an id the module no longer declares. */
function substitute(L: Lowerer, functions: IrFunction[], remap: Map<string, string>, elided: Set<string>): void {
  const seen = new Set<object>();
  /** Returns the node that should stand in this slot — itself, except where
   * an elided helper's call collapses to its argument. */
  const walk = (n: unknown): unknown => {
    if (n === null || typeof n !== "object") return n;
    if (Array.isArray(n)) {
      if (seen.has(n)) return n;
      seen.add(n);
      for (let i = 0; i < n.length; i++) n[i] = walk(n[i]);
      return n;
    }
    if (seen.has(n)) return n;
    seen.add(n);
    const o = n as Record<string, unknown>;
    // The literal's completion has to read the shape it had BEFORE the id
    // moves — the fields it does not name are exactly what it gained.
    if (o["kind"] === "recordLit") {
      const t = o["type"] as { kind?: string; shapeId?: string } | undefined;
      if (t?.kind === "record" && typeof t.shapeId === "string") {
        const to = remap.get(t.shapeId);
        if (to !== undefined) {
          const target = L.shapes.get(to)!;
          const fs = o["fields"] as { name: string; value: IrExpr; overflow?: true; drop?: true }[];
          const named = new Set(fs.filter((f) => f.overflow !== true && f.drop !== true).map((f) => f.name));
          const loc = o["loc"] as SrcLoc;
          for (const f of target.fields) {
            if (named.has(f.name)) continue;
            fs.push({ name: f.name, value: absentValue(L, f.type, loc) });
          }
        }
      }
    }
    for (const key of Object.keys(o)) {
      if (key === "loc") continue;
      const v = o[key];
      if ((key === "shapeId" || key === "resultShapeId") && typeof v === "string") {
        const to = remap.get(v);
        if (to !== undefined) o[key] = to;
        continue;
      }
      o[key] = walk(v);
    }
    // The copy that is now the identity. Done AFTER the argument is walked,
    // so the value handed up is fully rewritten.
    if (o["kind"] === "call" && typeof o["callee"] === "string" && elided.has(o["callee"])) {
      const args = o["args"] as IrExpr[];
      if (args.length === 1) return args[0];
    }
    return n;
  };
  walk(functions);
  walk(L.globalsList);
  // Class DEFS carry field types of their own, and moduleArtifacts assembles
  // the module's classes out of them AFTER this pass runs: a shape reached
  // only as a class field's type would otherwise keep naming an id the
  // module no longer declares.
  for (const c of L.classes.values()) walk(c.def);
  for (const f of L.ffiImports) walk(f);
  // Field and index types of every shape, and every union's arms: reached by
  // neither of the two walks above.
  for (const s of L.shapes.shapes) {
    for (const f of s.fields) f.type = walk(f.type) as IrType;
    if (s.indexValue) s.indexValue = walk(s.indexValue) as IrType;
  }
  for (const u of L.unions.unions) {
    for (let i = 0; i < u.arms.length; i++) u.arms[i] = walk(u.arms[i]) as IrType;
  }
  // The registered own-key guards and inspect prefixes name shapes directly.
  for (const g of L.ownKeyGuards) {
    const to = remap.get(g.shapeId);
    if (to !== undefined) g.shapeId = to;
  }
  for (const n of L.nullProtoRenderings) {
    const to = remap.get(n.shapeId);
    if (to !== undefined) n.shapeId = to;
  }
  // The elided helpers themselves: nothing calls them any more.
  if (elided.size > 0) {
    const drop = (fns: IrFunction[]): void => {
      for (let i = fns.length - 1; i >= 0; i--) if (elided.has(fns[i]!.name)) fns.splice(i, 1);
    };
    drop(functions);
    drop(L.liftedFns);
  }
}
