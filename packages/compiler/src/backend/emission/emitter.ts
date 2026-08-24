/* IR → C. Three-address style: every IR expression lands in a fresh C temp.
 * Verbose (clang -O2 erases it) but buys three things: short-circuit
 * emission is trivially correct, reference counting has one mechanical
 * hook point, and the output shape is already close to a CFG lowering.
 *
 * RC ownership discipline (must match docs/ir.md):
 * - every refcounted temp (isRefCounted kinds) holds an owned (+1) reference;
 * - varDecl/assign/return/call-argument MOVE that ownership (the temp is
 *   struck from its release list); everything else borrows;
 * - each statement releases its remaining refcounted temps when it ends;
 * - each scope releases the refcounted locals declared in it when it exits;
 * - callees own their params and release them on exit (callers pass +1);
 * - `return` first releases pending temps and every in-scope refcounted
 *   local.
 *
 * RC dispatch is type-directed: frames and scopes carry {name, type} so a
 * release always knows which scr_*_release to call. `isRefCounted` in
 * nodes.ts is the membership test — no `kind === "string"` checks here.
 *
 * The generated C is a debugging surface: locals keep their TS names inside
 * the mangled form and every statement carries a `source line` comment.
 */
import type {
  IrGlobal,
  IrRecordShape,
  IrExpr,
  IrFfiImport,
  IrFunction,
  IrLocal,
  IrModule,
  IrStmt,
  IrType,
  IrUnionDef,
  SrcLoc,
} from "../../ir/nodes.js";
import { DYN, funcOf, isRefCounted, isUnitType, mapOf, moduleEmbedsCompressedNpm, moduleUsesAbortSignal, moduleUsesChildStream, moduleUsesDgram, moduleEmbedsBuiltin, moduleUsesFetch, moduleUsesFetchStatic, moduleUsesFetchDispatch, moduleUsesFsWatch, moduleUsesHttp2, moduleUsesHttpServer, moduleUsesNet, moduleUsesRegex, moduleUsesWsGlobal, moduleUsesNodeTest, moduleUsesProcessEvents, moduleUsesStream, RUNTIME_EMITTER_CLASS, STRING, VOID } from "../../ir/nodes.js";
import { readKindgateDials } from "../kindgate.js";
import {
  mangleAsyncSpawn,
  mangleGenSpawn,
  mangleClassObj,
  mangleField,
  mangleGlobal,
  mangleFnClosure,
  mangleFunction,
  mangleLocal,
  mangleRawParam,
  mangleVtSlot,
  mangleWrapper,
} from "../mangle.js";
import { cType, releaseCallC, cStringLiteral, cDecl } from "./emit-types.js";
import { computeMayThrow } from "./may-throw.js";
import { dynDesc, unionTruthyHelper, unionEqHelper, unionToStrHelper, unionJoinHelper, jsonWriteHelper, jsonIndentHelper, dynMatchHelper, dynCheckHelper, dynArmHelper, dynFuncBoxHelper, dynToStrHelper, caughtToDynHelper, toDynHelper, dynClassDesc, recordKeyGetHelper, recordKeySetHelper, recordWideHelper } from "./emit-walkers.js";
import { VtSlot, ClassMeta, emitStructDefs, vtEntriesFor, vtSlotParams, emitVtableDecls, emitVtableInstances, emitVtAdapterDefs, emitHierarchyClassHelpers, emitClassObjs, emitCtorThunkDefs, errorVtStampLines, emitterVtStampLines, streamVtStampLines, traceAdapterC, traceArgC, boxNewC, arrNewC } from "./emit-shapes.js";
import { agenSettleThunkFor, emitAsyncScaffolding, childDataThunkFor, childExitThunkFor, childExitThunkFor2, closeBindThunkFor, connectSockThunkFor, closeOverrideWrapFor, dgramMsgThunkFor, dnsLookupThunkFor, netLookupAnswerThunkFor, emitterInvokeThunkFor, streamCbThunkFor, streamDataThunkFor, promiseAdoptAdapterFor, raceAdapterFor, resolveThunkFor, sniAnswerThunkFor } from "./emit-async.js";
import { emitNpmEmbedding, islandAdapter, islandTypedAdapter } from "./emit-island.js";
import { emitFunction, emitBlock, emitStmts, emitStmt, emitTryCatch, emitSwitch, mergeBrace, emitBranchInto, emitCondition } from "./emit-stmts.js";
import fs from "node:fs";
import { emitExpr } from "./emit-exprs.js";

/** SCRIPTC_RC_SITES=1 at BUILD time: emit the RC-audit per-SITE table — one
 * row per emitted closure body, carrying the source position it was written
 * at, so the exit audit can resolve a live closure's `fn` pointer to a
 * lambda instead of reporting "8690 closure(s)" and stopping there.
 *
 * A switch and not an `#ifdef` because the table is EMITTED C: with the
 * switch off the TU is byte-identical to an uninstrumented build, which is
 * what makes "the instrument changed nothing" checkable by diff rather than
 * by argument. Same unset/empty/"0" contract as SCRIPTC_RC_AUDIT. */
export function rcSitesRequested(): boolean {
  const v = process.env.SCRIPTC_RC_SITES;
  return v !== undefined && v !== "" && v !== "0";
}

/** file:line for a SrcLoc — the backend holds character offsets, not lines,
 * and no SourceFile, so the file is read once and indexed. Only ever called
 * under rcSitesRequested(); an unreadable file degrades to the offset. */
const rcLineIndex = new Map<string, number[] | null>();
function lineStartsOf(file: string): number[] | null {
  let starts = rcLineIndex.get(file);
  if (starts === undefined) {
    try {
      const text = fs.readFileSync(file, "utf8");
      starts = [0];
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    } catch {
      starts = null;
    }
    rcLineIndex.set(file, starts);
  }
  return starts;
}

/** `file:line:col` for a SrcLoc, degrading to `file@offset` when the source
 * is no longer readable. The one spelling of a SOURCE SITE inside emitted
 * code — `rcSiteLabel` below appends a name to it, and the keyed-read abort
 * (SC9003) passes it as the argument that makes an otherwise nameless
 * process abort say WHERE it happened. */
export function srcSite(loc: { file: string; start: number } | undefined): string {
  if (!loc) return "<unknown>";
  const starts = lineStartsOf(loc.file);
  if (!starts) return `${loc.file}@${loc.start}`;
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= loc.start) lo = mid; else hi = mid - 1;
  }
  return `${loc.file}:${lo + 1}:${loc.start - starts[lo]! + 1}`;
}

export function rcSiteLabel(loc: { file: string; start: number } | undefined, name: string): string {
  if (!loc) return name;
  return `${srcSite(loc)} ${name}`;
}

export function emitModule(mod: IrModule, sourceText?: string): string {
  return new CEmitter(mod, sourceText).emit();
}

/** `dst.push(...src)` for a WHOLE FUNCTION BODY, which is unbounded.
 *
 * A spread call passes one argument per element, and an engine's argument
 * list is finite: V8 throws `RangeError: Maximum call stack size exceeded`
 * somewhere north of a hundred thousand. Every other spread-push in the
 * emitter appends a fixed handful of lines and can never reach that, but a
 * function body's line count is the size of the user's function — and a
 * bundler's module initialiser is ONE function holding the whole module.
 * zapo's shipped `spec/proto/index.js` is 1.87 MB of exactly that, so the
 * emitter aborted the build (no `.c` at all, no diagnostic, a stack trace
 * out of the compiler) at the point where the init finally lowered.
 *
 * A loop has no argument list, so the append is bounded only by memory. */
export function appendLines(dst: string[], src: readonly string[]): void {
  for (const line of src) dst.push(line);
}

// Box construction moved onto CEmitter (boxNewC method): obj-kind boxes now
// also carry the payload type's trace entry point, which is type-directed
// through the emitter's cycle analysis.

/** A declared C value with its IR type — the unit frames and scopes track
 * so releases can be type-directed. */
export interface Temp {
  name: string;
  type: IrType;
  /** The value is an INTERNED STATIC — an immortal whose `rc` is SIZE_MAX
   * for the whole run (the string-literal table, emitted by assemble()).
   * `scr_str_retain` is `if (o && o->rc != SIZE_MAX) o->rc++` and
   * `scr_str_release` is `if (!o || o->rc == SIZE_MAX) return`, so on such a
   * value BOTH are exactly no-ops and the emitter may leave them out. The
   * temp still JOINS its frame, so `moveTemp` and every other part of the
   * ownership discipline see it exactly as before — only `releaseFrame`
   * skips it, which is where the bytes were.
   *
   * It is the frame release that mattered, not the retain: the retain is
   * `static inline` in the header (one predicated increment), while the
   * release is a real call re-listed in EVERY unwind epilogue live at that
   * point. On zapo that is 247,886 of 274,263 `scr_str_release` statements
   * — 90.38% (tests/perf/dynpath/litrel.mjs). */
  immortal?: boolean;
}

/** A scope entry: a refcounted local, either held directly or through a
 * capture box (boxed locals release their BOX; the box frees its contents). */
export interface ScopeEntry extends Temp {
  boxed?: boolean;
}

export class CEmitter {
  readonly lines: string[] = [];
  indent = 0;
  tempCounter = 0;
  /** Interned string literals: UTF-8 text → static symbol name. */
  readonly literals = new Map<string, string>();
  /** Interned unit-armed union instances: "unionId:tag" → static symbol.
   * A unit arm (undefined/null) has no payload, so every instance of one
   * (union, tag) pair is identical — ONE immortal (rc == SIZE_MAX) static
   * serves them all. Immortals are skipped by retain/release and by the
   * cycle collector's child filter (SCR_CYC_SKIP), so the missing cycle
   * header is fine even when a traced container points at one. */
  readonly unitInstances = new Map<string, string>();
  /** Interned regex literals: "<flags>/<pattern>" → static symbol. One
   * immortal (rc == SIZE_MAX) ScrRegex per distinct (pattern, flags) pair —
   * the bytecode slot starts NULL and the runtime compiles it lazily on
   * first use. The source/flags strings ride the ordinary literal table. */
  readonly regexInstances = new Map<string, string>();
  /** Interned tagged-template strings objects: per-site key → symbol +
   * cooked spans. One immortal (rc == SIZE_MAX) ScrArr of interned string
   * literals per template-literal SITE — the spec's per-occurrence
   * identity: the same site evaluated twice hands the tag the same array,
   * two sites never share even with identical text. */
  readonly templateStringsInstances = new Map<string, { sym: string; cooked: string[] }>();
  /** Class objects (classes as first-class values): className → static
   * symbol. One immortal ScrClassObj per class some classRef names —
   * preorder interval baked as constants, the .name string in the literal
   * table, and a per-class construct thunk (void *sc_ct_*) newValue
   * dispatches through. Registered during body emission (the regex
   * pattern); the statics and thunks are assembled around the bodies. */
  readonly classObjs = new Map<string, string>();
  /** Stack of statement frames: refcounted temps not yet released or moved. */
  frames: Temp[][] = [];
  /** Stack of scopes: refcounted locals (with types) declared in each. */
  scopes: ScopeEntry[][] = [];
  /** The function being emitted: local table (for boxedness) and whether
   * each local arrived through the closure environment (env captures are
   * borrowed — never declared, never released here). */
  currentLocals = new Map<string, IrLocal>();
  captureIds = new Set<string>();
  /** Hidden locals whose ENTIRE live range is one seqExpr: released when
   * that seqExpr's value has been produced, not at block exit. See
   * seqScopedLocals — the emitter computes this once per function and the
   * seqExpr case consults it. */
  seqScoped = new Set<string>();
  /** Indices into `scopes` that are seqExpr REGIONS. A region scope owns
   * only the locals seqScoped picked out; anything else declared inside
   * one belongs to the nearest enclosing ordinary scope, exactly where it
   * went before regions existed. */
  readonly seqScopeAt = new Set<number>();
  /** Declared functions referenced as values: each needs an env-signature
   * wrapper + an interned immortal closure (so `f === f` holds). */
  readonly fnValues = new Set<string>();
  /** Emitted ref-kind resolve thunks for new Promise, interned per inner
   * typeKey → thunk symbol. */
  readonly resolveThunks = new Map<string, string>();
  readonly genResThunks = new Map<string, string>();
  /** Emitted child exit adapters, interned per union id (childExitThunkFor). */
  readonly childExitThunks = new Map<string, string>();
  /** Emitted child-stream data adapters, interned per union id
   * (childDataThunkFor). */
  readonly childDataThunks = new Map<string, string>();
  /** Emitted bound-close adapters, interned per union id
   * (closeBindThunkFor). */
  readonly closeBindThunks = new Map<string, string>();
  /** Emitted close-override wrappers, interned per (union id, ret kind)
   * (closeOverrideWrapFor). */
  readonly closeOverrideWraps = new Map<string, string>();
  /** Emitted dgram message adapters, interned per rinfo shape id
   * (dgramMsgThunkFor). */
  readonly dgramMsgThunks = new Map<string, string>();
  /** Emitted dns.lookup callback adapters, interned per union id + param
   * count (dnsLookupThunkFor). */
  readonly dnsLookupThunks = new Map<string, string>();
  /** Emitted SNI answer-closure thunks, interned per cb func-type key
   * (sniAnswerThunkFor). */
  readonly sniAnswerThunks = new Map<string, string>();
  /** Emitted net.connect lookup answer thunks, interned per cb func-type
   * key (netLookupAnswerThunkFor). */
  readonly netLookupAnswerThunks = new Map<string, string>();
  /** Emitted EventEmitter listener invoke adapters, interned per listener
   * func-type key (emitterInvokeThunkFor). */
  readonly emitterInvokeThunks = new Map<string, string>();
  /** Emitted stream option-callback invoke adapters (read/write/final/
   * destroy/transform/flush — the leading-`this` closures), interned per
   * (kind, callback func-type) key (streamCbThunkFor). */
  readonly streamCbThunks = new Map<string, string>();
  /** Emitted stream completion-callback closure fns (the `callback` a
   * user's write/final/destroy/transform/flush receives and calls),
   * interned per (kind, done func-type) key (streamDoneFnFor). */
  readonly streamDoneFns = new Map<string, string>();
  /** Emitted CONNECT-listener union-socket adapters, interned per cb
   * func-type key (connectSockThunkFor). */
  readonly connectSockThunks = new Map<string, string>();
  /** Emitted Promise.race fulfillment adapters, interned per
   * `entryInner=>resultInner` typeKey pair (raceAdapterFor). */
  readonly raceThunks = new Map<string, string>();
  /** The globalThis.WebSocket families, interned per construct-signature
   * typeKey (wsGlobalCtorFor). The VALUE is the interned immortal
   * closure this maps to: one per program, so two reads of the global
   * compare equal the way they do in a browser. */
  readonly wsCtors = new Map<string, string>();
  /** Some wsCtor wrapper DELEGATES its init bag to a program dispatcher,
   * so the TU names scr_ws_disp_global_new and needs that unit's header.
   * Set by emit-ws.ts while it emits the wrapper, which is the only place
   * that knows -- the gate in index.ts answers the same question off the
   * IR, and the two must agree or the link fails naming no gate. */
  wsDispatchUsed = false;
  /** setTimeout appeared somewhere: main must run the event loop even in
   * programs with no async functions. */
  usesTimers = false;
  readonly fnByName = new Map<string, IrFunction>();
  /** Manifest-bound native imports, used by ffiCall emission. */
  readonly ffiByName = new Map<string, IrFfiImport>();
  readonly globalsById = new Map<string, IrGlobal>();
  readonly unionsById = new Map<string, IrUnionDef>();
  /** Active optional-chain bind temps, by chain id (chainRecv reads). */
  readonly chainTemps = new Map<string, Temp>();
  readonly recordsById = new Map<string, IrRecordShape>();
  /** Type-directed JSON walkers, interned per typeKey — one serializer per
   * type used in jsonStringify position (sc_jw_*), one match predicate
   * (sc_dm_*) and one checked builder (sc_dc_*) per type used in dynCheck
   * position. Emitted as prototypes + definitions after the struct block
   * (they reference struct types, per-shape RC helpers, and each other, so
   * the prototypes make definition order irrelevant). */
  readonly jsonWriters = new Map<string, string>();
  /** The pretty-print re-indenter (type-independent, interned once):
   * emitted on the first `JSON.stringify(v, null, space)` site. */
  jsonIndentFn: string | null = null;
  /** The dyn ToString pair (type-independent, interned once): emitted on
   * the first String(unknown) / `${unknown}` site. */
  dynToStrFn: string | null = null;
  /** The caught→dyn converter (type-independent, interned once): emitted
   * on the first catch binding flowing into an `unknown` slot. */
  caughtToDynFn: string | null = null;
  /** Interned per-union helpers: unionId → emitted function name. */
  readonly unionTruthyFns = new Map<string, string>();
  readonly unionEqFns = new Map<string, string>();
  readonly unionToStrFns = new Map<string, string>();
  readonly unionJoinFns = new Map<string, string>();
  readonly dynMatchers = new Map<string, string>();
  readonly dynBuilders = new Map<string, string>();
  /** The MERGED union-arm walkers (sc_da_*), per typeKey — one function
   * that decides an arm and builds it, so no matcher has to be kept in
   * lockstep with a builder. Its own map: the arm form and the checked
   * form of one type are two functions with two names, and interning them
   * apart is what lets a type reached ONLY through an arm never emit the
   * checked form at all. */
  readonly dynArmBuilders = new Map<string, string>();
  /** Record shapes whose WIDE-LANE key table has already been emitted
   * (the sc_kgk_ and sc_kgl_ pair -- a prefix of their own, so a shape
   * table can never collide with dynClassDesc's sc_dcl_<n> descriptors).
   * Interning is per shapeId, not per
   * typeKey: two builders of the same shape share one table. */
  readonly recWideTables = new Set<string>();
  /** Static→dyn converters (sc_td_*), per typeKey; dynamic-keyed record
   * read helpers (sc_rkg_*), per shapeId|result typeKey; dynamic-keyed
   * write helpers (sc_rks_*), per shapeId. */
  readonly toDynFns = new Map<string, string>();
  /** The checked-dynamic function boundary's per-signature helpers (see
   * emit-walkers.ts): call thunks (sc_dfk_*), box builders (sc_dfb_*),
   * and dynCheck adapters (sc_dfa_*), each per func typeKey. */
  readonly dynFuncThunks = new Map<string, string>();
  readonly dynFuncBoxes = new Map<string, string>();
  /** Stranded box builders: a carried function field whose signature has no
   * dyn call thunk (emit-walkers' strandedDynFuncBoxHelper). */
  readonly strandedDynFuncBoxes = new Map<string, string>();
  readonly dynFuncAdapters = new Map<string, string>();
  /** RC-AUDIT per-SITE attribution (SCRIPTC_RC_SITES=1 only): emitted
   * closure body symbol -> the source position it was written at. The exit
   * audit resolves a live closure's `fn` pointer through this table, which
   * turns "8690 closure(s) live at exit" into a list of lambdas. Empty —
   * and the table and its install call unemitted, so the TU is byte-
   * identical — when the switch is off. */
  readonly closureSites = new Map<string, string>();
  /** Emitted closure ENTRY POINT symbol -> the JS `Function.prototype.name`
   * of the function value it backs. Filled at the closure creation sites
   * themselves, so the key is exactly what lands in `ScrClosure.fn` — the
   * only handle a box built by a WALKER has on which function the value
   * is. main() installs it (scr_fn_names_install) and every walker-built
   * box resolves through it; a function this program cannot name has no
   * row, and `[Function (anonymous)]` stays the answer. */
  readonly fnNames = new Map<string, string>();
  /** dyn-promise settle adapters (sc_pda_*), per INNER typeKey: convert a
   * typed fulfillment payload into the boxed destination's dyn payload
   * (scr_dyn_new_promise_adapting's callback — toDynHelper's promise arm). */
  readonly promiseDynAdapters = new Map<string, string>();
  /** SCR_DYN_OBJINST boxing descriptors (sc_dcl_*), interned per class
   * name: one `static const ScrDynClass` per class the program ever boxes
   * into an `unknown` slot. Emitted with the walker prototypes — after
   * emitStructDefs, so the `_v` RC thunks the descriptor points at are
   * already declared. See dynClassDesc (emit-walkers.ts). */
  readonly dynClassDescs = new Map<string, string>();
  readonly recordKeyGetFns = new Map<string, string>();
  readonly recordKeySetFns = new Map<string, string>();
  /** The shared abort helpers, mirroring the LLVM emitter's helperDefs
   * (llvm/emitter.ts): ONE definition per trap message, called from every
   * guard site, instead of the message open-coded at each site. The
   * protection is unchanged — the helper is _Noreturn and its body is the
   * byte-identical scr_trap call the site used to make — but the message
   * text, and the address load that reaches it, stop scaling with the
   * program. Set as a side effect of oomAbortC / badTagAbortC below; read
   * by sharedTrapDefs at assembly time. */
  usesOomHelper = false;
  usesBadTagHelper = false;
  usesStringifyUndefHelper = false;

  /** SCRIPTC_DC_COUNT=1 — the RUNTIME execution counter for the DYNCHECK
   * family, and the one instrument this tree did not have. `SCRIPTC_DC_WHERE`
   * renames a path segment inside a message only a FAILING check prints, and
   * `SCRIPTC_DC_CENSUS` is compile-time: between them they can say how many
   * checks EXIST and which one FAILED, and neither can say how many ever RAN.
   * On a healthy run that is 100% of the population.
   *
   * With the dial on, every emitted `scr_dyn_check_fail` guard is preceded by
   * `SC_DC_HIT(k)` — one ordinal per emitted statement, so the ordinals are in
   * exact 1:1 correspondence with the census's DYNCHECK count — and the
   * failing arm carries `SC_DC_FAIL(k)`. A `/*DCSITE ...*\/` marker beside each
   * one names the interned validator and the emitter shape, so the dump is
   * attributable without a side file that could drift from the TU.
   *
   * OFF is the default and off emits NOTHING: dcSite() answers -1 and both
   * emitters answer the empty string, so the TU is byte-identical. That is
   * asserted, not assumed — a guard added with probeLower once interned an
   * extra helper into zapo's TU and was caught only by a byte diff. */
  readonly dcCount = process.env["SCRIPTC_DC_COUNT"] === "1";
  /** The kind-gate dials, read from ../kindgate.js — the ONE definition
   * both backends take them from. `backend/llvm/dyn.ts` reads the same
   * module and asks the same `kindgateWideLane`, so the hard/soft split
   * cannot be spelled differently on the two lanes. */
  readonly kindgateDials = readKindgateDials();
  /** SCRIPTC_KINDGATE_MATCH=1: the CONTROL that widens the record gate in
   * the SOFT (arm-walker) body as well as the hard one. Off by default
   * and off in every shipped build - it exists so the union-tag
   * population can be run both ways and the wrong tags counted rather
   * than asserted. See dynWalkerBody in emit-walkers.ts. */
  readonly kindgateMatch = this.kindgateDials.match;
  /** SCRIPTC_KINDGATE_WIDE=1: the record BUILDER reads a non-OBJ
   * receiver's declared members instead of refusing at the kind gate.
   * Off by default, and the measurement in estado-kindgate.md is why:
   * a checked record cast MATERIALIZES, so a widened array answers its
   * `length` right and then answers Array.isArray, typeof, String() and
   * JSON.stringify wrong - 11 new SILENT divergences over a generated
   * 35-case surface population, against 9 loud refusals turned correct.
   * SCRIPTC_KINDGATE_MATCH implies it (the matcher control reuses the
   * same projector). Off, neither dial emits one byte. */
  readonly kindgateWide = this.kindgateDials.wide;
  dcSites = 0;
  private dcOpen = -1;
  /** The increment for a guard about to be EVALUATED, plus its marker; it
   * ALLOCATES the ordinal, so it must be spelled before its dcFailC in the
   * same template literal (JS evaluates literal holes left to right). The
   * pairing is enforced rather than trusted: a second dcHitC before the
   * matching dcFailC, or a dcFailC without one, throws while emitting. */
  dcHitC(validator: string, shape: string): string {
    if (!this.dcCount) return "";
    if (this.dcOpen >= 0) throw new Error(`emitter bug: dc site ${this.dcOpen} has no dcFailC`);
    const k = this.dcSites++;
    this.dcOpen = k;
    return `SC_DC_HIT(${k}); /*DCSITE k=${k} v=${validator} s=${shape}*/ `;
  }
  /** The increment for the arm that actually REFUSED, closing the site. */
  dcFailC(): string {
    if (!this.dcCount) return "";
    if (this.dcOpen < 0) throw new Error("emitter bug: dcFailC without a dcHitC");
    const k = this.dcOpen;
    this.dcOpen = -1;
    return `SC_DC_FAIL(${k}); `;
  }
  /** The counter table and its exit dump, spliced beside the shared trap
   * helpers. Empty unless the dial is on AND the program emitted a check. */
  dcCountDefs(): string[] {
    if (!this.dcCount || this.dcSites === 0) return [];
    const n = this.dcSites;
    return [
      `/* SCRIPTC_DC_COUNT=1: ${n} emitted dyn-check statements, one ordinal each. */`,
      `static unsigned long sc_dc_hits[${n}];`,
      `static unsigned long sc_dc_fails[${n}];`,
      `#define SC_DC_HIT(k) (sc_dc_hits[k]++)`,
      `#define SC_DC_FAIL(k) (sc_dc_fails[k]++)`,
      `__attribute__((destructor)) static void sc_dc_count_dump(void) {`,
      `  unsigned long th = 0, tf = 0;`,
      `  size_t ran = 0, failed = 0;`,
      `  for (size_t i = 0; i < ${n}; i++) {`,
      `    th += sc_dc_hits[i]; tf += sc_dc_fails[i];`,
      `    if (sc_dc_hits[i]) ran++;`,
      `    if (sc_dc_fails[i]) failed++;`,
      `  }`,
      `  fprintf(stderr, "DCCOUNT-TOTAL sites=${n} executed=%zu evaluations=%lu failing-sites=%zu failures=%lu\\n",`,
      `          ran, th, failed, tf);`,
      `  for (size_t i = 0; i < ${n}; i++) {`,
      `    if (sc_dc_hits[i] || sc_dc_fails[i]) {`,
      `      fprintf(stderr, "DCCOUNT %zu %lu %lu\\n", i, sc_dc_hits[i], sc_dc_fails[i]);`,
      `    }`,
      `  }`,
      `}`,
      ``,
    ];
  }

  /** SCRIPTC_RKG_COUNT=1 - the RUNTIME execution counter for the keyed-read
   * ABORT family (ABORT.real), and the twin of SCRIPTC_DC_COUNT for the one
   * population that had no runtime instrument at all.
   *
   * `scripts/real-aborts.mjs` says how many call sites of an ABORTING
   * `sc_rkg_` helper a TU CONTAINS and which source function hosts each.
   * Nothing could say which of them a run ever REACHES - and unlike the
   * DYNCHECK family the miss path here is a process abort, so "it never
   * fired" is true of every site on every healthy run and tells you nothing.
   * The question that decides what matters is the other one: which sites are
   * on a path the program actually walks, and how often.
   *
   * With the dial on, every emitted CALL of a helper whose miss path traps is
   * preceded by `SC_RK_HIT(k)` - one ordinal per emitted CALL SITE, which is
   * `real-aborts.mjs`'s unit and not the statement unit that read 24 on both
   * sides of a fix - and a `/*RKSITE ...*\/` marker names the helper, the
   * shape and the result width so the dump is attributable from the TU alone,
   * with no side file that could drift.
   *
   * A helper that can answer `undefined` (a dyn result, an undefined-armed
   * union) is NOT counted: it cannot abort, so its call sites are not in this
   * population and counting them would inflate the denominator.
   *
   * OFF is the default and off emits NOTHING - asserted as byte equality of
   * the whole TU in `rkg-count-dial.test.ts`, because a probe is not free. */
  readonly rkCount = process.env["SCRIPTC_RKG_COUNT"] === "1";
  rkSites = 0;
  /** The `sc_rkg_` helpers whose MISS path is `scr_trap_fmt` - filled by
   * recordKeyGetHelper as it emits each one, so a call site can ask whether
   * the helper it just interned is in the aborting population. */
  readonly recordKeyGetAborts = new Set<string>();
  /** The increment for one emitted call of an ABORTING keyed-read helper.
   * Empty string unless the dial is on and the helper can trap, so the
   * ordinary emitter path is unchanged text. */
  rkHitC(helper: string, shapeId: string, width: string): string {
    if (!this.rkCount || !this.recordKeyGetAborts.has(helper)) return "";
    const k = this.rkSites++;
    return `SC_RK_HIT(${k}); /*RKSITE k=${k} h=${helper} s=${shapeId} t=${width}*/ `;
  }
  /** The trailing `, "<file>:<line>:<col>"` argument an ABORTING keyed-read
   * helper takes, and nothing at all for one that answers `undefined`.
   *
   * The helper is interned per (shape, result type), so it is shared by
   * every read of that pair and cannot name the site itself; the site has
   * to arrive from the call. This is the whole reason the aborting and the
   * non-aborting helper have different signatures — the ones that can
   * never die pay nothing, in text or in code, and on zapo that is 25 of
   * the 34 helpers and every one of their call sites.
   *
   * NOT behind a dial. `SCRIPTC_RKG_COUNT` answers "which sites does a run
   * REACH", which is a question you ask while investigating; this answers
   * "where did this process just abort", which is the question the abort
   * itself asks, and an instrument you have to have turned on beforehand
   * cannot answer it. */
  rkSiteArgC(helper: string, loc: { file: string; start: number } | undefined): string {
    if (!this.recordKeyGetAborts.has(helper)) return "";
    return `, ${cStringLiteral(Buffer.from(srcSite(loc), "utf8"))}`;
  }
  /** The counter table and its exit dump, spliced beside the shared trap
   * helpers. Empty unless the dial is on AND the program emitted a site.
   * NOTE: a destructor, so `process.exit()` (which takes `_Exit`) skips it,
   * exactly as it skips the RC audit and the DCCOUNT dump. */
  rkCountDefs(): string[] {
    if (!this.rkCount || this.rkSites === 0) return [];
    const n = this.rkSites;
    return [
      `/* SCRIPTC_RKG_COUNT=1: ${n} emitted ABORTABLE keyed-read call sites, one ordinal each. */`,
      `static unsigned long sc_rk_hits[${n}];`,
      // FIRST-HIT PRINT, and the reason it is not only a table.
      // `process.exit()` takes `_Exit`, which skips atexit AND the
      // destructor below - zapo's own entry ends in `process.exit(0)`, so
      // the dump never printed and the reachability question went
      // unanswered on the run that mattered. One line per site the first
      // time it executes is immune to that: it is already on stderr when
      // the process dies, however it dies.
      `#define SC_RK_HIT(k) ((sc_rk_hits[k]++ == 0) ? (void)fprintf(stderr, "RKFIRST %zu\\n", (size_t)(k)) : (void)0)`,
      `__attribute__((destructor)) static void sc_rk_count_dump(void) {`,
      `  unsigned long th = 0;`,
      `  size_t ran = 0;`,
      `  for (size_t i = 0; i < ${n}; i++) {`,
      `    th += sc_rk_hits[i];`,
      `    if (sc_rk_hits[i]) ran++;`,
      `  }`,
      `  fprintf(stderr, "RKCOUNT-TOTAL sites=${n} executed=%zu evaluations=%lu\\n", ran, th);`,
      `  for (size_t i = 0; i < ${n}; i++) {`,
      `    if (sc_rk_hits[i]) {`,
      `      fprintf(stderr, "RKCOUNT %zu %lu\\n", i, sc_rk_hits[i]);`,
      `    }`,
      `  }`,
      `}`,
      ``,
    ];
  }

  readonly walkerProtos: string[] = [];
  readonly walkerDefs: string[] = [];
  /** Island host-call adapters, interned per (arity, void-ness): the one
   * uniform shape scr_jsval_from_closure calls — unpack the cell array,
   * call the closure through its real ABI (which CONSUMES its params, so
   * each cell is retained in), return the +1 result cell or NULL for void.
   * Definitions ride walkerDefs (self-contained over the closure ABI). */
  readonly islandAdapters = new Map<string, string>();
  /** TYPED island host-call adapters, interned per full signature (param
   * typeKeys + return classification): each incoming engine argument
   * converts to the param's static type through the exit machinery before
   * the closure runs — see islandTypedAdapter (emit-island.ts). */
  readonly islandTypedAdapters = new Map<string, string>();
  /** Enclosing break/continue targets. An unlabeled `break` binds to the
   * innermost loop-or-switch entry (labeled BLOCK entries are skipped); an
   * unlabeled `continue` searches inward-out for the innermost LOOP,
   * skipping switches and blocks. A LABELED jump binds to the entry whose
   * `labels` contains its label: `break lbl` jumps to the target's
   * endLabel (loops allocate one lazily via `usedEnd` — a C `break` only
   * exits the innermost loop), `continue lbl` to the target loop's
   * continueLabel. Loops: `continueLabel` is null when C `continue` is
   * correct (unlabeled while/forOf); for/do-while loops need a goto label
   * so `continue` still runs the update/condition, and LABELED loops of
   * every shape allocate one up front (a labeled continue from a nested
   * loop needs a goto). Switches are emitted as goto chains — never as C
   * `switch` — so a C `break`/`continue` inside an emitted switch region
   * still binds to the enclosing C loop; a break targeting the switch
   * itself jumps to `endLabel` instead. Labeled blocks carry only an
   * endLabel (`break lbl` is the only jump that can target them).
   * `scopeDepth` = scopes.length at entry — a break/continue releases
   * every scope pushed after that before jumping. `frameDepth` =
   * frames.length at entry: statements the jump exits may still hold
   * pending refcounted temps in their frames (a switch's discriminant,
   * most notably), whose normal end-of-statement releases sit on the
   * fall-through path the jump bypasses — the jump releases every frame
   * pushed after the target's own before jumping. */
  jumpTargets: (
    | {
        kind: "loop";
        continueLabel: string | null;
        usedContinue: boolean;
        endLabel: string | null;
        usedEnd: boolean;
        labels?: string[];
        scopeDepth: number;
        frameDepth: number;
      }
    | { kind: "switch"; endLabel: string; usedEnd: boolean; labels?: string[]; scopeDepth: number; frameDepth: number }
    | { kind: "block"; endLabel: string; usedEnd: boolean; labels: string[]; scopeDepth: number; frameDepth: number }
  )[] = [];
  labelCounter = 0;
  readonly returnTypeByFn = new Map<string, IrType>();
  lineStarts: number[] | null = null;
  /** May-throw analysis results (computeMayThrow): pending-exception checks
   * are emitted only after calls that can actually raise. */
  readonly mayThrow: Set<string>;
  readonly indirectMayThrow: boolean;
  /** Enclosing try contexts, innermost last — the compile-time analogue of
   * the jump-target stack for UNWINDING: a pending check (or `throw`) inside
   * a try releases frames/scopes down to the recorded depths and jumps to
   * `label` (the catch, or the exception-path finally) instead of returning
   * out of the function. Purely compile-time: entering a try emits no code. */
  tryStack: { label: string; used: boolean; frameDepth: number; scopeDepth: number }[] =
    [];
  /** Enclosing try-with-FINALLY regions, innermost last — the pending-
   * return analogue of tryStack: a `return` inside one snapshots its value
   * into the function's pending-return slot (sc_pret), releases down to
   * the region's depths, and jumps to `label` (the region's pending-return
   * finally copy), whose tail dispatches to the next region out or emits
   * the actual return. Spans tryBody and catchBody; the finally body
   * itself is outside (the frontend fences jumps there). */
  finallyStack: { label: string; used: boolean; frameDepth: number; scopeDepth: number }[] =
    [];
  /** Return type of the function being emitted — the unwind path returns a
   * dummy of this type (never read: callers check the pending flag first). */
  currentReturnType: IrType = VOID;
  /** The generator channels of the function being emitted (null outside
   * generator bodies): yieldExpr emission reads them, and emitTryCatch's
   * catch prologue emits the GENRET sentinel re-unwind exactly here. */
  currentGenerator: { yieldT: IrType; nextT: IrType } | null = null;
  /** Cycle-capable shapes ("object:<name>" / "record:<id>") and unions
   * (unionId): instances get a cycle header + emitted trace/teardown, and
   * fields/payloads of these types are visited by container traces.
   * Computed as a greatest fixpoint in the constructor — see there. */
  readonly tracedShapes = new Set<string>();
  readonly tracedUnions = new Set<string>();
  /** The class graph (single inheritance): base/children links, hierarchy
   * membership (extends anywhere ⇒ vtable word + dynamic release), the
   * whole-program preorder numbering behind O(1) instanceof, and the
   * per-hierarchy virtual slot lists (root classes only). Computed once in
   * the constructor. */
  readonly classMeta = new Map<string, ClassMeta>();
  /** Method names with at least one may-throw implementation: a
   * virtualCall's pending check keys on this (same over-approximation as
   * computeMayThrow's callee cover). */
  readonly mayThrowMethods = new Set<string>();
  /** Vtable slot adapters to define after the function signatures (they
   * call sc_f_* bodies): dedupe key "implClass.method". */
  readonly vtAdapters = new Map<string, { impl: ClassMeta; slot: VtSlot }>();

  constructor(
    readonly mod: IrModule,
    sourceText?: string,
  ) {
    for (const fn of mod.functions) {
      this.returnTypeByFn.set(fn.name, fn.returnType);
      this.fnByName.set(fn.name, fn);
    }
    for (const entry of mod.ffiImports ?? []) this.ffiByName.set(entry.name, entry);
    const mt = computeMayThrow(mod);
    this.mayThrow = mt.fns;
    this.indirectMayThrow = mt.indirect;
    for (const g of mod.globals ?? []) this.globalsById.set(g.id, g);
    for (const u of mod.unions ?? []) this.unionsById.set(u.id, u);
    for (const r of mod.records ?? []) this.recordsById.set(r.id, r);
    // The class graph. Link base/children, number the forest in preorder
    // (roots and children in module class order — deterministic), and
    // compute each hierarchy's virtual slots: a class's method gets a slot
    // iff no ancestor declares it (root-most) AND some strict descendant
    // redeclares it — never-overridden methods stay direct calls
    // everywhere (whole-program devirtualization).
    for (const cls of mod.classes ?? []) {
      const meta: ClassMeta = {
        def: cls,
        base: null,
        children: [],
        root: undefined as unknown as ClassMeta,
        pre: 0,
        post: 0,
        hierarchy: false,
        slots: [],
      };
      this.classMeta.set(cls.name, meta);
    }
    for (const meta of this.classMeta.values()) {
      if (meta.def.base === undefined) continue;
      const base = this.classMeta.get(meta.def.base);
      if (!base) throw new Error(`emitter bug: undeclared base class ${meta.def.base}`);
      meta.base = base;
      base.children.push(meta);
    }
    let preCounter = 0;
    const number = (meta: ClassMeta, root: ClassMeta): void => {
      meta.root = root;
      meta.pre = preCounter++;
      for (const c of meta.children) number(c, root);
      meta.post = preCounter - 1; // max pre in the subtree (inclusive)
    };
    for (const meta of this.classMeta.values()) {
      if (meta.base === null) number(meta, meta);
      // The runtime emitter class is ALWAYS a hierarchy member: ScrEmitter
      // carries its vtable word whether or not the program subclasses it.
      meta.hierarchy = meta.base !== null || meta.children.length > 0 ||
        meta.def.name === RUNTIME_EMITTER_CLASS;
    }
    const declares = (m: ClassMeta, method: string): boolean =>
      m.def.methods?.includes(method) ?? false;
    const declaredBelow = (m: ClassMeta, method: string): boolean =>
      m.children.some((c) => declares(c, method) || declaredBelow(c, method));
    const collectSlots = (m: ClassMeta, root: ClassMeta, seen: Map<string, number>): void => {
      for (const method of m.def.methods ?? []) {
        let inherited = false;
        for (let a = m.base; a; a = a.base) inherited ||= declares(a, method);
        if (!inherited && declaredBelow(m, method)) {
          let fn = this.fnByName.get(`%${m.def.name}.${method}`);
          if (!fn && m.def.abstractMethods?.includes(method)) {
            // An ABSTRACT declarer has no function; the slot's ABI
            // signature comes from any concrete descendant implementation
            // (the frontend's override exactness makes them identical).
            // No concrete implementation anywhere in the subtree means no
            // instance can dispatch the slot (only abstract classes
            // declare it, and abstract classes never instantiate) — skip.
            const findImpl = (c: ClassMeta): IrFunction | undefined => {
              for (const child of c.children) {
                const f = declares(child, method) && !child.def.abstractMethods?.includes(method)
                  ? this.fnByName.get(`%${child.def.name}.${method}`)
                  : undefined;
                const found = f ?? findImpl(child);
                if (found) return found;
              }
              return undefined;
            };
            fn = findImpl(m);
            if (!fn) continue;
          }
          if (!fn) throw new Error(`emitter bug: missing method function %${m.def.name}.${method}`);
          // Sibling branches can each own a slot for the same method name
          // (each root-most in its own subtree — mixin layers make this
          // routine): the member name disambiguates by occurrence.
          const occurrence = seen.get(method) ?? 0;
          seen.set(method, occurrence + 1);
          root.slots.push({ method, declarer: m, fn, member: mangleVtSlot(method, occurrence) });
        }
      }
      for (const c of m.children) collectSlots(c, root, seen);
    };
    for (const meta of this.classMeta.values()) {
      if (meta.base === null && meta.hierarchy) collectSlots(meta, meta, new Map());
    }
    for (const cls of mod.classes ?? []) {
      for (const m of cls.methods ?? []) {
        if (this.mayThrow.has(`%${cls.name}.${m}`)) this.mayThrowMethods.add(m);
      }
    }
    // Cycle capability, as a greatest fixpoint over shapes and unions:
    // start optimistic (everything cycle-capable), then repeatedly drop
    // shapes with no cycle-capable field and unions with no cycle-capable
    // arm until stable. Closures and promises are always cycle-capable
    // (a captured box can hold anything; a rejection payload is an
    // arbitrary thrown value); strings never are, and arrays/maps inherit
    // their element/value type's capability (a record element can point
    // back at the array holding it). The optimistic start is what keeps
    // self- and mutually-recursive classes traced (`class A { next: A }`).
    const shapeDefs = [
      // The emitter class carries a synthetic closure-typed pseudo-field:
      // its runtime registry OWNS listener closures, so the emitter
      // hierarchy is unconditionally cycle-capable — the fixpoint must
      // never drop it (the pseudo-field never reaches struct emission;
      // runtime classes emit no structs).
      ...(mod.classes ?? []).map((c) => ({
        key: `object:${c.name}`,
        fields: c.name === RUNTIME_EMITTER_CLASS
          ? [...c.fields, { name: "<listeners>", type: funcOf([], VOID) }]
          : c.fields,
      })),
      // An index-signature shape's overflow map participates like a field
      // of map type: the shape is cycle-capable when the overflow VALUE
      // type is (a record/object/union value in the map can point back at
      // the record embedding it) — cycleCapable's map rule answers that.
      // A shape that ARMED the hidden toString slot carries one more
      // member — a `() => string` closure — and a closure is
      // unconditionally cycle-capable (it can capture the very record
      // holding it: the class→record projection's closure captures the
      // instance, and a self-referential class reaches the record back).
      // So the slot joins the fixpoint exactly like <overflow> does; a
      // shape whose only cycle-capable member is the slot would otherwise
      // get no header and its trace would visit an edge on a node the
      // collector does not know.
      ...(mod.records ?? []).map((r) => ({
        key: `record:${r.id}`,
        fields: [
          ...r.fields,
          ...(r.indexValue ? [{ name: "<overflow>", type: mapOf(STRING, r.indexValue) }] : []),
          ...(r.tostr ? [{ name: "<toString>", type: funcOf([], STRING) }] : []),
          // ...and the hidden SOURCE [[Prototype]] slot, a dyn member, for
          // the same reason: a dyn value carries a collector header of its
          // own and its members can point back at the shape holding it, so
          // a shape whose ONLY cycle-capable member is this slot must get a
          // header or its trace would visit an edge on a node the collector
          // does not know.
          ...(r.srcproto ? [{ name: "<srcproto>", type: DYN }] : []),
        ],
      })),
    ];
    for (const s of shapeDefs) this.tracedShapes.add(s.key);
    // A hierarchy is ONE unit of cycle capability: a base-typed slot can
    // hold any subclass and retain touches the cycle header, so header
    // presence must be uniform across an extends-hierarchy — it is
    // cycle-capable iff ANY member is. Standalone classes and records are
    // singleton units (today's behavior exactly).
    const unitKeyOf = (key: string): string => {
      if (!key.startsWith("object:")) return key;
      const meta = this.classMeta.get(key.slice("object:".length));
      return meta && meta.hierarchy ? `object:${meta.root.def.name}` : key;
    };
    const units = new Map<string, typeof shapeDefs>();
    for (const s of shapeDefs) {
      const unit = unitKeyOf(s.key);
      let members = units.get(unit);
      if (!members) units.set(unit, (members = []));
      members.push(s);
    }
    for (const u of mod.unions ?? []) this.tracedUnions.add(u.id);
    const cycleCapable = (t: IrType): boolean => {
      switch (t.kind) {
        case "func":
        case "promise":
        // The abort pair carries a collector header of its own: a listener
        // closure stored on a signal can capture the record or object
        // holding that signal, so the containing shape is cycle-capable
        // through the handle.
        case "abortSignal":
        case "abortController":
        // A dyn value carries a collector header of its own (scr_json.c's
        // scr_dyn_trace) and its members, [[Prototype]] link and accessor
        // table all point at further dyn values, so an `unknown`-typed
        // field can hold a graph that points back at the shape holding it.
        // Missing here was the SHAPE-LEVEL face of the untraced-dyn defect:
        // traceAdapterC now answers `scr_dyn_trace_v` for a dyn field, but
        // a shape whose ONLY cycle-capable field is dyn was still dropped
        // from tracedShapes by this fixpoint and got no header at all — so
        // the ring was invisible because the NODE was not a node. Twelve of
        // zapo's 2120 shapes were in exactly that state.
        case "dyn":
          return true;
        case "object":
          return this.tracedShapes.has(`object:${t.className}`);
        case "record":
          return this.tracedShapes.has(`record:${t.shapeId}`);
        case "union":
          return this.tracedUnions.has(t.unionId);
        // A map is cycle-capable exactly when its VALUE type is: a record/
        // object/union value can hold the map that owns it, while string/
        // array/scalar values cannot point back. Map-valued maps (an
        // index-signature overflow over `Map<K, V>` values) recurse on the
        // inner value. Terminates: IrTypes are finite trees, and the
        // record/union cases read the fixpoint sets.
        case "map":
          return cycleCapable(t.value);
        // An array is cycle-capable exactly when its ELEMENT type is —
        // record/object/union elements (and cycle-capable inner arrays)
        // can point back at the array. Terminates: element types are
        // finite trees, and the record/union cases read the fixpoint sets.
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
          this.tracedShapes.has(members[0]!.key) &&
          !members.some((s) => s.fields.some((f) => cycleCapable(f.type)))
        ) {
          for (const s of members) this.tracedShapes.delete(s.key);
          shrunk = true;
        }
      }
      for (const u of mod.unions ?? []) {
        if (this.tracedUnions.has(u.id) && !u.arms.some(cycleCapable)) {
          this.tracedUnions.delete(u.id);
          shrunk = true;
        }
      }
    }
    if (sourceText !== undefined) {
      this.lineStarts = [0];
      for (let i = 0; i < sourceText.length; i++) {
        if (sourceText[i] === "\n") this.lineStarts.push(i + 1);
      }
    }
  }

  /** The OOM abort, as a CALL to the shared helper. Every raw allocation
   * the emitter plants guards its result with this on the very next
   * statement; the guard is what stands between a NULL calloc and the
   * `o->rc = 1` one line down, so it is never elided — only the message
   * moves out of the site. */
  oomAbortC(): string {
    this.usesOomHelper = true;
    return "sc_oom()";
  }

  /** The invalid-union-tag abort, as a CALL to the shared helper. Closes a
   * `switch (v->tag)` whose case labels are exactly the union's arms; C
   * needs the default for definite assignment and a corrupt tag must stay
   * loud, so the arm stays — only the message moves out of it. */
  badTagAbortC(): string {
    this.usesBadTagHelper = true;
    return "sc_bad_tag()";
  }

  /** The stringify-undefined-arm abort, as a CALL to the shared helper. */
  stringifyUndefAbortC(): string {
    this.usesStringifyUndefHelper = true;
    return "sc_stringify_undef()";
  }

  /** The definitions for whichever shared abort helpers the TU referenced,
   * spliced in just below the includes so every later definition can call
   * them. Emitted only when referenced: an unused static would warn. */
  sharedTrapDefs(): string[] {
    const defs: string[] = [];
    // Spelled over THREE lines, like every other emitted definition: the
    // TU's line-oriented readers (tu-census.mjs, structural-aborts.mjs,
    // tests/perf/imagesize/*) all take "a definition opens at column 0 and
    // closes with `}` at column 0" as given, and a one-liner would hide the
    // helper's body from every one of them.
    const def = (name: string, msg: string): void => {
      defs.push(`static _Noreturn void ${name}(void) {`, `  scr_trap(${msg});`, `}`);
    };
    if (this.usesOomHelper) def("sc_oom", '"scriptc: out of memory\\n"');
    if (this.usesBadTagHelper) {
      def("sc_bad_tag", '"scriptc: internal error: invalid union tag\\n"');
    }
    if (this.usesStringifyUndefHelper) {
      def("sc_stringify_undef", '"scriptc: internal error: stringify reached an undefined arm\\n"');
    }
    if (defs.length > 0) defs.push("");
    return defs;
  }

  emit(): string {
    const body: string[] = [];
    // Function bodies are emitted first (into this.lines) so the literal
    // table is complete; the file is then assembled around them.
    for (const fn of this.mod.functions) {
      this.emitFunction(fn);
      appendLines(body, this.lines);
      this.lines.length = 0;
    }

    const out: string[] = [
      `/* Generated by scriptc from ${this.mod.sourceFile}. Do not edit. */`,
      `#include "scr_runtime.h"`,
      // The WebSocket global's API-object glue: its own header, because
      // the synthesized ctor/dispatch thunks name ScrWsGlobal and the
      // SCR_WSG_* event codes. Only when the program took the global:
      // the unit is not in a link line that never did.
      ...(this.wsCtors.size > 0 ? [`#include "scr_ws_global.h"`] : []),
      ...(this.wsDispatchUsed ? [`#include "scr_ws_dispatch.h"`] : []),
      `#include <math.h>`,
      `#include <stdio.h>`,
      `#include <stdlib.h>`,
      ``,
    ];
    // The shared abort helpers land HERE, below the includes and above
    // every definition that calls them. Their flags are only known once the
    // bodies, the struct defs and the walkers have all been emitted, so the
    // lines are spliced into this slot just before the file is joined.
    const trapHelperSlot = out.length;
    // Struct defs render into their own buffer BEFORE the unit-instance
    // table flushes: class newFns point undefined-armed union fields at
    // interned unit instances (fields start as JS's undefined, not NULL),
    // so the instances they intern must both exist in the map by flush
    // time and be DEFINED earlier in the file than the newFn bodies.
    const structDefs: string[] = [];
    this.emitStructDefs(structDefs);
    // ASYNC GENERATOR settle thunks are interned HERE, ahead of the
    // unit-instance flush below, not where the spawn wrappers name them
    // (emitAsyncScaffolding, much further down). Building one interns the
    // IteratorResult record's undefined arm as a unit instance, and this
    // table is already written out by then — a thunk built late would
    // reference an sc_unit_* that no line defines. Interning is
    // idempotent, so the scaffolding's own call just reads the cache.
    for (const fn of this.mod.functions) {
      if (fn.generator === undefined || fn.async !== true) continue;
      agenSettleThunkFor(
        this,
        { kind: "asyncGenerator", yieldT: fn.generator.yieldT, retT: fn.returnType, nextT: fn.generator.nextT },
        { kind: "record", shapeId: fn.generator.resultShapeId! },
      );
    }
    for (const [text, sym] of this.literals) {
      const bytes = Buffer.from(text, "utf8");
      out.push(
        `static struct { size_t rc; size_t len; size_t cap; char data[${bytes.length + 1}]; } ${sym} =`,
        `    { SIZE_MAX, ${bytes.length}, ${bytes.length}, ${cStringLiteral(bytes)} };`,
      );
    }
    if (this.literals.size > 0) out.push("");
    for (const [key, sym] of this.unitInstances) {
      // One immortal instance per unit-armed (union, tag): tag set, payload
      // slot and RC entry points zero — retain/release/collector all skip
      // rc == SIZE_MAX, so these never join the RC audit or a trace walk.
      const [unionId, tag] = key.split(":");
      out.push(
        `static ScrUnion ${sym} = { .rc = SIZE_MAX, .tag = ${tag} }; /* ${unionId} unit arm */`,
      );
    }
    if (this.unitInstances.size > 0) out.push("");
    for (const line of structDefs) out.push(line); // program-sized: never spread
    for (const [key, sym] of this.regexInstances) {
      // One immortal ScrRegex per (pattern, flags) literal, pointing at the
      // interned source/flags strings. `.bc` starts NULL: the runtime
      // compiles the pattern lazily on first use and caches it here (and
      // frees it at exit), so unexecuted regexes cost nothing. NOT const —
      // the bc slot mutates.
      const sep = key.indexOf("/");
      const flags = key.slice(0, sep);
      const pattern = key.slice(sep + 1);
      const src = this.internLiteral(pattern);
      const fl = this.internLiteral(flags);
      // "*/" inside the pattern would close the trailing comment.
      const safe = `/${pattern}/${flags}`.split("*/").join("* /");
      out.push(
        `static ScrRegex ${sym} = { .rc = SIZE_MAX, .source = (ScrStr *)&${src}, ` +
          `.flags = (ScrStr *)&${fl}, .bc = NULL }; /* ${safe} */`,
      );
    }
    if (this.regexInstances.size > 0) out.push("");
    for (const [, { sym, cooked }] of this.templateStringsInstances) {
      // One immortal ScrArr per tagged-template site: the data slots point
      // at the interned cooked-string literals (address constants — fully
      // static, no lazy init; reads retain immortal strings, a no-op).
      // len == cap and nothing ever mutates it (TemplateStringsArray is
      // ReadonlyArray, tsc rejects the mutating spellings).
      const slots = cooked.map((s) => `(void *)&${this.internLiteral(s)}`).join(", ");
      out.push(
        `static void *${sym}_data[${cooked.length}] = { ${slots} };`,
        `static ScrArr ${sym} = { .rc = SIZE_MAX, .len = ${cooked.length}, .cap = ${cooked.length}, ` +
          `.elem = SCR_ELEM_STR, .elem_retain = NULL, .elem_release = NULL, .elem_trace = NULL, ` +
          `.data = (uint64_t *)${sym}_data };`,
      );
    }
    if (this.templateStringsInstances.size > 0) out.push("");
    const embedded = this.mod.embedded;
    emitNpmEmbedding(this, out);
    const globals = this.mod.globals ?? [];
    for (const g of globals) {
      // File-scope statics: zero/NULL-initialized, assigned by %init
      // functions, released (refcounted ones) before the RC audit runs.
      out.push(`static ${cDecl(g.type, mangleGlobal(g.id))}; /* ${g.name} */`);
    }
    if (globals.length > 0) out.push("");
    // Outbound native FFI declarations. string/bytes each expand from one
    // scriptc value to a borrowed pointer+length pair at the C boundary.
    for (const entry of this.mod.ffiImports ?? []) {
      const params = entry.params.flatMap((cls): string[] => {
        switch (cls) {
          case "f64":
            return ["double"];
          case "bool":
          case "u8":
            return ["uint8_t"];
          case "u32":
            return ["uint32_t"];
          case "i32":
            return ["int32_t"];
          case "string":
          case "bytes":
            return ["const uint8_t *", "size_t"];
        }
      });
      const ret =
        entry.returns === "f64" ? "double"
        : entry.returns === "bool" || entry.returns === "u8" ? "uint8_t"
        : entry.returns === "u32" ? "uint32_t"
        : entry.returns === "i32" ? "int32_t"
        : "void";
      out.push(`extern ${ret} ${entry.symbol}(${params.length > 0 ? params.join(", ") : "void"});`);
    }
    if ((this.mod.ffiImports?.length ?? 0) > 0) out.push("");
    for (const fn of this.mod.functions) out.push(this.signature(fn) + ";");
    // Class objects (classes as values): construct-thunk prototypes plus
    // the immortal statics that take their addresses — after the function
    // signatures (the thunks call sc_new_*/the constructors), before
    // anything that references &sc_co_*.
    emitClassObjs(this, out);
    // Vtable slot adapters: prototyped with the vtables (emitStructDefs),
    // defined here where the method bodies they call are declared.
    this.emitVtAdapterDefs(out);
    // Wrappers + interned closures for declared functions used as values.
    // Placed after the forward declarations (they call sc_f_*) and before
    // the bodies (which reference &sc_fc_*).
    this.emitAsyncScaffolding(out);
    for (const name of this.fnValues) {
      const fn = this.fnByName.get(name)!;
      const params = ["ScrClosure *sc_env", ...fn.params.map((p) => cDecl(p.type, mangleLocal(p.localId)))];
      const call = `${this.callTargetC(name)}(${fn.params.map((p) => mangleLocal(p.localId)).join(", ")})`;
      const retType = fn.async ? "ScrPromise *" : fn.generator ? "ScrGen *" : cType(fn.returnType);
      out.push(
        ``,
        `static ${retType}${retType.endsWith("*") ? "" : " "}${mangleWrapper(name)}(${params.join(", ")}) {`,
        `  (void)sc_env;`,
        fn.returnType.kind === "void" && !fn.async && !fn.generator ? `  ${call};` : `  return ${call};`,
        `}`,
        // The field list MIRRORS ScrClosure's, and it has to stay exact:
        // the runtime casts &sc_fc_* to ScrClosure * and writes through
        // it, so a field the literal omits is a write past the object.
        // `implicit_proto` is the prototype object scr_dyn_fn_prototype
        // mints on first demand.
        `static struct { size_t rc; void *fn; size_t ncaps; ScrBox *props; void *implicit_proto; } ${mangleFnClosure(name)} =`,
        `    { SIZE_MAX, (void *)&${mangleWrapper(name)}, 0, NULL, NULL };`,
      );
    }
    // Construct-thunk definitions (prototyped with the class objects
    // above): they call sc_new_* and the constructors, both declared.
    emitCtorThunkDefs(this, out);
    // Type-directed JSON walkers (jsonStringify serializers, dynCheck
    // matchers/builders), interned per type during body emission above.
    if (this.walkerProtos.length > 0) {
      out.push("");
      for (const line of this.walkerProtos) out.push(line);
      out.push("");
      for (const line of this.walkerDefs) out.push(line);
    }
    // Loop-appended, never spread: `body` scales with the PROGRAM (a large
    // embedded graph emits hundreds of thousands of lines), and a spread
    // push passes every line as a call argument — the engine's stack
    // overflows long before memory matters.
    out.push("");
    for (const line of body) out.push(line);
    if (this.mod.lib !== undefined) {
      // LIBRARY mode: no main(), no scr_init/scr_lib_init, no event
      // loop — the profile-declared external symbols instead. Everything
      // above is unchanged (still all internal linkage).
      this.emitLibEntries(out, globals);
      out.splice(trapHelperSlot, 0, ...this.dcCountDefs(), ...this.rkCountDefs(), ...this.sharedTrapDefs());
      return out.join("\n");
    }
    const refGlobals = globals.filter((g) => isRefCounted(g.type));
    // Interned function-value closures are IMMORTAL (rc == SIZE_MAX), so
    // every lazily-created owned edge hung on one would outlive the RC
    // audit — dropped with the globals through the runtime's one
    // teardown entry point (scr_closure_static_teardown: the
    // own-property table AND the minted implicit prototype). UNGATED on
    // purpose: this used to fire only under moduleUsesDynInvoke, on the
    // premise that Object.defineProperties was the table's only writer.
    // It is not — a keyed write `F.k = v` and a keyed READ of
    // `F.prototype` both reach scr_dyn_fn_props, and the lazily-minted
    // prototype object lives in that table. See the LLVM emitter's note.
    const fnValueProps = [...this.fnValues];
    if (refGlobals.length > 0 || fnValueProps.length > 0) {
      out.push(`static void sc_release_globals(void) {`);
      for (const g of refGlobals) {
        out.push(`  ${releaseCallC(g.type, mangleGlobal(g.id))};`);
      }
      for (const name of fnValueProps) {
        out.push(
          `  scr_closure_static_teardown((ScrClosure *)&${mangleFnClosure(name)});`,
        );
      }
      out.push(`}`, ``);
    }
    const asyncEntry = this.fnByName.get(this.mod.entry)?.async === true;
    const hasAsync = this.mod.functions.some((f) => f.async);
    // Generator programs run the loop too (an empty pass when nothing is
    // pending): its exit accounting notes still-suspended generator
    // fibers as abandoned, so the RC audit downgrades exactly like the
    // async loop-exhaustion story.
    const hasGenerators = this.mod.functions.some((f) => f.generator !== undefined);
    // Embedded npm code can leave island promise chains pending when %main
    // returns (a package function's async work) — the loop's io hook
    // drains the engine's job queue at quiescence, so npm-importing
    // programs always run the loop, like Node always runs its own.
    const usesIsland = embedded !== undefined && embedded.modules.length > 0;
    // A pending module root normally selects Node's exit status 13, but
    // an already-failed node:test run or an embedded process.exitCode has
    // higher precedence. Keep this expression shared with the ordinary
    // successful epilogue so both paths consult the same program verdict.
    const usesNodeTest = moduleUsesNodeTest(this.mod);
    const programExitUsesIsland = !usesNodeTest && usesIsland;
    const programExitCode = usesNodeTest
      ? "scr_test_exit_code()"
      : usesIsland
        ? "scr_island_exit_code()"
        : "0";
    // Exit listeners can read MODULE GLOBALS directly (test/common's
    // runCallChecks over its mustCallChecks ledger — an interned top-level
    // closure, no capture boxes keeping anything alive), so they must run
    // BEFORE sc_release_globals — the atexit half alone would fire after
    // main freed them (observed use-after-free). scr_run_exit_listeners
    // is idempotent (scr_exit_ran), so the atexit becomes a no-op; the
    // code argument is the hint the failure reporters maintain — exactly
    // what the atexit path would have passed.
    const needsRelease = refGlobals.length > 0 || fnValueProps.length > 0;
    const runExitListeners =
      moduleUsesProcessEvents(this.mod) && needsRelease
        ? "scr_run_exit_listeners((double)scr_exit_code_hint_get()); "
        : "";
    const releaseGlobals = needsRelease
      ? `  ${runExitListeners}sc_release_globals();`
      : `  /* no refcounted globals */`;
    const uncaught = (indent: string, releaseTop = false) => [
      `${indent}if (scr_exc_pending()) {`,
      `${indent}  scr_exc_print_uncaught();`,
      `${indent}  ${releaseTop ? "scr_promise_release(sc_top); " : ""}` +
        `${needsRelease ? `${runExitListeners}sc_release_globals(); ` : ""}return 1;`,
      `${indent}}`,
    ];
    // The RC-audit per-SITE table (SCRIPTC_RC_SITES=1 only — see
    // rcSitesRequested). Emitted here, immediately before main, so every
    // closure body it names is already prototyped.
    const rcSiteRows = [...this.closureSites].filter(([sym]) => sym.length > 0);
    if (rcSiteRows.length > 0) {
      out.push(
        `#ifdef SCR_RC_AUDIT`,
        `static const ScrClosureSite sc_clo_site_tbl[] = {`,
        ...rcSiteRows.map(([sym, site]) =>
          `  { (const void *)&${sym}, ${cStringLiteral(Buffer.from(site, "utf8"))} },`),
        `};`,
        `#endif`,
        ``,
      );
    }
    // The function-name table (scr_runtime.h, ScrFnName). Unlike the
    // RC-audit table above this is unconditional: it is the ANSWER
    // `[Function: name]` needs for every box a WALKER builds, which has
    // only the closure's entry point to go on. Sorted so the TU is a
    // function of the program and not of emission order. Emitted here,
    // with the RC table, for the same reason — the bodies it names are
    // all prototyped by now.
    const fnNameRows = [...this.fnNames].filter(([sym]) => sym.length > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (fnNameRows.length > 0) {
      out.push(
        `static const ScrFnName sc_fn_name_tbl[] = {`,
        ...fnNameRows.map(([sym, name]) =>
          `  { (const void *)&${sym}, ${cStringLiteral(Buffer.from(name, "utf8"))} },`),
        `};`,
        ``,
      );
    }
    out.push(
      // Real argc/argv feed the library's interned process.argv (see
      // scr_lib_init — lazy, so argv-free programs allocate nothing).
      `int main(int argc, char **argv) {`,
      `  scr_init();`,
      ...(fnNameRows.length > 0
        ? [`  scr_fn_names_install(sc_fn_name_tbl, sizeof sc_fn_name_tbl / sizeof sc_fn_name_tbl[0]);`]
        : []),
      ...(rcSiteRows.length > 0
        ? [
            `#ifdef SCR_RC_AUDIT`,
            `  scr_closure_sites_install(sc_clo_site_tbl, sizeof sc_clo_site_tbl / sizeof sc_clo_site_tbl[0]);`,
            `#endif`,
          ]
        : []),
      // The builtin error classes' preorder intervals are program-dependent
      // (they share this module's class-forest numbering, so instanceof and
      // the uncaught printer's Error-range test agree between runtime-made
      // and compiled error objects) — stamp them before any code runs.
      ...this.errorVtStampLines(),
      // The runtime emitter vtable's interval, when the program touches
      // node:events (the class def rides the module exactly then).
      ...emitterVtStampLines(this),
      // The runtime stream vtables' intervals, when the program touches
      // node:stream (the emitter story — instanceof and dynamic teardown
      // both dispatch through them).
      ...streamVtStampLines(this),
      `  scr_lib_init(argc, argv);`,
      // Fetch-referencing programs register the native fetch bridge before any
      // island entry (the engine's lazy boot consults it): the ONLY
      // reference to scr_fetch.c, so fetch-free builds never compile or
      // link it (cc.ts gates on the same predicate). moduleUsesFetch is
      // true only for fetch-referencing embedded graphs and for USER-code
      // fetch (the island-backed ambient's globalGet) — both boot the
      // engine before the global is read.
      ...(moduleUsesFetch(this.mod) ? [`  scr_fetch_install();`] : []),
      // Embedded graphs that import node:zlib register the island's zlib
      // bridge before any island entry — the ONLY reference to
      // scr_zlib_island.c (cc.ts compiles it on the same predicate), so
      // zlib-free dynamic builds keep the island's clear refusal.
      ...(moduleEmbedsBuiltin(this.mod, "node:zlib") ? [`  scr_zlib_island_install();`] : []),
      // Embedded graphs that import node:http/https register the island's
      // http client bridge (scr_net_island.c — cc.ts compiles it and the
      // socket units on the same predicate; native-fetch builds also
      // register it from scr_fetch_install, idempotently).
      ...(moduleEmbedsBuiltin(this.mod, "node:http") || moduleEmbedsBuiltin(this.mod, "node:https")
        ? [`  scr_net_island_install();`]
        : []),
      // Event-surface programs (signal/exit listeners, stdin events) fill
      // the loop's nullable event hooks before %main — the events unit
      // (scr_events.c) links only when this line is emitted (cc.ts gates
      // on the same predicate, like fetch).
      ...(moduleUsesProcessEvents(this.mod) ? [`  scr_events_install();`] : []),
      // Net-surface programs fill the loop's net hooks before %main — the
      // net unit (scr_net.c) links only when this line is emitted (cc.ts
      // gates on the same predicate, like events). The dyn-install twin
      // stamps the netSocket handle-dispatch ops into the dyn core so
      // sockets can cross the checked-dynamic boundary (SCR_DYN_HANDLE).
      // globalThis.WebSocket rides the same hooks: scr_ws_client.c dials
      // through scr_net_connect and reads through the poller, so without
      // this line the loop never polls and the process exits between the
      // constructor and the handshake (measured).
      // The static fetch rides the same hooks for the same reason
      // globalThis.WebSocket does: scr_fetch_static.c dials through
      // scr_http's client, which reads through the poller — without this
      // line the loop has no pending work at the first turn, so the
      // process exits between the dial and the response head and the
      // program prints NOTHING with exit 0 (measured, and exactly the
      // silent failure a fetch must never have).
      ...(moduleUsesNet(this.mod) || moduleUsesWsGlobal(this.mod) || moduleUsesFetchStatic(this.mod)
        ? [`  scr_net_install();`, `  scr_net_dyn_install();`]
        : []),
      // Http-surface programs additionally stamp the httpReq/httpRes
      // handle-dispatch ops (scr_http.c links exactly when this line is
      // emitted — cc.ts's http gate).
      ...(moduleUsesHttpServer(this.mod) ? [`  scr_http_dyn_install();`] : []),
      // http2-surface programs stamp the h2 session/stream handle-dispatch
      // ops (scr_http2.c links exactly when this line is emitted — cc.ts's
      // http2 gate).
      ...(moduleUsesHttp2(this.mod) ? [`  scr_http2_dyn_install();`] : []),
      // Regex-surface programs stamp the RegExp handle-dispatch ops so a
      // regex can cross into the checked-dynamic tree by reference. The
      // gate is moduleUsesRegex — the SAME switch cc.ts links scr_regex.c
      // on — so the call and the symbol appear together or not at all
      // (a program that boxes a regex necessarily contains one).
      ...(moduleUsesRegex(this.mod) ? [`  scr_regex_dyn_install();`] : []),
      // Child-stdio programs stamp the child-stream handle-dispatch ops so
      // `child.stdout` can cross into the checked-dynamic tree by
      // reference. scr_child.c is always linked, so this is a plain
      // install gate rather than a link switch.
      ...(moduleUsesChildStream(this.mod) ? [`  scr_child_stream_dyn_install();`] : []),
      // Stream-surface programs fill the loop's stream hook (the deferred
      // next-tick emissions) before %main — scr_stream.c links only when
      // this line is emitted (cc.ts gates on the same predicate).
      ...(moduleUsesStream(this.mod) ? [`  scr_stream_install();`] : []),
      // The static fetch's abort seam: installed only when a program both
      // fetches and holds a signal, which is exactly when cc.ts links
      // scr_fetch_abort.c. It runs BEFORE %main so an already-aborted
      // signal handed to the very first fetch is seen.
      ...(moduleUsesFetchStatic(this.mod) && moduleUsesAbortSignal(this.mod)
        ? [`  scr_fetch_abort_install();`]
        : []),
      // The static fetch's DISPATCHER seam, the same way: installed only
      // when a program writes a dispatcher onto a RequestInit, which is
      // exactly when cc.ts links scr_fetch_dispatch.c.
      ...(moduleUsesFetchDispatch(this.mod) ? [`  scr_fetch_dispatch_install();`] : []),
      // Dgram/dns-surface programs fill the loop's dgram hooks the same
      // way — scr_dgram.c links only when this line is emitted.
      ...(moduleUsesDgram(this.mod) ? [`  scr_dgram_install();`] : []),
      // fs.watch programs fill the loop's watch hooks the same way —
      // scr_watch.c links only when this line is emitted.
      ...(moduleUsesFsWatch(this.mod) ? [`  scr_watch_install();`] : []),
      // The embedded npm tables must be registered before %main: the %init
      // functions it calls import from them. Static data only — the engine
      // still boots lazily, on the first island entry. Compressed module
      // text (emit-island.ts stores big sources as raw DEFLATE) needs the
      // inflater installed first — scr_zlib.c joins the link on the same
      // moduleEmbedsCompressedNpm predicate (index.ts's zlib switch), so
      // compression-free dynamic builds keep their exact link line.
      ...(embedded && embedded.modules.length > 0
        ? [
            ...(moduleEmbedsCompressedNpm(this.mod)
              ? [`  scr_island_set_inflate(scr_zlib_inflate_exact);`]
              : []),
            `  scr_island_modules(sc_npm_modules, ${embedded.modules.length}, ` +
              `${embedded.edges.length > 0 ? "sc_npm_edges" : "NULL"}, ${embedded.edges.length});`,
          ]
        : []),
      ...(asyncEntry
        ? [`  ScrPromise *sc_top = ${mangleAsyncSpawn(this.mod.entry)}();`]
        : [`  ${mangleFunction(this.mod.entry)}();`]),
      // Uncaught exception from top-level code: Node exits 1.
      ...(this.mayThrow.has(this.mod.entry) && !asyncEntry ? uncaught("  ") : []),
      // The event loop runs to exhaustion (microtasks before timers). A
      // throw escaping a timer callback and unhandled promise rejections
      // both exit 1, like Node.
      ...(hasAsync || hasGenerators || this.usesTimers || usesIsland
        ? [
            `  bool sc_loop_rejection = scr_loop_run(${asyncEntry ? "sc_top" : "NULL"});`,
            ...uncaught("  ", asyncEntry),
            `  if (sc_loop_rejection) {`,
            `    scr_discard_unhandled_rejections();`,
            ...(asyncEntry ? [`    scr_promise_release(sc_top);`] : []),
            `    ${needsRelease ? `${runExitListeners}sc_release_globals(); ` : ""}return 1;`,
            `  }`,
            ...(asyncEntry
              ? [
                  `  int sc_top_status = scr_promise_finish_top_level(sc_top);`,
                  `  if (sc_top_status == 1) {`,
                  // Earlier-checkpoint rejections were decided inside the
                  // loop. The fatal module verdict suppresses unrelated
                  // rejections from THIS checkpoint, exactly Node's order.
                  `    scr_discard_unhandled_rejections();`,
                  `    scr_promise_rethrow_top_level(sc_top);`,
                  `    scr_promise_release(sc_top);`,
                  `    scr_exc_print_uncaught();`,
                  `    ${needsRelease ? `${runExitListeners}sc_release_globals(); ` : ""}return 1;`,
                  `  }`,
                  `  scr_promise_release(sc_top);`,
                ]
              : []),
            `  if (scr_report_unhandled_rejections()) {`,
            `    ${needsRelease ? `${runExitListeners}sc_release_globals(); ` : ""}return 1;`,
            `  }`,
            ...(asyncEntry
              ? [
                  `  if (sc_top_status == 13) {`,
                  `    int sc_exit_status = ${programExitCode};`,
                  `    if (sc_exit_status == 0) sc_exit_status = sc_top_status;`,
                  ...(programExitUsesIsland && runExitListeners !== ""
                    ? [`    size_t sc_exit_code_version = scr_island_exit_code_version();`]
                    : []),
                  // finish_top_level initially notes 13; replace that hint
                  // before exit listeners run when a higher-priority
                  // verdict has already selected the process status.
                  `    scr_exit_code_note(sc_exit_status);`,
                  ...(runExitListeners !== "" ? [`    ${runExitListeners.trim()}`] : []),
                  ...(programExitUsesIsland && runExitListeners !== ""
                    ? [
                        `    if (scr_island_exit_code_version() != sc_exit_code_version) {`,
                        `      sc_exit_status = scr_island_exit_code();`,
                        `      scr_exit_code_note(sc_exit_status);`,
                        `    }`,
                      ]
                    : []),
                  ...(needsRelease ? [`    sc_release_globals();`] : []),
                  `    return sc_exit_status;`,
                  `  }`,
                ]
              : []),
          ]
        : []),
      releaseGlobals,
      // node:test programs exit through the runner's verdict (Node's
      // contract: 1 when any non-todo test failed). The loop-run above is
      // guaranteed for these programs — every registration libCall sets
      // usesTimers, so the runner fiber always drains before this line.
      // Island programs exit with process.exitCode when the embedded
      // graph set it (Node's implicit exit status: set it, return
      // normally, exit with it) — 0 when never set.
      `  return ${programExitCode};`,
      `}`,
      ``,
    );
    out.splice(trapHelperSlot, 0, ...this.dcCountDefs(), ...this.rkCountDefs(), ...this.sharedTrapDefs());
    return out.join("\n");
  }

  /* ── library mode ─────────────────────────────────────────────────────
   * The program TU's ONLY external-linkage definitions: the export-map
   * wrappers plus the mode-provided init / sink-registration / reset /
   * collect entries, all delegating their runtime halves to scr_library.c so
   * both backends' emitted bodies are trivially identical. The init entry
   * IS module-graph evaluation: full deterministic reset (program globals
   * released and zeroed — run-once guards included — then the runtime's
   * session reset), the error-vt interval stamps verbatim from today's
   * main, then %main, then the escaped-exception check. */
  emitLibEntries(out: string[], globals: IrGlobal[]): void {
    const lib = this.mod.lib!;
    const autoReset = lib.resultResetSymbol === null;
    out.push(``, `/* ── library-mode entries (profile: ${lib.profileName}) ── */`, ``);
    // Session reset of PROGRAM state: release every refcounted global and
    // zero everything (the run-once module guards included), putting the
    // program back at the not-yet-evaluated state.
    out.push(`static void sc_lib_release_globals(void) {`);
    for (const g of globals) {
      const name = mangleGlobal(g.id);
      if (isRefCounted(g.type)) {
        out.push(`  ${releaseCallC(g.type, name)}; ${name} = NULL; /* ${g.name} */`);
      } else if (g.type.kind === "bool") {
        out.push(`  ${name} = false; /* ${g.name} */`);
      } else {
        out.push(`  ${name} = 0; /* ${g.name} */`);
      }
    }
    if (globals.length === 0) out.push(`  /* no globals */`);
    out.push(`}`, ``);

    // The runtime detected-trap overlay table (scr_runtime.h declares it,
    // the library trap funnel consults it): flat code/teaching/remediation
    // triples, one per runtime trap code (SC4013–SC4019) the profile
    // declares text for. NULL keeps the funnel's default for that cell;
    // the empty table still defines the symbols the funnel links against.
    if (lib.trapOverlays.length === 0) {
      out.push(`const char *const scr_library_trap_overlays[] = { NULL };`);
    } else {
      const cells = lib.trapOverlays.flatMap((o) => [
        cStringLiteral(Buffer.from(o.code, "utf8")),
        o.teaching !== undefined ? cStringLiteral(Buffer.from(o.teaching, "utf8")) : "NULL",
        o.remediation !== undefined ? cStringLiteral(Buffer.from(o.remediation, "utf8")) : "NULL",
      ]);
      out.push(`const char *const scr_library_trap_overlays[] = { ${cells.join(", ")} };`);
    }
    out.push(`const size_t scr_library_trap_overlays_len = ${lib.trapOverlays.length};`, ``);

    out.push(
      `void ${lib.initSymbol}(void) {`,
      `  scr_library_entry(true, "${lib.initSymbol}"); /* init always resets the result arena */`,
      `  sc_lib_release_globals();`,
      `  scr_library_reset();`,
      ...this.errorVtStampLines(),
      ...emitterVtStampLines(this),
      `  ${mangleFunction(this.mod.entry)}();`,
      `  scr_library_check_exc();`,
      `}`,
      ``,
      `void ${lib.sinkRegisterSymbol}(void (*fn)(void *ctx, const uint8_t *msg, size_t msg_len, uint64_t address), void *ctx) {`,
      `  scr_library_set_sink(fn, ctx);`,
      `}`,
      ``,
    );
    if (lib.identity !== undefined) {
      // Profile-declared identity getters (the ask-2 sidecar's boot-time
      // pairing fence): pure data returns with NO entry prologue — exempt
      // from the poisoned guard and every runtime touch (ratified), so a
      // host can read them before init and after a trap.
      out.push(
        `uint64_t ${lib.identity.buildIdSymbol}(void) {`,
        `  return UINT64_C(0x${lib.identity.buildId});`,
        `}`,
        ``,
        `uint32_t ${lib.identity.abiVersionSymbol}(void) {`,
        `  return ${lib.identity.abiVersion}u;`,
        `}`,
        ``,
      );
    }
    if (lib.resultResetSymbol !== null) {
      out.push(
        `void ${lib.resultResetSymbol}(void) {`,
        `  scr_library_entry(false, "${lib.resultResetSymbol}");`,
        `  scr_library_arena_reset();`,
        `}`,
        ``,
      );
    }
    if (lib.collectSymbol !== null) {
      out.push(
        `void ${lib.collectSymbol}(void) {`,
        `  scr_library_entry(false, "${lib.collectSymbol}");`,
        `  scr_library_collect(); /* arena reset + a full cycle collection */`,
        `}`,
        ``,
      );
    }
    for (const e of lib.exports) {
      const params: string[] = [];
      const args: string[] = [];
      e.params.forEach((cls, i) => {
        switch (cls) {
          case "f64":
            params.push(`double a${i}`);
            args.push(`a${i}`);
            break;
          case "bool":
            params.push(`uint8_t a${i}`);
            args.push(`(a${i} != 0)`);
            break;
          case "u8":
            params.push(`uint8_t a${i}`);
            args.push(`(double)a${i}`);
            break;
          case "u32":
            params.push(`uint32_t a${i}`);
            args.push(`(double)a${i}`);
            break;
          case "i32":
            params.push(`int32_t a${i}`);
            args.push(`(double)a${i}`);
            break;
          case "i64":
            // The inbound declared-integer edge (ask 4): the helper
            // converts exactly or delivers the host-contract trap — a
            // value past ±(2^53−1) cannot ride f64 without silent
            // rounding, which is a coercion the author never wrote.
            params.push(`int64_t a${i}`);
            args.push(`scr_library_i64_in(a${i}, ${cStringLiteral(Buffer.from(e.inboundIntTrap!, "utf8"))})`);
            break;
          case "u64":
            params.push(`uint64_t a${i}`);
            args.push(`scr_library_u64_in(a${i}, ${cStringLiteral(Buffer.from(e.inboundIntTrap!, "utf8"))})`);
            break;
          case "string":
            params.push(`const uint8_t *a${i}_ptr`, `size_t a${i}_len`);
            args.push(`scr_library_str_in(a${i}_ptr, a${i}_len)`);
            break;
          case "bytes":
            params.push(`const uint8_t *a${i}_ptr`, `size_t a${i}_len`);
            // The helper's trap message is the compiler-assembled
            // structured trap-teaching form (0x01 text 0x1F SC4012 0x1F
            // symbol [0x1F remediation]) — assembled once at export
            // resolution, identical across both backends.
            args.push(`scr_library_bytes_in(a${i}_ptr, a${i}_len, ${cStringLiteral(Buffer.from(e.inboundBytesTrap!, "utf8"))})`);
            break;
        }
      });
      if (e.returns === "string" || e.returns === "bytes") {
        params.push(`const uint8_t **out`, `size_t *out_len`);
      }
      const retType =
        e.returns === "f64" ? "double"
        : e.returns === "bool" ? "uint8_t"
        : e.returns === "i64" ? "int64_t"
        : e.returns === "u64" ? "uint64_t"
        : "void";
      const call = `${mangleFunction(e.fnName)}(${args.join(", ")})`;
      out.push(`${retType} ${e.symbol}(${params.length > 0 ? params.join(", ") : "void"}) {`);
      // The prologue records this entry's symbol in the funnel's
      // current-entry slot: a detected trap anywhere below names the
      // entry the host called (structured trap-teaching field 2).
      out.push(`  scr_library_entry(${autoReset ? "true" : "false"}, "${e.symbol}");`);
      switch (e.returns) {
        case "void":
          out.push(`  ${call};`, `  scr_library_check_exc();`);
          break;
        case "f64":
          out.push(`  double sc_r = ${call};`, `  scr_library_check_exc();`, `  return sc_r;`);
          break;
        case "i64":
        case "u64":
          // The outbound declared-integer edge (ask 4): every value
          // reaching this return was PROVEN whole and inside the class's
          // range at compile time, so the cast is exact by construction
          // (and the unwind path's 0.0 converts cleanly).
          out.push(
            `  double sc_r = ${call};`,
            `  scr_library_check_exc();`,
            `  return (${retType})sc_r;`,
          );
          break;
        case "bool":
          out.push(`  bool sc_r = ${call};`, `  scr_library_check_exc();`, `  return (uint8_t)(sc_r ? 1 : 0);`);
          break;
        case "string":
          out.push(`  ScrStr *sc_r = ${call};`, `  scr_library_check_exc();`, `  scr_library_str_out(sc_r, out, out_len);`);
          break;
        case "bytes":
          out.push(`  ScrBytes *sc_r = ${call};`, `  scr_library_check_exc();`, `  scr_library_bytes_out(sc_r, out, out_len);`);
          break;
      }
      out.push(`}`, ``);
    }
  }

  emitAsyncScaffolding(out: string[]): void {
    return emitAsyncScaffolding(this, out);
  }

  emitStructDefs(out: string[]): void {
    return emitStructDefs(this, out);
  }

  /* ── vtables (class hierarchies) ──────────────────────────────────────
   * One vtable struct type per hierarchy (named after the root): a ScrVt
   * head — the class's preorder interval for instanceof and its DIRECT
   * release for dynamic teardown — plus one member per virtual slot. Only
   * methods actually overridden somewhere have slots; the slot's signature
   * is the root-most declaring class's, and overriding implementations sit
   * behind reinterpreting adapters (prefix layout makes the `this` cast
   * sound). Each class gets one static const vtable instance stamped into
   * every object it allocates. */

  vtEntriesFor(meta: ClassMeta): { slot: VtSlot; impl: ClassMeta | null }[] {
    return vtEntriesFor(this, meta);
  }

  vtSlotParams(slot: VtSlot, named: boolean): string[] {
    return vtSlotParams(this, slot, named);
  }

  emitVtableDecls(out: string[], hierarchyClasses: ClassMeta[]): void {
    return emitVtableDecls(this, out, hierarchyClasses);
  }

  emitVtableInstances(out: string[], hierarchyClasses: ClassMeta[]): void {
    return emitVtableInstances(this, out, hierarchyClasses);
  }

  emitVtAdapterDefs(out: string[]): void {
    return emitVtAdapterDefs(this, out);
  }

  emitHierarchyClassHelpers(out: string[],
    meta: ClassMeta,
    s: {
      struct: string;
      newFn: string;
      retain: string;
      release: string;
      trace: string;
      gcFree: string;
      traced: boolean;
      fields: { name: string; type: IrType }[];
    },): void {
    return emitHierarchyClassHelpers(this, out, meta, s);
  }

  /* ── type-directed JSON walkers (jsonStringify / dynCheck) ────────────
   * No dyn is built for stringify and no tags are consulted: the STATIC IR
   * type drives everything, one emitted helper per typeKey (interned, like
   * the array-HOF desugars). dynCheck helpers walk the runtime dyn (ScrDyn)
   * against the target type: match predicates (sc_dm_*) answer "does this
   * dyn fit?" without throwing (union arms are tried in canonical order —
   * first FULL match wins), and builders (sc_dc_*) construct the typed
   * value (+1) or throw a path-annotated TypeError through the exception
   * cell. Recursion terminates because recursive shapes/unions are rejected
   * by the frontend. */

  dynDesc(t: IrType): string {
    return dynDesc(this, t);
  }

  islandAdapter(arity: number, retKind: "void" | "jsval" | "f64" | "bool" | "string"): string {
    return islandAdapter(this, arity, retKind);
  }

  islandTypedAdapter(fn: IrType & { kind: "func" }): string {
    return islandTypedAdapter(this, fn);
  }

  unionTruthyHelper(unionId: string): string {
    return unionTruthyHelper(this, unionId);
  }

  unionEqHelper(unionId: string, sameValue: boolean): string {
    return unionEqHelper(this, unionId, sameValue);
  }

  unionToStrHelper(unionId: string): string {
    return unionToStrHelper(this, unionId);
  }

  unionJoinHelper(unionId: string): string {
    return unionJoinHelper(this, unionId);
  }

  jsonWriteHelper(t: IrType): string {
    return jsonWriteHelper(this, t);
  }

  jsonIndentHelper(): string {
    return jsonIndentHelper(this);
  }

  dynMatchHelper(t: IrType): string {
    return dynMatchHelper(this, t);
  }

  dynCheckHelper(t: IrType): string {
    return dynCheckHelper(this, t);
  }

  dynArmHelper(t: IrType): string {
    return dynArmHelper(this, t);
  }

  recordWideHelper(): string {
    return recordWideHelper(this);
  }

  toDynHelper(t: IrType): string {
    return toDynHelper(this, t);
  }

  dynClassDesc(className: string): string {
    return dynClassDesc(this, className);
  }

  dynFuncBoxHelper(t: IrType & { kind: "func" }): string {
    return dynFuncBoxHelper(this, t);
  }

  recordKeyGetHelper(shapeId: string, t: IrType, overflowOnly = false): string {
    return recordKeyGetHelper(this, shapeId, t, overflowOnly);
  }

  recordKeySetHelper(shapeId: string): string {
    return recordKeySetHelper(this, shapeId);
  }

  dynToStrHelper(): string {
    return dynToStrHelper(this);
  }

  caughtToDynHelper(): string {
    return caughtToDynHelper(this);
  }

  /* ── cycle-collection wiring ──────────────────────────────────────────
   * Containers that store a payload's RC entry points as function pointers
   * (obj-kind boxes, union ref arms, promise payloads, the exception cell)
   * also store the payload type's TRACE entry point — non-NULL exactly when
   * the payload type carries a cycle header, which is what the container's
   * own trace keys on (visit when present, release at teardown when not).
   * Closures/unions/promises always carry one (runtime-provided traces);
   * classes/records carry one iff their shape can participate in a cycle
   * (emitted trace); strings/arrays/dyn never can. */

  traceAdapterC(t: IrType): string | null {
    return traceAdapterC(this, t);
  }

  traceArgC(t: IrType): string {
    return traceArgC(this, t);
  }

  boxNewC(t: IrType): string {
    return boxNewC(this, t);
  }

  arrNewC(elem: IrType, capExpr: string | number): string {
    return arrNewC(this, elem, capExpr);
  }

  /* ── plumbing ─────────────────────────────────────────────────────── */

  line(text: string): void {
    this.lines.push("  ".repeat(this.indent) + text);
  }

  srcComment(loc: SrcLoc): string {
    if (!this.lineStarts) return "";
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= loc.start) lo = mid;
      else hi = mid - 1;
    }
    return ` /* ${this.mod.sourceFile}:${lo + 1} */`;
  }

  newTemp(type: IrType, init: string): Temp {
    const name = `sc_t${this.tempCounter++}`;
    this.line(`${cDecl(type, name)} = ${init};`);
    if (isRefCounted(type)) this.currentFrame().push({ name, type });
    return { name, type };
  }

  /** newTemp for a value that IS an interned immortal static (see
   * `Temp.immortal`): the initializer is the address itself rather than a
   * retain of it, and the frame entry is marked so `releaseFrame` writes no
   * release. Every other part of the discipline is unchanged — the temp is
   * in its frame, `moveTemp` finds it, and a consumer that takes ownership
   * of it and releases it later is releasing an immortal, which the runtime
   * already treats as a no-op. */
  newImmortalTemp(type: IrType, init: string): Temp {
    const name = `sc_t${this.tempCounter++}`;
    this.line(`${cDecl(type, name)} = ${init};`);
    if (isRefCounted(type)) this.currentFrame().push({ name, type, immortal: true });
    return { name, type };
  }

  /** newTemp for a MAY-THROW runtime call: the result joins its frame
   * BEFORE the standard pending check, so an unwind releases the dummy
   * (NULL for refcounted kinds) harmlessly and the value is only read past
   * the check. The shared shape of every fallible boundary call — jsOp,
   * jsExit, composite jsMarshal, dynCheck, await reads. */
  fallibleTemp(type: IrType, call: string): Temp {
    const t = this.newTemp(type, call);
    this.emitPendingCheck();
    return t;
  }

  currentFrame(): Temp[] {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) throw new Error("emitter bug: no active statement frame");
    return frame;
  }

  /** Strike a refcounted temp from its frame: ownership is being moved. */
  moveTemp(t: Temp): void {
    if (!isRefCounted(t.type)) return;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const idx = this.frames[i]!.findIndex((e) => e.name === t.name);
      if (idx >= 0) {
        this.frames[i]!.splice(idx, 1);
        return;
      }
    }
    throw new Error(`emitter bug: moved temp ${t.name} not found in any frame`);
  }

  /** The release call for one owned refcounted value. */
  releaseValue(name: string, type: IrType): void {
    this.line(`${releaseCallC(type, name)};`);
  }

  /** The scope a `varDecl`'s local belongs to.
   *
   * Without seqExpr regions this was always the innermost scope, and for
   * every local that is not seq-scoped it still is: a region is skipped
   * over, so the local lands in the same scope it landed in before. A
   * seq-scoped local belongs to the region it was declared in, which is
   * the innermost scope at the moment its varDecl emits (its own
   * seqExpr pushed it; nothing else pushes a scope in between). The
   * `seqScopeAt.has` test on the top is a belt-and-braces check: if the
   * innermost scope is somehow NOT a region, the local takes the old
   * path rather than a region that is not its own. */
  declScope(localId: string): ScopeEntry[] {
    const top = this.scopes.length - 1;
    if (this.seqScoped.has(localId) && this.seqScopeAt.has(top)) return this.scopes[top]!;
    let i = top;
    while (i > 0 && this.seqScopeAt.has(i)) i--;
    return this.scopes[i]!;
  }

  releaseFrame(frame: ScopeEntry[]): void {
    for (const t of frame) {
      // An interned immortal: its release is a runtime no-op by
      // construction (rc == SIZE_MAX), so writing one costs a call site and
      // buys nothing. Skipped here rather than at the declaration so the
      // temp stays in the frame for moveTemp and the rest of the ownership
      // discipline.
      if (t.immortal) continue;
      if (t.boxed) this.line(`scr_box_release(${t.name});`);
      else this.releaseValue(t.name, t.type);
    }
  }

  /** THE release-on-jump path (break/continue/return): pending statement
   * frames and entered scopes down to (and excluding nothing above) the
   * given depths, innermost first — everything whose normal fall-through
   * releases the jump bypasses. The jump target's own frame/scope stay
   * live: a loop's releases after the loop and a switch's after its end
   * label are still on the jump's path (return passes 0/0 — it leaves the
   * whole function). */
  releaseForJump(frameDepth: number, scopeDepth: number): void {
    for (let i = this.frames.length - 1; i >= frameDepth; i--) this.releaseFrame(this.frames[i]!);
    for (let i = this.scopes.length - 1; i >= scopeDepth; i--) this.releaseFrame(this.scopes[i]!);
  }

  /** True when the last statement is a jump — its emission already released
   * everything it had to, and the fall-through releases after it would be
   * dead double-release code. `throw` counts: it unwinds (to a handler or
   * out of the function) through the same release path. */
  endsWithJump(stmts: IrStmt[]): boolean {
    const last = stmts[stmts.length - 1]?.kind;
    return last === "return" || last === "break" || last === "continue" || last === "throw" || last === "rethrow" || last === "runtimeFence";
  }

  /** THE unwind path at a point where an exception is pending: release
   * everything between here and the innermost try handler — or the whole
   * function — via releaseForJump, then jump to the handler / return a
   * dummy value (never read: callers of a may-throw function test the
   * pending flag before using the result). Callers own the surrounding
   * `if (scr_exc_pending())`; a `throw` unwinds unconditionally. */
  emitUnwind(): void {
    const target = this.tryStack[this.tryStack.length - 1];
    if (target) {
      this.releaseForJump(target.frameDepth, target.scopeDepth);
      target.used = true;
      this.line(`goto ${target.label};`);
      return;
    }
    this.releaseForJump(0, 0);
    const t = this.currentReturnType;
    if (t.kind === "void") this.line(`return;`);
    else if (t.kind === "f64") this.line(`return 0;`);
    else if (t.kind === "bool") this.line(`return false;`);
    else this.line(`return NULL;`);
  }

  errorVtStampLines(): string[] {
    return errorVtStampLines(this);
  }

  /** The C symbol a direct call or closure enters a function through:
   * async bodies are entered via their emitted spawn wrapper (which runs
   * the fiber eagerly to its first suspension and returns the promise);
   * generator bodies via theirs (which only ALLOCATES the suspended
   * fiber and returns the generator object). */
  callTargetC(fnName: string): string {
    const fn = this.fnByName.get(fnName);
    // ORDER MATTERS: an async GENERATOR sets both flags and enters
    // through the lazy gen-spawn wrapper, never the eager async one.
    if (fn?.generator !== undefined) return mangleGenSpawn(fnName);
    if (fn?.async === true) return mangleAsyncSpawn(fnName);
    return mangleFunction(fnName);
  }

  /** The emitter contract for exceptions: after EVERY call that can throw
   * (per the may-throw analysis), test the pending flag and unwind. */
  emitPendingCheck(): void {
    this.line(`if (scr_exc_pending()) {`);
    this.indent++;
    this.emitUnwind();
    this.indent--;
    this.line(`}`);
  }

  internLiteral(text: string): string {
    let sym = this.literals.get(text);
    if (!sym) {
      sym = `sc_lit_${this.literals.size}`;
      this.literals.set(text, sym);
    }
    return sym;
  }

  /** The class object's static symbol (classes as values), registering it
   * for assembly on first use and interning the .name literal while the
   * literal table is still open (bodies emit before the file assembles —
   * the regex-literal discipline). */
  classObjSym(className: string): string {
    let sym = this.classObjs.get(className);
    if (!sym) {
      const meta = this.classMeta.get(className);
      if (!meta) throw new Error(`emitter bug: classRef to unknown class ${className}`);
      this.internLiteral(meta.def.jsName ?? "");
      sym = mangleClassObj(className);
      this.classObjs.set(className, sym);
    }
    return sym;
  }

  /** True when construction through a classval of `className` can throw:
   * the runtime callee is the static class's constructor or any strict
   * descendant's (classval flows never leave the subtree). */
  newValueMayThrow(className: string): boolean {
    const meta = this.classMeta.get(className);
    if (!meta) throw new Error(`emitter bug: newValue on unknown class ${className}`);
    const any = (m: ClassMeta): boolean =>
      this.mayThrow.has(`%${m.def.name}.constructor`) || m.children.some(any);
    return any(meta);
  }

  /** The undefined arm's tag of a union type, or -1 (not a union / no
   * undefined arm). A record FIELD with such a type is optional-flavored:
   * the JSON serializer DROPS it while it holds the undefined arm and the
   * dynCheck builder produces the undefined arm for a MISSING key — both
   * exactly Node's optional-field behavior. */
  undefinedArmTag(t: IrType): number {
    if (t.kind !== "union") return -1;
    const def = this.unionsById.get(t.unionId);
    return def ? def.arms.findIndex((a) => a.kind === "undefinedT") : -1;
  }

  /** The interned immortal instance for a UNIT arm of a union — asserts the
   * arm really is payload-less (undefined/null). */
  internUnitInstance(unionId: string, tag: number): string {
    const arm = this.unionsById.get(unionId)?.arms[tag];
    if (!arm || !isUnitType(arm)) {
      throw new Error(`emitter bug: unit instance for non-unit arm ${tag} of ${unionId}`);
    }
    const key = `${unionId}:${tag}`;
    let sym = this.unitInstances.get(key);
    if (!sym) {
      sym = `sc_unit_${this.unitInstances.size}`;
      this.unitInstances.set(key, sym);
    }
    return sym;
  }

  /** The C expression for that instance — the one pointer every unit-arm
   * value of this (union, tag) is: rc == SIZE_MAX, so RC entry points and
   * the collector both skip it and no retain is ever owed. */
  unitInstanceRef(unionId: string, tag: number): string {
    return `(ScrUnion *)&${this.internUnitInstance(unionId, tag)}`;
  }

  /** The ABSENT element value for an array slot, in C — the one spelling of
   * it. Three producers push it: arrayNewLen (`Array.from({length: n})`),
   * the growth half of `a.length = n`, and arrayClear (the tombstone write
   * `a[i] = null as unknown as T`). A union carrying an undefined arm holds
   * the interned immortal unit instance, so the slot reads JS-exactly;
   * every other refcounted element kind holds NULL, a hole that
   * scr_arr_get_ref refuses on read. Scalars have no absent value that is
   * not a lie — their zero — so the frontend only builds those nodes where
   * it has proven every slot is written first. */
  absentElemC(elem: IrType): string {
    if (elem.kind === "union") {
      const def = this.unionsById.get(elem.unionId);
      const tag = def ? def.arms.findIndex((a) => a.kind === "undefinedT") : -1;
      if (tag >= 0) return this.unitInstanceRef(elem.unionId, tag);
    }
    if (elem.kind === "f64") return "0";
    if (elem.kind === "bool") return "false";
    return "NULL";
  }

  /** The class-newFn initialization line for a field whose type ADMITS
   * undefined — such fields start as JS's `undefined`, never the calloc
   * NULL: tsc's strictPropertyInitialization accepts them with no
   * initializer and no constructor assignment (undefined is in the type),
   * so a fresh instance is readable before any assignment runs — a method
   * assigns later, a constructor branch skips it, a base constructor's
   * virtual call reads a derived field before super() returns. Node reads
   * `undefined` there; a NULL payload pointer would be a segfault (union
   * fields) or a silent nothing (jsval fields). Undefined-armed unions get
   * the interned immortal unit instance (free; releases skip it); jsval
   * (`any`) fields get an engine undefined cell — such classes exist only
   * in --dynamic builds, and the field's release balances it. Empty for
   * every type that cannot hold undefined (tsc's SPI guards those) and for
   * record shapes' construction paths, which write every field. */
  undefFieldInitLineC(name: string, t: IrType): string[] {
    if (t.kind === "jsval") {
      return [`  o->${mangleField(name)} = scr_jsval_undefined(); /* ${name} starts undefined */`];
    }
    // A CHECKED-DYNAMIC field (`unknown`/`any` without --dynamic, and the
    // `%props` table a run-time-keyed defineProperty needs) admits
    // undefined too, and the calloc NULL was not "undefined": every read
    // of it is a scr_dyn_retain(NULL) — a SEGFAULT, measured on
    // `class C { u?: unknown; n: number; constructor(){ this.n = 1 } }`,
    // where Node answers `true` to `c.u === undefined`. The interned
    // undefined singleton is immortal, so the retain/release pair around
    // the field costs nothing and the store needs no teardown.
    if (t.kind === "dyn") {
      return [`  o->${mangleField(name)} = scr_dyn_undefined(); /* ${name} starts undefined */`];
    }
    const tag = this.undefinedArmTag(t);
    if (tag < 0 || t.kind !== "union") return [];
    return [`  o->${mangleField(name)} = ${this.unitInstanceRef(t.unionId, tag)}; /* ${name} starts undefined */`];
  }

  /* ── functions ────────────────────────────────────────────────────── */

  signature(fn: IrFunction): string {
    const boxedIds = new Set(fn.locals.filter((l) => l.boxed).map((l) => l.id));
    const parts = fn.params.map((p) =>
      // A boxed param's sc_l_ name is its box; the raw value arrives under
      // a sc_p_ name and is moved into the box in the prologue.
      cDecl(p.type, boxedIds.has(p.localId) ? mangleRawParam(p.localId) : mangleLocal(p.localId)),
    );
    // Lifted functions receive their closure first.
    if (fn.captures !== undefined) parts.unshift("ScrClosure *sc_env");
    const params = parts.length ? parts.join(", ") : "void";
    return `static ${cType(fn.returnType)} ${mangleFunction(fn.name)}(${params})`;
  }

  emitFunction(fn: IrFunction): void {
    return emitFunction(this, fn);
  }

  /* ── statements ───────────────────────────────────────────────────── */

  emitBlock(stmts: IrStmt[], setup?: (scope: ScopeEntry[]) => void): void {
    return emitBlock(this, stmts, setup);
  }

  emitStmts(stmts: IrStmt[]): void {
    return emitStmts(this, stmts);
  }

  emitStmt(s: IrStmt): void {
    return emitStmt(this, s);
  }

  /** A fresh loop jump-target entry. `continueLabel` null means "C
   * continue is correct" (while/forOf) — but a LABELED loop always
   * allocates one (a labeled continue arriving from a nested loop needs a
   * goto), and every labeled loop gets a lazy end label for labeled break
   * (a C break only exits the innermost loop). */
  loopTarget(continueLabel: string | null, labels: string[] | undefined): (typeof this.jumpTargets)[number] & { kind: "loop" } {
    return {
      kind: "loop",
      continueLabel: continueLabel === null && labels !== undefined ? `sc_cont_${this.labelCounter++}` : continueLabel,
      usedContinue: false,
      endLabel: labels !== undefined ? `sc_end_${this.labelCounter++}` : null,
      usedEnd: false,
      ...(labels !== undefined && { labels }),
      scopeDepth: this.scopes.length,
      frameDepth: this.frames.length,
    };
  }

  emitTryCatch(s: IrStmt & { kind: "tryCatch" }): void {
    return emitTryCatch(this, s);
  }

  emitSwitch(s: IrStmt & { kind: "switch" }): void {
    return emitSwitch(this, s);
  }

  mergeBrace(emitBlockFn: () => void): void {
    return mergeBrace(this, emitBlockFn);
  }

  emitBranchInto(target: string, expr: IrExpr): void {
    return emitBranchInto(this, target, expr);
  }

  emitCondition(cond: IrExpr): string {
    return emitCondition(this, cond);
  }

  /** C expression testing JS truthiness of a temp (falsy: 0, -0, NaN, "").
   * `x == x` rejects NaN, `x != 0` rejects both zeros; strings only need
   * their length — no runtime call, no ownership change. */
  truthyC(t: Temp): string {
    switch (t.type.kind) {
      case "bool":
        return t.name;
      case "f64":
        return `${t.name} == ${t.name} && ${t.name} != 0`;
      case "string":
        return `${t.name}->len != 0`;
      case "jsval":
        // Island truthiness: the engine's ToBoolean (never throws, no
        // ownership change) — jsval operands are legal in `logical`.
        return `(scr_jsval_truthy(${t.name}) != 0)`;
      case "union":
        // The ARM value's ToBoolean, answered by a per-union interned
        // helper (switch on tag: unit arms false, scalar/string arms by
        // value, ref arms true, jsval arms ask the engine).
        return `${this.unionTruthyHelper(t.type.unionId)}(${t.name})`;
      case "array":
      case "map":
      case "set":
      case "regex":
      case "url":
      case "searchParams":
      case "symbol":
      case "stats":
      case "spawnRes":
      case "fileHandle":
      case "child":
      case "netServer":
      case "netSocket":
      case "http2Session":
      case "http2Stream":
      case "dgramSocket":
      case "testCtx":
      case "httpReq":
      case "httpRes":
      case "httpClientReq":
      case "secureCtx":
      case "abortController":
      case "fsWatcher":
      case "childStream":
      case "bytes":
      case "func":
      case "object":
      case "classval":
      case "record":
      case "promise":
      case "generator":
      case "asyncGenerator":
        // JS objects are ALWAYS truthy ([] and {} included). These are
        // non-NULL pointers, so the honest constant reads as a pointer
        // test (no unused-value warnings, operand still evaluated).
        return `${t.name} != NULL`;
      case "procStream":
        // A stream value is a JS object (always truthy); the scalar fd
        // representation is 1 or 2, so the honest constant reads as its
        // own non-zero test.
        return `${t.name} != 0`;
      case "dyn":
        // ToBoolean over the dyn kind (scr_dyn_truthy — JS-exact for
        // every kind; borrowed, never throws): `v || dflt` and condition
        // descent on checked-dynamic values.
        return `scr_dyn_truthy(${t.name})`;
      case "undefinedT":
      case "nullT":
      case "caught":
        throw new Error(`emitter bug: truthiness of ${t.type.kind}`);
      case "bigint":
        return `scr_big_truthy(${t.name})`;
      case "keyobj":
      // A Hash or Hmac handle is an object too: truthy whenever it exists.
      case "hash":
      case "hmac":
      case "cipher":
      case "decipher":
      // A signal handle is an object: always truthy when present.
      case "abortSignal":
      // A Response and a Headers view are objects too, and so is a
      // RequestInit (a Request would be one).
      case "response":
      case "headers":
      case "requestInit":
      case "request":
        return `${t.name} != NULL`;
      case "void":
        throw new Error("emitter bug: truthiness of void");
      default: {
        const _exhaustive: never = t.type;
        void _exhaustive;
        throw new Error("unreachable");
      }
    }
  }

  /* ── expressions ──────────────────────────────────────────────────── */

  emitExpr(e: IrExpr): Temp {
    return emitExpr(this, e);
  }

  childExitThunkFor(param: IrType): string {
    return childExitThunkFor(this, param);
  }

  childDataThunkFor(param: IrType): string {
    return childDataThunkFor(this, param);
  }

  closeBindThunkFor(cbUnion: IrType, retServer: boolean): string {
    return closeBindThunkFor(this, cbUnion, retServer);
  }

  closeOverrideWrapFor(cbUnion: IrType, retServer: boolean): string {
    return closeOverrideWrapFor(this, cbUnion, retServer);
  }

  childExitThunkFor2(codeParam: IrType, sigParam: IrType): string {
    return childExitThunkFor2(this, codeParam, sigParam);
  }

  dgramMsgThunkFor(param: IrType): string {
    return dgramMsgThunkFor(this, param);
  }

  dnsLookupThunkFor(cbT: IrType): string {
    return dnsLookupThunkFor(this, cbT);
  }

  sniAnswerThunkFor(cbT: IrType): string {
    return sniAnswerThunkFor(this, cbT);
  }

  netLookupAnswerThunkFor(cbT: IrType): string {
    return netLookupAnswerThunkFor(this, cbT);
  }

  emitterInvokeThunkFor(cbT: IrType): string {
    return emitterInvokeThunkFor(this, cbT);
  }

  streamDataThunkFor(cbT: IrType): string {
    return streamDataThunkFor(this, cbT);
  }

  streamCbThunkFor(kind: "r" | "w" | "f" | "d" | "t" | "l" | "e", cbT: IrType): string {
    return streamCbThunkFor(this, kind, cbT);
  }

  connectSockThunkFor(cbT: IrType): string {
    return connectSockThunkFor(this, cbT);
  }

  raceAdapterFor(from: IrType, to: IrType): string {
    return raceAdapterFor(this, from, to);
  }

  resolveThunkFor(inner: IrType): string {
    return resolveThunkFor(this, inner);
  }

  promiseAdoptAdapterFor(sov: IrType, inner: IrType): string {
    return promiseAdoptAdapterFor(this, sov, inner);
  }
}
