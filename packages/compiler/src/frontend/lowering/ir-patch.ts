/* DEFERRED IR REWRITES, DESCRIBED AS DATA.
 *
 * Four registries on the Lowerer hold rewrites that a post-lowering pass
 * installs over IR the walk has already emitted: the own-key presence
 * guards (armOwnMasks), the required-slot `in` guards (armOwnMasks), the
 * null-prototype inspect prefixes (armOwnMasks), and the enumeration-order
 * refills (reconcileKeyOrders). Each one exists because its answer is a
 * whole-program fact, and the site that must change is already IR by the
 * time the answer is known.
 *
 * Until now each site registered a JS CLOSURE that patched its node in
 * place. A closure is the right spelling for a rewrite that only ever runs
 * inside the process that built it, and the wrong one for a rewrite that
 * has to survive being written to disk and read back: a serialized lowering
 * fragment cannot carry a closure, so every one of these sites would
 * silently lose its patch, and a lost patch is an own-key question answered
 * with the wrong constant — a silently wrong binary, not a build failure.
 *
 * So each site now passes a DESCRIPTOR: a tagged data record naming which
 * rewrite to perform and with which parameters, plus the live anchor it
 * performs it on (the statement list and index, or the node object). The
 * anchor is the part that cannot be serialized; the descriptor is the part
 * that must be. A fragment writer resolves each anchor to a PATH through
 * the function tree it is writing, and a fragment reader resolves the path
 * back to an anchor — the parameters ride across unchanged.
 *
 * THE POINT OF THE SPLIT IS THAT THERE IS ONE IMPLEMENTATION. `applyOwnKey`
 * and friends below are the only code that performs these rewrites, and
 * they are reached identically from a live lowering and from a replayed
 * fragment. A descriptor whose data twin disagreed with its closure would
 * be a silently wrong binary of exactly the kind this file exists to
 * prevent; there is no second implementation for it to disagree with.
 *
 * ADDING A MEMBER TO ANY UNION HERE: the applier switches exhaustively and
 * ends in a `never` check, so an unhandled kind is a type error rather than
 * a fallthrough. That is deliberate — a union with no runtime enumeration
 * fails silently, and this one is read by a cache.
 */

import { appendFileSync } from "node:fs";
import type { IrExpr, IrStmt, IrType, SrcLoc } from "../../ir/nodes.js";
import { BOOL, STRING, UNDEFINED_T } from "../../ir/nodes.js";

/** A slot in a statement list: the anchor most of these rewrites address.
 *
 * `holder` is the live array and `at` the index. Both are meaningless
 * across a serialization boundary and both are recovered from a path. */
export interface StmtSlot {
  holder: IrStmt[];
  at: number;
}

/** A node rewritten IN PLACE — the registration exists precisely because
 * the site holds no handle to the node's container (an argument inside an
 * emitted call, a literal embedded in a statement). Mutating the object
 * itself is the only spelling available. */
export interface NodeSlot {
  node: Record<string, unknown>;
}

/* DID THE PATCH ACTUALLY FIRE?
 *
 * A byte-identity run that shows 1,476 programs unchanged proves the
 * converted rewrites are equivalent to the closures they replaced ONLY for
 * the rewrites some program actually performed. A patch kind that never
 * fires anywhere in the corpus is untested by that run and would look
 * exactly as green.
 *
 * So each applier counts itself. SCRIPTC_PATCH_CENSUS=<path> appends one
 * JSON object per process with the per-kind totals; unset, the counting is
 * two integer increments and nothing reads them. This is the same stance
 * as the lowering profile: production-inert, and it cannot fail a build.
 */
const NL = String.fromCharCode(10);
const patchCensus = new Map<string, number>();
function notePatch(kind: string): void {
  patchCensus.set(kind, (patchCensus.get(kind) ?? 0) + 1);
}
/** Flush the census, if one was asked for. Called once per build. */
export function flushPatchCensus(program: string): void {
  const path = process.env["SCRIPTC_PATCH_CENSUS"];
  if (path === undefined || path === "") return;
  try {
    appendFileSync(path, JSON.stringify({ program, ...Object.fromEntries([...patchCensus].sort()) }) + NL);
  } catch { /* never fails a build */ }
  patchCensus.clear();
}

/* ------------------------------------------------------------------ */
/* Own-key presence guards                                             */
/* ------------------------------------------------------------------ */

/** How one registered own-key guard re-spells itself once arming is known.
 * The `present` expression armOwnMasks supplies is the same in every case
 * (`recordKeyPresent` over the guard's own shape and field); what differs
 * is where it goes. */
export type OwnKeyPatch =
  /** Replace the statement at `slot` with `if (present) { inner }`,
   * optionally nested inside a tag test that stays OUTERMOST.
   *
   * The outer test is not decoration. Object.values/entries push the
   * field NARROWED to its non-undefined arm, so admitting a key the mask
   * calls own while the slot still holds the undefined arm would narrow
   * an undefined arm and read the wrong payload. Object.keys pushes a
   * string literal and needs no such guard, and passes `outer: null`. */
  | {
      kind: "guardStmt";
      slot: StmtSlot;
      inner: IrStmt;
      outer: { unionId: string; tag: number; value: IrExpr } | null;
      loc: SrcLoc;
    }
  /** Set the `value` of a `return` statement to `present` — the hasOwn
   * helper, whose whole body is one guarded return per field. */
  | { kind: "returnValue"; stmt: IrStmt & { kind: "return" } }
  /** Replace one field's value in an already-built record literal with
   * `present ? <the value the walk built> : <the undefined arm>`.
   *
   * `expect` is an IDENTITY check, not a convenience: the desugar that
   * registered this may have rebuilt the literal since, and re-spelling a
   * slot that now holds a different value would install this field's
   * guard over another field's expression. When it does not match, the
   * patch is a no-op — the same stance `owner` gives the helper rebuilds. */
  | {
      kind: "literalField";
      fields: { name: string; value: IrExpr }[];
      slot: number;
      field: string;
      expect: IrExpr;
      undefArm: { tag: number; unionType: IrType & { kind: "union" } };
      loc: SrcLoc;
    };

/** Perform one own-key rewrite. The ONLY implementation. */
export function applyOwnKey(p: OwnKeyPatch, present: IrExpr): void {
  notePatch("ownKey." + p.kind);
  switch (p.kind) {
    case "guardStmt": {
      const inner: IrStmt = {
        kind: "if",
        cond: present,
        then: [p.inner],
        else_: null,
        loc: p.loc,
      };
      p.slot.holder[p.slot.at] =
        p.outer === null
          ? inner
          : {
              kind: "if",
              cond: {
                kind: "unionIsTag",
                unionId: p.outer.unionId,
                tag: p.outer.tag,
                negated: true,
                value: p.outer.value,
                type: BOOL,
                loc: p.loc,
              },
              then: [inner],
              else_: null,
              loc: p.loc,
            };
      return;
    }
    case "returnValue": {
      p.stmt.value = present;
      return;
    }
    case "literalField": {
      const entry = p.fields[p.slot];
      if (!entry || entry.name !== p.field || entry.value !== p.expect) return;
      entry.value = {
        kind: "ternary",
        cond: present,
        then: p.expect,
        else_: {
          kind: "unionWrap",
          unionId: p.undefArm.unionType.unionId,
          tag: p.undefArm.tag,
          value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: p.loc },
          type: p.undefArm.unionType,
          loc: p.loc,
        },
        type: p.undefArm.unionType,
        loc: p.loc,
      };
      return;
    }
    default: {
      const never: never = p;
      throw new Error(`compiler bug: unhandled own-key patch ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Required-slot `in` guards                                           */
/* ------------------------------------------------------------------ */

/** How one registered `in`-over-a-required-field re-spells itself once the
 * COMPLETION targets are known. */
export type SlotFilledPatch =
  /** The statically-true `boolLit` becomes the per-instance question.
   * Rewritten in place: the literal is already embedded in whatever
   * expression the walk built around it. */
  | {
      kind: "boolToSlotFilled";
      slot: NodeSlot;
      obj: IrExpr;
    }
  /** An inspect renderer's per-field statement becomes conditional on the
   * slot being filled. Also in place, and for the same reason.
   *
   * Scoped to `recordSlotFilled` rather than the own-key question on
   * purpose: it is the COMPLETED bit alone that makes a slot unreadable,
   * and a crossing-armed shape must keep rendering what it materialised. */
  | {
      kind: "guardStmtInPlace";
      slot: NodeSlot;
      obj: IrExpr;
      loc: SrcLoc;
    };

/** Perform one required-slot rewrite. The ONLY implementation.
 *
 * `shapeId` and `field` are the REGISTRY ENTRY's, deliberately: shape
 * unification remaps the entry's shapeId, and a patch carrying its own copy
 * would keep pointing at a shape that no longer exists. */
export function applySlotFilled(p: SlotFilledPatch, shapeId: string, field: string): void {
  notePatch("slotFilled." + p.kind);
  switch (p.kind) {
    case "boolToSlotFilled": {
      const n = p.slot.node;
      delete n["value"];
      n["kind"] = "recordSlotFilled";
      n["obj"] = p.obj;
      n["shapeId"] = shapeId;
      n["field"] = field;
      return;
    }
    case "guardStmtInPlace": {
      const holder = p.slot.node;
      const inner = { ...holder } as unknown as IrStmt;
      for (const k of Object.keys(holder)) delete holder[k];
      Object.assign(holder, {
        kind: "if",
        cond: {
          kind: "recordSlotFilled",
          obj: p.obj,
          shapeId,
          field,
          type: BOOL,
          loc: p.loc,
        },
        then: [inner],
        else_: null,
        loc: p.loc,
      });
      return;
    }
    default: {
      const never: never = p;
      throw new Error(`compiler bug: unhandled slot-filled patch ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Null-prototype inspect prefixes                                     */
/* ------------------------------------------------------------------ */

/** An inspect helper that baked an `[Object: null prototype]` prefix from
 * the shape's builtin flag, revised into the per-instance question.
 *
 * TWO nodes, always: the open brace and the depth-gated `[Object]` form.
 * They are one descriptor because they are one decision — a shape whose
 * prefix becomes per-instance must ask the instance in both renderings or
 * the two disagree within a single inspect. */
export interface NullProtoPatch {
  kind: "perInstancePrefix";
  loc: SrcLoc;
  nodes: { slot: NodeSlot; obj: IrExpr; whenNull: string; plain: string }[];
}

/** Perform one null-prototype revision. The ONLY implementation.
 *
 * `shapeId` is the REGISTRY ENTRY's — see applySlotFilled. */
export function applyNullProto(p: NullProtoPatch, shapeId: string): void {
  notePatch("nullProto." + p.kind);
  if (p.kind !== "perInstancePrefix") {
    const never: never = p.kind;
    throw new Error(`compiler bug: unhandled null-proto patch ${JSON.stringify(never)}`);
  }
  for (const n of p.nodes) {
    const tern: IrExpr = {
      kind: "ternary",
      cond: {
        kind: "recordNullProto",
        obj: n.obj,
        shapeId,
        type: BOOL,
        loc: p.loc,
      },
      then: { kind: "strLit", value: n.whenNull, type: STRING, loc: p.loc },
      else_: { kind: "strLit", value: n.plain, type: STRING, loc: p.loc },
      type: STRING,
      loc: p.loc,
    } as unknown as IrExpr;
    const holder = n.slot.node;
    for (const k of Object.keys(holder)) delete holder[k];
    Object.assign(holder, tern);
  }
}

/* ------------------------------------------------------------------ */
/* Enumeration-order refills                                           */
/* ------------------------------------------------------------------ */

/** An interned helper whose BODY bakes a shape's enumeration order, and
 * the parameters that rebuild it over a re-picked one.
 *
 * Four of the six enumeration surfaces read `declaredOrder` at emission
 * time and follow a re-pick for free. These bake it, so reconcileKeyOrders
 * has to rebuild them — and a rebuild that is a closure is a rebuild a
 * cached fragment cannot perform, which would leave the helper enumerating
 * one order while JSON.stringify enumerates another. That disagreement is
 * a new defect, not a partial fix, so the descriptor carries everything the
 * rebuild reads: all of it is IR data or a registry lookup, never a
 * `ts.Node`.
 *
 * The rebuild IMPLEMENTATION is not here. It lives beside the construction
 * it mirrors (lower-calls.ts), registered into `ENUM_REFILLS` at module
 * load, so the code that fills a body and the code that refills it cannot
 * drift apart in separate files. What is here is the descriptor and the
 * dispatch, which is the part a fragment has to carry. */
export interface EnumRefill {
  /** Selects the implementation in `ENUM_REFILLS`. */
  impl: "obj.keys" | "obj.values" | "obj.entries";
  /** The interned helper's module-function name — the `owner` whose
   * registered own-key guards a refill drops before registering them
   * again over the rebuilt body. */
  helper: string;
  /** The record shape whose declaredOrder this body bakes. */
  shapeId: string;
  /** The helper's own IR: its statement list (rebuilt in place), the
   * receiver and accumulator refs, the result type, and the location
   * every synthesized node carries. */
  body: IrStmt[];
  recvRef: IrExpr;
  outRef: IrExpr;
  resultT: IrType;
  loc: SrcLoc;
  /** values/entries only: the result ELEMENT type each field's value
   * flows into, and the [string, V] tuple type entries packs. */
  valueT: IrType | null;
  tupleT: (IrType & { kind: "record" }) | null;
  /** FIRST FILL ONLY, and deliberately not serialized: the call node the
   * values/entries construction blames when a field's type cannot re-tag
   * into the result element, plus the member as the source spelled it.
   *
   * A REFILL cannot reach those arms. They are per-field type decisions —
   * `typeEquals`, the arm count, whether the value coerces — and a re-pick
   * changes only the ORDER the same fields are visited in. A first fill
   * that did reach one threw PoisonError out of `unsupported` before the
   * descriptor was ever registered, so no refillable helper exists whose
   * fill refused. The impl therefore throws a compiler bug rather than
   * skipping the refusal, which is the loud half of the trade: a fragment
   * that somehow lost a refusal must stop the build, not ship the binary
   * the refusal was protecting against. */
  diag?: { node: unknown; member: string };
}

/** One refill implementation, as registered by the module that owns the
 * matching construction. `L` is the Lowerer — typed loosely here so this
 * module stays free of the 15k-line import cycle; every implementation
 * narrows it immediately. */
export type EnumRefillImpl = (L: unknown, r: EnumRefill) => void;

/** impl name -> implementation. Populated at module load by the lowering
 * modules that own each construction. A descriptor naming an impl that is
 * not registered throws rather than silently skipping the rebuild — the
 * stale-helper failure this whole file exists to make loud. */
export const ENUM_REFILLS = new Map<string, EnumRefillImpl>();

/** Register one refill implementation (called at module load). */
export function registerEnumRefill(impl: string, fn: EnumRefillImpl): void {
  const prior = ENUM_REFILLS.get(impl);
  if (prior !== undefined && prior !== fn) {
    throw new Error(`compiler bug: two implementations registered for enum refill ${impl}`);
  }
  ENUM_REFILLS.set(impl, fn);
}

/** Run one refill. The ONLY dispatch.
 *
 * `why` separates the two callers in the census, and the distinction is the
 * one that matters: "fill" is the body a helper is born with, "rebuild" is
 * reconcileKeyOrders giving it a re-picked key order. A census that folded
 * them would report the descriptor as exercised while the REBUILD path --
 * the only reason the descriptor exists -- had never run. */
export function applyEnumRefill(L: unknown, r: EnumRefill, why: "fill" | "rebuild"): void {
  notePatch("enumRefill." + r.impl + "." + why);
  const fn = ENUM_REFILLS.get(r.impl);
  if (fn === undefined) {
    throw new Error(
      `compiler bug: enumeration-order refill '${r.impl}' for helper ${r.helper} has no registered ` +
        `implementation (a cached lowering fragment cannot rebuild it, and the helper would keep a ` +
        `stale key order while the emission-time surfaces follow the re-picked one)`,
    );
  }
  fn(L, r);
}
