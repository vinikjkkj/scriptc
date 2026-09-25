/* The checker facade: 5.9.3-shaped TypeChecker methods over 7.0.2's sync
 * client, built around the survey's feasibility verdict. Naive per-call use
 * of the 7.0.2 client costs 0.1-0.3 ms of IPC per query; the census counted
 * 32,226 checker calls lowering mock-gateway, so a transparent adapter would
 * add seconds. Batched, the same queries run at ~0.005 ms/call — parity with
 * 5.9.3. Three mechanisms make batching and reuse the DEFAULT path:
 *
 * 1. IDENTITY MEMOS. One WeakMap per query kind, keyed on the client-side
 *    node/type/symbol object. Safe because the 7.0.2 client registry dedupes
 *    by server handle id (probe-verified: the same symbol/type from any two
 *    queries is the same object), and a snapshot is immutable — an answer
 *    never changes for the life of the program. The client itself does NOT
 *    memoize (warm re-query of 21 nodes costs 2.5-3.8 ms; the survey's
 *    finding), so this layer is where reuse lives.
 *
 * 2. PER-FILE BATCH PREFETCH. The first getTypeAtLocation/getSymbolAtLocation
 *    miss in a source file walks the whole file client-side (free — the AST
 *    is local) and issues the ARRAY overloads for every node, chunked, then
 *    answers all later queries for that file from the memo. The lowering's
 *    walk touches most of a file anyway, so prefetching the file is the
 *    batching lever without changing a single call site. prefetchSourceFile()
 *    exposes the same hook explicitly. Symbol prefetch also batch-fetches
 *    getTypeOfSymbol over every symbol the file mentions (5,333 calls of the
 *    mock-gateway census ride that pattern).
 *
 * 3. CLIENT-SIDE FAST PATHS. getBaseTypeOfLiteralType — the census's single
 *    hottest method (9,059 calls on mock-gateway) — is answered locally from
 *    type.flags plus the intrinsic-type singletons for the literal kinds
 *    5.9.3 maps to intrinsics (string/number/bigint/boolean literals), with
 *    IPC only for enum-ish and union types. isTupleType answers shape-true
 *    and non-object-false locally and round-trips (memoized) only for
 *    object types. Both verified against the raw checker AND against 5.9.3
 *    by the adapter's suites. */

import type { Node, SourceFile } from "typescript/unstable/ast";
import type {
  Checker,
  IndexInfo,
  Project,
  Signature,
  Symbol as Ts7Symbol,
  Type,
  TypePredicate,
  TypeReference,
} from "typescript/unstable/sync";
import { walkPreorder } from "./ast.js";
import { SignatureKind, TypeFlags } from "./enums.js";

/** Array-overload chunk size: large enough that per-request overhead
 * vanishes, small enough to keep any single JSON-RPC payload modest. */
const BATCH_CHUNK = 2048;

/** The bisecting panic fence for batch queries. The prefetch sweeps query
 * nodes/symbols the lowering itself may never ask about, and tsgo can PANIC
 * on some of them (a server-side failure the sync channel surfaces as a
 * thrown Error, server intact). A batch must not turn a node nobody needs
 * into a build crash: on failure, bisect — healthy items keep their real
 * answers, and the panicking ITEM alone memoizes undefined (anyType through
 * the facade), which is exactly what the pinned type-position finding maps
 * such answers to. */
function withPanicFence<I, O>(
  chunk: readonly I[],
  call: (chunk: I[]) => readonly (O | undefined)[],
): (O | undefined)[] {
  try {
    return [...call(chunk as I[])];
  } catch {
    if (chunk.length === 1) return [undefined];
    const mid = chunk.length >> 1;
    return [
      ...withPanicFence(chunk.slice(0, mid), call),
      ...withPanicFence(chunk.slice(mid), call),
    ];
  }
}

function chunked<T, R>(items: readonly T[], fetch: (chunk: readonly T[]) => readonly R[]): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += BATCH_CHUNK) {
    out.push(...fetch(items.slice(i, i + BATCH_CHUNK)));
  }
  return out;
}

/** The prefetch sweep's depth floor. The lowering fences expressions at 200
 * nesting levels (SC1090) and never queries below its fence, so nodes much
 * deeper than that can only belong to a program the build is about to
 * refuse — and batch-querying them is where a pathological file's cost
 * lives (the ~6500-term binderBinaryExpressionStress chains spent minutes
 * in server-side per-node queries). Skipped subtrees stay CORRECT: any
 * query the lowering does make below the floor falls through to a direct,
 * memoized per-node call. */
const PREFETCH_MAX_DEPTH = 512;

/** The prefetch sweep's SIZE floor, and the second thing that stopped it
 * paying.
 *
 * The sweep exists because a per-node round trip costs 0.1-0.3 ms and a
 * file's lowering asks about most of its nodes, so ONE batch beats
 * thousands of calls. That trade is a bet on the hit rate, and it is a
 * losing bet exactly where the file is enormous and the answers are
 * worthless: zapo's `spec/proto/index.js` is 1,867,556 bytes of minified
 * JavaScript with ZERO newlines and 623,938 AST nodes at a maximum
 * depth of 431 — under PREFETCH_MAX_DEPTH, so nothing above stopped it —
 * and it reaches the lowering through the declaration-twin rule, where a
 * minified `.js` body has no types and every value in it ends up `ScrDyn`.
 * The sweep issued getTypeAtLocation and getSymbolAtLocation over all
 * 623,938 nodes, in 305 chunks of 2,048, twice.
 *
 * Measured with `node --cpu-prof` over the frontend-only lane
 * (SCRIPTC_KEYREAD_CENSUS_ONLY=1) of zapo's fake-server messaging bench:
 * prefetchTypes was 127,733 ms and prefetchSymbols 27,096 ms of 507,470 ms
 * sampled — 30.5% of the whole frontend, nearly all of it blocked
 * reading the tsgo channel.
 *
 * THAT 30.5% IS HISTORY, NOT A STANDING FIGURE. It is what the sweep cost
 * BEFORE this constant existed — it is the case FOR the cap, and the cap
 * collected it. Measured again after, the whole sweep is 0.50% of the
 * frontend. The closing note at the bottom of this comment carries the
 * current numbers; read it before treating anything here as a target.
 *
 * Above this many nodes the file keeps the per-node path, which is not a
 * fallback bolted on for this: getTypeAtLocation/getSymbolAtLocation
 * already answer a memo miss with a direct memoized call, and have since
 * the facade was written. Answers are IDENTICAL either way; only the
 * number of round trips changes. Skipped files stay marked prefetched, so
 * the decision is made once per file, not once per query.
 *
 * THE CONSTANT IS NOT ON A CLIFF. Every source of that program over 150 KB
 * was counted, plus the three largest @types/node declaration files:
 *
 *     1,867,556 bytes   623,938 nodes   OVER   spec/proto/index.js
 *       757,506         133,498         OVER   spec/proto/index.d.ts
 *       179,914          17,877                spec/mex/index.d.ts
 *       215,106          15,200                @types/node/inspector.generated.d.ts
 *       225,899          10,507                @types/node/crypto.d.ts
 *
 * Only the generated protobuf pair crosses; the next largest file in the
 * whole program is 5.6x under. Nothing an ordinary project writes comes
 * near it, and packages/compiler/test/ts7/facade.test.ts — whose fixtures
 * are small — keeps taking the batch path and keeps asserting that N nodes
 * cost O(1) raw requests.
 *
 * WHAT IT IS WORTH, A/B, on the frontend-only lane of zapo's fake-server
 * messaging bench. NO profiler (its overhead lands on the node side, which
 * is the side that changes), arms back to back by a chained script, and the
 * cap arm run BOTH first and last because a one-sample timing on a shared
 * box is not a measurement. The tsgo checker is a separate process, so its
 * CPU is sampled by pid and reported apart:
 *
 *     arm  variant   wall s   node CPU s   tsgo CPU s   TOTAL CPU s
 *     c1   cap ON     604.0        428.6        186.5         615.0
 *     c2   cap OFF    676.7        370.2        322.3         692.4
 *     c3   cap ON     539.1        394.8        161.9         556.7
 *
 * READ THE A/A CONTROL FIRST: c1 and c3 are the SAME compiler and differ by
 * 9.5% of total CPU. That is the run-to-run noise with three sibling blocks
 * building, and it is large enough that the c1-vs-c2 pair alone would not
 * have carried this. What does carry it is that BOTH cap arms sit below the
 * base arm while the base arm ran BETWEEN them — drift cannot produce that
 * ordering — and that the mechanism column is far outside the noise: tsgo
 * CPU -42.1% and -49.8% against an A/A spread of 13.2%.
 *
 * The trade is legible in the two CPU columns and it is the trade this
 * constant is making: the SERVER does about half as much work, because the
 * sweep is not asking it about 623,938 nodes the lowering never queries;
 * node does more, because the queries that remain each pay their own round
 * trip instead of riding a batch of 2,048. On this input the server saves
 * more than the client spends. Mean of the two cap arms against the base:
 * total CPU 585.9 vs 692.4 (-15.4%), wall 571.6 s vs 676.7 s (-15.5%).
 *
 * The frontend is 45.8% of an 877 s end-to-end build of that program, so
 * this is worth roughly 7% of a whole build — real and free.
 *
 * ── AFTER THE CAP: THE SWEEP IS 0.50% OF THE FRONTEND ──────────────────
 *
 * This paragraph used to end "and NOT the big lever", and name the big one
 * as scoping the batch to the subtree the lowering is about to walk. That
 * sentence outlived its evidence, and it was a trap: the 30.5% above was
 * measured before the cap, the cap is what collected it (29b48e0a9, where
 * the -15.4% is banked), and the leftover is small. Someone went and got
 * the number rather than inheriting the claim.
 *
 * MEASURED on app182 (zapo-rest against zapo-js 1.8.2,
 * --provenance-sources), from a full --cpu-prof of the real build,
 * attributing each frame to callers that are not already inside the frame
 * — a naive attribution double-counts recursion and can report an
 * inclusive total larger than the profile's own busy count:
 *
 *     prefetchTypes     4,283 inclusive samples
 *     prefetchSymbols   4,060
 *                       8,343 of 1,657,214 busy  =  0.50%
 *
 * Inclusive, so the sweep's own share of channel blocking is already in
 * it; the sweep is at most 2.4% of all time blocked on the tsgo channel.
 *
 * THE WASTE IS REAL AND IT IS STILL NOT WORTH MUCH, which is the whole
 * lesson. Counting nodes rather than milliseconds, over the same build:
 * the sweep asks the checker about 773,125 nodes to answer questions about
 * 154,066 — 80.1% of what it queries is for nobody. Declaration files are
 * the sharpest instance by far: ten of them are swept for 35,868 nodes to
 * answer TWENTY-ONE questions, because the lowering never walks a .d.ts,
 * it arrives one declaration at a time through symbol.declarations. But
 * 80.1% of 0.50% is 0.40%, and scoping the sweep to the declaration —
 * built, measured, and proved behaviour-neutral on 154 corpus programs
 * whose emitted .ll and diagnostics are byte-identical either way — buys
 * about 0.023% of the frontend. It was not merged. It is recorded on
 * branch block/jsscope at 7ae7ef583 if the trade ever changes.
 *
 * So: this file is not where the frontend's time goes. When that build was
 * profiled, 55.27% of non-idle work was inside canDynCheckTo, and 42.3% of
 * the whole frontend sat under a single caller of it. Do not come to the
 * prefetch sweep looking for a lever. */
const PREFETCH_MAX_NODES = 100_000;

/** The 7.0.2 client identity-dedupes immutable types but does NOT memoize
 * constituentTypes(Type): its registry path for constituents is fetchTypes with no
 * handle list, so the all-cached short-circuit can never fire and every
 * inspection issues a getTypesOfType round trip. An immutable type's
 * constituent list cannot change, so the derived answer belongs beside the
 * adapter, shared by every caller regardless of which helper led to the type.
 *
 * Measured on zapo-rest's frontend: 723,237 inspections over 3,827 distinct
 * types - 189.0 asks per type, and 705.2 MB of the 1,502.4 MB the frontend
 * pulls over the tsgo channel, the single largest line item on either count.
 *
 * Ported from upstream #190 (09f51311f), including its `?? []`: the handful
 * of call sites that do not guard with isUnionType()/isIntersectionType()
 * first would throw a TypeError on a non-union today, so no reachable
 * behaviour turns into an empty list. */
const constituentTypesOf = new WeakMap<Type, readonly Type[]>();

export function constituentTypes(type: Type): readonly Type[] {
  let types = constituentTypesOf.get(type);
  if (types === undefined) {
    const raw = (type as Type & { getTypes(): readonly Type[] | undefined }).getTypes();
    // MEASUREMENT ONLY, and it is the evidence for the `?? []` above: every
    // call site guards with isUnionType()/isIntersectionType() first or takes
    // a ts.UnionType parameter, so a non-union should never reach here and
    // the fallback should never fire. Counted rather than asserted, because
    // a throw would turn a measurement into an outage. Fires at most once
    // per distinct type (this is the memo-miss path).
    if (raw === undefined) {
      (globalThis as { __REDUND_NOTE__?: (op: string, key?: unknown) => void })
        .__REDUND_NOTE__?.("constituentTypes.notAUnion", (type as unknown as { id?: number }).id);
    }
    types = raw ?? [];
    constituentTypesOf.set(type, types);
  }
  return types;
}

/** Preorder sweep of the whole file, ITERATIVE (walkPreorder): the obvious
 * recursive forEachChild walk overflowed the stack HERE, in the prefetch
 * sweep, on the binderBinaryExpressionStress chains — before lowering could
 * answer with its SC1090 nesting fence. */
function collectNodes(sf: SourceFile): Node[] {
  const nodes: Node[] = [];
  walkPreorder(sf, (n, depth) => {
    nodes.push(n);
    if (depth >= PREFETCH_MAX_DEPTH) return "skip";
    return undefined;
  });
  return nodes;
}

/** THE ABSENT-ANSWER SENTINEL, and why the memos store it.
 *
 * `undefined` is a legitimate ANSWER for most of these queries - a node with
 * no symbol, a call with no resolved signature, a signature with no type
 * predicate - so a memo cannot also use it to mean "never asked". The
 * spelling that stood here said exactly that, and paid for it: every read
 * was `has(x) ? get(x) : miss`, which is two hash lookups on every HIT.
 *
 * The sixteen methods that wore it were called 47,275,994 times lowering
 * zapo-rest's frontend - 33,259,973 of them getSymbolAtLocation alone, which
 * is asked 115.3 times per distinct node - so the spelling cost 47 million
 * avoidable lookups and bought nothing.
 *
 * Storing NONE in place of a genuine `undefined` makes ONE `get()` enough:
 * `undefined` back from a map now means "never asked" and nothing else. The
 * value types below are written so the compiler enforces it - `undefined` is
 * not assignable to any of these maps, so a write site that forgets its
 * `?? NONE` fails to build rather than silently reintroducing the ambiguity.
 * Answers are unchanged; only the number of lookups is. */
const NONE = Symbol("scriptc.checker.none");
type None = typeof NONE;

export class CheckerFacade {
  /** Node-keyed memos. An absent answer is stored as NONE (see above), so a
   * `get()` returning undefined means the question was never asked. */
  private readonly typeAtLocation = new WeakMap<Node, Type | None>();
  private readonly symbolAtLocation = new WeakMap<Node, Ts7Symbol | None>();
  private readonly contextualType = new WeakMap<Node, Type | None>();
  private readonly typeFromTypeNode = new WeakMap<Node, Type | None>();
  private readonly shorthandValueSymbol = new WeakMap<Node, Ts7Symbol | None>();
  private readonly resolvedSignature = new WeakMap<Node, Signature | None>();
  private readonly signatureFromDeclaration = new WeakMap<Node, Signature | None>();
  /** Symbol-keyed memos. */
  private readonly typeOfSymbol = new WeakMap<Ts7Symbol, Type | None>();
  private readonly aliasedSymbol = new WeakMap<Ts7Symbol, Ts7Symbol>();
  private readonly declaredTypeOfSymbol = new WeakMap<Ts7Symbol, Type>();
  /** Type-keyed memos. */
  private readonly baseTypeOfLiteral = new WeakMap<Type, Type>();
  private readonly nonNullableType = new WeakMap<Type, Type | None>();
  private readonly propertiesOfType = new WeakMap<Type, readonly Ts7Symbol[]>();
  private readonly indexInfosOfType = new WeakMap<Type, readonly IndexInfo[]>();
  private readonly typeArgumentsOf = new WeakMap<Type, readonly Type[]>();
  private readonly arrayTypeAnswer = new WeakMap<Type, boolean>();
  private readonly arrayLikeAnswer = new WeakMap<Type, boolean>();
  private readonly typeStringOf = new WeakMap<Type, string>();
  private readonly awaitedTypeOf = new WeakMap<Type, Type | None>();
  /** Signature-keyed memos. */
  private readonly returnTypeOf = new WeakMap<Signature, Type | None>();
  private readonly typePredicateOf = new WeakMap<Signature, TypePredicate | None>();
  /** Files whose nodes have been batch-prefetched, per query kind. */
  private readonly prefetchedTypes = new WeakSet<SourceFile>();
  private readonly prefetchedSymbols = new WeakSet<SourceFile>();
  private unknownType: Type | null = null;
  /** Intrinsic singletons (string/number/bigint/boolean), fetched once. */
  private readonly intrinsics = new Map<string, Type>();
  private readonly tupleTypeAnswer = new WeakMap<Type, boolean>();

  constructor(
    /** The underlying 7.0.2 sync checker — exposed for methods the facade
     * does not shim; going around the facade forfeits memoization only. */
    readonly raw: Checker,
    private readonly options: { autoPrefetch?: boolean; project?: Project } = {},
  ) {
    /* MEASUREMENT ONLY (block jsredund). The redundancy census needs a live
     * ts7 client object to reach the prototypes it counts on; this is the one
     * place that has one. No-op unless a --require preload installed the hook,
     * which nothing in a normal build does. */
    const install = (globalThis as { __REDUND_INSTALL__?: (raw: unknown, proto: unknown) => void })
      .__REDUND_INSTALL__;
    if (install) install(raw, CheckerFacade.prototype);
  }

  /* ── the symbol-declaration surface (phase 3) ─────────────────────────
   * 7's Symbol carries declarations as NodeHandles (server references),
   * where 5.9.3 handed out the nodes themselves. The lowering reads
   * symbol.declarations/valueDeclaration pervasively, so the facade owns
   * the resolve step (NodeHandle.resolve into the client AST — identity-
   * stable, probe-verified) and memoizes per symbol. Requires the project
   * the symbols came from (options.project — Ts7Program supplies it). */
  private readonly declsOf = new WeakMap<Ts7Symbol, readonly Node[]>();
  private readonly valueDeclOf = new WeakMap<Ts7Symbol, Node | None>();

  private requireProject(): Project {
    const project = this.options.project;
    if (!project) throw new Error("CheckerFacade built without a project cannot resolve declarations");
    return project;
  }

  /** 5.9.3's symbol.declarations (never undefined here: 7 answers an empty
   * array where 5.9.3 answered undefined — callers treat them alike).
   *
   * The facade is also handed SENTINEL symbols the lowerer mints for
   * bindings the language has but the symbol table does not — THIS_BINDING
   * and ARGUMENTS_BINDING are `{ escapedName }` object literals cast to
   * ts.Symbol, with no `declarations` field at all. Reading `.map` off
   * that undefined was an ICE (`Cannot read properties of undefined`) on
   * every diagnostic that tried to blame such a binding's declaration —
   * which is to say, on the fence a real npm package walks into. A symbol
   * with no declarations is an ANSWER (the empty array), never a crash. */
  declarationsOf(symbol: Ts7Symbol): readonly Node[] {
    let decls = this.declsOf.get(symbol);
    if (decls === undefined) {
      const handles = symbol.declarations as typeof symbol.declarations | undefined;
      if (handles === undefined) {
        decls = [];
      } else {
        const project = this.requireProject();
        decls = handles
          .map((h) => h.resolve(project))
          .filter((n): n is Node => n !== undefined);
      }
      this.declsOf.set(symbol, decls);
    }
    return decls;
  }

  /** 5.9.3's symbol.valueDeclaration. */
  valueDeclarationOf(symbol: Ts7Symbol): Node | undefined {
    const memo = this.valueDeclOf.get(symbol);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const decl = symbol.valueDeclaration?.resolve(this.requireProject());
    this.valueDeclOf.set(symbol, decl ?? NONE);
    return decl;
  }

  /** 5.9.3's signature.getDeclaration() (undefined for synthesized
   * signatures — same contract as sig.declaration there). */
  signatureDeclaration(signature: Signature): Node | undefined {
    const memo = this.sigDeclOf.get(signature);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const decl = signature.declaration?.resolve(this.requireProject());
    this.sigDeclOf.set(signature, decl ?? NONE);
    return decl;
  }
  private readonly sigDeclOf = new WeakMap<Signature, Node | None>();

  /** 5.9.3's type.getCallSignatures(). */
  getCallSignatures(type: Type): readonly Signature[] {
    let sigs = this.callSigsOf.get(type);
    if (sigs === undefined) {
      sigs = this.raw.getSignaturesOfType(type, SignatureKind.Call);
      this.callSigsOf.set(type, sigs);
    }
    return sigs;
  }
  private readonly callSigsOf = new WeakMap<Type, readonly Signature[]>();

  /** 5.9.3's type.getConstructSignatures(). */
  getConstructSignatures(type: Type): readonly Signature[] {
    let sigs = this.ctorSigsOf.get(type);
    if (sigs === undefined) {
      sigs = this.raw.getSignaturesOfType(type, SignatureKind.Construct);
      this.ctorSigsOf.set(type, sigs);
    }
    return sigs;
  }
  private readonly ctorSigsOf = new WeakMap<Type, readonly Signature[]>();

  /** 5.9.3's type.getProperty(name), memoized per (type, name).
   *
   * Two-key, which is why it went unmemoized while the one-key queries around
   * it did not - but the pair is as immutable as either half. Measured on
   * zapo-rest's frontend: 519,532 round trips over 27,850 distinct pairs
   * (18.7x), 264.5 MB, the second-largest line item in the whole channel. A
   * shadow audit let all 519,532 reach the server and compared each answer
   * against the first one seen for its key: 491,682 repeats, zero
   * disagreements. */
  getPropertyOfType(type: Type, name: string): Ts7Symbol | undefined {
    let byName = this.propertyOfType.get(type);
    if (byName === undefined) {
      byName = new Map<string, Ts7Symbol | None>();
      this.propertyOfType.set(type, byName);
    }
    const memo = byName.get(name);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const symbol = this.raw.getPropertyOfType(type, name);
    byName.set(name, symbol ?? NONE);
    return symbol;
  }
  private readonly propertyOfType = new WeakMap<Type, Map<string, Ts7Symbol | None>>();

  /** 5.9.3's checker.getConstraintOfTypeParameter(tp): the constraint of a
   * type parameter AS THE CHECKER HOLDS IT, or undefined when none was
   * written.
   *
   * This is NOT the same question as reading `tpDecl.constraint` and
   * resolving that type NODE, and the difference is the whole reason the
   * method exists. A type node resolves in the scope it was WRITTEN in, so
   * a member of a GENERIC type still reads that type's own parameters as
   * abstract: `interface Client<TP = {}> { on<K extends keyof (Events &
   * TP)>(...) }` accessed as `Client['on']` answers a SIGNATURE whose
   * parameters are instantiated at `TP = {}`, while its type parameter's
   * declaration node still says `keyof (Events & TP)` with `TP` open. The
   * signature's own type parameter carries the INSTANTIATED constraint.
   *
   * It answers undefined for a parameter with no constraint (a bare `<T>`,
   * or one carrying only a default), which is the property
   * getBaseConstraintOfType does NOT have — that one widens a bare
   * parameter to its apparent type instead of saying it has none. Callers
   * that must distinguish "unconstrained" from "constrained" still read
   * the declaration for THAT question and use this for the type. */
  constraintOfTypeParameter(type: Type): Type | undefined {
    const memo = this.constraintOfTp.get(type);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    let constraint: Type | undefined;
    try {
      constraint = type.isTypeParameter() ? this.raw.getConstraintOfTypeParameter(type) : undefined;
    } catch {
      // tsgo can PANIC on a query (the sync channel surfaces it as a throw,
      // server intact). "No answer" is the honest report; every caller here
      // falls back to the declaration node it read before this method
      // existed, so a panic costs the improvement and never the build.
      constraint = undefined;
    }
    this.constraintOfTp.set(type, constraint ?? NONE);
    return constraint;
  }
  private readonly constraintOfTp = new WeakMap<Type, Type | None>();

  /** The 5.9.3 checker never answered undefined from getTypeAtLocation-
   * family queries (errorType/anyType stood in); the 7 client loosens them
   * to `T | undefined`. The lowering is written against the 5.9.3 contract,
   * so the facade restores it: undefined becomes anyType — exactly the
   * equivalence the parity battery pinned (a 7-side undefined renders as
   * "any" wherever 5.9.3 said any). */
  private anyType(): Type {
    return this.intrinsic("any", () => this.raw.getAnyType());
  }

  /** Batch-prefetches getTypeAtLocation and getSymbolAtLocation for every
   * node of the file, plus getTypeOfSymbol for every symbol those answers
   * surfaced — the per-file hook that turns the lowering's walk into three
   * array requests instead of thousands of round trips. */
  prefetchSourceFile(sf: SourceFile): void {
    this.prefetchTypes(sf);
    this.prefetchSymbols(sf);
  }

  private prefetchTypes(sf: SourceFile): void {
    if (this.prefetchedTypes.has(sf)) return;
    this.prefetchedTypes.add(sf);
    const all = collectNodes(sf);
    if (all.length > PREFETCH_MAX_NODES) return;
    const nodes = all.filter((n) => !this.typeAtLocation.has(n));
    const types = chunked(nodes, (chunk) => this.typesWithPanicFence(chunk));
    nodes.forEach((n, i) => this.typeAtLocation.set(n, types[i] ?? NONE));
  }

  /** withPanicFence over the type sweep (observed panic: GetTypeAtLocation
   * over an unresolved npm import's clause — a server-side nil deref). */
  private typesWithPanicFence(chunk: readonly Node[]): (Type | undefined)[] {
    return withPanicFence(chunk, (c) => this.raw.getTypeAtLocation(c) as (Type | undefined)[]);
  }

  private prefetchSymbols(sf: SourceFile): void {
    if (this.prefetchedSymbols.has(sf)) return;
    this.prefetchedSymbols.add(sf);
    const all = collectNodes(sf);
    if (all.length > PREFETCH_MAX_NODES) return;
    const nodes = all.filter((n) => !this.symbolAtLocation.has(n));
    // The same bisecting panic fence as the type sweep: tsgo panics on
    // SYMBOL queries too (observed: GetSymbolAtLocation over an
    // `import.defer(...)` callee — the sweep's batch must not turn one
    // poisonous node into a build crash).
    const symbols = chunked(nodes, (chunk) =>
      withPanicFence(chunk, (c) => this.raw.getSymbolAtLocation(c)),
    );
    nodes.forEach((n, i) => this.symbolAtLocation.set(n, symbols[i] ?? NONE));
    // The walk's companion query: types of the symbols the file mentions.
    const distinct = [...new Set(symbols.filter((s): s is Ts7Symbol => s !== undefined))].filter(
      (s) => !this.typeOfSymbol.has(s),
    );
    const symbolTypes = chunked(distinct, (chunk) =>
      withPanicFence(chunk, (c) => this.raw.getTypeOfSymbol(c)),
    );
    distinct.forEach((s, i) => this.typeOfSymbol.set(s, symbolTypes[i] ?? NONE));
  }

  private autoPrefetch(node: Node, kind: "types" | "symbols"): void {
    if (this.options.autoPrefetch === false) return;
    const sf = node.getSourceFile();
    if (kind === "types") this.prefetchTypes(sf);
    else this.prefetchSymbols(sf);
  }

  getTypeAtLocation(node: Node): Type {
    const memo = this.typeAtLocation.get(node);
    if (memo !== undefined) return memo === NONE ? this.anyType() : memo;
    this.autoPrefetch(node, "types");
    const swept = this.typeAtLocation.get(node);
    if (swept !== undefined) return swept === NONE ? this.anyType() : swept;
    // The direct (memo-miss) path wears the SAME panic fence as the sweep,
    // for the reason getTypeOfSymbol's already did: a tsgo panic is a
    // thrown Error on the sync channel, and the sweep answers one with
    // `undefined` (presented as `any`) rather than a crashed build. While
    // every file was swept, the sweep reached the poisonous node first and
    // this path never saw one; a file the sweep SKIPS has no such
    // protection, so the two paths have to agree about what a panic means.
    const [type] = withPanicFence([node], (c) => this.raw.getTypeAtLocation(c) as (Type | undefined)[]);
    this.typeAtLocation.set(node, type ?? NONE);
    return type ?? this.anyType();
  }

  getSymbolAtLocation(node: Node): Ts7Symbol | undefined {
    const memo = this.symbolAtLocation.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    this.autoPrefetch(node, "symbols");
    const swept = this.symbolAtLocation.get(node);
    if (swept !== undefined) return swept === NONE ? undefined : swept;
    // Fenced for the reason above: the symbol sweep panics too (the
    // `import.defer(...)` callee it already names), and a skipped file's
    // queries all come down this path.
    const [symbol] = withPanicFence([node], (c) => this.raw.getSymbolAtLocation(c));
    this.symbolAtLocation.set(node, symbol ?? NONE);
    return symbol;
  }

  getTypeOfSymbol(symbol: Ts7Symbol): Type {
    const memo = this.typeOfSymbol.get(symbol);
    if (memo !== undefined) return memo === NONE ? this.anyType() : memo;
    // The direct (memo-miss) path wears the same panic fence as the
    // prefetch sweep: symbols the sweep never saw (members resolved from
    // other files' d.ts) can hit the identical server panics (observed:
    // GetTypeOfSymbol's TypeReference/TupleType conversion on the formatter idiom's
    // engine graph), and the fence's answer is the sweep's — undefined,
    // presented as `any`.
    const [type] = withPanicFence([symbol], (c) => this.raw.getTypeOfSymbol(c));
    this.typeOfSymbol.set(symbol, type ?? NONE);
    return type ?? this.anyType();
  }

  getAliasedSymbol(symbol: Ts7Symbol): Ts7Symbol {
    let aliased = this.aliasedSymbol.get(symbol);
    if (aliased === undefined) {
      aliased = this.raw.getAliasedSymbol(symbol);
      this.aliasedSymbol.set(symbol, aliased);
    }
    return aliased;
  }

  getDeclaredTypeOfSymbol(symbol: Ts7Symbol): Type {
    let type = this.declaredTypeOfSymbol.get(symbol);
    if (type === undefined) {
      type = this.raw.getDeclaredTypeOfSymbol(symbol);
      this.declaredTypeOfSymbol.set(symbol, type);
    }
    return type;
  }

  getContextualType(node: Node): Type | undefined {
    const memo = this.contextualType.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const type = this.raw.getContextualType(node as never);
    this.contextualType.set(node, type ?? NONE);
    return type;
  }

  getTypeFromTypeNode(node: Node): Type {
    const memo = this.typeFromTypeNode.get(node);
    if (memo !== undefined) return memo === NONE ? this.anyType() : memo;
    const type = this.raw.getTypeFromTypeNode(node as never);
    this.typeFromTypeNode.set(node, type ?? NONE);
    return type ?? this.anyType();
  }

  getShorthandAssignmentValueSymbol(node: Node): Ts7Symbol | undefined {
    const memo = this.shorthandValueSymbol.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const symbol = this.raw.getShorthandAssignmentValueSymbol(node);
    this.shorthandValueSymbol.set(node, symbol ?? NONE);
    return symbol;
  }

  /** Assignability, memoized per (source, target) pair.
   *
   * THE COMMENT THAT STOOD HERE SAID THIS RAN "a handful of times per
   * program". It was wrong by four orders of magnitude and nobody could have
   * known without counting: on zapo-rest's frontend the one caller - the
   * constraint-erased conditional in types.ts, zapo's
   * `NonPromise<T> = T extends PromiseLike<unknown> ? never : T` - asks it
   * 295,302 times over SEVEN distinct type pairs, one of which accounts for
   * 42,186 of them. The caller is not at fault: it sits inside a mapType
   * frame the memo there declines to store (the answer depends on the
   * type-parameter binding), so the whole derivation repeats per
   * instantiation and this query repeats with it.
   *
   * Assignability between two types of one immutable snapshot is a pure
   * function of the pair - the same argument every memo above rests on. A
   * shadow audit let all 295,302 calls reach the server and compared each
   * answer against the first seen for its pair: 295,295 repeats, zero
   * disagreements. Seven cache entries. */
  isTypeAssignableTo(source: Type, target: Type): boolean {
    let byTarget = this.assignableTo.get(source);
    if (byTarget === undefined) {
      byTarget = new WeakMap<Type, boolean>();
      this.assignableTo.set(source, byTarget);
    }
    const memo = byTarget.get(target);
    if (memo !== undefined) return memo;
    const answer = this.raw.isTypeAssignableTo(source, target);
    byTarget.set(target, answer);
    return answer;
  }
  private readonly assignableTo = new WeakMap<Type, WeakMap<Type, boolean>>();

  getResolvedSignature(node: Node): Signature | undefined {
    const memo = this.resolvedSignature.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const signature = this.raw.getResolvedSignature(node);
    this.resolvedSignature.set(node, signature ?? NONE);
    return signature;
  }

  getSignatureFromDeclaration(node: Node): Signature | undefined {
    const memo = this.signatureFromDeclaration.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const signature = this.raw.getSignatureFromDeclaration(node);
    this.signatureFromDeclaration.set(node, signature ?? NONE);
    return signature;
  }

  getReturnTypeOfSignature(signature: Signature): Type {
    const memo = this.returnTypeOf.get(signature);
    if (memo !== undefined) return memo === NONE ? this.anyType() : memo;
    const type = this.raw.getReturnTypeOfSignature(signature);
    this.returnTypeOf.set(signature, type ?? NONE);
    return type ?? this.anyType();
  }

  getTypePredicateOfSignature(signature: Signature): TypePredicate | undefined {
    const memo = this.typePredicateOf.get(signature);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const predicate = this.raw.getTypePredicateOfSignature(signature);
    this.typePredicateOf.set(signature, predicate ?? NONE);
    return predicate;
  }

  /** 5.9.3 semantics, answered client-side wherever type.flags suffices:
   * string/number/bigint/boolean literals map to the intrinsic singletons
   * (one IPC ever per intrinsic); enum-ish and union types round-trip
   * (memoized); everything else is itself. */
  getBaseTypeOfLiteralType(type: Type): Type {
    const memo = this.baseTypeOfLiteral.get(type);
    if (memo !== undefined) return memo;
    const flags = type.flags;
    let base: Type;
    if (flags & (TypeFlags.EnumLiteral | TypeFlags.Enum) || flags & TypeFlags.Union) {
      base = this.raw.getBaseTypeOfLiteralType(type) ?? type;
    } else if (flags & (TypeFlags.StringLiteral | TypeFlags.TemplateLiteral)) {
      base = this.intrinsic("string", () => this.raw.getStringType());
    } else if (flags & TypeFlags.NumberLiteral) {
      base = this.intrinsic("number", () => this.raw.getNumberType());
    } else if (flags & TypeFlags.BigIntLiteral) {
      base = this.intrinsic("bigint", () => this.raw.getBigIntType());
    } else if (flags & TypeFlags.BooleanLiteral) {
      base = this.intrinsic("boolean", () => this.raw.getBooleanType());
    } else {
      base = type;
    }
    this.baseTypeOfLiteral.set(type, base);
    return base;
  }

  private intrinsic(name: string, fetch: () => Type): Type {
    let type = this.intrinsics.get(name);
    if (type === undefined) {
      type = fetch();
      this.intrinsics.set(name, type);
    }
    return type;
  }

  /** 5.9.3's checker.getConstantValue, memoized per node. The one caller
   * (enum lowering) passes ENUM MEMBER declaration nodes only: 7 answers
   * the member's computed constant there for const and regular enums alike
   * (access-expression queries answer const enums only — same as 5.9.3 —
   * so the lowering resolves the member symbol and asks its declaration). */
  getConstantValue(node: Node): string | number | undefined {
    const memo = this.constantValueOf.get(node);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const value = this.raw.getConstantValue(node);
    this.constantValueOf.set(node, value ?? NONE);
    return value;
  }
  private readonly constantValueOf = new WeakMap<Node, string | number | None>();

  getNonNullableType(type: Type): Type {
    const memo = this.nonNullableType.get(type);
    if (memo !== undefined) return memo === NONE ? type : memo;
    const result = this.raw.getNonNullableType(type);
    this.nonNullableType.set(type, result ?? NONE);
    return result ?? type;
  }

  getPropertiesOfType(type: Type): readonly Ts7Symbol[] {
    let props = this.propertiesOfType.get(type);
    if (props === undefined) {
      props = this.raw.getPropertiesOfType(type);
      this.propertiesOfType.set(type, props);
    }
    return props;
  }

  getIndexInfosOfType(type: Type): readonly IndexInfo[] {
    let infos = this.indexInfosOfType.get(type);
    if (infos === undefined) {
      infos = this.raw.getIndexInfosOfType(type);
      this.indexInfosOfType.set(type, infos);
    }
    return infos;
  }

  getTypeArguments(type: TypeReference): readonly Type[] {
    let args = this.typeArgumentsOf.get(type);
    if (args === undefined) {
      // 5.9.3 answered [] for a non-reference passed by cast (the lowering
      // leans on that — a concretely-declared interface takes the same
      // path as its generic @types twin); tsgo PANICS on it, so the
      // reference check happens client-side (free — objectFlags).
      args = (type as Type).isTypeReference() ? this.raw.getTypeArguments(type) : [];
      this.typeArgumentsOf.set(type, args);
    }
    return args;
  }

  isArrayType(type: Type): boolean {
    // Arrays are object types. The raw checker agrees that primitive,
    // union/intersection and type-parameter types are not arrays (a
    // narrowed array arm arrives as its own object type), so answer those
    // locally instead of paying a round trip -- exactly as isTupleType
    // directly below already does. Ported from upstream #190.
    if (!(type.flags & TypeFlags.Object)) return false;
    let answer = this.arrayTypeAnswer.get(type);
    if (answer === undefined) {
      answer = this.raw.isArrayType(type);
      this.arrayTypeAnswer.set(type, answer);
    }
    return answer;
  }

  /** 5.9.3's checker.isTupleType answers true for tuple SHAPES and for
   * REFERENCES to them (Pair<number>, a readonly [T, T] instantiation).
   * The 7.0.2 client-side Type.isTupleType() sees only the shape — a
   * reference answers false there (measured; the facade suite pins it) —
   * so shape-true and non-object-false resolve locally and only object
   * types that are not visibly tuples round-trip, memoized. */
  isTupleType(type: Type): boolean {
    if (type.isTupleType()) return true;
    if (!(type.flags & TypeFlags.Object)) return false;
    let answer = this.tupleTypeAnswer.get(type);
    if (answer === undefined) {
      answer = this.raw.isTupleType(type);
      this.tupleTypeAnswer.set(type, answer);
    }
    return answer;
  }

  isArrayLikeType(type: Type): boolean {
    let answer = this.arrayLikeAnswer.get(type);
    if (answer === undefined) {
      answer = this.raw.isArrayLikeType(type);
      this.arrayLikeAnswer.set(type, answer);
    }
    return answer;
  }

  typeToString(type: Type, enclosingDeclaration?: Node, flags?: number): string {
    if (enclosingDeclaration === undefined && flags === undefined) {
      let text = this.typeStringOf.get(type);
      if (text === undefined) {
        text = this.raw.typeToString(type);
        this.typeStringOf.set(type, text);
      }
      return text;
    }
    return this.raw.typeToString(type, enclosingDeclaration, flags);
  }

  getTypeOfSymbolAtLocation(symbol: Ts7Symbol, location: Node): Type {
    // Two-key query with one census call site: no memo, straight through.
    return this.raw.getTypeOfSymbolAtLocation(symbol, location);
  }

  getUnknownType(): Type {
    this.unknownType ??= this.raw.getUnknownType();
    return this.unknownType;
  }

  /** 7.0.2 dropped getAwaitedType (the census's one MISSING checker method).
   * Shimmed per the survey: unwrap Promise/PromiseLike references through
   * their type argument, distributing over unions. The client cannot BUILD
   * union types, so a union whose arms unwrap to more than one distinct type
   * returns undefined (callers fall back to the input; the census's one call
   * site does exactly that) — a union like `T | PromiseLike<T>` collapses by
   * object identity to T, which is the pattern that call site exists for. */
  getAwaitedType(type: Type): Type | undefined {
    const memo = this.awaitedTypeOf.get(type);
    if (memo !== undefined) return memo === NONE ? undefined : memo;
    const awaited = this.computeAwaitedType(type, 0);
    this.awaitedTypeOf.set(type, awaited ?? NONE);
    return awaited;
  }

  private computeAwaitedType(type: Type, depth: number): Type | undefined {
    if (depth > 8) return undefined; // matches 5.9.3's unwrap depth fence
    if (type.isUnionType()) {
      const arms = constituentTypes(type);
      const awaited = arms.map((arm) => this.computeAwaitedType(arm, depth + 1));
      if (awaited.some((arm) => arm === undefined)) return undefined;
      // No arm was a promise: awaiting the union is the union itself
      // (5.9.3 answers the input type — string | null stays string | null).
      if (awaited.every((arm, i) => arm === arms[i])) return type;
      const distinct = [...new Set(awaited as Type[])];
      if (distinct.length === 1) return distinct[0];
      // `PromiseLike<T | null> | T | null` — an async function's return
      // position when the payload is itself a union, which is the shape
      // `async (): Promise<R | null>` gives EVERY `return { ... }` in it.
      // Each arm unwraps, but to more than one distinct type, so the
      // identity collapse above cannot answer and the client cannot BUILD
      // `T | null` to answer with. It does not have to: the awaited union is
      // already one of the results in hand — the PromiseLike arm's own type
      // argument. Take it only when its arms are EXACTLY the arms of
      // everything awaited, which is the definition of the answer rather
      // than a guess; anything else still declines and the caller still
      // falls back to the input.
      const leaves = new Set<Type>();
      for (const a of distinct) {
        if (a.isUnionType()) for (const l of constituentTypes(a)) leaves.add(l);
        else leaves.add(a);
      }
      for (const cand of distinct) {
        if (!cand.isUnionType()) continue;
        const own = constituentTypes(cand);
        if (own.length === leaves.size && own.every((l) => leaves.has(l))) return cand;
      }
      return undefined;
    }
    const unwrapped = this.promiseArgumentOf(type);
    if (unwrapped === null) return type;
    return this.computeAwaitedType(unwrapped, depth + 1);
  }

  /** The type argument of a Promise/PromiseLike reference, or null when the
   * type is not one. Global-ness is approximated by symbol name — scriptc
   * programs see the es2025 lib's Promise (the ambient world forces it). */
  private promiseArgumentOf(type: Type): Type | null {
    if (!type.isTypeReference()) return null;
    const name = type.getTarget().getSymbol()?.name;
    if (name !== "Promise" && name !== "PromiseLike") return null;
    const args = this.getTypeArguments(type);
    return args[0] ?? null;
  }
}
