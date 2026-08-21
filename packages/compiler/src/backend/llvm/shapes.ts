/* Type-directed RC/trace/box dispatch tables of the LLVM backend, the
 * cycle-capability fixpoint, and per-record-shape emission — the .ll
 * mirror of the C emitter's emit-types.ts + emit-shapes.ts slice that the
 * phase-2 tier needs. Everything here follows the SAME contracts the C
 * backend compiled into the runtime: `_v` adapters where a container
 * stores RC entry points as data, per-shape retain/release/new (and
 * trace/teardown for cycle-capable shapes) with `size_t rc` at offset 0,
 * scr_obj_alloc_note/scr_obj_free_note bracketing every shape allocation
 * so the sanitized lane's RC audit stays exact.
 *
 * Anything outside the tier refuses loudly (LlvmUnsupportedError naming
 * the type kind) — the tables never guess. */
import type { IrModule, IrRecordShape, IrType } from "../../ir/nodes.js";
import { DYN, funcOf, isRefCounted, mapOf, ownMaskBytes, ownMaskKeyBit, RUNTIME_EMITTER_CLASS, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES, STRING, VOID } from "../../ir/nodes.js";
import {
  mangleClassRelease,
  mangleClassTrace,
  mangleRecordGcFree,
  mangleRecordNew,
  mangleRecordRelease,
  mangleRecordRetain,
  mangleRecordStruct,
  mangleRecordTrace,
} from "../mangle.js";
import { arrayElemIsRef, mapKeyAccess as mapKeyAccessC, rcAdapters } from "../emission/emit-types.js";
import { LlvmUnsupportedError } from "./unsupported.js";
import type { BlockBuilder } from "./blocks.js";

/** What the tables need from the emitter: the extern-declaration ledger
 * and the module-wide cycle/shape indexes. */
export interface ShapeHost {
  declare(decl: string): void;
  /** Request the shared OOM abort helper (@sc_oom) — emitted once. */
  needOom(): void;
  readonly tracedShapes: Set<string>;
  readonly tracedUnions: Set<string>;
  readonly recordsById: Map<string, IrRecordShape>;
}

/** Every emitted function/helper carries #0 = { sanitize_address } — see
 * the emitter header. */
export const FN_ATTRS = "#0";

/* ── cycle capability (the CEmitter constructor's fixpoint, ported) ────
 * Greatest fixpoint over shapes and unions: start optimistic (everything
 * cycle-capable), repeatedly drop shapes with no cycle-capable field and
 * unions with no cycle-capable arm until stable. Closures and promises
 * are always cycle-capable; strings never are; arrays/maps inherit their
 * element/value type's capability. A HIERARCHY is one unit of capability
 * (a base-typed slot can hold any subclass and retain touches the cycle
 * header, so header presence must be uniform across an extends tree): a
 * unit is cycle-capable iff ANY member is — CEmitter's unit grouping,
 * ported. */
export function computeTraced(mod: IrModule): { shapes: Set<string>; unions: Set<string> } {
  const tracedShapes = new Set<string>();
  const tracedUnions = new Set<string>();
  const classes = mod.classes ?? [];
  const shapeDefs = [
    ...classes.map((c) => ({
      key: `object:${c.name}`,
      fields: c.name === RUNTIME_EMITTER_CLASS
        ? [...c.fields, { name: "<listeners>", type: funcOf([], VOID) }]
        : c.fields,
    })),
    // A shape that armed the HIDDEN toString slot carries one more member
    // — a `() => string` closure, unconditionally cycle-capable (the
    // class→record projection's closure captures the very instance the
    // record was made from) — so the slot joins the fixpoint exactly like
    // <overflow>. emitter.ts's C twin carries the same row.
    ...(mod.records ?? []).map((r) => ({
      key: `record:${r.id}`,
      fields: [
        ...r.fields,
        ...(r.indexValue ? [{ name: "<overflow>", type: mapOf(STRING, r.indexValue) }] : []),
        ...(r.tostr ? [{ name: "<toString>", type: funcOf([], STRING) }] : []),
      ],
    })),
  ];
  for (const s of shapeDefs) tracedShapes.add(s.key);
  for (const u of mod.unions ?? []) tracedUnions.add(u.id);
  // Hierarchy units: root lookup over the base links (classes with a base
  // or a subclass — and the runtime emitter class — form units under their
  // root; standalone classes and records stay singleton units).
  const baseOf = new Map(classes.map((c) => [c.name, c.base ?? null] as const));
  const hasChildren = new Set(classes.map((c) => c.base).filter((b): b is string => b !== undefined));
  const rootOf = (name: string): string => {
    let cur = name;
    for (let b = baseOf.get(cur); b !== null && b !== undefined; b = baseOf.get(cur)) cur = b;
    return cur;
  };
  const unitKeyOf = (key: string): string => {
    if (!key.startsWith("object:")) return key;
    const name = key.slice("object:".length);
    const inHierarchy =
      typeof baseOf.get(name) === "string" || hasChildren.has(name) || name === RUNTIME_EMITTER_CLASS;
    return inHierarchy ? `object:${rootOf(name)}` : key;
  };
  const units = new Map<string, typeof shapeDefs>();
  for (const s of shapeDefs) {
    const unit = unitKeyOf(s.key);
    let members = units.get(unit);
    if (!members) units.set(unit, (members = []));
    members.push(s);
  }
  const cycleCapable = (t: IrType): boolean => {
    switch (t.kind) {
      case "func":
      case "promise":
      // A dyn value is a collector node with its own header — emitter.ts's
      // row has the story. (This copy is also still missing that file's
      // abortSignal/abortController rows; that divergence is pre-existing
      // and out of this change's scope.)
      case "dyn":
        return true;
      case "object":
        return tracedShapes.has(`object:${t.className}`);
      case "record":
        return tracedShapes.has(`record:${t.shapeId}`);
      case "union":
        return tracedUnions.has(t.unionId);
      case "map":
        return cycleCapable(t.value);
      case "array":
        return cycleCapable(t.elem);
      default:
        return false;
    }
  };
  let shrunk = true;
  while (shrunk) {
    shrunk = false;
    for (const members of units.values()) {
      if (
        tracedShapes.has(members[0]!.key) &&
        !members.some((s) => s.fields.some((f) => cycleCapable(f.type)))
      ) {
        for (const s of members) tracedShapes.delete(s.key);
        shrunk = true;
      }
    }
    for (const u of mod.unions ?? []) {
      if (tracedUnions.has(u.id) && !u.arms.some(cycleCapable)) {
        tracedUnions.delete(u.id);
        shrunk = true;
      }
    }
  }
  return { shapes: tracedShapes, unions: tracedUnions };
}


/* ── RC dispatch ──────────────────────────────────────────────────────── */

/** The runtime's `_v` (ptr → ptr / ptr → void) RC entry points for one
 * refcounted type — used both as the CALL targets of the LLVM tier's
 * retain/release (everything is `ptr` here, so the `_v` shape IS the
 * direct shape) and as the function-pointer arguments of every container
 * construction (unions, ref arrays, obj boxes, overflow maps). Records
 * use their emitted per-shape helpers, whose signatures are already
 * `_v`-shaped. */
export function vAdapters(host: ShapeHost, t: IrType): { retain: string; release: string } {
  // DERIVED, not copied: emit-types.ts's rcAdapters is the one table, and
  // this tier is a pure rewriting of it — `@` on every name, a `declare`
  // for the runtime-provided pairs, and nothing for the per-shape helpers
  // the program TU emits itself (already `ptr`-shaped here, so the base
  // name IS the `_v` shape). The hand-written switch this replaces had
  // drifted nine kinds behind its C twin; there is no longer a second
  // list that CAN drift.
  const a = rcAdapters(t);
  if (a === null) throw new LlvmUnsupportedError(`rc:${t.kind}`);
  if (a.origin !== "emitted") {
    host.declare(`declare ptr @${a.retain}(ptr)`);
    host.declare(`declare void @${a.release}(ptr)`);
  }
  return { retain: `@${a.retain}`, release: `@${a.release}` };
}

/** The retain call target (ptr → ptr, +1 unless immortal) — the `_v`
 * table above; the split exists so call sites read type-directedly. */
export function retainSym(host: ShapeHost, t: IrType): string {
  return vAdapters(host, t).retain;
}

/** The release call target (ptr → void, NULL-tolerant). The runtime's
 * typed releases are external symbols, so the direct (non-`_v`) entry
 * points serve where one exists; records use their emitted helper. */
export function releaseSym(host: ShapeHost, t: IrType): string {
  switch (t.kind) {
    case "caught":
      host.declare(`declare void @scr_caught_release(ptr)`);
      return "@scr_caught_release";
    case "string":
      host.declare(`declare void @scr_str_release(ptr)`);
      return "@scr_str_release";
    case "array":
      host.declare(`declare void @scr_arr_release(ptr)`);
      return "@scr_arr_release";
    case "map":
    case "set":
      host.declare(`declare void @scr_map_release(ptr)`);
      return "@scr_map_release";
    case "union":
      host.declare(`declare void @scr_union_release(ptr)`);
      return "@scr_union_release";
    case "promise":
      host.declare(`declare void @scr_promise_release(ptr)`);
      return "@scr_promise_release";
    case "bytes":
      host.declare(`declare void @scr_bytes_release(ptr)`);
      return "@scr_bytes_release";
    case "url":
      host.declare(`declare void @scr_url_release_v(ptr)`);
      return "@scr_url_release_v";
    case "searchParams":
      host.declare(`declare void @scr_sp_release_v(ptr)`);
      return "@scr_sp_release_v";
    case "stats":
      host.declare(`declare void @scr_stats_release_v(ptr)`);
      return "@scr_stats_release_v";
    case "spawnRes":
      host.declare(`declare void @scr_spawn_res_release_v(ptr)`);
      return "@scr_spawn_res_release_v";
    case "child":
      host.declare(`declare void @scr_child_release_v(ptr)`);
      return "@scr_child_release_v";
    case "childStream":
      host.declare(`declare void @scr_child_stream_release_v(ptr)`);
      return "@scr_child_stream_release_v";
    case "generator":
      host.declare(`declare void @scr_gen_release(ptr)`);
      return "@scr_gen_release";
    case "func":
      host.declare(`declare void @scr_closure_release(ptr)`);
      return "@scr_closure_release";
    case "symbol":
      host.declare(`declare void @scr_sym_release(ptr)`);
      return "@scr_sym_release";
    case "regex":
      host.declare(`declare void @scr_regex_release(ptr)`);
      return "@scr_regex_release";
    case "record":
      return `@${mangleRecordRelease(t.shapeId)}`;
    case "object":
      if (RUNTIME_ERROR_CLASSES.has(t.className)) {
        host.declare(`declare void @scr_error_release_v(ptr)`);
        return "@scr_error_release_v";
      }
      if (t.className === RUNTIME_EMITTER_CLASS) {
        host.declare(`declare void @scr_emitter_release_v(ptr)`);
        return "@scr_emitter_release_v";
      }
      if (RUNTIME_STREAM_CLASSES.has(t.className)) {
        host.declare(`declare void @scr_stream_release_v(ptr)`);
        return "@scr_stream_release_v";
      }
      return `@${mangleClassRelease(t.className)}`;
    case "classval":
      host.declare(`declare void @scr_classobj_release_v(ptr)`);
      return "@scr_classobj_release_v";
    case "fsWatcher":
      host.declare(`declare void @scr_watcher_release_v(ptr)`);
      return "@scr_watcher_release_v";
    case "jsval":
      host.declare(`declare void @scr_jsval_release_v(ptr)`);
      return "@scr_jsval_release_v";
    case "dyn":
      // scr_dyn_release releases the tree recursively; NULL-tolerant.
      host.declare(`declare void @scr_dyn_release(ptr)`);
      return "@scr_dyn_release";
    default:
      // Every remaining refcounted kind — the handle families, and the
      // bigint/crypto values whose absence from the switch above was the
      // whole of this tier's RC gap — shares its `_v` pair between both
      // roles: `void scr_x_release_v(void *)` IS the direct signature once
      // everything is `ptr`, and the thunk it forwards to is the same
      // NULL-tolerant release the typed entry point names. So this falls
      // through to the ONE table rather than repeating it, and a kind with
      // no adapters at all still leaves as the same loud `rc:` refusal
      // (rcAdapters answers null, vAdapters raises it).
      return vAdapters(host, t).release;
  }
}

/** The trace entry point for a payload/field type, or null when the type
 * cannot participate in a cycle — traceAdapterC's table over the LLVM
 * tier's kinds (promise/object rows are out of tier and unreachable:
 * their RC rows refuse first). */
export function traceAdapter(host: ShapeHost, t: IrType): string | null {
  switch (t.kind) {
    case "func":
      host.declare(`declare void @scr_closure_trace_v(ptr, ptr, ptr)`);
      return "@scr_closure_trace_v";
    // Unconditionally cycle-capable: a listener closure stored on a signal
    // can capture that signal, or the controller that owns it.
    case "abortSignal":
      host.declare(`declare void @scr_abort_signal_trace_v(ptr, ptr, ptr)`);
      return "@scr_abort_signal_trace_v";
    case "abortController":
      host.declare(`declare void @scr_abort_controller_trace_v(ptr, ptr, ptr)`);
      return "@scr_abort_controller_trace_v";
    case "promise":
      // Promises are unconditionally cycle-capable (a rejection payload
      // is an arbitrary thrown value) — emit-shapes.ts's row.
      host.declare(`declare void @scr_promise_trace_v(ptr, ptr, ptr)`);
      return "@scr_promise_trace_v";
    // Unconditionally cycle-capable, and the row that was missing entirely
    // — emit-shapes.ts's `dyn` row has the whole story.
    case "dyn":
      host.declare(`declare void @scr_dyn_trace_v(ptr, ptr, ptr)`);
      return "@scr_dyn_trace_v";
    case "union":
      if (!host.tracedUnions.has(t.unionId)) return null;
      host.declare(`declare void @scr_union_trace_v(ptr, ptr, ptr)`);
      return "@scr_union_trace_v";
    case "record":
      return host.tracedShapes.has(`record:${t.shapeId}`) ? `@${mangleRecordTrace(t.shapeId)}` : null;
    case "object":
      if (!host.tracedShapes.has(`object:${t.className}`)) return null;
      if (RUNTIME_ERROR_CLASSES.has(t.className)) {
        host.declare(`declare void @scr_error_trace(ptr, ptr, ptr)`);
        return "@scr_error_trace";
      }
      if (t.className === RUNTIME_EMITTER_CLASS) {
        // Unconditionally cycle-capable (the registry owns listener
        // closures) — the fixpoint's <listeners> field keeps the whole
        // emitter hierarchy in the traced set.
        host.declare(`declare void @scr_emitter_trace(ptr, ptr, ptr)`);
        return "@scr_emitter_trace";
      }
      if (RUNTIME_STREAM_CLASSES.has(t.className)) {
        host.declare(`declare void @scr_stream_trace(ptr, ptr, ptr)`);
        return "@scr_stream_trace";
      }
      return `@${mangleClassTrace(t.className)}`;
    case "map":
      if (traceAdapter(host, t.value) === null) return null;
      host.declare(`declare void @scr_map_trace_v(ptr, ptr, ptr)`);
      return "@scr_map_trace_v";
    case "array":
      if (traceAdapter(host, t.elem) === null) return null;
      host.declare(`declare void @scr_arr_trace_v(ptr, ptr, ptr)`);
      return "@scr_arr_trace_v";
    default:
      return null;
  }
}

/** `@trace` or `null` — the trace argument at a container call site. */
export function traceArg(host: ShapeHost, t: IrType): string {
  return traceAdapter(host, t) ?? "null";
}

/* ── arrays ───────────────────────────────────────────────────────────── */

/** Runtime accessor suffix for an element type (matches emit-types.ts:
 * f64 and bool unboxed, everything refcounted through the `_ref` family). */
export function elemAccess(elem: IrType): "f64" | "bool" | "ref" {
  return elem.kind === "f64" ? "f64" : elem.kind === "bool" ? "bool" : "ref";
}

/** The ScrElemKind constant for the plain (non-REF) construction path. */
function elemKindNum(elem: IrType): number {
  switch (elem.kind) {
    case "f64":
      return 0; // SCR_ELEM_F64
    case "bool":
      return 1; // SCR_ELEM_BOOL
    case "string":
      return 2; // SCR_ELEM_STR
    case "array":
      return 3; // SCR_ELEM_ARR
    case "bytes":
      return 4; // SCR_ELEM_BYTES
    default:
      throw new LlvmUnsupportedError(`arrayElem:${elem.kind}`);
  }
}

/** Array construction call text (arrNewC's dispatch): ref elements
 * (records, unions, closures — and cycle-capable inner arrays, whose
 * SCR_ELEM_ARR spelling would hide them from the outer array's trace)
 * construct through scr_arr_new_ref with the element type's `_v` RC entry
 * points; every other element kind keeps the plain scr_arr_new call. */
export function arrNewCall(host: ShapeHost, elem: IrType, capText: string): string {
  // The SAME list the C backend and elemKindC use (arrayElemIsRef). This
  // used to be a third hand-maintained copy and had drifted: it was missing
  // map/set, so `Map<K,V>[]` refused the LLVM tier and fell back to C for no
  // reason. A cycle-capable inner array still answers from the trace
  // fixpoint here, exactly as in arrNewC.
  const useRef =
    elem.kind === "array"
      ? traceAdapter(host, elem) !== null
      : arrayElemIsRef(elem);
  if (!useRef) {
    host.declare(`declare ptr @scr_arr_new(i32, i64)`);
    return `call ptr @scr_arr_new(i32 ${elemKindNum(elem)}, i64 ${capText})`;
  }
  const v = vAdapters(host, elem);
  host.declare(`declare ptr @scr_arr_new_ref(ptr, ptr, ptr, i64)`);
  return `call ptr @scr_arr_new_ref(ptr ${v.retain}, ptr ${v.release}, ptr ${traceArg(host, elem)}, i64 ${capText})`;
}

/* ── capture boxes ────────────────────────────────────────────────────── */

/** Box construction call text (boxNewC's dispatch): plain-kind boxes for
 * the runtime-known payloads, obj-kind boxes (RC entry points + trace as
 * data) for per-shape payloads and cycle-capable arrays. SCR_BOX_* tags
 * from scr_runtime.h. */
export function boxNewCall(host: ShapeHost, t: IrType): string {
  const plain: Partial<Record<IrType["kind"], number>> = { f64: 0, bool: 1, string: 2, func: 4 };
  const kind = plain[t.kind];
  if (kind !== undefined) {
    host.declare(`declare ptr @scr_box_new(i32)`);
    return `call ptr @scr_box_new(i32 ${kind})`;
  }
  if (t.kind === "array" && traceAdapter(host, t) === null) {
    host.declare(`declare ptr @scr_box_new(i32)`);
    return `call ptr @scr_box_new(i32 3)`; // SCR_BOX_ARR
  }
  // Everything else that HAS RC adapters rides an obj-box carrying them
  // plus the payload's trace — boxNewC's rule, from boxNewC's table. The
  // hand-written chain this replaces was the seventh copy of that list and
  // was short the same nine kinds; `direct` (caught) has no void*-thunk to
  // store, and a catch binding is never captured.
  const rc = rcAdapters(t);
  if (rc !== null && rc.origin !== "direct") {
    const v = vAdapters(host, t);
    host.declare(`declare ptr @scr_box_new_obj(ptr, ptr, ptr)`);
    return `call ptr @scr_box_new_obj(ptr ${v.retain}, ptr ${v.release}, ptr ${traceArg(host, t)})`;
  }
  throw new LlvmUnsupportedError(`box:${t.kind}`);
}

/** Box accessor suffix (boxAccess): scalars unboxed, ref kinds pointers. */
export function boxAccess(t: IrType): "f64" | "bool" | "ref" {
  return t.kind === "f64" ? "f64" : t.kind === "bool" ? "bool" : "ref";
}

/* ── record shapes ────────────────────────────────────────────────────── */

/** A record field's in-struct LLVM type. bool fields store as i8 (the C
 * _Bool layout); loads/stores convert at the access site. */
export function llFieldType(t: IrType): "double" | "i8" | "ptr" {
  if (t.kind === "f64") return "double";
  if (t.kind === "bool") return "i8";
  // Everything else a record can hold is a refcounted heap value, and
  // "which kinds are those" is rcAdapters' question, not this table's —
  // the hand-written case list this replaces was a third copy of it and
  // had fallen the same nine kinds behind. A field the shape emitter can
  // store is exactly a field it can retain and release.
  if (rcAdapters(t) !== null) return "ptr";
  throw new LlvmUnsupportedError(`type:${t.kind}`);
}

/* ── maps and sets ────────────────────────────────────────────────────── */

/** Runtime suffix for a map's KEY kind: f64 with SameValueZero, string
 * content, or identity REF.
 *
 * IMPORTED, not copied — emit-types.ts's mapKeyAccess is the one table,
 * exactly as vAdapters imports rcAdapters above. The hand-written copy
 * this replaces admitted four kinds where its C twin admits seven, and
 * said so: "adding the suffix alone makes them compile and then
 * SEGFAULT — this side needs more than the accessor name". That was
 * true and is no longer: what the ref path needed was the ref-KEY
 * CONSTRUCTOR (scr_map_new_ref / scr_set_new_ref_traced), so the map
 * retains and releases its own keys, and emitMapNew/emitSetNew now call
 * it. Every other ref-key entry point — set/get/has/delete/iter_key/
 * to_arr — was already reachable through this same suffix.
 *
 * A kind the shared table calls a ref key but this tier cannot retain
 * still refuses cleanly: vAdapters raises `rc:<kind>` from rcAdapters.
 * And a kind NEITHER tier knows is an emitter bug there and a refusal
 * here, which is this tier's contract. */
export function mapKeyAccess(key: IrType): "f64" | "str" | "ref" {
  try {
    return mapKeyAccessC(key);
  } catch {
    throw new LlvmUnsupportedError(`mapKey:${key.kind}`);
  }
}

/** The ScrMapKeyKind / ScrMapValKind constants for scr_map_new. */
export function mapKeyKindNum(key: IrType): number {
  const acc = mapKeyAccess(key);
  return acc === "f64" ? 0 : acc === "str" ? 1 : 2;
}

export function mapValKindNum(value: IrType): number {
  return value.kind === "f64" ? 0 : value.kind === "bool" ? 1 : 2;
}

/** The RC-relevant members of a shape: every field, plus the overflow map
 * on index-signature shapes (one more map-typed member). `index` is the
 * member's field position in the emitted struct type (rc header at 0). */
function rcMembers(shape: IrRecordShape): { index: number; type: IrType; name: string }[] {
  return [
    ...shape.fields.map((f, i) => ({ index: i + 1, type: f.type, name: f.name })),
    ...(shape.indexValue
      ? [{ index: shape.fields.length + 1, type: mapOf(STRING, shape.indexValue), name: "[key: string] overflow" }]
      : []),
    // The hidden toString slot, LAST so no declared field's index moves —
    // released with the record and TRACED as a closure edge, the C
    // backend's rcMembers row exactly.
    ...(shape.tostr ? [{ index: toStrSlotIndex(shape), type: funcOf([], STRING), name: "<toString> slot" }] : []),
    // The hidden SOURCE [[Prototype]] slot, LAST — released with the record
    // and TRACED as a dyn edge, the C backend's rcMembers row exactly.
    ...(shape.srcproto ? [{ index: srcProtoSlotIndex(shape), type: DYN, name: "<source prototype> slot" }] : []),
  ];
}

/** The hidden toString slot's field index in the emitted struct type: rc
 * at 0, the declared fields, the overflow map on index-signature shapes,
 * then the slot. Shared by every getelementptr that reaches it, so the
 * layout is stated once. */
export function toStrSlotIndex(shape: IrRecordShape): number {
  return shape.fields.length + (shape.indexValue ? 1 : 0) + 1;
}

/** Emit the OWN-KEY question for `shape.fieldName` on the record in
 * register `recv`, returning an i1 register — the .ll twin of
 * ownPresentCondC, spelled with the same short-circuit so the two backends
 * evaluate the same loads on the same paths.
 *
 * Null means "unconditionally present": an unarmed shape whose field is
 * not undefined-armed has nothing to test, exactly as today.
 *
 * `dropUndefined` is the JSON.stringify rule — an undefined-VALUED own
 * property is still dropped from JSON output (`JSON.stringify({a:
 * undefined})` is `{}`), so there the two tests are a conjunction; every
 * other own-key surface (Object.keys, hasOwn, the record→dyn walker) asks
 * for own-ness alone, because `Object.keys({a: undefined})` is `["a"]`. */
export function emitOwnPresentLl(
  B: BlockBuilder,
  shape: IrRecordShape,
  fieldName: string,
  recv: string,
  utag: number,
  dropUndefined: boolean,
): string | null {
  const struct = mangleRecordStruct(shape.id);
  const fieldIdx = shape.fields.findIndex((f) => f.name === fieldName);
  const armTest = (): string => {
    const p = B.tmp();
    B.line(`${p} = getelementptr inbounds %${struct}, ptr ${recv}, i64 0, i32 ${fieldIdx + 1} ; .${fieldName}`);
    const u = B.tmp();
    B.line(`${u} = load ptr, ptr ${p}`);
    const tp = B.tmp();
    B.line(`${tp} = getelementptr inbounds %ScrUnion, ptr ${u}, i64 0, i32 1`);
    const tg = B.tmp();
    B.line(`${tg} = load i32, ptr ${tp}`);
    const r = B.tmp();
    B.line(`${r} = icmp ne i32 ${tg}, ${utag}`);
    return r;
  };
  // INTERNAL SLOTS take no bit (ownPresentCondC's row, one function).
  const bit = ownMaskKeyBit(shape, fieldName);
  if (!bit || fieldIdx < 0) return utag >= 0 ? armTest() : null;
  const mi = ownMaskSlotIndex(shape);
  const vp = B.tmp();
  B.line(`${vp} = getelementptr inbounds %${struct}, ptr ${recv}, i64 0, i32 ${mi}, i64 0 ; ${fieldName} own-mask valid`);
  const v0 = B.tmp();
  B.line(`${v0} = load i8, ptr ${vp}`);
  const valid = B.tmp();
  B.line(`${valid} = icmp ne i8 ${v0}, 0`);
  const lOwn = B.newLabel("own.m");
  const lArm = B.newLabel("own.a");
  const lJoin = B.newLabel("own.j");
  B.condBr(valid, lOwn, lArm);
  B.startBlock(lOwn);
  const bp = B.tmp();
  B.line(`${bp} = getelementptr inbounds %${struct}, ptr ${recv}, i64 0, i32 ${mi}, i64 ${bit.byte}`);
  const bv = B.tmp();
  B.line(`${bv} = load i8, ptr ${bp}`);
  const msk = B.tmp();
  B.line(`${msk} = and i8 ${bv}, ${bit.bit}`);
  const own = B.tmp();
  B.line(`${own} = icmp ne i8 ${msk}, 0`);
  B.br(lJoin);
  B.startBlock(lArm);
  const fall = utag >= 0 ? armTest() : "true";
  B.br(lJoin);
  B.startBlock(lJoin);
  const phi = B.tmp();
  B.line(`${phi} = phi i1 [ ${own}, %${lOwn} ], [ ${fall}, %${lArm} ]`);
  if (!dropUndefined || utag < 0) return phi;
  // JSON's conjunction: own AND not the undefined arm. The arm test is
  // re-read here because the mask branch above did not take it.
  const arm2 = armTest();
  const both = B.tmp();
  B.line(`${both} = and i1 ${phi}, ${arm2}`);
  return both;
}

/** The hidden own-key mask's field index in the emitted struct type: rc at
 * 0, the declared fields, the overflow map, the toString slot, then the
 * mask — LAST, so no existing member's index moves. It is a `[K x i8]`
 * array (ownMaskBytes), not a pointer: plain bytes, never refcounted,
 * never traced. Shared by every getelementptr that reaches it, so the
 * layout is stated once and the C twin (OWNMASK_MEMBER) matches it. */
export function ownMaskSlotIndex(shape: IrRecordShape): number {
  return shape.fields.length + (shape.indexValue ? 1 : 0) + (shape.tostr ? 1 : 0) + 1;
}

/** The hidden SOURCE [[Prototype]] slot's field index: after the mask, so
 * no existing member's index moves. The C twin is SRCPROTO_MEMBER, laid
 * out in the same position. */
export function srcProtoSlotIndex(shape: IrRecordShape): number {
  return ownMaskSlotIndex(shape) + (shape.ownmask ? 1 : 0);
}

/** The immortal-skip + mark-live retain body shared by every shape. The
 * cycle header sits 32 bytes before the object; `color` is at header+16,
 * so mark-live is one i32 store at obj-16 (scr_cyc_mark_live inlined —
 * the runtime's is a static inline with no external symbol). */
function retainBody(fnName: string, traced: boolean): string[] {
  return [
    `define internal ptr @${fnName}(ptr %o) ${FN_ATTRS} {`,
    `entry:`,
    `  %isnull = icmp eq ptr %o, null`,
    `  br i1 %isnull, label %done, label %check`,
    `check:`,
    `  %rc = load i64, ptr %o`,
    `  %imm = icmp eq i64 %rc, -1`,
    `  br i1 %imm, label %done, label %inc`,
    `inc:`,
    `  %n = add i64 %rc, 1`,
    `  store i64 %n, ptr %o`,
    ...(traced
      ? [`  %colorp = getelementptr i8, ptr %o, i64 -16`, `  store i32 0, ptr %colorp ; mark live`]
      : []),
    `  br label %done`,
    `done:`,
    `  ret ptr %o`,
    `}`,
  ];
}

/** Per-record-shape LLVM emission: the named struct types (returned as
 * `typeDefs`) and the new/retain/release (+trace/gcFree for cycle-capable
 * shapes) function definitions (`defs`). Layout mirrors the C emitter:
 * `{ i64 rc, fields..., [ptr overflow] }`; the retain/release signatures
 * are already `_v`-shaped, so the same symbols serve as container RC
 * entry points. */
export function emitRecordShapes(host: ShapeHost, mod: IrModule): { typeDefs: string[]; defs: string[] } {
  const typeDefs: string[] = [];
  const defs: string[] = [];
  const records = mod.records ?? [];
  if (records.length === 0) return { typeDefs, defs };
  host.declare(`declare void @scr_obj_alloc_note()`);
  host.declare(`declare void @scr_obj_free_note()`);

  for (const shape of records) {
    const struct = mangleRecordStruct(shape.id);
    const fieldTys: string[] = shape.fields.map((f) => llFieldType(f.type));
    if (shape.indexValue) fieldTys.push("ptr"); // the overflow ScrMap *
    if (shape.tostr) fieldTys.push("ptr"); // the hidden toString slot (ScrClosure *)
    if (shape.ownmask) fieldTys.push(`[${ownMaskBytes(shape)} x i8]`); // the hidden own-key mask
    if (shape.srcproto) fieldTys.push("ptr"); // the hidden source [[Prototype]] (ScrDyn *)
    typeDefs.push(
      `%${struct} = type { i64${fieldTys.length ? ", " + fieldTys.join(", ") : ""} } ` +
        `; record ${shape.id} { ${shape.fields.map((f) => f.name).join("; ")}${shape.indexValue ? "; [key: string]" : ""} }`,
    );
  }

  for (const shape of records) {
    const struct = mangleRecordStruct(shape.id);
    const traced = host.tracedShapes.has(`record:${shape.id}`);
    const members = rcMembers(shape);
    const refMembers = members.filter((m) => isRefCounted(m.type));
    const sizeOf = `ptrtoint (ptr getelementptr (%${struct}, ptr null, i32 1) to i64)`;

    defs.push(...retainBody(mangleRecordRetain(shape.id), traced), ``);

    // release: NULL-tolerant, immortal-skip; at rc == 0 release every
    // refcounted member (runtime releases are NULL-tolerant) and free —
    // traced shapes route through the collector (on_dead/on_release,
    // scr_cyc_free) exactly like emit-shapes.ts.
    const rel: string[] = [
      `define internal void @${mangleRecordRelease(shape.id)}(ptr %o) ${FN_ATTRS} {`,
      `entry:`,
      `  %isnull = icmp eq ptr %o, null`,
      `  br i1 %isnull, label %done, label %check`,
      `check:`,
      `  %rc = load i64, ptr %o`,
      `  %imm = icmp eq i64 %rc, -1`,
      `  br i1 %imm, label %done, label %dec`,
      `dec:`,
      `  %n = sub i64 %rc, 1`,
      `  store i64 %n, ptr %o`,
      `  %dead = icmp eq i64 %n, 0`,
      `  br i1 %dead, label %free, label %${traced ? "root" : "done"}`,
      `free:`,
    ];
    if (traced) {
      host.declare(`declare void @scr_cyc_on_dead(ptr)`);
      rel.push(`  call void @scr_cyc_on_dead(ptr %o)`);
    }
    let t = 0;
    for (const m of refMembers) {
      rel.push(
        `  %f${t} = getelementptr inbounds %${struct}, ptr %o, i64 0, i32 ${m.index}`,
        `  %v${t} = load ptr, ptr %f${t}`,
        `  call void ${releaseSym(host, m.type)}(ptr %v${t}) ; ${m.name}`,
      );
      t++;
    }
    rel.push(`  call void @scr_obj_free_note()`);
    if (traced) {
      host.declare(`declare void @scr_cyc_free(ptr)`);
      host.declare(`declare void @scr_cyc_on_release(ptr)`);
      rel.push(
        `  call void @scr_cyc_free(ptr %o)`,
        `  br label %done`,
        `root:`,
        `  call void @scr_cyc_on_release(ptr %o) ; possible cycle root; may collect`,
        `  br label %done`,
      );
    } else {
      host.declare(`declare void @free(ptr)`);
      rel.push(`  call void @free(ptr %o)`, `  br label %done`);
    }
    rel.push(`done:`, `  ret void`, `}`, ``);
    defs.push(...rel);

    // new: zeroed allocation (+ the overflow map on index-signature
    // shapes), rc = 1, alloc note. Traced shapes allocate with the
    // collector header (scr_cyc_alloc zeroes and aborts on OOM itself).
    const nw: string[] = [
      `define internal ptr @${mangleRecordNew(shape.id)}() ${FN_ATTRS} {`,
      `entry:`,
    ];
    if (traced) {
      host.declare(`declare ptr @scr_cyc_alloc(i64, ptr, ptr)`);
      nw.push(
        `  %o = call ptr @scr_cyc_alloc(i64 ${sizeOf}, ptr @${mangleRecordTrace(shape.id)}, ptr @${mangleRecordGcFree(shape.id)})`,
      );
    } else {
      host.declare(`declare ptr @calloc(i64, i64)`);
      host.needOom();
      nw.push(
        `  %o = call ptr @calloc(i64 1, i64 ${sizeOf})`,
        `  %isnull = icmp eq ptr %o, null`,
        `  br i1 %isnull, label %oom, label %ok`,
        `oom:`,
        `  call void @sc_oom()`,
        `  unreachable`,
        `ok:`,
      );
    }
    nw.push(`  store i64 1, ptr %o`);
    if (shape.indexValue) {
      // The overflow map (string-keyed): value handling is type-directed
      // exactly like emit-shapes.ts's overflowNewC.
      host.declare(`declare ptr @scr_map_new(i32, i32, ptr, ptr, ptr)`);
      const v = shape.indexValue;
      const valKind = v.kind === "f64" ? 0 : v.kind === "bool" ? 1 : 2;
      const rc = valKind === 2 ? vAdapters(host, v) : { retain: "null", release: "null" };
      const trace = valKind === 2 ? traceArg(host, v) : "null";
      nw.push(
        `  %ovf = call ptr @scr_map_new(i32 1, i32 ${valKind}, ptr ${rc.retain}, ptr ${rc.release}, ptr ${trace})`,
        `  %ovfp = getelementptr inbounds %${struct}, ptr %o, i64 0, i32 ${shape.fields.length + 1}`,
        `  store ptr %ovf, ptr %ovfp`,
      );
    }
    nw.push(`  call void @scr_obj_alloc_note()`, `  ret ptr %o`, `}`, ``);
    defs.push(...nw);

    if (traced) {
      // trace: visit exactly the cycle-capable members; gcFree: release
      // exactly the complement, then free (the trace/teardown complement
      // contract in scr_runtime.h).
      const tracedMembers = members.filter((m) => traceAdapter(host, m.type) !== null);
      const untracedRefMembers = refMembers.filter((m) => traceAdapter(host, m.type) === null);
      const tr: string[] = [
        `define internal void @${mangleRecordTrace(shape.id)}(ptr %o, ptr %visit, ptr %ctx) ${FN_ATTRS} {`,
        `entry:`,
      ];
      tracedMembers.forEach((m, i) => {
        tr.push(
          `  %f${i} = getelementptr inbounds %${struct}, ptr %o, i64 0, i32 ${m.index}`,
          `  %v${i} = load ptr, ptr %f${i}`,
          `  call void %visit(ptr %v${i}, ptr %ctx) ; ${m.name}`,
        );
      });
      tr.push(`  ret void`, `}`, ``);
      defs.push(...tr);

      const gf: string[] = [
        `define internal void @${mangleRecordGcFree(shape.id)}(ptr %o) ${FN_ATTRS} {`,
        `entry:`,
      ];
      untracedRefMembers.forEach((m, i) => {
        gf.push(
          `  %f${i} = getelementptr inbounds %${struct}, ptr %o, i64 0, i32 ${m.index}`,
          `  %v${i} = load ptr, ptr %f${i}`,
          `  call void ${releaseSym(host, m.type)}(ptr %v${i}) ; ${m.name} (acyclic)`,
        );
      });
      gf.push(`  call void @scr_obj_free_note()`, `  call void @scr_cyc_free(ptr %o)`, `  ret void`, `}`, ``);
      defs.push(...gf);
    }
  }
  return { typeDefs, defs };
}
