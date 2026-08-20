/* AST + checker → IR.
 *
 * Invariants:
 * - Runs only on programs that passed preflight (tsc-clean), so the lowerer
 *   may assume the checker's guarantees (no undeclared identifiers, no
 *   ill-typed operators) and every remaining rejection is a *scriptc*
 *   limitation with its own SC1xxx/SC2xxx code.
 * - Collects ALL diagnostics instead of stopping at the first: an
 *   unsupported construct poisons its enclosing statement (PoisonError),
 *   the statement is skipped, and lowering continues. The user sees every
 *   blocker at once — this list is the seed of the coverage report.
 * - Lexical scoping is resolved here: locals get function-unique ids
 *   ("x.0", "x.1" for shadowing); the IR is scope-flat.
 */
import { isRelativeSpecifier } from "../shared.js";
import * as ts from "../ts7/adapter.js";
import type { ScrDiagnostic } from "../../diagnostics/diagnostic.js";
import {
  anyOpRequiresDynamicDiag,
  blockedBindingUseDiag,
  checkerPanicDiag,
  componentTypeDiag,
  isCheckerPanic,
  genericSignatureTypeDiag,
  indexSignatureTypeDiag,
  intersectionTypeDiag,
  noLoweringDiag,
  overloadedSignatureTypeDiag,
  recordShapeMismatchDiag,
  requiresDynamicApiDiag,
  requiresDynamicPackageDiag,
  requiresDynamicTypeDiag,
  unionMismatchDiag,
  UNSUPPORTED,
  keyOrderFromDynamicDiag,
  projectionCopiesAMutatedFieldDiag,
  unsupportedDiag,
  unsupportedTypeDiag,
} from "../../diagnostics/diagnostic.js";
import type {
  IrClassDef,
  IrExpr,
  IrFfiImport,
  IrFunction,
  IrGlobal,
  IrLocal,
  IrModule,
  IrParam,
  IrRecordShape,
  IrStmt,
  IrType,
  IrLibFn,
  IrUnionDef,
  SrcLoc,
} from "../../ir/nodes.js";
import { armDiscrimLits, arrayOf, BOOL, canAdaptDynFuncTo, canDynCheckTo, discrimSeparates, dynCheckArmOrder, funcOf, canConvertToDyn, canCrossIslandBoundary, canExitIslandToType, canMarshalTypedFuncIntoIsland, DYN, F64, httpReqIsReadableIn, isJsonSafeType, isUndefinedArmedUnion, isUnitType, JSVAL, READABLE_T, RUNTIME_ERROR_CLASSES, streamDuplexWidensToWritable, STRING, typeEquals, UNDEFINED_T, VOID } from "../../ir/nodes.js";
import { type DynamicImportResolution, type NpmBuiltinUse, type NpmLazyTrap } from "../npm.js";
import { provenanceActive } from "../provenance-registry.js";
import {
  ambientDtsPath,
  canonicalBuiltinModule,
  type StartupCrash,
  cjsExportAssignmentOf,
  cjsExportDiscardReason,
  fallbackDtsPath,
  isCjsExportTableLiteral,
  isJsSourceFile,
  isNodeEsmFile,
  isNodeTypesPath,
  locOf,
  orderedImportsOf,
  overridesDtsPath,
  npmStaticDepSf7,
  requireSpecOf,
  resolveImport,
  workspacePackageOfPath,
} from "../program.js";
import { settleOrValueArms,
  containsRecord,
  containsUnion,
  describeComponentBlocker,
  describeRecordMemberBlocker,
  formatIrType,
  ISLAND_AMBIENT_TYPES,
  isConstAssertionTypeNode,
  isUnitOnlyTsType,
  mapType,
  overflowShapeKeys,
  overflowShapeKeysDenied,
  ShapeRegistry,
  typeKey,
  type TypeMapperCtx,
  UnionRegistry,
  withUndefinedArm as withUndefinedArmCanonical,
  withUnitArm as withUnitArmCanonical,
} from "../types.js";
import { CompoundOp, IslandFnEntry, boundaryIntoIslandMsg, boundaryOutOfIslandMsg, BuiltinModuleFn, builtinConstLit, builtinModuleConstOf, builtinModulesArrayLit, builtinFenceHintOf, builtinModuleFnOf, stdlibMemberFence, isStdlibMember, isStdlibSymbol, isStdlibGlobal, stdlibGlobalMember, nodeTypesOnlySymbol } from "./surfaces.js";
import { FileParts, splitFiles, collectProgram, collectNpmImports, collectJsonImports,
  collectJsonRequires, collectDeclTwinExportBridges, moduleArtifacts, collectGlobals, declSymbolOf, defaultExportSymbolOf, lowerFileInit, lowerDefaultExport, buildMain, appendDynamicImportModules } from "./lower-modules.js";
import { scanDefinePropSymbolSlots } from "./lower-classes.js";
import { ClassInfo, ClassIteratorInfo, GenericClassInfo, registerBuiltinErrorClasses, registerBuiltinEmitterClass, registerBuiltinStreamClasses, builtinErrorInfoOf, builtinEmitterInfoOf, builtinStreamInfoOf, analyzeClassDecoration, classIteratorDrainCall, classIteratorNextCall, classIteratorOf, classIteratorOpenCall, classIteratorRestDrainCall, classMemberNameOf, classValueRef, collectClassShape, exactClassOfReceiver, collectClassShapeInner, ctorAbiEquals, findMethodOn, findStaticOn, findGenericMethodOn, findGenericStaticOn, genericClassInstanceType, isSubclassOf, inHierarchy, overrideBelow, staticShadowBelow, upcastTo, lowerClassMembers, lowerClassCtor, lowerClassExpression, lowerClassExpressionInfo, lowerClassMethodMember, lowerClassValueProperty, lowerStaticMethod, throwingSetterFn, fieldInitStmts, lowerStaticFieldInits, lowerStaticFieldRead, lowerDerivedCtorBody, superCallStmt, lowerSuperMethodCall, superThisRef, lowerSuperAccessorRead, lowerSuperAccessorWrite, inheritsBuiltinErrorCtor, inheritsBuiltinEmitterCtor, errorMessageArg, lowerNew, accessorCall } from "./lower-classes.js";
import { MixinFnShape, mixinCallClassInfoOf, mixinIntersectionInstanceType } from "./lower-mixins.js";
import { ParamShape, FnSig, GenericFnInfo, GenericInstance, bindingNeverReassigned, bodyReadsArguments, isThisParameter, paramShape, paramShapes, checkDefaultParamBodyType, completeArgs, wrappedUndefined, undefinedArgFor, requireExactArityValue, bodyReturnType, declaredReturnType, collectSignature, collectSignatureInner, collectGenericSignature, genericFnOf, lowerGenericCall, lowerGenericFnValue, inferTypeParamBindings, lowerGenericInstance, lowerCall, lowerFfiCall, lowerTimersMemberCall, lowerPromiseMethodCall, lowerFilterNarrowCall, isTopLevelFnSymbol, lowerNestedFunctionDecl, lambdaSignature, lowerLambda, lowerFunction, validateFfiImports } from "./lower-calls.js";
import { lowerArrayMethodCall, lowerBufferStaticCall, lowerBytesMethodCall, lowerBytesNew, lowerMapMethodCall, lowerMapForEachCall, buildMapForEachFn, lowerRecordOvfCaptureHelper, ovfCapturePlannable, dynSlotCheckOk, lowerEnvToPairsHelper, lowerSetMethodCall, lowerSetForEachCall, buildSetForEachFn, lowerRegexMethodCall, lowerStringMethodCall } from "./lower-containers.js";
import { lowerStreamModuleCall, streamInstanceOfExpr } from "./lower-stream.js";
import { lowerEmitOverrideSpec, type EmitSpecCtx, type EmitSpecRequest } from "./lower-emitter.js";
import { builtinImportOf, createRequireBindingDecl, createRequireNamespaceDecl, createRequireSpecOf, stripTypeCasts, lowerBuiltinModuleCall, lowerFsToUnixTimestampCall, lowerFsLadderCall, lowerChildArgsArg, lowerSpawnSyncCall, lowerSpawnCall, lowerExecSyncCall, recordToEnvPairs, lowerJsonMethodCall, fencedBuiltinImportOf, lowerCryptoComposedCall, lowerUrlMethodCall, lowerSearchParamsMethodCall, lowerStatsMethodCall, lowerFileHandleMethodCall, lowerChildMethodCall, lowerAtomicsCall, lowerBuiltinExtraProperty, promisifiedExecFileDecl, lowerPromisifiedSettledCall, type PromisifiedTarget, lowerExecFileAsyncCall, execFileAsyncHelper, lowerStringDecoderMethodCall, strdecHelper, lowerReadlineMethodCall, lowerDcChannelMethodCall, lowerDcChannelProperty, lowerAlsMethodCall, lowerDcTracingChannelMethodCall, lowerDcTracingChannelProperty, lowerJsonProperty, lowerErrorCodeProperty, lowerErrorPrototypeProperty, lowerUint8ArrayPrototypeProperty, lowerUint8ArrayStaticProperty, lowerProcessProperty, processVersionsMember, isProcessEnv, envValueType, lowerProcessEnvGet, lowerProcessMethodCall, lowerProcessOptionalMethodCall, lowerTimeoutMethodCall, envSnapshotHelper, isConsoleLog, consoleCallMember, lowerNumberStaticCall, lowerNumberStaticProperty, lowerDateCall, lowerTextCodecCall, lowerCryptoModuleCall, lowerFsConstantsProperty, lowerBuiltinConstantsProperty, builtinConstantBindingOf, builtinConstantsDestructureDecl, lowerProcessStreamProperty, lowerStringStaticCall, lowerStringLastIndexOfCall, lowerPromiseStaticCall } from "./lower-builtins.js";
import { isIslandExpr, islandFuncValueFence, islandRegexpOf, jsvalIn, requireDynamicApi, islandGlobalFnOf, lowerDynamicImportCall, lowerFetchCall, lowerIslandMethodCall, lowerMathProperty, npmPackageOf, npmMemberFence, npmPackageOfSymbol } from "./lower-island.js";
import { lowerHttpHeadersElement, lowerNetModuleCall, lowerServerMethodCall, lowerServerProperty, lowerTlsRootCertificates } from "./lower-server.js";
import { lowerNamespaceConditionalCall, namespaceOverrideOf } from "./lower-nsvalue.js";
import { lowerDgramDnsModuleCall, lowerDgramMethodCall } from "./lower-dgram.js";
import { lowerNodeTestModuleCall, lowerTestDirectCall, lowerTestMethodCall, lowerTestCtxProperty } from "./lower-test.js";
import { lowerAssertModuleCall, lowerAssertDirectCall } from "./lower-assert.js";
import { lowerUtilModuleCall } from "./lower-inspect.js";
import { lowerComptime, comptimeBakeable, rejectComptimeCaptures, comptimeValueToIr } from "./lower-comptime.js";
import { lowerDeleteValue, lowerStmts, noteBlockedBindings, isBlockedBinding, lowerScopedBlock, predeclareForwardCapture, probeBindWhy, predeclareForwardFnDecl, predeclareForwardVar, rejectJumpCrossingFinally, lowerStmt, lowerVarStatement, lowerDestructuringDecl, lowerDestructuringAssignParts, lowerBindingPattern, lowerJsvalBindingPattern, checkBindingElement, bindPatternTarget, lowerVarDeclList, lowerVarDecl, lowerSwitch, lowerTry, lowerExprStatement, lowerForOf, lowerForStatement } from "./lower-stmts.js";
import { recordKeyResultOk, narrowBridgeDyn, FieldTarget, lowerDynObjectLiteral, lowerExpr, maybeNarrow, lowerUnitComparison, lowerNullishCoalesce, lowerOptionalChain, finishOptionalChain, lowerCondition, ensureBool, requireTruthyUnion, eqComparableUnion, lowerIntrinsicProperty, lowerArrayLiteral, lowerObjectLiteral, lowerShorthandValue, rejectThisInObjectMethod, lowerElementAccess, lowerElementWrite, lowerRecordKeyRead, ensureString, numberConvAtDynWidth, lowerTemplate, lowerAsExpression, lowerPrefixUnary, lowerBinary, lowerCaughtTypeofTest, caughtRead, caughtLocalOf, caughtToString, lowerInstanceOf, lowerRegexLiteral, lowerFieldRead, lowerUnionProperty, fieldTarget, fieldGetExpr, fieldSetStmt, lowerFieldCompound, uniqueSymbolKeyOf, foldedStringKeyOf } from "./lower-exprs.js";
import { assertExpandoAccounting, expandoCounters, type ExpandoBind, type ExpandoMember } from "./lower-expando.js";
import { lowerRecordFieldCall, lowerObjectMethodCall, classHasOwnValueOf, classToStringDispatch } from "./lower-calls.js";
import { fenceCrossBlockNsRef, nsPathPrefix } from "./lower-namespaces.js";

/** Entry function name. '%' cannot appear in a TS identifier, so a user
 * function can never collide with it (mangling is injective per prefix). */
export const ENTRY_NAME = "%main";

/** One step of the copy-reshape width relation (widthLiftPlan): how a
 * source-typed value enters a destination slot. Pure data — the plan half;
 * applyWidthLift is the build half. */
export type WidthLift =
  | { how: "copy" }
  | { how: "wrap"; tag: number }
  | { how: "retag" }
  | { how: "liftWrap"; tag: number; arm: IrType }
  | { how: "width" }
  | { how: "ovfCapture" }
  | { how: "arr" }
  | { how: "tupleArr" }
  | { how: "emptyArr" }
  | { how: "objWidth" }
  | { how: "clsWidth" }
  | { how: "narrow" }
  | { how: "dynIn" }
  | { how: "dynOut" }
  | { how: "upcast" }
  | { how: "httpBody" }
  | { how: "funcAdapt" };

/** A class METHOD projected into a func-typed record slot: the field
 * becomes a BOUND closure — the instance captured, the method called with
 * the slot's own arguments. `virtual` picks vtable dispatch when an
 * override can exist below the receiver's static class; a direct call to
 * `%declarer.name` otherwise. `func` is the slot's exact signature (the
 * closure's shape), reconciled equal to the method's in boundMethodPlan. */
export interface BoundMethodProj {
  declarer: string;
  name: string;
  virtual: boolean;
  func: IrType & { kind: "func" };
}

/** How one target field of a class-instance→record projection is filled:
 * a plain instance field copied under a width lift, an absent optional
 * completing to its undefined arm, or a method bound into a closure. */
export type ObjFieldProj =
  | { src: IrType; lift: WidthLift }
  | { absent: true; utag: number }
  | { method: BoundMethodProj };

export class PoisonError extends Error {}

/** Own-property lookup for the surface tables. They are plain object
 * literals, so a bare `table[name]` would also find Object.prototype
 * members ("toLocaleString", "constructor", "valueOf") — genuine member
 * NAMES user code can spell now that the real lib declares them; treating
 * an inherited function as a table entry would mis-lower or ICE. */
export function own<T>(table: Record<string, T | undefined>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Sentinel binding key for `this` (which has no ts.Symbol): a stable
 * object identity used in the same scope/capture maps as real symbols, so
 * arrows capturing `this` ride the ordinary capture machinery. */
export const THIS_BINDING = { escapedName: "%this" } as unknown as ts.Symbol;

/** Sentinel binding key for the `arguments` object — the twin of
 * THIS_BINDING, and for the same reason: an ARROW binds neither `this` nor
 * `arguments`, so a read inside one names the ENCLOSING function's. The
 * synthetic `%arguments` slot is registered under this key, so an arrow's
 * read rides the ordinary capture machinery (box the origin, thread one
 * capture per function in between) instead of needing a story of its own.
 *
 * The one way it differs from `this`: the outward walk must STOP at the
 * first non-arrow frame. Every other function form — declaration,
 * expression, method, accessor, constructor — binds an `arguments` of its
 * own, so a frame that is not an arrow and carries no binding is a frame
 * whose `arguments` simply never got storage; walking past it would answer
 * with a DIFFERENT call's argument list. peekArgumentsLocal enforces it. */
export const ARGUMENTS_BINDING = { escapedName: "%arguments" } as unknown as ts.Symbol;

/* ── the island boundary, in one voice ────────────────────────────────
 * Whether a value can cross between the static world and the island is
 * ONE question — canCrossIslandBoundary (nodes.ts), asked here through
 * boundarySafe() — and each rejected direction has ONE message builder,
 * so the rule and its wording cannot drift apart across the implicit
 * coercion path, the explicit marshal path, and the exact-type fence. */

/** Per-function lowering context. A stack of these models nested functions:
 * identifier resolution walks outward, and a hit in an enclosing context
 * turns into a capture (boxing the binding at its origin and threading it
 * through every function in between). */
export interface FnCtx {
  locals: IrLocal[];
  scopes: Map<ts.Symbol, IrLocal>[];
  localCounters: Map<string, number>;
  /** `var` bindings hoisted to THIS frame's root (hoistVarBinding /
   * predeclareForwardVar), keyed by the checker's merged symbol — every
   * same-name `var` in one function is one symbol, so one slot.
   * Module-scope vars live in globalsBySymbol instead.
   *
   * PER FRAME, not per Lowerer, and that is the whole point. One JS
   * function body is lowered ONCE PER MONOMORPHIZATION (implicit-any
   * instances, lowerGenericInstance), and every instance re-lowers the
   * same AST, so the checker hands back the SAME `ts.Symbol` for the same
   * `var`. A Lowerer-wide map therefore answered the second instance with
   * the FIRST instance's IrLocal: no varDecl was pushed into instance 1's
   * root and no local was registered in its frame, while its declaration
   * statement still lowered to a plain `assign` — the IR validator's
   * `assign to undeclared local/global "x.0"` SC9001. */
  hoistedVars: Map<ts.Symbol, IrLocal>;
  /** CLASS-PINNED bindings of THIS frame: localId → the class name whose
   * class object the binding provably holds (classPinnedBinding's proof —
   * a const initialized from a direct class reference). PER FRAME, like
   * hoistedVars and for the same reason: localIds are minted from a
   * per-frame counter (`name.N`), so two functions each declaring `const
   * C = …` both own `C.0` and a Lowerer-wide map would answer one frame
   * with the other frame's class. Module globals are keyed by their
   * `%g.`-prefixed ids instead, which ARE unique — see globalClassPins. */
  classPins: Map<string, string>;
  /** Lifted functions only: capture entries (also present in `locals`,
   * boxed), in closure caps[] order. undefined ⇔ plain declared function. */
  captures: IrParam[] | null;
  /** Parent-function localIds feeding each capture, parallel to captures. */
  captureSources: string[];
  captureBySymbol: Map<ts.Symbol, IrLocal>;
  /** Named function expressions/declarations: the function's own name
   * symbol. Self-references become `selfRef` (NOT a capture — a box holding
   * its own closure would be an RC cycle and leak). */
  selfSymbol: ts.Symbol | null;
  selfType: IrType | null;
  /** Await is legal here (async function body). */
  isAsync?: boolean;
  /** Yield is legal here (generator function body): the yield/next value
   * channels the yield lowering types itself against. */
  generator?: { yieldT: IrType; nextT: IrType } | null;
  /** VARIADIC `arguments` form (rest-marked func type with no declared
   * rest param): the synthetic trailing dyn-array param `arguments`
   * reads resolve to. Also registered under ARGUMENTS_BINDING in the
   * frame's outermost scope, which is what nested arrows capture. */
  argumentsLocal?: IrLocal | null;
  /** This frame is an ARROW's. JS scoping: an arrow binds neither `this`
   * nor `arguments`, so both resolve outward THROUGH it — and the
   * `arguments` walk stops at the first frame where this is false. */
  isArrow?: boolean;
  /** Declared return type — lets `return` detect record-shape mismatches
   * (SC2002) before the validator would ICE on them. */
  returnType: IrType;
  /** Implicit-any instance RETURN INFERENCE (resolveInferredReturn):
   * present ⇔ `return` statements lower their values BARE (no coercion)
   * and record themselves here; the post-pass unifies the types and wraps
   * each return onto the settled one. `returnType` holds the DYN pin. */
  inferReturn?: { entries: { stmt: IrStmt; node: ts.Expression | null }[] } | null;
  /** Enclosing control constructs, innermost last: loops/switches/labeled
   * blocks (jump targets — `labels` carries their JS label names so labeled
   * break/continue resolve), try-with-finally regions ("tryFinally" — a
   * try/catch body guarded by a finally: `return` crosses them now via the
   * backend's pending-return path; break/continue still reject), and
   * finally BLOCKS themselves ("finallyBlock" — jumps out stay rejected: a
   * return there would REPLACE a pending completion, a model the emitter
   * doesn't implement; see rejectJumpCrossingFinally). Per function: a
   * nested function's jumps never bind to enclosing constructs. */
  ctl: { kind: "loop" | "switch" | "block" | "tryFinally" | "finallyBlock"; labels?: string[] }[];
}

export function newFnCtx(
  lifted: boolean,
  selfSymbol: ts.Symbol | null,
  selfType: IrType | null,
  returnType: IrType,
): FnCtx {
  return {
    locals: [],
    scopes: [new Map()],
    localCounters: new Map(),
    hoistedVars: new Map(),
    classPins: new Map(),
    captures: lifted ? [] : null,
    captureSources: [],
    captureBySymbol: new Map(),
    selfSymbol,
    selfType,
    returnType,
    ctl: [],
  };
}

export interface LowerStats {
  /** Statements the lowerer attempted (nested statements count individually;
   * statements inside a poisoned construct were never reached and don't). */
  statementsTotal: number;
  statementsFailed: number;
  /** Statements that LOWERED but contain island constructs (jsOp/jsExit —
   * package calls, island-backed lib members): they compile, but their
   * work runs in the embedded engine. Only a --dynamic analysis produces
   * these; coverage renders them as "compile dynamically". */
  statementsIsland: number;
  /** Functions whose signature couldn't be analyzed (bodies not counted). */
  functionsSkipped: number;
}

/** IrStmt discriminants — the island walk below must not descend into
 * NESTED statements (each is counted individually by its own lowerStmts
 * visit; descending would attribute a nested island statement to every
 * enclosing construct too). The top-level statement object itself is
 * always visited. */
export const IR_STMT_KINDS = new Set([
  "varDecl", "assign", "exprStmt", "if", "while", "doWhile", "switch",
  "arraySet", "arrayClear", "forOf", "return", "fieldSet", "recordSet", "break",
  "continue", "block", "tryCatch", "throw", "rethrow", "runtimeFence",
]);

/** True when a lowered statement's OWN expressions contain island
 * constructs — a generic JSON walk (like moduleUsesRegex): `kind`
 * discriminants live only on IR objects, so user string values can never
 * false-positive. Nested statements are skipped (counted separately). */
/** Every identifier a binding name binds: the identifier itself, or all
 * identifiers of a (possibly nested) destructuring pattern in source
 * order. */
export function boundIdentifiersOf(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const out: ts.Identifier[] = [];
  for (const el of name.elements) {
    // Elisions: OmittedExpression in 5.9.3, a NAMELESS BindingElement in 7
    // (the parity battery's pinned finding 2) — both spell "no binding".
    if (ts.isOmittedExpression(el) || el.name === undefined) continue;
    out.push(...boundIdentifiersOf(el.name));
  }
  return out;
}

export function stmtUsesIsland(stmts: IrStmt | IrStmt[]): boolean {
  let found = false;
  const visit = (v: unknown, root: boolean): void => {
    if (found || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, root);
      return;
    }
    const kind = (v as { kind?: unknown }).kind;
    if (!root && typeof kind === "string" && IR_STMT_KINDS.has(kind)) return;
    const fn = (v as { fn?: unknown }).fn;
    if (
      kind === "jsOp" || kind === "jsExit" || kind === "jsBridgePromise" ||
      fn === "island.eval" || fn === "island.import" || fn === "island.importDyn" ||
      fn === "island.castFail"
    ) {
      found = true;
      return;
    }
    for (const value of Object.values(v)) visit(value, false);
  };
  visit(stmts, true);
  return found;
}

export interface LowerResult {
  /** Present iff diagnostics is empty. */
  module: IrModule | null;
  diagnostics: ScrDiagnostic[];
  /** JS statements whose compile fences DEFERRED to runtime (runtimeFence
   * statements in the module) — off the build, on the coverage report. */
  runtimeFences: ScrDiagnostic[];
  /** SC6xxx ADVICE — the program compiled and these say something true
   * about what it compiled to. Never fatal: `module` is non-null with a
   * non-empty list, and nothing here may ever move a row into
   * `diagnostics`. */
  advisories: ScrDiagnostic[];
  stats: LowerStats;
  /** --provenance-sources only: per-file statement attribution (the
   * coverage report aggregates it per provenance package). */
  statsByFile?: Map<string, { total: number; failed: number; island: number }>;
  /** --provenance-sources only: diagnostics of elided pure-annotated dead
   * consts in fetched source modules — off the build, on the report. */
  provenanceElided?: ScrDiagnostic[];
  /** Coverage only (LowerOptions.coverage): the unreached remainder,
   * lowered in a throwaway pass — blockers in it can never fail a build. */
  unreached?: { diagnostics: ScrDiagnostic[]; stats: LowerStats };
  /** --dynamic only: every Node builtin the embedded npm graph imports,
   * shimmed or not — the coverage report's island honesty. */
  npmBuiltins?: NpmBuiltinUse[];
  /** --dynamic only: unresolvable specifiers reached ONLY by require()/
   * import() edges — the build embeds Node's call-time error as a runtime
   * trap; the coverage report lists them beside the builtins. */
  npmLazyTraps?: NpmLazyTrap[];
}

export interface LowerOptions {
  /** --dynamic: the island engine is linked, so island constructs
   * (__island_eval) may lower. Off by default — without it they produce a
   * requires-dynamic diagnostic instead. */
  dynamic?: boolean;
  /** Coverage: additionally lower the unreached remainder (bodies nothing
   * on the entry path reaches) in a throwaway pass and report its
   * diagnostics and stats under `unreached` — the whole-program analysis
   * builds deliberately gave up. */
  coverage?: boolean;
  /** The platform the build TARGETS ("win32" under a windows cross triple,
   * the host platform otherwise — see buildTargetPlatform in index.ts).
   * The whole program compiles for one platform, so the platform-keyed
   * surfaces are compile-time constants: on win32 the bare path module
   * binds path.win32 (Node on Windows IS path.win32) and path.sep /
   * path.delimiter / os.EOL lower as the win32 literals; path.posix and
   * path.win32 keep answering THEIR platform everywhere, like Node's. */
  targetPlatform?: string;
  /** Node's startup refusal (LoadResult.startupCrash — preflight's
   * resolution walk and CJS named-import link check): the program
   * compiles to that startup crash. */
  startupCrash?: StartupCrash | null;
  /** LIBRARY mode's reachability roots: the profile-mapped exports of the
   * entry module. Executable builds root at the entry's top level alone
   * (an unreferenced export dead-strips); a library's exports are called from
   * OUTSIDE the graph, so discovery seeds them alongside the init
   * bodies. Names are the entry file's unqualified declaration names. */
  libRoots?: readonly string[];
  /** Outbound native FFI declarations from a validated format-1 manifest.
   * Calls of their exact ambient TypeScript bindings lower to direct C ABI
   * imports; without this option ambient declarations keep Node's ordinary
   * ReferenceError behavior. */
  ffiImports?: readonly IrFfiImport[];
  /** --best-effort: a STATEMENT whose construct has no static lowering
   * compiles to a runtime fence (a catchable, SC-coded throw at the
   * statement's position) instead of failing the build — the JS-input
   * deferral rule, opened to TypeScript sources on request. The build then
   * succeeds as long as every REACHED-and-RUN statement lowers; a statement
   * the program never runs (a plugin install, a teardown path the entry
   * never takes) never throws. ICEs (SC9001) and declaration/type fences
   * (a signature that cannot map) stay compile errors — only per-statement
   * construct fences defer. */
  bestEffort?: boolean;
}

/** The Lowerer's pass configuration (see lowerToIr). */
export interface LowererMode {
  /** Names of bodies the discovery pass reached; null lowers everything. */
  reachable?: ReadonlySet<string> | null;
  /** Coverage remainder: lower ONLY bodies outside `reachable`, skip the
   * always-reachable init bodies and module building, and report deferred
   * collection diagnostics nothing flushed. */
  remainder?: boolean;
  /** Symbols whose deferred diagnostics the emit pass already flushed —
   * the remainder must not report them a second time. */
  alreadyFlushed?: ReadonlySet<ts.Symbol>;
  /** The build's target platform (LowerOptions.targetPlatform — lowerToIr
   * passes it to every pass). Defaults to the host. */
  targetPlatform?: string;
  /** Node's startup refusal (preflight's resolution walk / CJS named-
   * import link check): %main opens with exactly this throw, before any
   * module init — Node refuses the whole graph before anything evaluates,
   * so nothing runs. */
  startupCrash?: StartupCrash | null;
  /** The build's outbound native FFI declarations. */
  ffiImports?: readonly IrFfiImport[];
  /** Program-validated ambient declaration symbols for each FFI name.
   * Undefined in discovery's legacy call-local validation path. */
  ffiBindingSymbols?: ReadonlyMap<string, ReadonlySet<ts.Symbol>>;
  /** --best-effort (LowerOptions.bestEffort): defer per-statement construct
   * fences to runtime in TypeScript sources too. */
  bestEffort?: boolean;
}

/** Build lowering runs in two passes over the same ts.Program:
 *
 * 1. DISCOVERY — a worklist computes the set of reachable bodies. Seeds are
 *    the per-file init bodies (module top-level statements always run, in
 *    import order); lowering a body yields IR whose call/closure/new/
 *    virtualCall nodes are the edges that enqueue further bodies. The
 *    pass's IR, diagnostics, and stats are discarded — it exists only to
 *    answer "which bodies does the entry reach?".
 * 2. EMIT — a fresh Lowerer lowers in the HISTORICAL order (per file:
 *    function declarations, then class members; then file inits, %main,
 *    generic instances, lifted lambdas), skipping bodies the discovery
 *    pass did not mark. Keeping the emit order (and lambda/instance
 *    numbering) identical to the pre-reachability compiler means a fully
 *    reachable program emits byte-identical C.
 *
 * `coverage: true` adds a third pass — the REMAINDER — that lowers only
 * the bodies discovery did NOT mark (plus deferred collection diagnostics
 * nothing flushed), reported separately: whole-program analysis without
 * letting unreached code fail builds. */
export function lowerToIr(
  program: ts.Program,
  entry: ts.SourceFile,
  moduleOrder: ts.SourceFile[],
  options: LowerOptions = {},
): LowerResult {
  const dynamic = options.dynamic ?? false;
  // The OVERFLOW GRANT's registry is per-compilation: the discovery pass
  // fills it, the emit pass's ShapeRegistry consults it while interning.
  // Cleared here so one program's casts can never grant another's shapes
  // (a compiler process compiles many).
  overflowShapeKeys.clear();
  overflowShapeKeysDenied.clear();
  const targetPlatform = options.targetPlatform ?? process.platform;
  const bestEffort = options.bestEffort ?? false;
  const startupCrash = options.startupCrash ?? null;
  // --dynamic: modules reachable only through dynamic import() of the
  // program's own files join the compiled graph here, ONCE, before any
  // pass constructs (nothing calls their %init at startup — the import()
  // site's namespace builder does, on the engine microtask, Node's
  // evaluation point for them). Inadmissible static cycles inside the
  // added subgraph are minted here and handed to the EMIT pass: the
  // discovery pass's diagnostics are discarded by design, and after this
  // extension of the shared array no later pass re-walks the subgraph.
  const dynamicCycleDiags: ScrDiagnostic[] = [];
  if (dynamic) {
    appendDynamicImportModules(program, moduleOrder, (cycle, reason) => {
      dynamicCycleDiags.push(
        unsupportedDiag("SC1016", { file: entry.fileName, start: 0, end: 0 }, `circular imports (${cycle}; ${reason})`),
      );
    });
  }
  const ffiImports = options.ffiImports ?? [];
  const validation = new Lowerer(program, entry, moduleOrder, dynamic, {
    targetPlatform,
    bestEffort,
    ffiImports,
  });
  const ffiValidation = validateFfiImports(validation);
  // Discovery must lower under the SAME rules as emit, or the reachable
  // set it computes does not describe the program emit produces.
  //
  //  - the same exact-symbol ownership: otherwise a local function
  //    shadowing a configured ambient name is mistaken for FFI while
  //    computing reachability, even though emit would correctly lower it
  //    as ordinary TypeScript.
  //  - the same DEFERRAL rule (bestEffort): --best-effort makes emit lower
  //    PAST a construct that has no lowering — the statement becomes a
  //    runtime fence, or a function-valued object member becomes a trap
  //    closure — so emit reaches resolution sites that a poisoning
  //    discovery pass abandoned. Every edge between the poison and the end
  //    of that statement is then missing from `reachable`, the callee is
  //    never emitted, and the call emit DID produce validates as
  //    "call to undeclared function": an SC9001 ICE that --best-effort
  //    cannot defer, in a build whose whole point was deferral. Discovery
  //    must defer wherever emit defers.
  //
  // FFI-free builds reuse the validation lowerer (validation is an
  // immediate no-op there), retaining the historical two-pass
  // construction cost.
  const discovery = ffiImports.length === 0
    ? validation
    : new Lowerer(program, entry, moduleOrder, dynamic, {
        targetPlatform,
        bestEffort,
        ffiImports,
        ffiBindingSymbols: ffiValidation.symbolsByName,
      });
  const reachable = discovery.discover(options.libRoots);
  const emit = new Lowerer(program, entry, moduleOrder, dynamic, {
    reachable,
    targetPlatform,
    bestEffort,
    startupCrash,
    ffiImports,
    ffiBindingSymbols: ffiValidation.symbolsByName,
  });
  for (const d of dynamicCycleDiags) emit.pushDiag(d);
  for (const d of ffiValidation.diagnostics) emit.pushDiag(d);
  const result = emit.run();
  // The expando member partition must be exhaustive (lower-expando.ts):
  // every registered slot is either bound to its dyn-box accessor pair or
  // counted under a named skip. Checked here, so the corpus lane IS the
  // accounting test — a skip added without a counter stops the sum from
  // balancing on the first program that takes it.
  assertExpandoAccounting(expandoCounters);
  if (options.coverage !== true) return result;
  const remainder = new Lowerer(program, entry, moduleOrder, dynamic, {
    reachable,
    remainder: true,
    alreadyFlushed: emit.flushedSymbols,
    targetPlatform,
    ffiImports,
    ffiBindingSymbols: ffiValidation.symbolsByName,
  });
  const rem = remainder.run();
  return { ...result, unreached: { diagnostics: rem.diagnostics, stats: rem.stats } };
}

/** The island-handle type a `import(...)` initializer gives a binding
 * whose DECLARED type has no static mapping (`Promise<typeof
 * import("./m")>` — module-namespace types don't map): the direct form
 * holds the static promise-of-handle, the awaited form holds the handle
 * itself. Null for every other initializer shape. */
export function importCallHandleType(expr: ts.Expression | undefined): IrType | null {
  if (!expr) return null;
  let e = expr;
  let awaited = false;
  for (;;) {
    if (ts.isParenthesizedExpression(e)) {
      e = e.expression;
    } else if (ts.isAwaitExpression(e)) {
      awaited = true;
      e = e.expression;
    } else {
      break;
    }
  }
  if (ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return awaited ? JSVAL : { kind: "promise", inner: JSVAL };
  }
  return null;
}

/** True when `expr` is a call that resolved to an overload SIGNATURE of a
 * source-implemented function whose implementation returns an island value
 * (`any` under --dynamic): tsc never checks overload return types against
 * the body — only the implementation signature is checked — so the
 * overload's return is an unverifiable claim about an island value. The
 * binding stores the HANDLE instead of trap-extracting the claimed type
 * (reconcileOverloadReturn keeps the call jsval by the same rule), and
 * uses dispatch to engine ops — exactly the value Node's binding holds.
 * Ambient (.d.ts) declarations never reach this: they have no compiled
 * implementation, so their calls lower through the island/builtin paths
 * whose validated exits keep the checker-trust trap. */
export function uncheckedOverloadHandleCall(L: Lowerer, expr: ts.Expression | undefined): boolean {
  if (!L.dynamic || !expr) return false;
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  // Tagged templates are calls too (tag(strings, ...values)) and resolve
  // overload sets the same way — foo1`${1}` against a TemplateStringsArray
  // overload of an any-returning implementation stores the handle.
  if (!ts.isCallExpression(e) && !ts.isTaggedTemplateExpression(e)) return false;
  const rsig = L.checker.getResolvedSignature(e);
  const rdecl = rsig ? L.checker.signatureDeclaration(rsig) : undefined;
  if (!rsig || !rdecl) return false;
  if (!(ts.isFunctionDeclaration(rdecl) || ts.isMethodDeclaration(rdecl)) || rdecl.body) return false;
  const name = rdecl.name;
  const symbol = name ? L.checker.getSymbolAtLocation(name) : undefined;
  if (!symbol) return false;
  const impl = L.checker
    .declarationsOf(symbol)
    .find((d) => (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) && (d as ts.FunctionDeclaration).body !== undefined);
  if (!impl) return false;
  const implSig = L.checker.getSignatureFromDeclaration(impl);
  if (!implSig) return false;
  return L.mapTypeOf(L.checker.getReturnTypeOfSignature(implSig))?.kind === "jsval";
}

/** The JavaScript declaration fallback for unmappable binding types (see
 * irTypeOf): `any` and every other inference residue is the checked-
 * dynamic 'unknown' kind, and array types keep their array-ness with the
 * fallback applied to the ELEMENT (any[]/never[] evolving arrays become
 * unknown[], so length/push/index still lower). Null for TypeScript
 * files and for void (no value exists to represent). */
/** A JS-file type carrying `never[]` (or a never element) ANYWHERE in its
 * array/tuple/union structure: tsc's inference residue for evolving and
 * information-free shapes — the bare `const gb = []` (never[]), the mixed
 * command tuple `['pwd', []]` ((string | never[])[]). never's f64
 * representation (mapType's uninhabited stance, sound for genuinely dead
 * TS reads) must not capture these VALUES — a later dyn push would
 * dynCheck strings into a number array, a union arm would re-tag as
 * number[] and fence. Callers treat a tainted type as unmappable so the
 * checked-dynamic fallbacks apply, the pre-never-mapping behavior. Bare
 * `never` at the ROOT stays out (`for (const v of [])`'s loop var — the
 * dead read the f64 mapping is FOR). */
export function neverTaintedJsType(L: Lowerer, node: ts.Node, t: ts.Type): boolean {
  if (!isJsSourceFile(node.getSourceFile())) return false;
  const walk = (x: ts.Type, depth: number): boolean => {
    if (depth === 0) return false;
    if (x.isUnionType()) return x.getTypes().some((a) => walk(a, depth - 1));
    if (L.checker.isArrayType(x) || L.checker.isTupleType(x)) {
      return L.checker
        .getTypeArguments(x as ts.TypeReference)
        .some((a) => (a.flags & ts.TypeFlags.Never) !== 0 || walk(a, depth - 1));
    }
    return false;
  };
  return walk(t, 4);
}

/** The dyn undefined value — what an uninitialized checked-dynamic
 * binding holds (JS: declared bindings read `undefined` before any
 * assignment). A NULL dyn slot is a trap, never a value, so every dyn
 * binding that is READABLE before its first assignment must start here:
 * `let x;` declarations, hoisted `var`s (function and module scope,
 * forward captures included), and the implicit-return completion
 * (lower-calls' own copy of this pattern predates the helper). */
export function dynUndefinedExpr(loc: SrcLoc): IrExpr {
  return {
    kind: "dynFrom",
    value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
    type: DYN,
    loc,
  };
}

/** An always-throwing Node-parity error expression (the error.nodeThrow
 * libCall — the lowered form of arms Node rejects unconditionally:
 * ERR_INVALID_THIS receivers, ERR_MISSING_ARGS arity ladders, the
 * symbol-to-string TypeError). kind 0 Error / 1 TypeError / 2 RangeError;
 * an empty code means no code slot. `type` is the replaced expression's
 * own (never materialized — the global.undefRead pattern). */
export function nodeThrowExpr(kind: 0 | 1 | 2, code: string, message: string, type: IrType, loc: SrcLoc): IrExpr {
  return {
    kind: "libCall",
    fn: "error.nodeThrow",
    args: [
      { kind: "numLit", value: kind, type: F64, loc },
      { kind: "strLit", value: code, type: STRING, loc },
      { kind: "strLit", value: message, type: STRING, loc },
    ],
    type,
    loc,
  };
}

/** The post-validation fence STRING a validation-ladder Chk libCall
 * throws after its Node-order checks pass: the same SC2020 text the
 * per-statement runtime fence would have thrown (message + "[code at
 * file:line]"), rendered eagerly so the runtime can throw it verbatim
 * (scr_throw_lowering_fence). The diagnostic joins the runtime-fence
 * ledger exactly like a deferred statement fence — nothing silently
 * drops off the coverage report. */
export function ladderFenceExpr(L: Lowerer, surface: string, node: ts.Node, hint?: string): IrExpr {
  const loc = locOf(node);
  const d = noLoweringDiag(surface, loc, hint);
  L.runtimeFences.push(d);
  const sf = node.getSourceFile();
  const pos = ts.getLineAndCharacterOfPosition(sf, loc.start);
  return {
    kind: "strLit",
    value: `${d.message} [${d.code} at ${loc.file}:${pos.line + 1}]`,
    type: STRING,
    loc,
  };
}

/** The checked-dynamic declaration fallback for unmappable binding types
 * (see irTypeOf), two gates over one story:
 *
 * JAVASCRIPT files: `any` and every other inference residue is the
 * checked-dynamic 'unknown' kind, and array types keep their array-ness
 * with the fallback applied to the ELEMENT (any[]/never[] evolving arrays
 * become unknown[], so length/push/index still lower).
 *
 * TYPESCRIPT files: genuine checker-`any` residue ONLY — a bare `any`
 * binding (`flags & Any`), or a single-call-signature function type whose
 * only unmappable pieces are `any` (`(value: any) => value is string` —
 * the arrow the binding holds lowers those params to dyn, so the binding
 * keeps its func-ness with the same per-piece fallback). The honest
 * static subset of `any` is a binding whose VALUES are dyn-representable:
 * the binding is 'unknown' storage with the boundary conversions
 * coerceToExpected already applies (dynFrom into the slot, validated
 * dynCheck out) and per-site SC2011 fences for the operations the checked-dynamic tree
 * cannot carry JS-exactly (the island still lifts those). Every OTHER
 * unmappable TS type keeps its own diagnostic — annotations exist there,
 * and the fence names the real blocker. `--dynamic` builds never reach
 * this fallback for `any` (mapType answers jsval first).
 *
 * Null for void (no value exists to represent). */
export function dynFallbackType(L: Lowerer, node: ts.Node, t: ts.Type): IrType | null {
  if (t.flags & ts.TypeFlags.Void) return null;
  if (!isJsSourceFile(node.getSourceFile())) {
    if (t.flags & ts.TypeFlags.Any) return DYN;
    // TS single-call-signature function types: per-piece fallback, but
    // ONLY `any` pieces fall to dyn — any other unmappable piece keeps
    // the whole type's own fence.
    return anyPiecedFuncType(L, node, t);
  }
  if (L.checker.isArrayType(t)) {
    const elem = L.checker.getTypeArguments(t as ts.TypeReference)[0];
    const elemTainted =
      elem !== undefined &&
      ((elem.flags & ts.TypeFlags.Never) !== 0 || neverTaintedJsType(L, node, elem));
    const mappedElem = elem !== undefined && !elemTainted ? L.mapTypeOf(elem) : null;
    // A mappable element keeps the static array; an unmappable one makes
    // the WHOLE value dyn (the checked-dynamic tree has real arrays — length/index/push
    // read through the keyed-dyn paths; dyn-element STATIC arrays have no
    // backend representation).
    if (mappedElem) return { kind: "array", elem: mappedElem };
  }
  // A PURE single-call-signature type (an implicit-any JS function —
  // `exports.check = function (certs) {...}`, common/tls's shape): keep
  // its func-ness like arrays keep array-ness, with the fallback applied
  // per PIECE — unmappable params/returns become the checked-dynamic
  // kind, so direct calls stay static calls and value uses cross the
  // boundary by boxing (canBoxFuncIntoDyn). Generics, rest params,
  // construct signatures, overloads, and function-with-properties shapes
  // stay out (the whole value falls to dyn below, where every reached
  // use meets its own fence or boxes as-is).
  const sig = pureSingleCallSignatureOf(L, t);
  if (sig) {
    const params = sig.getParameters().map((p): IrType => {
      const pt = L.checker.getTypeOfSymbolAtLocation(p, node);
      return L.mapTypeOf(pt) ?? DYN;
    });
    const retT = L.checker.getReturnTypeOfSignature(sig);
    const ret: IrType =
      retT.flags & ts.TypeFlags.Void ? VOID : L.mapTypeOf(retT) ?? DYN;
    return { kind: "func", params, ret };
  }
  return DYN;
}

/** The one call signature of a PURE function type — single signature, no
 * properties, no construct signatures, no type parameters, no rest params
 * (declared or synthesized from an `arguments` read). Null for every
 * other shape. The structural gate both dynFallbackType arms share. */
function pureSingleCallSignatureOf(L: Lowerer, t: ts.Type): ts.Signature | null {
  if (!(t.flags & ts.TypeFlags.Object)) return null;
  const sigs = L.checker.getCallSignatures(t);
  if (
    sigs.length === 1 &&
    L.checker.getPropertiesOfType(t).length === 0 &&
    L.checker.getConstructSignatures(t).length === 0 &&
    sigs[0]!.getTypeParameters().length === 0 &&
    sigs[0]!.getParameters().every(
      (p) => {
        const pDecl = L.checker.valueDeclarationOf(p);
        return !pDecl || !ts.isParameter(pDecl) || pDecl.dotDotDotToken === undefined;
      },
    ) &&
    // A SYNTHESIZED rest param (tsc's `arguments` inference — no
    // valueDeclaration to carry the dotDotDot): param-count mismatch
    // against the signature's declaration; the whole value stays dyn.
    (() => {
      const sigDecl = L.checker.signatureDeclaration(sigs[0]!);
      const declParams = sigDecl !== undefined && ts.isFunctionLike(sigDecl) ? sigDecl.parameters : undefined;
      if (declParams !== undefined && declParams.length !== sigs[0]!.getParameters().length) return false;
      // tsgo never synthesizes the `arguments` pseudo-rest into the
      // inferred signature (5.9.3 did — the count mismatch above was the
      // whole detector there), so ask the declaration's body directly.
      return !(sigDecl !== undefined && ts.isFunctionLike(sigDecl) && bodyReadsArguments(sigDecl as { body?: ts.Node }));
    })()
  ) {
    return sigs[0]!;
  }
  return null;
}

/** The TS arm's function-shape fallback: a pure single-call-signature
 * type whose only UNMAPPABLE pieces are `any`-flavored keeps its
 * func-ness with those pieces as dyn (`(value: any) => value is string`
 * — the arrow the binding holds lowers its params through the same
 * irTypeOf fallback, so the binding type and the closure type agree).
 * A piece that fails to map for any other reason answers null — the
 * whole type keeps its own diagnostic. */
function anyPiecedFuncType(L: Lowerer, node: ts.Node, t: ts.Type): IrType | null {
  const sig = pureSingleCallSignatureOf(L, t);
  if (!sig) return null;
  const params: IrType[] = [];
  for (const p of sig.getParameters()) {
    const pt = L.checker.getTypeOfSymbolAtLocation(p, node);
    const mapped = L.mapTypeOf(pt) ?? (pt.flags & ts.TypeFlags.Any ? DYN : null);
    if (!mapped || mapped.kind === "void") return null;
    params.push(mapped);
  }
  const retT = L.checker.getReturnTypeOfSignature(sig);
  const ret: IrType | null =
    retT.flags & (ts.TypeFlags.Void | ts.TypeFlags.Never) ? VOID
    : L.mapTypeOf(retT) ?? (retT.flags & ts.TypeFlags.Any ? DYN : null);
  if (!ret) return null;
  return { kind: "func", params, ret };
}

/** The best-effort JS `Function.prototype.name` of an expression flowing
 * into a dyn slot (the boxed function kind's inspect/error name):
 * identifier and property reads answer the referenced NAME (a
 * REFERENCE-SITE approximation of JS's creation-site naming — an aliased
 * binding reports the alias; SEMANTICS.md), named function expressions
 * their own name, anonymous function/arrow expressions their
 * NamedEvaluation home (a variable initializer or property assignment).
 * Null when nothing names the value (the box stays anonymous). */
export function jsFuncNameOf(node: ts.Node): string | null {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if ((ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) && n.name) return n.name.text;
  if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
    const p = n.parent;
    if (p && ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) {
      return p.name.text;
    }
    if (p && ts.isPropertyAssignment(p) && p.initializer === n && ts.isIdentifier(p.name)) {
      return p.name.text;
    }
    // `mut = () => …`. NamedEvaluation covers assignment to a plain
    // IdentifierReference and nothing else: `o.f = () => …` leaves the
    // name empty in every engine, so a property target declines here.
    if (
      p &&
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      p.right === n &&
      ts.isIdentifier(p.left)
    ) {
      return p.left.text;
    }
  }
  return null;
}

/** The JS `Function.prototype.name` of a function VALUE, resolved at the
 * value's CREATION site instead of the reference site jsFuncNameOf reads.
 *
 * JS names a function once, when it is created, and every later binding
 * carries that one name: `function f(){}; var g = f; g.name === "f"`.
 * jsFuncNameOf answers the SPELLING at the point of use, so it said `"g"` —
 * a silent wrong answer for every aliased function value in the program,
 * and the reason `f.bind(o).name` could never be right either (the bound
 * name is derived from the TARGET's name, so the model has to know what a
 * value IS before it can prefix anything).
 *
 * Three creation forms are provable without running the program, and they
 * are the ones JS's own naming rules are written in terms of:
 *
 *   - a `.bind(...)` call — the bound function's name is `"bound "` plus
 *     the target's, and a rebind stacks the prefix (`"bound bound f"`);
 *   - an identifier whose symbol has ONE declaration that is a function or
 *     class declaration — the declaration's name;
 *   - an identifier bound by a `const` (or a `let`/`var` this file never
 *     writes again) whose initializer is itself one of these forms —
 *     followed to its own creation site.
 *
 * Anything else — a reassigned binding, a parameter, an element read, a
 * call result — has no creation site a compiler can see, and falls back to
 * jsFuncNameOf's reference-site spelling. That fallback is the documented
 * pre-existing approximation (SEMANTICS.md), NOT a new guess: this function
 * only ever replaces it where the real name is provable.
 *
 * `seen` breaks `var a = b, b = a` cycles; the walk is otherwise bounded by
 * the declaration chain. */
export function jsFuncValueNameOf(L: Lowerer, node: ts.Node, seen?: Set<ts.Symbol>): string | null {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;

  // `target.bind(...)`. The receiver's own name resolves the same way, so a
  // rebind composes without a special case. An anonymous target gives
  // Node's `"bound "` WITH the trailing space — that is the answer, not a
  // missing one, so the empty tail is kept rather than turned into null.
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "bind" &&
    n.expression.questionDotToken === undefined
  ) {
    return `bound ${jsFuncValueNameOf(L, n.expression.expression, seen) ?? ""}`;
  }

  if (ts.isIdentifier(n)) {
    return declaredFuncValueName(L, n, seen ?? new Set()) ?? jsFuncNameOf(n);
  }
  return jsFuncNameOf(n);
}

/** The creation-site name reachable through an identifier's DECLARATION,
 * or null when the binding names no one function value. See
 * jsFuncValueNameOf. */
function declaredFuncValueName(L: Lowerer, id: ts.Identifier, seen: Set<ts.Symbol>): string | null {
  const sym = L.resolveValueSymbol(id);
  if (!sym || seen.has(sym)) return null;
  seen.add(sym);
  const decls = L.checker.declarationsOf(sym);
  // Two declarations means two possible values behind one name (a
  // redeclared `var`, a declaration/implementation pair): nothing here can
  // say which one a use sees.
  if (decls.length !== 1) return null;
  const d = decls[0];
  if (!d) return null;
  if ((ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) && d.name) return d.name.text;
  if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || !d.initializer) return null;
  // A binding written again after its initializer can hold a different
  // function at the point of use — the reference-site spelling is then the
  // only honest thing left, so decline and let the caller fall back.
  const isConst = (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0;
  if (!isConst && !bindingNeverReassigned(L, sym, d)) return null;
  return jsFuncValueNameOf(L, d.initializer, seen);
}

/** The SOURCE TEXT `Function.prototype.toString` must answer for a
 * function value flowing into a dyn slot — resolved at the value's
 * CREATION site, the same walk jsFuncValueNameOf uses for the name, for
 * the same reason: JS fixes a function's source once, when it is created,
 * and every later binding carries that one text (`function f(){};
 * var g = f; String(g)` prints f's body, not "g").
 *
 * The walk answers one of three things, and the two non-text answers are
 * as much the truth as the text is:
 *
 *   - `{ text }` — the creation site is a function/arrow/class/method
 *     node, so its text IS the answer, comments and whitespace included;
 *   - `"bound"` — a `.bind(...)` call. A bound function has NO source, so
 *     `function () { [native code] }` is what every engine prints, and
 *     that is a right answer rather than a missing one;
 *   - `null` — a parameter, a call result, an element read, a reassigned
 *     binding: nothing here can say which function the value is. The
 *     caller carries no text and the runtime refuses to guess.
 *
 * JAVASCRIPT sources only. Node executes a `.ts` program type-STRIPPED,
 * so its answer is the erased text (each annotation replaced by spaces of
 * equal width), not what the file says; handing back `getText()` there
 * would trade one invisible wrong answer for another. TypeScript function
 * values keep the compile-time fence they already have (SC2011 on
 * `String(f)`), which is loud.
 *
 * `seen` breaks `var a = b, b = a` cycles, like the name walk. */
export function jsFuncValueSourceOf(
  L: Lowerer,
  node: ts.Node,
  seen?: Set<ts.Symbol>,
): { text: string } | "bound" | null {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;

  // `target.bind(...)`. A rebind is still bound, so the recursion needs no
  // special case — every answer up the chain is "bound".
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "bind" &&
    n.expression.questionDotToken === undefined
  ) {
    return "bound";
  }

  if (ts.isIdentifier(n)) {
    const sym = L.resolveValueSymbol(n);
    if (!sym) return null;
    const s = seen ?? new Set<ts.Symbol>();
    if (s.has(sym)) return null;
    s.add(sym);
    const decls = L.checker.declarationsOf(sym);
    // Two declarations means two possible values behind one name; nothing
    // here can say which one a use sees.
    if (decls.length !== 1) return null;
    const d = decls[0];
    if (!d) return null;
    if (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) return functionNodeSource(d);
    if (!ts.isVariableDeclaration(d) || !d.initializer) return null;
    // A binding written again after its initializer can hold a different
    // function at the point of use.
    const isConst = (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0;
    if (!isConst && !bindingNeverReassigned(L, sym, d)) return null;
    return jsFuncValueSourceOf(L, d.initializer, s);
  }

  // `o.m` / `K.prototype.m` / `K.s` — a method shorthand and a property
  // holding a function literal are creation sites like any other, and the
  // property symbol names exactly one declaration when it has one. (The
  // NAME walk has no equivalent because jsFuncNameOf's reference-site
  // spelling already answers `m` here; the TEXT has no such shortcut.)
  if (ts.isPropertyAccessExpression(n) && n.questionDotToken === undefined) {
    const psym = L.checker.getSymbolAtLocation(n.name);
    if (!psym) return null;
    const s = seen ?? new Set<ts.Symbol>();
    if (s.has(psym)) return null;
    s.add(psym);
    const decls = L.checker.declarationsOf(psym);
    if (decls.length !== 1) return null;
    const d = decls[0];
    if (!d) return null;
    if (ts.isMethodDeclaration(d) || ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d)) {
      return functionNodeSource(d);
    }
    if (ts.isPropertyAssignment(d) && d.initializer) return jsFuncValueSourceOf(L, d.initializer, s);
    if (ts.isPropertyDeclaration(d) && d.initializer) return jsFuncValueSourceOf(L, d.initializer, s);
    return null;
  }

  if (
    ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) ||
    ts.isClassExpression(n) || ts.isClassDeclaration(n) || ts.isMethodDeclaration(n)
  ) {
    return functionNodeSource(n);
  }
  return null;
}

/** Modifiers an engine does NOT count as part of a function's source
 * text: they belong to the DECLARATION that holds the function, not to
 * the function. `export function f(){}` stringifies as `function f(){}`
 * and `static s(){}` as `s(){}`, while `async`, `get`, `set` and `*` —
 * which change what the function IS — stay. */
const SRC_OUTER_MODIFIERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DefaultKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.StaticKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.OverrideKeyword,
]);

/** A function-like node's own source text, or null when the node is not
 * in a JavaScript file (see jsFuncValueSourceOf's TypeScript note) or the
 * text is unavailable (a synthesized node has no position). */
function functionNodeSource(n: ts.Node): { text: string } | null {
  const sf = n.getSourceFile() as ts.SourceFile | undefined;
  if (!sf) return null;
  if (!/\.(js|mjs|cjs|jsx)$/i.test(sf.fileName)) return null;
  if (n.pos < 0 || n.end < 0 || n.end > sf.text.length) return null;
  // getStart() is the node proper, past leading trivia — but the node
  // proper still includes the outer modifiers, which the engine's answer
  // does not.
  let start = n.getStart(sf);
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  if (mods) {
    for (const m of mods) {
      if (!SRC_OUTER_MODIFIERS.has(m.kind)) {
        start = m.getStart(sf);
        break;
      }
      start = ts.skipTrivia(sf.text, m.end);
    }
  }
  if (start >= n.end) return null;
  const text = sf.text.slice(start, n.end);
  return text.length > 0 ? { text } : null;
}

export class Lowerer {
  readonly checker: ts.TypeChecker;
  readonly diags: ScrDiagnostic[] = [];
  readonly fnSigsBySymbol = new Map<ts.Symbol, FnSig>();
  readonly genericFnsBySymbol = new Map<ts.Symbol, GenericFnInfo>();
  /** Object-literal GENERIC methods (`{ m<T>(x: T) {...} }`), interned by
   * their function-like node — instances ride the same monomorphization
   * queue (objLitGenericFnInfoOf). */
  readonly objLitGenericFns = new Map<ts.Node, GenericFnInfo>();
  /** Generic arrow/function-expression INITIALIZERS of never-reassigned
   * bindings (`const f = <T>(x: T) => x`), interned by the function-like
   * node — registered in genericFnsBySymbol under the binding's symbol
   * (and a named function expression's own inner name), so calls and
   * pinned values resolve through genericFnOf exactly like top-level
   * generic function declarations (bindingGenericFnInfoOf). */
  readonly bindingGenericFns = new Map<ts.Node, GenericFnInfo>();
  /** Per-symbol result of the never-reassigned file scan
   * (bindingNeverReassigned — object-literal generic-method receivers). */
  readonly neverReassignedCache = new Map<ts.Symbol, boolean>();
  /** TRAP bindings: declarations whose initializer provably throws before
   * producing a value (its chain roots at an ambient-undefined name —
   * ambientUndefVarRootOf). Module init unwinds at the declaration, so no
   * reference to the binding can ever execute; the statement lowers to the
   * root's throw, no storage exists, and references lower to the same
   * trap shape (never reached — sound whatever the type). */
  readonly trapBindings = new Set<ts.Symbol>();
  /** NULLISH bindings of unmappable (generic-signature) types: `const i:
   * I<A & B> = null as any` — the binding provably holds null/undefined
   * forever (every write's RHS is nullish too), so no storage exists and
   * each READ knows the value. Member reads and method calls through one
   * lower to Node's exact TypeError ("Cannot read properties of null
   * (reading 'fn')"); nullish-to-nullish flows lower to nothing. The map
   * answers which unit the binding holds (the TypeError names it). Null
   * entries cache probed non-qualifiers. */
  readonly nullishBindings = new Map<ts.Symbol, "null" | "undefined" | null>();
  /** DEAD bindings of unmappable types: never READ anywhere in the
   * program, declared with no initializer or a value-only one (a function
   * literal), every write's RHS side-effect-free. Node materializes the
   * value and drops it — zero observable effect — so the declaration and
   * its writes lower to nothing, and no type fence fires for a value the
   * program never consumes. */
  readonly deadBindings = new Set<ts.Symbol>();
  /** IMPLICIT-ANY function-value bindings (npm-static JS — `const knownBy
   * = (cmd) => ...`), by their VariableDeclaration: the registered info,
   * or null for probed non-qualifiers (implicitLocalFnNodeOf). */
  readonly implicitLocalFns = new Map<ts.Node, GenericFnInfo | null>();
  /** Monomorphization worklist: instances queued by call sites, drained in
   * run() (processing an instance body can queue more). */
  readonly instantiationQueue: { info: GenericFnInfo; inst: GenericInstance }[] = [];
  /** Non-null while an instance body lowers: type-parameter symbol →
   * concrete IR type, consulted inside mapType's recursion. */
  typeParamBindings: Map<ts.Symbol, IrType> | null = null;
  /** The ts-level twin of typeParamBindings, non-null while a CALL-keyed
   * instance body lowers: type-parameter symbol → the bound CHECKER type,
   * consulted where the mapped IrType has already widened away information
   * the body needs — indexed accesses (`T[K]` needs K's literal key) and
   * keyed record reads (`o[k]` where k's type is a literal-bound K). */
  typeParamTsBindings: Map<ts.Symbol, ts.Type> | null = null;
  /** The current instantiation's symbolic→resolved side table, installed
   * only while that instance's body lowers (lowerGenericInstance). Null
   * everywhere else, which makes symbolicTsResolver inert. */
  symbolicResolved: Map<ts.Type, ts.Type> | null = null;
  /** Non-null while an IMPLICIT-ANY instance body lowers (npm-static JS —
   * lower-calls' implicit-monomorphization section): bound param symbol →
   * the call site's checker type, consulted by typeOf for identifier
   * references the checker still types `any`. The implicit twin of
   * typeParamBindings — the checker has no `T` to substitute, so the
   * binding rides the node-type accessor instead of mapType. */
  implicitParamTypes: Map<ts.Symbol, ts.Type> | null = null;
  /** IMPLICIT-ANY instances lowered EAGERLY at first demand (their return
   * types are inferred from the body — the call site needs them settled),
   * collected here for run()'s function list (the liftedFns discipline). */
  readonly implicitFns: IrFunction[] = [];
  /** ALIASED-TYPEOF narrowing (npm-static JS — ms's `var type = typeof
   * val; if (type === 'string') ...`): while a branch such a test proves
   * lowers, the tested operand's symbol maps to the proven ARM's checker
   * type here, and typeOf answers it — the checker only narrows const
   * aliases, so this carries the var/let form the checker cannot.
   * Scoped strictly by narrowingAliases (lowerIf / lowerCondition). */
  readonly aliasNarrowTypes = new Map<ts.Symbol, ts.Type>();

  /** Runs `fn` with the given aliased-typeof narrows applied (and restored
   * after) — the branch-scoping primitive. */
  narrowingAliases<T>(narrows: readonly { sym: ts.Symbol; tsArm: ts.Type }[], fn: () => T): T {
    if (narrows.length === 0) return fn();
    const saved = narrows.map((n) => [n.sym, this.aliasNarrowTypes.get(n.sym)] as const);
    for (const n of narrows) this.aliasNarrowTypes.set(n.sym, n.tsArm);
    try {
      return fn();
    } finally {
      for (const [sym, old] of saved) {
        if (old === undefined) this.aliasNarrowTypes.delete(sym);
        else this.aliasNarrowTypes.set(sym, old);
      }
    }
  }
  /** Non-null while an instance body lowers: appended to every diagnostic
   * so a body error names WHICH instantiation triggered it. */
  instantiationContext: string | null = null;
  /** True while re-lowering a base function's 2nd+ instance: the same source
   * statements were already counted for the first instance. */
  suppressStats = false;
  /** Synthetic array-HOF loop functions (map/filter/forEach desugar),
   * interned per method + element/callback-result type: key → fn name. */
  readonly arrHofHelpers = new Map<string, string>();
  /** Emit-override specializations (`%C.emit:<event>` — lower-emitter.ts's
   * emit-overrides block): interned names, the drive-loop queue, and the
   * currently-lowering specialization's context (the super-forward
   * interception reads it). */
  readonly emitSpecDone = new Set<string>();
  readonly emitSpecQueue: EmitSpecRequest[] = [];
  emitSpecCtx: EmitSpecCtx | null = null;
  /** Width-coercion helpers (%rec.width.N / %arr.width.N), interned per
   * (from, to) shape pair — see widthCoerce. */
  readonly widthHelpers = new Map<string, string>();
  /** (fromShape, toShape) pairs whose width plan is being computed — the
   * cycle guard for RECURSIVE shapes (a self-referential record narrowing
   * into a self-referential subset). Re-entering an in-progress pair
   * answers "assume coercible" (the greatest fixed point: every OTHER
   * constraint of the cycle is still checked by the outer call, and the
   * built helper terminates because recordWidthHelper interns its name
   * before building the body, so the recursive reference resolves to the
   * helper itself). */
  private readonly widthPlanning = new Set<string>();

  /** Interned node:assert helpers (deep-equality comparisons keyed by
   * typeKey, throws wrappers keyed by callback type + expected class) —
   * the widthHelpers pattern with its own namespace. */
  readonly assertHelpers = new Map<string, string>();
  /** util.inspect's per-type traversal helpers (%util.insp.N), interned
   * by typeKey — the assertHelpers pattern with its own namespace. */
  readonly inspectHelpers = new Map<string, string>();
  /** Union re-tag helpers (%union.retag.N), interned per (from, to)
   * unionId pair — see unionRetagHelper. */
  readonly retagHelpers = new Map<string, string>();
  /** Per class, the field names some non-constructor member ASSIGNS on
   * `this` — SC6003's admission rule, memoized because the width planner
   * probes the same class from several positions. See
   * classMethodWrittenFields. */
  readonly methodWrittenFields = new Map<string, Set<string>>();
  /** One id per distinct promise payload CONVERSION (from-type, to-type,
   * settle-or-value flavour) -- the second half of the runtime memo's
   * key. Separate from retagHelpers.size so the ids stay a dense little
   * range whatever else interned a helper in between. */
  promiseAdaptIds = 0;
  /** Symbols bound by `const x = promisify(execFile)` — the one lowered
   * util.promisify shape. Declarations register here and emit nothing;
   * calls through the binding lower (lowerExecFileAsyncCall) and value
   * uses fence. */
  readonly promisifiedExecFile = new Set<ts.Symbol>();
  /** `const unzipAsync = promisify(unzip)` bindings → the lib fn their
   * calls lower to (the settled-promise targets; promisifiedExecFileDecl
   * fills this). */
  readonly promisifiedSettled = new Map<ts.Symbol, PromisifiedTarget>();
  /** Symbols bound by `const process = globalThis.process` (and the other
   * stdlib-global snapshot spellings): pure alias plumbing — receiver
   * checks resolve through this map (stdlibGlobalNameOf), declarations
   * emit nothing. */
  readonly stdlibGlobalAliases = new Map<ts.Symbol, string>();
  /** CJS export-table ACCESSORS (`module.exports = { get path() {...} }`),
   * lifted lazily as module-level functions and interned per accessor
   * declaration: member reads call the getter (lower-exprs). */
  readonly cjsAccessorFns = new Map<ts.Node, { fnName: string; type: IrType & { kind: "func" } }>();
  readonly narrowHelpers = new Map<string, string>();
  /** Class down-narrow helpers (%class.narrow.N), interned per
   * (from, to) class-name pair — see narrowedClassHelper. */
  readonly classNarrowHelpers = new Map<string, string>();
  /** Interned `%iter.drain.<n>` helpers (classIteratorDrainCall): one per
   * receiver class — the eager drain of a class iterable's protocol into
   * a fresh element array, behind array/call spreads. */
  readonly iterDrainHelpers = new Map<string, string>();
  /** Island-lift builder helpers (%jsin.rec.N / %jsin.arr.N /
   * %jsin.elems.N), interned per source type — see jsvalLiftExpr. */
  readonly jsinHelpers = new Map<string, string>();
  /** Synthetic Map.forEach loop functions, interned per key/value type +
   * callback arity: key → fn name (see lowerMapForEachCall). */
  readonly mapHofHelpers = new Map<string, string>();
  /** Synthetic Set.forEach loop functions, interned per element type +
   * callback arity/return — Map's pattern. */
  readonly setHofHelpers = new Map<string, string>();
  /** Synthetic URLSearchParams.forEach loop functions, interned per
   * callback arity/return — Map's pattern over the sp index walk. */
  readonly spHofHelpers = new Map<string, string>();
  /** The primitive-constructor VALUES (`String`/`Number`/`Boolean` as
   * bare identifiers — CLI option tables store and compare them): one
   * synthesized coercion function per constructor per program, interned
   * here by name so every reference is the SAME zero-capture closure and
   * `opt.type === String` is JS identity (see primitiveCtorClosure). */
  readonly primitiveCtorFns = new Map<string, string>();
  /** Optional-chain lowering state. While a chain body lowers, the guarded
   * receiver NODE reads as a chainRecv (typed by the narrowed arm) instead
   * of re-lowering, its checker type reads non-nullish (typeOf), and the
   * node carrying the ?. token is marked handled so the receiver-typed
   * lowerings stop declining it (chainBlocked). */
  readonly chainRecvByNode = new Map<ts.Node, IrExpr>();
  readonly chainNarrowedType = new Map<ts.Node, ts.Type>();
  readonly chainHandled = new Set<ts.Node>();
  /** The DYN TWIN of a catch binding whose block hands the binding to a
   * NESTED FUNCTION (`catch (e) { setTimeout(function () { cb(e) }, 0) }`
   * — protobufjs's rpc/service.js writes exactly that). A `caught` local
   * is a snapshot box that may not travel in a capture (validate.ts:
   * `capture "e" is caught-typed`), and the fence's own message names the
   * fix: "narrow into a typed local first". This map IS that lift, done by
   * the compiler instead of demanded of the source — lowerTry declares one
   * hidden DYN local per such catch, initializes it with the caughtToDyn
   * the un-narrowed read would have produced anyway, and registers it
   * here keyed by the caught local it stands for.
   *
   * ONE twin per catch clause, and every un-narrowed read in the block
   * goes through it (caughtRead), because two independent caughtToDyn
   * conversions of one snapshot would be two dyn OBJECTS: `cb(e)` inside
   * the closure and `emit("error", e)` outside it must be the same value,
   * which is what JS guarantees and what a per-read conversion would
   * quietly break. Narrowed reads (caughtNarrow under a proven test) and
   * `throw e` still read the snapshot directly — they extract, they do not
   * convert, and rethrow needs the original cell.
   *
   * Keyed by the IrLocal OBJECT, not by its id: localIds are minted from a
   * PER-FRAME counter (`e.0`), so two functions each with a `catch (e)`
   * both own `e.0` and an id-keyed map would answer one frame with the
   * other frame's twin — the same hazard FnCtx.classPins documents. */
  readonly caughtDynTwins = new Map<IrLocal, IrLocal>();
  /** for-of-over-matchAll bindings whose `.index` reads the companion-index
   * array: binding SYMBOL → the hidden number[] of match start indices plus
   * the hidden cursor holding THIS iteration's position (registered while
   * the loop body lowers; the property path serves `m.index` as
   * idxs[cur] — computed only at an actual read, so a drain row is never
   * touched for bodies that ignore it). */
  readonly matchAllIndexBindings = new Map<ts.Symbol, { idxsLocalId: string; curLocalId: string }>();
  /** STORED matchAll drains: `const rows = s.matchAll(re)` lowers through
   * matchAllInto with a hidden companion index array, registered here so a
   * later `for (const m of rows)` in the SAME function serves `m.index`
   * (the ctx guard keeps hidden locals out of closures — a cross-function
   * walk falls back to the plain array walk and the fence). */
  readonly matchAllDrainIndexes = new Map<ts.Symbol, { idxsLocalId: string; ctx: FnCtx }>();
  /** STORED numeric value iterators: `const it = numbers.values()` (and
   * the equivalent `[Symbol.iterator]()` spelling) over number[] or a
   * represented typed array has no first-class IR value, so its statically
   * known protocol state lives in hidden source/cursor/done locals. A
   * later for-of in the SAME function reads and advances them.
   * `doneLocalId` is sticky: once next() observes the end, later source
   * changes do not revive the exhausted iterator, exactly like Node. */
  readonly numericIterators = new Map<
    ts.Symbol,
    { sourceLocalId: string; sourceType: IrType; indexLocalId: string; doneLocalId: string; ctx: FnCtx }
  >();
  chainCounter = 0;
  /** Keyed by program-wide qualified class name (what IR object types carry). */
  readonly classes = new Map<string, ClassInfo>();
  readonly classBySymbol = new Map<ts.Symbol, ClassInfo>();
  /** The class whose members are lowering — `super` binds lexically to it
   * (arrows inside methods lower within this window, so they see it too). */
  currentClass: ClassInfo | null = null;
  readonly globalsBySymbol = new Map<ts.Symbol, IrGlobal>();
  /** CLASS-PINNED module globals: the `%g.`-prefixed id of an immutable
   * global whose value is provably one class's class object → that class
   * name (classPinnedBinding's proof). Module global ids are unique
   * program-wide, so unlike a frame's locals these live on the Lowerer.
   * Read through pinnedClassValueOf. */
  readonly globalClassPins = new Map<string, string>();
  /** Nonzero while classCtorThunk is planning a thunk's arguments — the
   * window in which varRefs are the thunk's SYNTHETIC parameters rather
   * than the current frame's bindings. See pinnedClassValueOf. */
  ctorThunkDepth = 0;
  /** Expando function members (`foo.bar = 12` on a module-level function
   * or callable const): per function symbol, each written member's module
   * global — string keys for spelled/folded names, ts.Symbols for
   * unique-symbol keys (lower-expando.ts). */
  readonly expandoMembers = new Map<ts.Symbol, Map<string | ts.Symbol, ExpandoMember>>();
  /** Per-file `dyn.expandoBind` requests: the accessor pair that lets a
   * dyn box over the function value reach the member's module global
   * (lower-expando.ts). lowerFileInit emits them interleaved with the
   * top-level statements, by the recorded source position. */
  readonly expandoBinds = new Map<ts.SourceFile, ExpandoBind[]>();
  /** CJS export globals ALSO key by their declaration NODE: the checker
   * hands importers a distinct (late-bound) symbol for `module.exports`
   * property exports — different object, same declaration — so globalOf
   * falls back through the shared node (collectGlobals registers both). */
  readonly globalsByDeclNode = new Map<ts.Node, IrGlobal>();
  readonly globalsList: IrGlobal[] = [];
  /** npm-import init statements (--dynamic), keyed by file AND import
   * declaration: the island.import assignments/side-effect loads for that
   * statement. lowerFileInit splices them into the importing file's %init
   * header at the statement's position — Node evaluates each imported
   * module (island packages included) where the import appears, so an
   * `import "polyfill"` before an `import "./app.js"` runs the package
   * top-level BEFORE app's init, not after. */
  readonly npmInitActions = new Map<ts.SourceFile, Map<ts.Statement, IrStmt[]>>();
  /** Per-file %init PRELUDE statements for JSON imports: bakeable DATA
   * assignments with no observable evaluation order of their own —
   * prepended by lowerFileInit so the bindings are live before any
   * top-level statement runs. */
  readonly jsonInitActions = new Map<ts.SourceFile, IrStmt[]>();
  /** The embedded npm runtime graph (collectNpmImports), attached to the
   * emitted module. Null without npm imports or without --dynamic. */
  npmEmbedded: IrModule["embedded"] | null = null;
  npmBuiltins: NpmBuiltinUse[] | null = null;
  npmLazyTraps: NpmLazyTrap[] | null = null;
  /** Dynamic `import("literal")` resolutions, keyed
   * `fileName\u0000specifier` (collectDynamicImports fills it during npm
   * collection; lowerDynamicImportCall reads it per site). */
  readonly dynImports = new Map<string, DynamicImportResolution>();
  /** createRequire-require resolutions of BARE npm specifiers, keyed
   * `fileName\u0000specifier` (collectCreateRequires fills it during npm
   * collection under --dynamic — the require-condition entry key plus its
   * embedded format; lowerCreateRequireCall reads it per site; "" marks a
   * failed resolution already reported at collection). */
  readonly createRequireImports = new Map<string, { entryKey: string; format: "esm" | "cjs" | "json" } | "">();
  /** Module → the name of its synthesized namespace-BUILDER function
   * (lowerOwnModuleImport): every `import()` of the same program module
   * shares one builder. */
  readonly dynNsBuilders = new Map<ts.SourceFile, string>();
  /** Parameters forced to the island-handle type (jsval) regardless of
   * their checker type: then-handler params whose settled value is an
   * engine handle (a dynamic import's namespace object) — paramShape's
   * early-out. */
  readonly jsvalParamOverrides = new Set<ts.ParameterDeclaration>();
  /** Parameters bound at an IR type the CHECKER did not spell — paramShape's
   * second early-out, the jsvalParamOverrides pattern with a type instead of
   * a fixed kind. One producer today: a `new Promise` executor's resolve
   * parameter, widened to the SETTLE-OR-VALUE union `Promise<T> | T` when the
   * executor actually resolves with a promise (lower-classes.ts,
   * executorResolveAdoptionUnion). The lib signature says
   * `(value: T | PromiseLike<T>) => void` and mapType collapses that to `T`,
   * which is what erases the promise possibility; the override puts it back
   * exactly where the value can still be told apart — the union's tag. */
  readonly paramIrOverrides = new Map<ts.ParameterDeclaration, IrType>();
  /** File → qualifier prefix: "" for the entry, "%mI." otherwise. */
  readonly fileTag = new Map<ts.SourceFile, string>();
  /** Namespace ModuleBlocks this program lowers, filled by splitFiles:
   * "flattened" — an instantiated namespace whose body joined the file's
   * parts (members resolve statically); "typeOnly" — a skipped
   * non-instantiated one (its only value members are import= aliases,
   * still resolved statically). Ambient blocks never register — their
   * members keep the ReferenceError/fence paths (lower-namespaces.ts). */
  readonly nsBlocks = new Map<ts.Node, "flattened" | "typeOnly">();
  /** File → its %init function name, filled by prepareModuleInits before
   * any body lowers: import headers and inline require statements call
   * dependency inits by these names. */
  readonly initNameOf = new Map<ts.SourceFile, string>();
  /** File → the id of its run-once guard global (a bool module global,
   * false at program start). Every non-entry module gets one: its %init
   * may be called from several importers/requirers, and the guard is what
   * makes each call after the first a Node-style cache hit. The entry has
   * none — %main calls it exactly once (a dependency edge back to the
   * entry would be a fenced cycle). */
  readonly moduleGuardOf = new Map<ts.SourceFile, string>();
  /** Files whose module evaluation is asynchronous: direct top-level
   * await/for-await modules plus their static ESM importers. Their %init
   * bodies run on fibers and every async dependency edge awaits the
   * dependency promise before the importer body starts. Synchronous files
   * stay synchronous — adding even an already-settled await would insert
   * an observable microtask hop. */
  readonly asyncInitFiles = new Set<ts.SourceFile>();
  /** Async module → its cached evaluation-promise global. The emitted
   * spawn wrapper fills this on first evaluation and returns a retained
   * reference on cache hits, matching Node's one ModuleJob promise per
   * module even across diamonds and concurrent dynamic imports. */
  readonly modulePromiseOf = new Map<ts.SourceFile, string>();
  /** Async import-cycle member → the cycle's deterministic graph
   * representative. Used to recognize internal SCC edges; this is NOT
   * necessarily the runtime evaluation root, because a dynamically-only
   * cycle can first be entered through any member. */
  readonly asyncCycleRepresentativeOf = new Map<ts.SourceFile, ts.SourceFile>();
  /** Async import-cycle member → the shared completion-promise global for
   * its SCC. Every member's spawn wrapper temporarily publishes its own
   * promise while eager recursive evaluation unwinds; the outermost
   * wrapper (the member actually requested first at runtime) writes last
   * and therefore becomes the cycle's evaluation root. Dynamic imports
   * wait on this shared verdict rather than a build-time-selected member. */
  readonly asyncCyclePromiseOf = new Map<ts.SourceFile, string>();
  /** Record-shape interner: canonical (name-sorted) field list → shapeId.
   * Threaded into every mapType call; its `shapes` array becomes
   * IrModule.records. */
  readonly shapes = new ShapeRegistry();
  /** Union interner: canonical (typeKey-sorted) arm list → unionId.
   * Threaded into every mapType call; its `unions` array becomes
   * IrModule.unions. An arm's index in the canonical list is its runtime
   * tag. */
  readonly unions = new UnionRegistry();
  /** Every arm pair the runtime-keyed extraction admitted ONLY because a
   * string-literal discriminant separates it (runtimeKeyedUnionExtraction).
   * A union's literal table can still be ERASED after the fact -- a later
   * ts union with the same arms and no discriminant intersects it away --
   * and the extraction is already emitted by then, so the reliance is
   * re-checked once every union is final. It has never fired; it exists
   * because the alternative to firing is a mis-tagged value, which is
   * exactly what this gate was built to prevent. */
  readonly discrimRelied: { unionId: string; a: number; b: number }[] = [];
  /** Object literals that must build as DYN OBJECTS rather than at their
   * contextual type — the property-DESCRIPTOR map of
   * `Object.create(proto, descs)` and the descriptor objects inside it.
   *
   * The contextual type is the poison there: the library declares
   * `PropertyDescriptor.value?: any` and `get?(): any`, so a literal
   * built at the CONTEXT loses everything the literal knows and forces
   * every member through the engine boundary a static build does not
   * have (`{ value: function () {…} }` reports SC2011 on a `() => string`
   * that maps perfectly well). The literal's OWN type is strictly more
   * informative here, and a descriptor map is a checked-dynamic value by
   * construction — the runtime reads it key by key. Marked by the
   * lowering that knows the position, never inferred. */
  readonly dynObjectLiterals = new Set<ts.ObjectLiteralExpression>();
  /** Object literals whose destination SHAPE the lowering knows better than
   * the checker's contextual type does — an EMIT PAYLOAD, whose position in
   * the event's unified tuple is the type the registered listeners actually
   * receive.
   *
   * The contextual type is the poison here, for the same reason it is in
   * `dynObjectLiterals` one field up. A typed-events class declares the pair
   *
   *     emit<K extends keyof M>(event: K, payload: Parameters<M[K]>[0]): boolean
   *     emit(event: string, ...args: unknown[]): boolean
   *
   * and tsc contextually types the payload argument through the SECOND
   * overload — `unknown`. So a literal assembled out of an untyped emitter's
   * `any`-typed callback parameters (`this.raw.on('node_in', (node, frame) =>
   * this.emit('debug_transport_node_in', { node, frame }))`) has an
   * unmappable own type AND an unmappable context, and the last-resort type
   * fence fires with the context's word: "values of type 'unknown'".
   *
   * The emitter knows the answer. Its program-wide table already unified the
   * event's tuple from every listener the program registers, and the listener
   * is who receives this record. Building at the tuple position is therefore
   * neither a guess nor a widening: it is the declared type of the value's
   * one consumer, and each property coerces into its field exactly as a
   * hand-written `node as BinaryNode` would (the checked dyn extraction, not
   * a reinterpret). Consulted ONE STEP before the type fence, so no literal
   * that lowers today changes its answer. */
  readonly emitPayloadShapes = new Map<ts.ObjectLiteralExpression, IrType>();
  readonly ambient = ambientDtsPath();
  readonly overridesAmbient = overridesDtsPath();
  readonly fallbackAmbient = fallbackDtsPath();
  /** The one mapType context: registries + hooks, assembled in the
   * constructor (typeParamResolver reads the CURRENT instantiation bindings
   * through `this`, so the same ctx serves generic bodies too). */
  readonly typeCtx: TypeMapperCtx;

  readonly stats: LowerStats = {
    statementsTotal: 0,
    statementsFailed: 0,
    statementsIsland: 0,
    functionsSkipped: 0,
  };

  /** Discovery-pass edge sink (null in the emit pass): every resolution of
   * a reference to a lowerable body reports its name here — recorded even
   * when the enclosing statement later poisons. */
  onEdge: ((name: string) => void) | null = null;

  // Stack of function contexts (bottom = the function being declared at
  // top level, top = the innermost nested function currently lowering).
  fnStack: FnCtx[] = [];
  readonly liftedFns: IrFunction[] = [];
  lambdaCounter = 0;

  /** Statement lists currently mid-lowering, innermost last: the forward-
   * capture machinery (predeclareForwardCapture) needs to know which later
   * statements of an OPEN list a symbol's declaration sits in, which scope
   * frame list-level declarations register into, and where to insert the
   * scope-entry TDZ varDecl (before the statement being lowered). */
  readonly activeStmtLists: {
    stmts: readonly ts.Statement[];
    index: number;
    ctx: FnCtx;
    frame: Map<ts.Symbol, IrLocal>;
    out: IrStmt[];
  }[] = [];
  /** Forward-captured consts pre-declared as TDZ boxes, keyed by symbol:
   * lowerVarDecl consumes the entry when the source declaration arrives and
   * emits the initializing `assign` instead of a fresh declaration. */
  readonly tdzPredeclared = new Map<ts.Symbol, IrLocal>();
  /** Nested function DECLARATIONS lowered eagerly by the forward-hoisting
   * machinery (predeclareForwardFnDecl — a reference above the declaration
   * in the same function, JS's function hoisting): the statement loop skips
   * the source statement when it arrives. */
  readonly hoistedFnDecls = new Set<ts.FunctionDeclaration>();
  /** Comma expressions whose LEFT operand the statement loop already emitted
   * as its own statement (the granularity rule's sequence-assignment split —
   * `x = (a, b, v);` lowered as `a; b; x = v;` so each effect owns its poison
   * window). lowerBinary's value-position comma branch reads only the right
   * operand for these, because re-lowering the left would run the effect
   * TWICE. Registered and cleared around one statement. */
  readonly hoistedSeqEffects = new Set<ts.BinaryExpression>();
  /** Per-file `var` module globals whose type carries an undefined arm:
   * lowerFileInit assigns them the interned undefined right after the
   * run-once guard — JS hoists module vars to `undefined` at entry, so a
   * function called above the declaration statement reads that, never a
   * NULL slot. Filled by collectGlobals. */
  readonly varGlobalEntryInits = new Map<ts.SourceFile, IrGlobal[]>();
  /** Per-TWIN bridge assignments: a `.d.ts` export whose runtime value is
   * a PROPERTY of the object the twin whole-exports (`module.exports = j`).
   * lowerFileInit appends them to the twin's own init, after its body has
   * built the object. Filled by collectDeclTwinExportBridges. */
  readonly twinExportBridges = new Map<ts.SourceFile, { gid: string; root: IrGlobal; key: string }[]>();

  get ctx(): FnCtx {
    const top = this.fnStack[this.fnStack.length - 1];
    if (!top) throw new Error("lowerer bug: no active function context");
    return top;
  }

  get scopes(): Map<ts.Symbol, IrLocal>[] {
    return this.ctx.scopes;
  }

  /** Names of bodies the discovery pass reached; null lowers everything
   * (the discovery pass itself). */
  readonly reachable: ReadonlySet<string> | null;
  /** Coverage remainder mode: the reachability gate inverts (see wantBody)
   * and no module is built. */
  readonly remainder: boolean;
  /** Deferred collection diagnostics (failed signatures/class shapes) by
   * declaration symbol: an unreached declaration must not fail the build,
   * so its diagnostics wait until a reference makes them relevant. */
  readonly deferredDiags = new Map<ts.Symbol, ScrDiagnostic[]>();
  /** Deferred classes by qualified IR name — for flush sites that only
   * know the class name (typed receivers, module class retention). */
  readonly deferredClassByName = new Map<string, ts.Symbol>();
  /** Symbols whose deferred diagnostics THIS pass flushed (handed to the
   * coverage remainder as alreadyFlushed). */
  readonly flushedSymbols = new Set<ts.Symbol>();
  readonly alreadyFlushed: ReadonlySet<ts.Symbol>;
  /** The build's target platform ("win32" | "darwin" | "linux" | ...):
   * selects the platform-keyed builtin surfaces (builtinModuleFnsOf /
   * builtinModuleConstOf in surfaces.ts). */
  readonly targetPlatform: string;
  readonly bestEffort: boolean;
  /** LowererMode.startupCrash — buildMain opens %main with the throw. */
  readonly startupCrash: StartupCrash | null;
  /** Outbound native bindings by their source-level ambient name. */
  readonly ffiImports: readonly IrFfiImport[];
  readonly ffiImportsByName: ReadonlyMap<string, IrFfiImport>;
  /** Non-null after whole-program FFI declaration validation. */
  readonly ffiBindingSymbols: ReadonlyMap<string, ReadonlySet<ts.Symbol>> | null;
  /** Symbols a POISONED declaration statement would have bound: the
   * declaration's own diagnostic is already recorded, and no local/global
   * registered, so later references fall through every resolution step —
   * the fallthroughs report the inherited-blocker cascade (SC2004)
   * instead of misattributing the reference. */
  readonly blockedBindings = new Set<ts.Symbol>();
  /** True while collectProgram runs: resolution helpers must not flush
   * deferred diagnostics (collection itself resolves symbols — extends
   * clauses — and collection order must not decide what reports). */
  collecting = false;
  /** Non-null redirects pushDiag into a capture buffer (the deferred
   * collection wrapper). */
  diagSink: ScrDiagnostic[] | null = null;
  /** Diagnostics converted into runtimeFence statements (JS sources —
   * see lowerStmts): off the build, preserved here so coverage reporting
   * can still name every deferred fence. */
  readonly runtimeFences: ScrDiagnostic[] = [];
  /** ADVICE (the SC6xxx band) — the program compiled, and this says
   * something true about what it compiled to. A SEPARATE list, not a
   * severity filter over `diags`: every gate in this file that decides
   * fatality, deferral or poison-capture reads `this.diags.length`, and
   * a non-fatal member of that array would have to be excluded from each
   * of them correctly, forever. Here it cannot reach any of them. */
  readonly advisories: ScrDiagnostic[] = [];
  /** --provenance-sources: diagnostics of ELIDED pure-annotated dead
   * consts in fetched source modules (lowerStmts's elision rule) — off
   * the build entirely (the statement lowers to its poisoned bindings and
   * nothing throws), preserved for the coverage report's provenance
   * section. */
  readonly provenanceElided: ScrDiagnostic[] = [];
  /** --provenance-sources: per-file statement attribution (mirrors the
   * stats counters, keyed by fileName) so the coverage report can answer
   * "did the PACKAGE's statements compile static?" per provenance
   * package. Only populated while the registry is active; the remainder
   * pass skips it (attribution describes the build). */
  readonly statsByFile = new Map<string, { total: number; failed: number; island: number }>();

  /** Bumps the per-file attribution counter (no-op unless provenance is
   * active and this is the emit/discovery lane — mirror the CALLER's
   * suppressStats guard, this method only gates remainder). */
  bumpFileStat(file: string, kind: "total" | "failed" | "island"): void {
    if (this.remainder || !provenanceActive()) return;
    let s = this.statsByFile.get(file);
    if (!s) this.statsByFile.set(file, (s = { total: 0, failed: 0, island: 0 }));
    s[kind]++;
  }

  constructor(
    readonly program: ts.Program,
    readonly entry: ts.SourceFile,
    readonly moduleOrder: ts.SourceFile[],
    readonly dynamic: boolean,
    mode: LowererMode = {},
  ) {
    this.reachable = mode.reachable ?? null;
    this.remainder = mode.remainder ?? false;
    this.alreadyFlushed = mode.alreadyFlushed ?? new Set();
    this.targetPlatform = mode.targetPlatform ?? process.platform;
    this.bestEffort = mode.bestEffort ?? false;
    this.startupCrash = mode.startupCrash ?? null;
    this.ffiImports = mode.ffiImports ?? [];
    this.ffiImportsByName = new Map(this.ffiImports.map((entry) => [entry.name, entry]));
    this.ffiBindingSymbols = mode.ffiBindingSymbols ?? null;
    this.checker = program.getTypeChecker();
    this.typeCtx = {
      checker: this.checker,
      shapes: this.shapes,
      unions: this.unions,
      classNamer: this.classNamer,
      resolveTypeParam: this.typeParamResolver,
      resolveTypeParamTs: this.typeParamTsResolver,
      resolveSymbolic: this.symbolicTsResolver,
      genericClassInstance: (decl, ref) => this.genericClassInstanceType(decl, ref),
      mixinClassInstance: (decl) =>
        this.mixinTypeContext && this.mixinTypeContext.classNode === decl
          ? { kind: "object", className: this.mixinTypeContext.className }
          : null,
      mixinIntersectionInstance: (widened) => mixinIntersectionInstanceType(this, widened),
      isStdlibFile: this.isStdlibFile,
      isNpmFile: this.isNpmFile,
      dynamic: this.dynamic,
      // fileTag is filled just below; the hook is only ever CALLED during
      // lowering, long after the constructor completes.
      isProgramFile: (sf) => this.fileTag.has(sf),
      declFileHasCompiledImpl: (sf) => this.declTwinCompiled(sf),
      accessorProducerProp: (sym) => this.accessorProducerProp(sym),
    };
    // --dynamic: modules reachable only through dynamic import() joined
    // moduleOrder BEFORE any pass constructed — lowerToIr runs
    // appendDynamicImportModules once on the shared array (a per-pass run
    // here minted cycle refusals into the DISCOVERY pass, whose
    // diagnostics are discarded by design, and the extended order left
    // nothing for the emit pass to re-detect).
    this.moduleOrder.forEach((sf, i) => {
      this.fileTag.set(sf, sf === entry ? "" : `%m${i}.`);
    });
    if (this.moduleOrder.length === 0) this.fileTag.set(entry, "");
    this.registerBuiltinErrorClasses();
    registerBuiltinEmitterClass(this);
    registerBuiltinStreamClasses(this);
  }

  registerBuiltinErrorClasses(): void {
    return registerBuiltinErrorClasses(this);
  }

  builtinErrorInfoOf(symbol: ts.Symbol | null | undefined): ClassInfo | null {
    return builtinErrorInfoOf(this, symbol);
  }

  builtinEmitterInfoOf(symbol: ts.Symbol | null | undefined): ClassInfo | null {
    return builtinEmitterInfoOf(this, symbol);
  }

  builtinStreamInfoOf(symbol: ts.Symbol | null | undefined): ClassInfo | null {
    return builtinStreamInfoOf(this, symbol);
  }

  /** Program-wide qualified name for a top-level declaration. */
  qualify(sf: ts.SourceFile, name: string): string {
    return `${this.fileTag.get(sf) ?? ""}${name}`;
  }

  /** The IR name mapType gives class instance types — must agree with
   * collectClassShape's registration. Namespace-nested classes carry the
   * namespace path (nsPathPrefix), so `namespace A { export class C }`
   * and a top-level `class C` never collide. Class EXPRESSIONS name by
   * SOURCE POSITION (`%cx<start>.<name>`): deterministic across the
   * discovery and emit passes (no counter can drift between them),
   * program-unique through the file qualifier, and collision-free with
   * user identifiers ('%'). */
  readonly classNamer = (decl: ts.ClassLikeDeclaration): string =>
    ts.isClassExpression(decl)
      ? this.qualify(decl.getSourceFile(), `%cx${decl.getStart()}.${decl.name?.text ?? ""}`)
      : this.qualify(decl.getSourceFile(), nsPathPrefix(decl) + (decl.name ? decl.name.text : "%anon"));

  /** Follows import aliases to the original declaration's symbol. Every
   * value reference resolves through here, so it doubles as the flush
   * point for deferred collection diagnostics: resolving a reference to a
   * broken declaration reports what collection deferred. */
  resolveValueSymbol(ident: ts.Identifier): ts.Symbol | null {
    let symbol = this.checker.getSymbolAtLocation(ident);
    // A shorthand property's NAME resolves to the property symbol; the
    // VALUE binding it reads is the checker's shorthand-value symbol
    // (the option-object parsers lower `{ cwd }` through the identifier).
    if (ident.parent && ts.isShorthandPropertyAssignment(ident.parent) && ident.parent.name === ident) {
      symbol = this.checker.getShorthandAssignmentValueSymbol(ident.parent) ?? symbol;
    }
    // tsgo synthesizes no expando symbol at a CJS MEMBER-EXPORT use site
    // (`common.GREETING` where the exporter attached GREETING with
    // `module.exports.GREETING = ...` — 5.9.3 answered the expando
    // property symbol here), but the exporter's MODULE symbol still
    // carries the member in its exports table; resolve through it so both
    // ends of the export key one symbol identity, like 5.9.3's.
    if (!symbol && ident.parent && ts.isPropertyAccessExpression(ident.parent) && ident.parent.name === ident) {
      const recv = ident.parent.expression;
      if (ts.isIdentifier(recv) && this.cjsLocalModuleBindingOf(recv)) {
        const recvSym = this.checker.getSymbolAtLocation(recv);
        const recvDecls = recvSym ? this.checker.declarationsOf(recvSym) : [];
        const recvDecl = recvDecls.find(ts.isImportClause) ?? recvDecls[0];
        if (recvDecl && ts.isVariableDeclaration(recvDecl) && recvDecl.initializer) {
          const spec = requireSpecOf(recvDecl.initializer);
          const dep =
            spec === null
              ? null
              : isRelativeSpecifier(spec)
                ? resolveImport(this.program, recvDecl.getSourceFile(), spec)
                : npmStaticDepSf7(this.program, recvDecl.getSourceFile(), spec);
          if (dep) symbol = this.cjsModuleExportSymbol(dep, ident.text);
        } else if (recvDecl && ts.isImportClause(recvDecl)) {
          // The DEFAULT-import spelling of the same binding: the dep is
          // the import declaration's resolved CJS module.
          const dep = this.cjsDefaultImportDepOf(recvDecl);
          if (dep) symbol = this.cjsModuleExportSymbol(dep, ident.text);
        }
      }
    }
    if (!symbol) return null;
    // Bare references across MERGED-namespace blocks fence here (Node's
    // transform throws ReferenceError where tsc's emit would qualify —
    // lower-namespaces.ts); a no-op for programs without namespaces.
    fenceCrossBlockNsRef(this, ident, symbol);
    if (symbol.flags & ts.SymbolFlags.Alias) {
      // SNAPSHOT aliases own storage keyed by the PRE-alias symbol
      // (`import x = N.y` of a mutable target — collectGlobals): the
      // reference reads the snapshot, never the live target, exactly like
      // Node's emitted `var x = N.y`. Only those aliases register this
      // way; every other alias resolves through to its declaration.
      if (this.globalsBySymbol.has(symbol)) {
        this.flushDeferred(symbol);
        return symbol;
      }
      // DEFAULT-SNAPSHOT storage lives on the EXPORTER'S default alias
      // symbol (`export default someLet` — collectGlobals registers the
      // Node-semantics snapshot there). getAliasedSymbol would resolve
      // PAST it to the live let; walk the default-import hops and stop at
      // the first default symbol carrying storage instead.
      const snap = this.defaultSnapshotSymbolOf(symbol);
      if (snap) {
        this.flushDeferred(snap);
        return snap;
      }
      symbol = this.checker.getAliasedSymbol(symbol);
    }
    // CommonJS export plumbing: a binding that resolved to a PROPERTY of a
    // top-level `module.exports = { ... }` literal (shorthand, or a plain
    // identifier value — renames included) re-resolves to the local
    // declaration the property references. The export table is then pure
    // alias plumbing, exactly like an ESM export list: importers land on
    // the original function/const/class symbols and every existing
    // registry (globals, fn signatures, classes) applies unchanged.
    const cjsValue = this.cjsExportValueSymbol(symbol);
    if (cjsValue) symbol = cjsValue;
    this.flushDeferred(symbol);
    return symbol;
  }

  /** The default-snapshot storage symbol a DEFAULT-import alias chain
   * lands on, or null. A mutable entity-name default (`export default
   * someLet`) registers its Node-semantics snapshot global under the
   * exporter's default ALIAS symbol; the checker's getAliasedSymbol
   * resolves through that symbol to the live let, so this walk follows
   * the default hops syntactically — default import clauses, `{ default
   * as x }` specifiers, `export { default } from` re-exports — and stops
   * at the first default symbol carrying registered storage. Local
   * `export { x as default }` specifiers (no module specifier) are LIVE
   * bindings in Node and fall through to ordinary alias resolution. */
  private defaultSnapshotSymbolOf(alias: ts.Symbol): ts.Symbol | null {
    let sym: ts.Symbol | undefined = alias;
    for (let hop = 0; sym !== undefined && hop < 32; hop++) {
      if (hop > 0 && sym.flags & ts.SymbolFlags.Alias && this.globalsBySymbol.has(sym)) return sym;
      const d = this.checker
        .declarationsOf(sym)
        .find((x) => ts.isImportClause(x) || ts.isImportSpecifier(x) || ts.isExportSpecifier(x));
      let spec: ts.Expression | undefined;
      let name: string | undefined;
      if (d && ts.isImportClause(d) && ts.isImportDeclaration(d.parent)) {
        spec = d.parent.moduleSpecifier;
        name = "default";
      } else if (d && ts.isImportSpecifier(d)) {
        const idecl: ts.Node = d.parent.parent.parent;
        if (ts.isImportDeclaration(idecl)) spec = idecl.moduleSpecifier;
        name = (d.propertyName ?? d.name).text;
      } else if (d && ts.isExportSpecifier(d)) {
        const edecl: ts.Node = d.parent.parent;
        if (ts.isExportDeclaration(edecl)) spec = edecl.moduleSpecifier;
        name = (d.propertyName ?? d.name).text;
      }
      if (d === undefined || spec === undefined || !ts.isStringLiteral(spec) || name !== "default") return null;
      const dep = resolveImport(this.program, d.getSourceFile(), spec.text);
      if (!dep) return null;
      sym = defaultExportSymbolOf(this, dep) ?? undefined;
    }
    return null;
  }

  /** A module's CJS export-table member symbol by NAME (the checker's
   * module-symbol exports map — present in tsgo even where no expando
   * property symbol exists at the attachment/use sites). */
  cjsModuleExportSymbol(sf: ts.SourceFile, name: string): ts.Symbol | undefined {
    const moduleSym = this.checker.getSymbolAtLocation(sf);
    return moduleSym?.getExports().get(name as ts.__String);
  }

  /** The local VALUE symbol behind a CJS export-table property symbol —
   * see resolveValueSymbol. Null when `symbol` is not such a property (or
   * the property's value is not a plain identifier reference). */
  private cjsExportValueSymbol(symbol: ts.Symbol): ts.Symbol | null {
    const d = this.checker.declarationsOf(symbol)[0];
    if (!d) return null;
    // MEMBER-form class exports (`exports.C = C` — commander's error.js):
    // alias plumbing exactly like a table entry, so importers land on the
    // class declaration and the class registry applies unchanged (a class
    // VALUE global would fence — builtin-derived classes have no
    // first-class value form). Only CLASS targets re-resolve this way;
    // every other member export keeps its snapshot storage semantics.
    const memberClass = this.cjsMemberExportClassSymbol(d);
    if (memberClass) return memberClass;
    const isShorthand = ts.isShorthandPropertyAssignment(d);
    const isIdentProp = ts.isPropertyAssignment(d) && ts.isIdentifier(d.initializer);
    if (!isShorthand && !isIdentProp) return null;
    if (!ts.isObjectLiteralExpression(d.parent) || !isCjsExportTableLiteral(d.parent)) return null;
    let value = isShorthand
      ? this.checker.getShorthandAssignmentValueSymbol(d)
      : this.checker.getSymbolAtLocation((d as ts.PropertyAssignment).initializer as ts.Identifier);
    if (!value) return null;
    if (value.flags & ts.SymbolFlags.Alias) value = this.checker.getAliasedSymbol(value);
    return value;
  }

  /** The CLASS symbol a member-form CJS export declaration forwards to:
   * `d` (an export property symbol's declaration) sits in a top-level
   * `exports.C = <ident>` / `module.exports.C = <ident>` statement of a
   * JS module, the statement is not discarded by a later table, and the
   * identifier resolves to a class declaration. Null otherwise. */
  cjsMemberExportClassSymbol(d: ts.Node): ts.Symbol | null {
    const assign = ts.isBinaryExpression(d)
      ? d
      : ts.isPropertyAccessExpression(d) && d.parent !== undefined && ts.isBinaryExpression(d.parent)
        ? d.parent
        : null;
    if (!assign || assign.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
    if (!ts.isIdentifier(assign.right)) return null;
    const stmt = assign.parent;
    if (!stmt || !ts.isExpressionStatement(stmt) || !ts.isSourceFile(stmt.parent)) return null;
    if (!isJsSourceFile(stmt.parent)) return null;
    const cjs = cjsExportAssignmentOf(stmt);
    if (cjs?.kind !== "member" || cjs.expr !== assign) return null;
    if (cjsExportDiscardReason(stmt) !== null) return null;
    let value = this.checker.getSymbolAtLocation(assign.right);
    if (!value) return null;
    if (value.flags & ts.SymbolFlags.Alias) value = this.checker.getAliasedSymbol(value);
    const isClass = this.checker
      .declarationsOf(value)
      .some((decl) => ts.isClassDeclaration(decl));
    return isClass ? value : null;
  }

  /** The CommonJS JS module a DEFAULT-import binding's declaration loads
   * (`import d from "./lib.cjs"`), or null: Node's ESM-CJS interop binds
   * the default to module.exports — exactly a require binding — so those
   * bindings ride the CJS namespace machinery below. ESM dependencies
   * (any .ts, ESM-syntax .js/.mjs) answer null and keep the ESM default
   * machinery. */
  private cjsDefaultImportDepOf(clause: ts.ImportClause): ts.SourceFile | null {
    const importDecl = clause.parent;
    if (!ts.isImportDeclaration(importDecl) || !ts.isStringLiteral(importDecl.moduleSpecifier)) {
      return null;
    }
    const spec = importDecl.moduleSpecifier.text;
    // Bare specifiers resolve only for opted-in --npm-static packages —
    // their CJS entries take the same default-binding interop as a
    // relative require; every other bare import answers null and keeps
    // its own machinery.
    const dep = isRelativeSpecifier(spec)
      ? resolveImport(this.program, importDecl.getSourceFile(), spec)
      : npmStaticDepSf7(this.program, importDecl.getSourceFile(), spec);
    if (!dep || !isJsSourceFile(dep) || isNodeEsmFile(dep)) return null;
    return dep;
  }

  /** True when `expr` is an identifier bound by a top-level
   * `const x = require("./local")` of a RELATIVE module — the CommonJS
   * namespace binding — or of a bare specifier naming an opted-in
   * --npm-static package (its CJS entry is a program module, so the
   * binding is the same namespace over the same export table), or by a
   * DEFAULT import of a CommonJS JS module (`import d from "./lib.cjs"`:
   * Node binds d to module.exports, the same value require answers).
   * Member accesses on it resolve through the export table (property
   * symbols → resolveValueSymbol); the bare value keeps the
   * namespace-object fence, like ESM namespace imports of builtins. */
  cjsLocalModuleBindingOf(expr: ts.Expression): boolean {
    if (!ts.isIdentifier(expr)) return false;
    const sym = this.checker.getSymbolAtLocation(expr);
    const decls = sym ? this.checker.declarationsOf(sym) : [];
    const decl = decls.find(ts.isImportClause) ?? decls[0];
    if (!decl) return false;
    if (ts.isImportClause(decl)) {
      if (decl.name === undefined || this.cjsDefaultImportDepOf(decl) === null) return false;
    } else {
      if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !decl.initializer) {
        return false;
      }
      const spec = requireSpecOf(decl.initializer);
      if (spec === null) return false;
      if (
        !isRelativeSpecifier(spec) &&
        npmStaticDepSf7(this.program, decl.getSourceFile(), spec) === null
      ) {
        return false;
      }
    }
    // SINGLE-VALUE exporters (`module.exports = Countdown` / `= double` /
    // `= 42`): the requirer's binding IS the exported value, not a
    // namespace over an export table — the alias resolves straight to the
    // class/function/const declaration (or the scalar export= statement)
    // and every ordinary identifier path applies (new, calls, bare value).
    // Exported-const TABLES (a VariableDeclaration whose initializer is
    // the object literal) keep the namespace reading — member accesses
    // resolve through the table's property symbols.
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      const d = this.checker.declarationsOf(this.checker.getAliasedSymbol(sym))[0];
      if (d && (ts.isClassDeclaration(d) || ts.isFunctionDeclaration(d))) return false;
      if (d && ts.isVariableDeclaration(d)) {
        let init = d.initializer;
        while (init && ts.isParenthesizedExpression(init)) init = init.expression;
        if (!init || !ts.isObjectLiteralExpression(init)) return false;
      }
      // The scalar-literal export= symbol declares AT the `module.exports
      // =` statement itself; table/Proxy replacements share that
      // declaration node, so only scalar RHS reads as a single value.
      if (d && ts.isBinaryExpression(d)) {
        let r: ts.Expression = d.right;
        while (ts.isParenthesizedExpression(r)) r = r.expression;
        const scalar =
          ts.isNumericLiteral(r) || ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r) ||
          r.kind === ts.SyntaxKind.TrueKeyword || r.kind === ts.SyntaxKind.FalseKeyword ||
          (ts.isPrefixUnaryExpression(r) && r.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(r.operand));
        if (scalar) return false;
      }
    }
    return true;
  }

  /** Assignment-target resolution: a function local (possibly captured) or
   * a module global. tsc has already rejected writes to consts. */
  resolveWritable(ident: ts.Identifier): { id: string; type: IrType } | null {
    const local = this.resolveLocal(ident);
    if (local?.type.kind === "caught") {
      // tsc admits writes (the binding types as `unknown`), but the
      // snapshot is read-only by design — bind a new local instead.
      this.unsupported("SC1090", ident, "assignments to catch bindings");
    }
    if (local) return { id: local.id, type: local.type };
    const g = this.globalOf(ident);
    if (g) return { id: g.id, type: g.type };
    return null;
  }

  fnSigOf(ident: ts.Identifier): FnSig | null {
    const symbol = this.resolveValueSymbol(ident);
    return symbol ? (this.fnSigsBySymbol.get(symbol) ?? null) : null;
  }

  globalOf(ident: ts.Identifier): IrGlobal | null {
    const symbol = this.resolveValueSymbol(ident);
    if (!symbol) return null;
    const g = this.globalsBySymbol.get(symbol);
    if (g) return g;
    for (const d of this.checker.declarationsOf(symbol)) {
      const byDecl = this.globalsByDeclNode.get(d);
      if (byDecl) return byDecl;
    }
    // A `.d.ts`-declared binding whose RUNTIME lives in a compiled `.js`
    // twin (the WA spec tables: `export declare const WA_APPSTATE_SCHEMAS`
    // beside the `.js` that assigns it). The value resolved to the ambient
    // declaration, so neither lookup above hit — but the twin module
    // compiled the real global. Bridge by the export name to the twin's own
    // top-level binding.
    for (const d of this.checker.declarationsOf(symbol)) {
      const twin = this.declTwinSourceOf(d.getSourceFile());
      if (twin === null) continue;
      for (const stmt of twin.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const vd of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(vd.name) || vd.name.text !== symbol.name) continue;
          const twinSym = this.checker.getSymbolAtLocation(vd.name);
          const tg = (twinSym && this.globalsBySymbol.get(twinSym)) ?? this.globalsByDeclNode.get(vd);
          if (tg) return tg;
        }
      }
    }
    return null;
  }

  splitFiles(): FileParts[] {
    return splitFiles(this);
  }

  collectProgram(parts: FileParts[]): void {
    return collectProgram(this, parts);
  }

  /** Names every file's %init and registers the run-once guard globals
   * (EVERY module, the entry included: an admissible import cycle can
   * close back on the entry, whose init call must be the cache hit Node's
   * revisit is — not a recursion) BEFORE any body lowers: function bodies
   * and init bodies alike may contain require statements that lower to
   * calls of these names. Runs in every pass so the ids are
   * deterministic. */
  prepareModuleInits(parts: FileParts[]): void {
    parts.forEach((fp, i) => this.initNameOf.set(fp.sf, `%init.${i}`));
    for (const fp of parts) {
      const rawTag = this.fileTag.get(fp.sf) ?? "";
      const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
      // '%' cannot appear in a user identifier, so the id can never
      // collide with a collected module global of the same file.
      const id = `%g.${tag}%loaded`;
      this.moduleGuardOf.set(fp.sf, id);
      this.globalsList.push({ id, name: "%loaded", type: BOOL, mutable: true });
    }

    // A module is intrinsically async when an await/for-await occurs
    // outside every nested function-like boundary. Then propagate that
    // status backwards through STATIC ESM edges: Node does not start an
    // importer's body until each async dependency has completed. CJS
    // import/require edges deliberately do not propagate — Node refuses
    // require(esm) when the graph contains top-level await, and the call
    // sites below keep that as a named unsupported boundary.
    for (const fp of parts) {
      let found = false;
      ts.walkPreorder(fp.sf, (node) => {
        if (node !== fp.sf && ts.isFunctionLike(node)) return "skip";
        if (
          ts.isAwaitExpression(node) ||
          (ts.isForOfStatement(node) && node.awaitModifier !== undefined)
        ) {
          found = true;
          return "stop";
        }
        return undefined;
      });
      if (found) this.asyncInitFiles.add(fp.sf);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const fp of parts) {
        if (this.asyncInitFiles.has(fp.sf) || !isNodeEsmFile(fp.sf)) continue;
        if (orderedImportsOf(this.program, fp.sf).some(({ dep }) => dep !== null && this.asyncInitFiles.has(dep))) {
          this.asyncInitFiles.add(fp.sf);
          changed = true;
        }
      }
    }
    for (const fp of parts) {
      if (!this.asyncInitFiles.has(fp.sf)) continue;
      const rawTag = this.fileTag.get(fp.sf) ?? "";
      const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
      const id = `%g.${tag}%initPromise`;
      this.modulePromiseOf.set(fp.sf, id);
      this.globalsList.push({
        id,
        name: "%initPromise",
        type: { kind: "promise", inner: VOID },
        mutable: true,
      });
    }

    const orderIndex = new Map(parts.map((fp, i) => [fp.sf, i] as const));
    const partSet = new Set(parts.map((fp) => fp.sf));
    const staticDeps = (sf: ts.SourceFile): ts.SourceFile[] =>
      orderedImportsOf(this.program, sf)
        .map(({ dep }) => dep)
        .filter((dep): dep is ts.SourceFile => dep !== null && dep !== sf && partSet.has(dep));

    // Tarjan SCCs over the same static graph. The last postorder member is
    // a deterministic COMPONENT representative for internal-edge tests
    // and global naming. The runtime evaluation root can differ: a cycle
    // reached only through import() starts at whichever member is actually
    // requested first, not whichever import() site preflight discovered
    // first. The shared cycle-promise slot below is filled by the emitted
    // spawn wrappers so it records that runtime choice.
    let nextIndex = 0;
    const indexOf = new Map<ts.SourceFile, number>();
    const lowOf = new Map<ts.SourceFile, number>();
    const stack: ts.SourceFile[] = [];
    const onStack = new Set<ts.SourceFile>();
    const visit = (sf: ts.SourceFile): void => {
      const at = nextIndex++;
      indexOf.set(sf, at);
      lowOf.set(sf, at);
      stack.push(sf);
      onStack.add(sf);
      for (const dep of staticDeps(sf)) {
        if (!indexOf.has(dep)) {
          visit(dep);
          lowOf.set(sf, Math.min(lowOf.get(sf)!, lowOf.get(dep)!));
        } else if (onStack.has(dep)) {
          lowOf.set(sf, Math.min(lowOf.get(sf)!, indexOf.get(dep)!));
        }
      }
      if (lowOf.get(sf) !== indexOf.get(sf)) return;
      const component: ts.SourceFile[] = [];
      for (;;) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === sf) break;
      }
      if (component.length < 2 || !component.some((member) => this.asyncInitFiles.has(member))) return;
      const root = component.reduce((a, b) => orderIndex.get(a)! > orderIndex.get(b)! ? a : b);
      const rawTag = this.fileTag.get(root) ?? "";
      const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
      const cyclePromiseId = `%g.${tag}%cyclePromise`;
      this.globalsList.push({
        id: cyclePromiseId,
        name: "%cyclePromise",
        type: { kind: "promise", inner: VOID },
        mutable: true,
      });
      for (const member of component) {
        if (this.asyncInitFiles.has(member)) {
          this.asyncCycleRepresentativeOf.set(member, root);
          this.asyncCyclePromiseOf.set(member, cyclePromiseId);
        }
      }
    };
    for (const fp of parts) if (!indexOf.has(fp.sf)) visit(fp.sf);
  }

  /** The lowering of a CommonJS `require("./local")` occurrence: a call of
   * the required module's run-once %init at exactly this statement's
   * position — Node's inline evaluation, with the guard supplying the
   * cache-hit behavior for every require after the first. Bare specifiers
   * naming an opted-in --npm-static package resolve to that package's
   * program entry (the same edge preflight admitted — bundle dists require
   * their external dependencies by name). Null for everything else
   * (builtins load nothing; the rest kept its preflight fence). */
  requireInitStmt(spec: string, node: ts.Node): IrStmt | null {
    // Relative requires resolve within the program; a BARE require can be
    // a program-module edge too when it names an opted-in --npm-static
    // package (one package requiring another — the resolution answered
    // its shipped JS, the file is in the module order, and the reads
    // alias its globals). Without the guarded %init call at this position
    // those globals stay uninitialized: the dep's module body would never
    // run.
    const dep = isRelativeSpecifier(spec)
      ? resolveImport(this.program, node.getSourceFile(), spec)
      : npmStaticDepSf7(this.program, node.getSourceFile(), spec);
    if (!dep || dep.fileName.endsWith(".json")) return null;
    if (this.asyncInitFiles.has(dep)) {
      this.unsupported(
        "SC1090",
        node,
        `require() of '${spec}' (its ES-module graph uses top-level await; use import() instead)`,
      );
    }
    const initName = this.initNameOf.get(dep);
    if (initName === undefined) return null;
    const loc = locOf(node);
    return {
      kind: "exprStmt",
      expr: { kind: "call", callee: initName, args: [], type: VOID, loc },
      loc,
    };
  }

  /** True when this body should lower: everything with no reachable set
   * (discovery), the marked bodies in the emit pass, and exactly the
   * UNMARKED bodies in the coverage remainder. */
  wantBody(name: string): boolean {
    if (this.reachable === null) return true;
    return this.remainder ? !this.reachable.has(name) : this.reachable.has(name);
  }

  collectNpmImports(parts: FileParts[]): void {
    return collectNpmImports(this, parts);
  }

  collectJsonImports(parts: FileParts[]): void {
    return collectJsonImports(this, parts);
  }

  collectDeclTwinExportBridges(parts: FileParts[]): void {
    return collectDeclTwinExportBridges(this, parts);
  }

  collectJsonRequires(parts: FileParts[]): void {
    return collectJsonRequires(this, parts);
  }

  run(): LowerResult {
    const parts = this.splitFiles();
    this.collectProgram(parts);
    // Decorated classes analyze AFTER the whole collection pass: a
    // decorator's return type may name a subclass declared below the
    // class, and reference lowering needs each class's rebindability
    // (valueGlobalId) settled before any body lowers.
    for (const info of this.classes.values()) analyzeClassDecoration(this, info);
    this.prepareModuleInits(parts);

    const functions: IrFunction[] = [];
    for (const fp of parts) {
      for (const decl of fp.fnDecls) {
        // Overload signatures / ambient declarations are type-world (no
        // body to lower — and they share the implementation's symbol, so
        // counting them as skips would double-count the declaration).
        if (!decl.body) continue;
        // Generic functions have no body of their own: they are lowered
        // per-instantiation, on demand, from the worklist below.
        const declSymbol = declSymbolOf(this, decl);
        if (declSymbol && this.genericFnsBySymbol.has(declSymbol)) continue;
        // Mixin functions likewise: no signature, no body of their own —
        // calls instantiate the class inside per site (lower-mixins.ts).
        if (this.mixinFnShapes.get(decl)) continue;
        const sig = declSymbol ? this.fnSigsBySymbol.get(declSymbol) : undefined;
        // A body nothing reaches never lowers: its constructs can't fail
        // the build and it leaves no trace in the emitted C.
        if (sig && !this.wantBody(sig.name)) continue;
        const fn = this.lowerFunction(decl);
        if (fn) functions.push(fn);
        else if (this.countsSkips()) this.stats.functionsSkipped++;
      }
      for (const decl of fp.classDecls) {
        const info = this.classes.get(this.classNamer(decl));
        if (info) functions.push(...this.lowerClassMembers(info));
        else if (this.countsSkips()) this.stats.functionsSkipped++;
      }
    }

    // Each file's top-level statements form its run-once init function.
    // %main calls only the ENTRY's init: each init's hoisted import header
    // runs its dependencies (npm island loads at their import positions),
    // inline require statements call theirs mid-body, and the guards make
    // revisits cache hits — Node's evaluation order over the WHOLE graph
    // falls out of the nesting. The coverage remainder skips them — they
    // are reachable by definition, already counted by the emit pass.
    if (!this.remainder) {
      for (const fp of parts) {
        functions.push(this.lowerFileInit(fp.sf, fp.topStmts, this.initNameOf.get(fp.sf)!));
      }
      functions.push(this.buildMain());
    }
    // Class EXPRESSIONS collected while the inits lowered: their members
    // lower here, wantBody-gated like declaration members (nested class
    // expressions inside these bodies are fenced, so the list is stable).
    // Monomorphization worklists: every site above queued the generic
    // instances it needs — function instances (calls, pinned values) and
    // class instantiations (type references) — and lowering any instance
    // body can queue more of EITHER kind (generic functions constructing
    // generic classes, generic methods calling generic functions) — the
    // index loops run to the joint fixpoint. Same-key recursion re-uses
    // its own entry; polymorphic recursion is cut off by
    // MAX_GENERIC_INSTANCES.
    {
      let ec = 0;
      let gc = 0;
      let gi = 0;
      let es = 0;
      while (
        ec < this.exprClasses.length ||
        gc < this.genericClassInstances.length ||
        gi < this.instantiationQueue.length ||
        es < this.emitSpecQueue.length
      ) {
        while (ec < this.exprClasses.length) {
          functions.push(...this.lowerClassMembers(this.exprClasses[ec++]!));
        }
        while (gc < this.genericClassInstances.length) {
          functions.push(...this.lowerClassMembers(this.genericClassInstances[gc++]!));
        }
        while (gi < this.instantiationQueue.length) {
          const { info, inst } = this.instantiationQueue[gi++]!;
          // A body-level poison outside the per-statement catches (a
          // generic method's this/super fence, a fenced parameter
          // default): the diagnostic is recorded — the instance skips
          // like a signature-blocked function (lowerFunction's rule).
          try {
            functions.push(this.lowerGenericInstance(info, inst));
          } catch (e) {
            if (!(e instanceof PoisonError)) throw e;
          }
        }
        // Emit-override specializations queued by the emit sites above (a
        // body can queue more — the super-forward chain — and generic
        // instances of its own; the joint fixpoint covers both).
        while (es < this.emitSpecQueue.length) {
          try {
            const fn = lowerEmitOverrideSpec(this, this.emitSpecQueue[es++]!);
            if (fn) functions.push(fn);
          } catch (e) {
            if (!(e instanceof PoisonError)) throw e;
          }
        }
      }
    }
    // Lambdas lifted while lowering any of the above (plus synthetic
    // array-HOF loop functions, which ride the same list), and the
    // implicit-any instances lowered eagerly at their first call sites.
    functions.push(...this.liftedFns);
    functions.push(...this.implicitFns);

    // The deferred key-enumeration decision - after the whole walk, so a
    // construction anywhere in the program can reach a surface anywhere.
    this.reportKeyEnumerationRisks();

    if (this.remainder) {
      // Deferred collection diagnostics nothing flushed — declarations no
      // reference ever made relevant. They belong to the unreached group
      // (collection order keeps them deterministic).
      for (const [symbol, diags] of this.deferredDiags) {
        if (this.alreadyFlushed.has(symbol)) continue;
        for (const d of diags) this.pushDiag(d);
      }
      return {
        module: null,
        diagnostics: this.diags,
        runtimeFences: this.runtimeFences,
        advisories: this.advisories,
        stats: this.stats,
        ...(this.statsByFile.size > 0 ? { statsByFile: this.statsByFile } : {}),
        ...(this.provenanceElided.length > 0 ? { provenanceElided: this.provenanceElided } : {}),
        ...(this.npmBuiltins ? { npmBuiltins: this.npmBuiltins } : {}),
        ...(this.npmLazyTraps ? { npmLazyTraps: this.npmLazyTraps } : {}),
      };
    }

    // Globals typed by a class that never REGISTERED (a JS class whose
    // collection fenced — Symbol-keyed fields, an unsupported base): the
    // declaration statement and every use compiled to runtime fences, but
    // the collection-time global still carries the object type, and the
    // emitter would name a struct that does not exist — invalid C, the
    // compile-C escape family. The storage is dead by construction (the
    // initializing assign never lowered; reads cascade to their own
    // fences), so drop it — guarded by a reference scan, with the
    // validator's registration check as the backstop for anything that
    // does slip through with a live reference.
    const brokenGlobals = this.globalsList.filter((g) => this.typeNamesUnregisteredClass(g.type));
    const brokenLocalFns = functions.filter((fn) =>
      fn.locals.some((l) => this.typeNamesUnregisteredClass(l.type)),
    );
    if (brokenGlobals.length > 0 || brokenLocalFns.length > 0) {
      const referencedIn = (root: unknown): Set<string> => {
        const referenced = new Set<string>();
        const scan = (node: unknown): void => {
          if (node === null || typeof node !== "object") return;
          if (Array.isArray(node)) {
            for (const item of node) scan(item);
            return;
          }
          const rec = node as Record<string, unknown>;
          const id = rec["localId"];
          if (typeof id === "string") referenced.add(id);
          const catchId = rec["catchLocalId"];
          if (typeof catchId === "string") referenced.add(catchId);
          // Closure captures name their source locals as PLAIN STRINGS
          // (captures: string[]) — a captured broken-class local is live.
          if (rec["kind"] === "closure" && Array.isArray(rec["captures"])) {
            for (const c of rec["captures"]) if (typeof c === "string") referenced.add(c);
          }
          for (const key of Object.keys(rec)) scan(rec[key]);
        };
        scan(root);
        return referenced;
      };
      if (brokenGlobals.length > 0) {
        const referenced = referencedIn(functions);
        for (const g of brokenGlobals) {
          if (referenced.has(g.id)) continue; // live reference — validator reports
          const i = this.globalsList.indexOf(g);
          if (i >= 0) this.globalsList.splice(i, 1);
        }
      }
      // LOCALS left behind the same way (`const countdown = new Countdown(...)`
      // inside an init body whose declaration fenced): the emitter declares
      // every local at function top, so an unreferenced one typed by the
      // unregistered class is the identical invalid-C escape.
      for (const fn of brokenLocalFns) {
        // Params and captures list their locals by id too — never prune
        // those out from under them.
        const referenced = referencedIn([fn.body, fn.params, fn.captures ?? []]);
        fn.locals = fn.locals.filter(
          (l) => referenced.has(l.id) || !this.typeNamesUnregisteredClass(l.type),
        );
      }
    }

    // Computed before the module gate: retention resolves every class name
    // the emitted program references, flushing deferred class diagnostics
    // that a reached type makes relevant.
    const artifacts = this.moduleArtifacts(functions);
    // Types still naming a class that never REGISTERED after retention's
    // flush (JS graphs whose class fences deferred to runtime — the
    // sentence-walker's path params, printer tables whose func-typed
    // fields spell the fenced class): the emitter would name a struct
    // that does not exist — the compile-C escape family. No instance of
    // such a class can ever exist (every construction site fenced), so
    // the slots are inert by construction: rewrite each to the f64 dummy
    // placeholder (boxNewC's uncollected-class stance, applied to unboxed
    // slots), uniformly across params/locals/globals/fields/body types so
    // every producer and consumer agrees. Programs with no unregistered
    // reference are untouched — byte-stability holds.
    if (this.diags.length === 0) {
      this.sanitizeUnregisteredClassTypes([functions, this.globalsList, artifacts.classes, artifacts.records, artifacts.unions]);
    }
    // Every discriminant the extraction LEANED on, re-read now that no
    // union can change again (see discrimRelied).
    if (this.diags.length === 0) {
      for (const r of this.discrimRelied) {
        const def = this.unions.get(r.unionId);
        if (def === undefined || !discrimSeparates(def, r.a, r.b)) {
          throw new Error(
            `compiler bug: union ${r.unionId} lost the literal discriminant separating arms ` +
              `${String(r.a)} and ${String(r.b)} after a checked extraction was emitted against it`,
          );
        }
      }
    }
    const module: IrModule | null =
      this.diags.length > 0
        ? null
        : {
            irVersion: 3,
            sourceFile: this.entry.fileName,
            functions,
            classes: artifacts.classes,
            records: artifacts.records,
            unions: artifacts.unions,
            globals: this.globalsList,
            ...(this.npmEmbedded ? { embedded: this.npmEmbedded } : {}),
            entry: ENTRY_NAME,
            ...(this.ffiImports.length > 0 ? { ffiImports: [...this.ffiImports] } : {}),
          };
    return {
      module,
      diagnostics: this.diags,
      runtimeFences: this.runtimeFences,
      advisories: this.advisories,
      stats: this.stats,
      ...(this.statsByFile.size > 0 ? { statsByFile: this.statsByFile } : {}),
      ...(this.provenanceElided.length > 0 ? { provenanceElided: this.provenanceElided } : {}),
      ...(this.npmBuiltins ? { npmBuiltins: this.npmBuiltins } : {}),
      ...(this.npmLazyTraps ? { npmLazyTraps: this.npmLazyTraps } : {}),
    };
  }

  /** The unregistered-class type sweep (run()'s last step before the
   * module assembles): every `{kind:"object"}` TYPE naming a class with
   * no registered ClassInfo is rewritten IN PLACE to the f64 dummy.
   * classval types are exempt (they emit the class-independent
   * `ScrClassObj *` — inert-but-valid storage, the validator's own
   * stance), and only type objects rewrite — node-level classNames
   * (`new`, upcasts) cannot reach here (their lowerings fence without a
   * registered class), so the validator still backstops those. */
  sanitizeUnregisteredClassTypes(roots: unknown[]): void {
    const isUnregisteredObjectType = (v: unknown): boolean =>
      typeof v === "object" && v !== null &&
      (v as { kind?: unknown }).kind === "object" &&
      typeof (v as { className?: unknown }).className === "string" &&
      !this.classes.has((v as { className: string }).className);
    const sweep = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((item, i) => {
          if (isUnregisteredObjectType(item)) node[i] = F64;
          else sweep(item);
        });
        return;
      }
      const rec = node as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        if (key === "loc") continue;
        const v = rec[key];
        if (isUnregisteredObjectType(v)) rec[key] = F64;
        else sweep(v);
      }
    };
    for (const root of roots) sweep(root);
  }

  /** True when `t` (recursively) names a class instance type with no
   * registered ClassInfo — the shape of a JS class whose collection fenced.
   * Used by run()'s global pruning; shapes/unions recurse with a seen-set
   * (interned ids can nest). */
  typeNamesUnregisteredClass(t: IrType, seen: Set<string> = new Set()): boolean {
    switch (t.kind) {
      case "object":
        return !this.classes.has(t.className);
      case "array":
      case "set":
        return this.typeNamesUnregisteredClass(t.elem, seen);
      case "map":
        return (
          this.typeNamesUnregisteredClass(t.key, seen) ||
          this.typeNamesUnregisteredClass(t.value, seen)
        );
      case "promise":
        return this.typeNamesUnregisteredClass(t.inner, seen);
      case "func":
        return (
          t.params.some((p) => this.typeNamesUnregisteredClass(p, seen)) ||
          this.typeNamesUnregisteredClass(t.ret, seen)
        );
      case "record": {
        if (seen.has(t.shapeId)) return false;
        seen.add(t.shapeId);
        const shape = this.shapes.get(t.shapeId);
        if (!shape) return false;
        if (shape.indexValue && this.typeNamesUnregisteredClass(shape.indexValue, seen)) return true;
        return shape.fields.some((f) => this.typeNamesUnregisteredClass(f.type, seen));
      }
      case "union": {
        if (seen.has(t.unionId)) return false;
        seen.add(t.unionId);
        const def = this.unions.get(t.unionId);
        return !!def && def.arms.some((a) => this.typeNamesUnregisteredClass(a, seen));
      }
      default:
        return false;
    }
  }

  /** Whether run() counts a signature-blocked declaration in
   * stats.functionsSkipped: whole-program passes and the coverage
   * remainder do; the reachability emit pass leaves the counting to the
   * remainder (the declaration was never reached). */
  countsSkips(): boolean {
    return this.reachable === null || this.remainder;
  }

  /* ── reachability ─────────────────────────────────────────────────── */

  /** The discovery pass: computes the set of body names the program's entry
   * reaches. Seeds are the per-file init bodies (top-level statements always
   * run); edges fire from RESOLUTION sites while a body lowers (noteEdge /
   * noteVirtualEdge) — direct calls, closure creation (a taken closure may
   * be called indirectly), `new`, super calls, accessor invocations, and
   * virtual dispatch. Recording at resolution time (not off the produced
   * IR) keeps edges from statements that later poison, so the callee's own
   * diagnostics still surface — the collect-everything invariant. Generic
   * instances ride the existing monomorphization queue (already
   * demand-driven) and lifted lambdas lower inline with their enclosing
   * body; both fire edges through the same hooks and are not units
   * themselves. */
  discover(extraRoots?: readonly string[]): Set<string> {
    const parts = this.splitFiles();
    this.collectProgram(parts);
    // Decorated classes analyze post-collection here too: the %init seeds
    // lower the decoration calls, whose edges (decorator bodies, construct
    // thunks) the emit pass must see.
    for (const info of this.classes.values()) analyzeClassDecoration(this, info);
    this.prepareModuleInits(parts);

    // Every lowerable body, by emitted-function name. The names double as
    // the reachable-set keys the emit pass gates on — deterministic across
    // Lowerer instances by construction (qualified declaration names).
    const units = new Map<string, () => IrFunction | null>();
    for (const fp of parts) {
      for (const decl of fp.fnDecls) {
        // Overload signatures share the implementation's symbol (and so
        // its FnSig): only the with-body declaration is the unit, or the
        // signature's closure would shadow the implementation's.
        if (!decl.body) continue;
        const declSymbol = declSymbolOf(this, decl);
        if (!declSymbol || this.genericFnsBySymbol.has(declSymbol)) continue;
        const sig = this.fnSigsBySymbol.get(declSymbol);
        if (sig) units.set(sig.name, () => this.lowerFunction(decl));
      }
    }
    for (const info of this.classes.values()) {
      if (info.builtinError) continue; // runtime-provided; nothing lowers
      // Generic-class INSTANTIATIONS (and mixin instantiations) are
      // demand-driven, not units: their members lower unconditionally in
      // the instance drain below — the generic-fn instance rule.
      if (info.genericInstance || info.mixinInstance) continue;
      const cName = info.def.name;
      // A FAMILY has no constructor function and no instance members —
      // only its statics are units.
      if (!info.generic) {
        units.set(`%${cName}.constructor`, () => this.lowerClassCtor(info));
        for (const { mName, member } of this.classMethodMembers(info)) {
          units.set(`%${cName}.${mName}`, () => this.lowerClassMethodMember(info, member));
        }
        for (const prop of info.throwingSetters) {
          units.set(`%${cName}.set:${prop}`, () => this.throwingSetterFn(info, prop));
        }
      }
      for (const name of info.staticMethods?.keys() ?? []) {
        units.set(`%${cName}.static:${name}`, () => lowerStaticMethod(this, info, name));
      }
    }

    const reachable = new Set<string>();
    const queue: string[] = [];
    this.onEdge = (name: string): void => {
      if (reachable.has(name)) return;
      reachable.add(name);
      if (units.has(name)) queue.push(name);
    };
    // Class EXPRESSIONS collect while init bodies lower (below): their
    // member units register the moment collection finishes — before any
    // edge to them can fire (references require the collected class).
    this.onExprClassCollected = (info: ClassInfo): void => {
      const cName = info.def.name;
      units.set(`%${cName}.constructor`, () => this.lowerClassCtor(info));
      for (const { mName, member } of this.classMethodMembers(info)) {
        units.set(`%${cName}.${mName}`, () => this.lowerClassMethodMember(info, member));
      }
      for (const name of info.staticMethods?.keys() ?? []) {
        units.set(`%${cName}.static:${name}`, () => lowerStaticMethod(this, info, name));
      }
      for (const prop of info.throwingSetters) {
        units.set(`%${cName}.set:${prop}`, () => this.throwingSetterFn(info, prop));
      }
    };
    // Generic instances queued by the bodies above lower here (an instance
    // body fires edges of its own and can queue further instances of
    // either kind — function instances and class instantiations drain to
    // the joint fixpoint).
    let instLowered = 0;
    let clsInstLowered = 0;
    let specLowered = 0;
    const drainInstances = (): void => {
      while (
        instLowered < this.instantiationQueue.length ||
        clsInstLowered < this.genericClassInstances.length ||
        specLowered < this.emitSpecQueue.length
      ) {
        while (instLowered < this.instantiationQueue.length) {
          const { info, inst } = this.instantiationQueue[instLowered++]!;
          // Body-level poisons skip the instance here too (the emit pass
          // re-records the diagnostic; discovery only needs the edges the
          // body fired before poisoning).
          try {
            this.lowerGenericInstance(info, inst);
          } catch (e) {
            if (!(e instanceof PoisonError)) throw e;
          }
        }
        while (clsInstLowered < this.genericClassInstances.length) {
          this.lowerClassMembers(this.genericClassInstances[clsInstLowered++]!);
        }
        // Emit-override specialization bodies fire edges of their own
        // (the super-forward chain, closures, generic calls) — lower them
        // for discovery exactly like generic instances.
        while (specLowered < this.emitSpecQueue.length) {
          try {
            lowerEmitOverrideSpec(this, this.emitSpecQueue[specLowered++]!);
          } catch (e) {
            if (!(e instanceof PoisonError)) throw e;
          }
        }
      }
    };

    parts.forEach((fp) => {
      this.lowerFileInit(fp.sf, fp.topStmts, this.initNameOf.get(fp.sf)!);
      drainInstances();
    });
    // LIBRARY mode's extra reachability roots (LowerOptions.libRoots): the
    // profile-mapped exports are called from outside the graph, so they
    // seed the worklist beside the init bodies. Unknown names are inert
    // (the export-map resolution reports them as SC4002 later).
    for (const root of extraRoots ?? []) this.onEdge?.(root);
    while (queue.length > 0) {
      // A body-level poison outside the per-statement catches (a fenced
      // constructor/method parameter default lowered by declareParams):
      // discovery only needs the edges the body fired before poisoning —
      // the emit pass re-records the diagnostic and skips the member.
      try {
        units.get(queue.shift()!)!();
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
      }
      drainInstances();
    }
    return reachable;
  }

  /** Discovery hook (see discover): fires when lowering resolves a
   * reference to a lowerable body. Inert in the emit pass. */
  noteEdge(name: string): void {
    if (this.onEdge) this.onEdge(name);
  }

  /** Discovery hook for virtual dispatch: a virtualCall on `info`'s static
   * class reaches the nearest declaration at/above it plus every override
   * on a STRICT descendant (receivers of sibling branches can't flow into
   * this call site; a virtualCall through their own static classes marks
   * them). */
  noteVirtualEdge(info: ClassInfo, method: string): void {
    if (!this.onEdge) return;
    const above = this.findMethodOn(info, method);
    if (above) this.noteEdge(`%${above.declarer.def.name}.${method}`);
    const below = (c: ClassInfo): void => {
      for (const s of c.subclasses) {
        if (s.methods.has(method)) this.noteEdge(`%${s.def.name}.${method}`);
        below(s);
      }
    };
    below(info);
  }

  moduleArtifacts(functions: IrFunction[]): {
    classes: IrClassDef[];
    records: IrRecordShape[];
    unions: IrUnionDef[];
  } {
    return moduleArtifacts(this, functions);
  }

  /* ── diagnostics plumbing ─────────────────────────────────────────── */

  /** All diagnostics land here; while a generic instance body is lowering,
   * the instantiation context is appended so the user knows which concrete
   * types made the (source-anchored) construct fail. */
  pushDiag(diag: ScrDiagnostic): void {
    if (process.env["SCRIPTC_DIAG_STACK"] !== undefined) {
      console.error(`DIAGSTACK ${diag.code} ${String(diag.message).slice(0, 120)}\n` +
        (new Error().stack ?? "").split("\n").slice(1, 16).join("\n"));
    }
    const d = this.instantiationContext
      ? { ...diag, message: `${diag.message} (${this.instantiationContext})` }
      : diag;
    // Deferred collection: the wrapper decides whether these ever report
    // (a reference flushes them; unreferenced declarations stay silent in
    // builds and report under coverage's unreached group).
    if (this.diagSink) {
      this.diagSink.push(d);
      return;
    }
    // One site, one report: some declarations map a type twice (module
    // globals pre-register before their initializers lower) — an exact
    // duplicate (code + span + message) adds noise, not information.
    if (
      this.diags.some(
        (p) =>
          p.code === d.code &&
          p.loc.start === d.loc.start &&
          p.loc.end === d.loc.end &&
          p.message === d.message,
      )
    ) {
      return;
    }
    this.diags.push(d);
  }

  /** An SC6xxx advisory. Never fatal, never deferred, never spliced into
   * a runtime fence — it does not touch `diags`, so none of that
   * machinery can see it. Deduped on code + span like pushDiag, because
   * coverage lowers the unreached remainder in a second pass over the
   * same nodes and a doubled advice line reads as two sites. */
  pushAdvice(diag: ScrDiagnostic): void {
    if (
      this.advisories.some(
        (p) => p.code === diag.code && p.loc.start === diag.loc.start && p.loc.end === diag.loc.end,
      )
    ) {
      return;
    }
    this.advisories.push(diag);
  }

  /** KEY-ENUMERATION RISK - the record model's two silent wrong answers,
   * made loud. A record is a monomorphic struct with no per-instance key
   * list, so its own keys are its SHAPE's: `fields` for the set,
   * `declaredOrder` for the order. That is Node-exact only while the value
   * was BUILT that way, and three constructions are not:
   *   "set"   a width copy - or a spread doing width subtyping in spread
   *           clothing - into a narrower shape. JS's narrowed value is the
   *           SAME object and keeps the dropped keys; the struct copy ends
   *           them (docs/limitations, the width-copy stance).
   *   "order" a literal spelled in an order the shape does not carry.
   *           `declaredOrder` is the FIRST interned type's member order and
   *           is metadata rather than identity, so one shape serves several
   *           literal orders and keeps only the first.
   *   "dyn"   a checked cast materialising the shape out of a dynamic
   *           value, whose keys and their order are run-time facts.
   * The risk rides the VALUE, never the shape: a shape is shared by every
   * construction of its member set, so a shape-level test refuses the
   * programs that build it correctly too - tests/corpus/1555 and 2023 are
   * both such, and both keep compiling because of this. And only the
   * ENUMERATION is refused: reading a narrowed record's declared fields is
   * untouched, which is what tests/corpus/2026 has always relied on. */
  readonly keyRiskLiterals = new Map<string, { why: "set" | "order" | "dyn"; detail: string }>();
  readonly keyRiskHelpers = new Map<string, { why: "set" | "order" | "dyn"; detail: string }>();
  readonly keyRiskValues = new Map<string, { why: "set" | "order" | "dyn"; detail: string }>();

  /** Every place the program enumerates a record, decided in run().
   * Deferred because a surface can be lowered before the construction that
   * puts its value at risk (a literal inside a function declared further
   * down, a width copy in a later module) - an eager test would miss
   * exactly the programs that make the answer wrong. */
  readonly keyEnumUses: { ref: string | null; risk: { why: "set" | "order" | "dyn"; detail: string } | null; loc: SrcLoc; surface: string }[] = [];

  keyRiskLocKey(loc: SrcLoc): string {
    return `${loc.file}@${loc.start}`;
  }

  /** Local ids are per-FRAME (`${name}.${count}` off FnCtx.localCounters),
   * so two functions each declaring `narrow` both hold `narrow.0` and a
   * Lowerer-wide map would let one frame's risk refuse the other frame's
   * binding. Keys carry the frame. Globals (`%g.`-prefixed) are already
   * program-unique AND cross frames, so they must NOT be scoped. */
  private readonly keyRiskFrameIds = new WeakMap<object, number>();
  private keyRiskFrameNext = 0;

  keyRiskKey(localId: string): string {
    if (localId.startsWith("%g.")) return localId;
    const frame = this.ctx as unknown as object;
    let id = this.keyRiskFrameIds.get(frame);
    if (id === undefined) {
      id = this.keyRiskFrameNext++;
      this.keyRiskFrameIds.set(frame, id);
    }
    return `f${id}:${localId}`;
  }

  /** A record LITERAL the walk proved cannot enumerate Node-exactly. */
  noteKeyRiskLiteral(loc: SrcLoc, why: "set" | "order" | "dyn", detail: string): void {
    const k = this.keyRiskLocKey(loc);
    if (!this.keyRiskLiterals.has(k)) this.keyRiskLiterals.set(k, { why, detail });
  }

  /** The risk of the VALUE an expression produces, or null when the walk
   * cannot point at its construction (a parameter, a field read, a call
   * result). Null means SAY NOTHING: a refusal has to name the site that
   * makes the answer wrong, or it is refusing a program at random. */
  exprKeyRisk(e: IrExpr): { why: "set" | "order" | "dyn"; detail: string } | null {
    if (e.kind === "dynCheck") {
      // A cast to a UNION materialises exactly ONE arm (widest first, first
      // full match wins) and that arm alone, so every record arm carries the
      // same run-time fact.
      const shapeIds =
        e.type.kind === "record"
          ? [e.type.shapeId]
          : e.type.kind === "union"
            ? (this.unions.get(e.type.unionId)?.arms ?? []).flatMap((a) => (a.kind === "record" ? [a.shapeId] : []))
            : [];
      for (const id of shapeIds) {
        const sh = this.shapes.get(id);
        if (!sh || sh.tuple || sh.indexValue) continue;
        // One data field has one order; it is the ORDER that needs two.
        if (sh.fields.filter((f) => !f.name.startsWith("%")).length < 2) continue;
        return {
          why: "dyn",
          detail: `a checked cast materialises ${id} out of a dynamic value, whose own keys and their order are a run-time fact no struct carries`,
        };
      }
      return null;
    }
    if (e.kind === "call") return this.keyRiskHelpers.get(e.callee) ?? null;
    if (e.kind === "recordLit") return this.keyRiskLiterals.get(this.keyRiskLocKey(e.loc)) ?? null;
    if (e.kind === "varRef") return this.keyRiskValues.get(this.keyRiskKey(e.localId)) ?? null;
    return null;
  }

  /** A binding takes its initializer's risk: `const n: Narrow = wide` is
   * the whole of the drop in one line. */
  noteKeyRiskBinding(localId: string, init: IrExpr | null): void {
    if (!init) return;
    const r = this.exprKeyRisk(init);
    const k = this.keyRiskKey(localId);
    if (r && !this.keyRiskValues.has(k)) this.keyRiskValues.set(k, r);
  }

  /** Note that this expression's own keys are enumerated. */
  noteKeyEnumeration(value: IrExpr | null, loc: SrcLoc, surface: string): void {
    if (!value) return;
    if (value.kind === "varRef") {
      this.keyEnumUses.push({ ref: this.keyRiskKey(value.localId), risk: null, loc, surface });
      return;
    }
    const r = this.exprKeyRisk(value);
    if (r) this.keyEnumUses.push({ ref: null, risk: r, loc, surface });
  }

  /** run()'s deferred decision: enumerating a value the walk proved wrong
   * is REFUSED rather than answered wrongly. SCRIPTC_KEYRISK_WHY prints the
   * whole join instead of only the matches, so a program that is CLEAR can
   * be seen to be. */
  reportKeyEnumerationRisks(): void {
    const why = process.env["SCRIPTC_KEYRISK_WHY"] !== undefined;
    for (const u of this.keyEnumUses) {
      const risk = u.risk ?? (u.ref === null ? null : this.keyRiskValues.get(u.ref) ?? null);
      if (why) {
        console.error(
          `[keyrisk] ${u.loc.file}@${u.loc.start} ${u.surface} ${u.ref ?? "-"} ` +
            (risk ? `RISK-${risk.why} ${risk.detail}` : "ok"),
        );
      }
      if (!risk) continue;
      // The "dyn" half is ADVICE, not a refusal, and the reason is measured:
      // refusing it refuses `JSON.parse(s) as T` followed by
      // `JSON.stringify(t)` - seven of the first fifteen corpus programs
      // compiled, all of them green against Node. A cast whose source order
      // the compiler cannot see is POSSIBLY wrong; the other two halves are
      // provably wrong, so they refuse.
      if (risk.why === "dyn") {
        this.pushAdvice(keyOrderFromDynamicDiag(u.surface, risk.detail, u.loc));
        continue;
      }
      this.pushDiag(
        unsupportedDiag(
          "SC1090",
          u.loc,
          `${u.surface} over a record this program does not build the way its shape enumerates ` +
            (risk.why === "set"
              ? "(a width copy into the narrower shape ends the keys that shape does not name, and JS would keep them)"
              : "(a record enumerates in its shape declared order, not per-object insertion order)"),
          `${risk.detail} - read the fields you need instead of enumerating, or build the value the way the shape enumerates it`,
        ),
      );
    }
  }

  unsupported(
    code: keyof typeof UNSUPPORTED & `SC${number}`,
    node: ts.Node,
    featureOverride?: string,
    hintOverride?: string,
  ): never {
    this.pushDiag(unsupportedDiag(code, locOf(node), featureOverride, hintOverride));
    throw new PoisonError();
  }

  /** The dynamic-family fence for an OPERATION on an `any`-origin
   * checked-dynamic value that only the engine can execute (operators,
   * iteration, computed member names, ...). Carries SC2011 — the same
   * code as the `any` type fence — so the coverage report groups it with
   * the dynamic-capable family and the two-tier retry knows the island
   * lifts the site. Use exactly when the blocking operand IS dyn-typed
   * and its checker type is `any`-flavored; genuine `unknown` keeps the
   * SC1100-family fences (tsc constrains what unknown can do, so those
   * sites are checker-error territory, not engine territory). */
  anyOpFence(feature: string, node: ts.Node): never {
    this.pushDiag(anyOpRequiresDynamicDiag(feature, locOf(node)));
    throw new PoisonError();
  }

  /** True when this expression's CHECKER type is `any`-flavored — the
   * gate anyOpFence's call sites use to tell `any`-origin dyn values
   * (the engine could run the operation) from genuine `unknown` ones. */
  anyOrigin(node: ts.Node): boolean {
    return (this.typeOf(node).flags & ts.TypeFlags.Any) !== 0;
  }

  /** SCRIPTC_DYN_WHY (compiler-development probe): for every site that
   * reports the dynamic-family TYPE fence, print the site, the node kind,
   * the type, and the STATIC refusal chain that sent it here. The fence
   * message names only the outermost type, which is never the level worth
   * fixing; the chain is. The static answer is already in the memo as a
   * refusal by the time badType runs, so the re-walk turns the memo off
   * and the trace on. Diagnostic path only — the build has already failed
   * at this site, so nothing this costs lands in a compiling program. */
  private dynWhy(node: ts.Node, type: ts.Type, widened: ts.Type): void {
    if (!process.env.SCRIPTC_DYN_WHY) return;
    const loc = locOf(node);
    console.error(
      `DYNWHY ${loc.file}@${loc.start} kind=${ts.SyntaxKind[node.kind]} :: ${this.checker.typeToString(type).slice(0, 120)}`,
    );
    const frames = (new Error().stack ?? "")
      .split("\n")
      .slice(3, 8)
      .map((l) => l.trim().replace(/^at /, "").replace(/ \(.*/, ""))
      .join(" < ");
    console.error(`DYNWHY   from ${frames}`);
    const memoAnswer = mapType(widened, this.typeCtx);
    console.error(`DYNWHY   memo-answer=${memoAnswer ? typeKey(memoAnswer).slice(0, 90) : "null"}`);
    const prevTrace = process.env.SCRIPTC_MAP_TRACE;
    const prevMemo = process.env.SCRIPTC_NO_MEMO;
    process.env.SCRIPTC_MAP_TRACE = "1";
    process.env.SCRIPTC_NO_MEMO = "1";
    try {
      const fresh = mapType(widened, this.typeCtx);
      console.error(`DYNWHY   fresh-answer=${fresh ? typeKey(fresh).slice(0, 90) : "null"}`);
    } finally {
      if (prevTrace === undefined) delete process.env.SCRIPTC_MAP_TRACE;
      else process.env.SCRIPTC_MAP_TRACE = prevTrace;
      if (prevMemo === undefined) delete process.env.SCRIPTC_NO_MEMO;
      else process.env.SCRIPTC_NO_MEMO = prevMemo;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const recvT = mapType(this.typeOf(node.expression), this.typeCtx);
      let detail = recvT ? typeKey(recvT).slice(0, 60) : "null";
      if (recvT?.kind === "record") {
        const shape = this.shapes.get(recvT.shapeId);
        const f = shape?.fields.find((x) => x.name === node.name.text);
        detail += ` field ${node.name.text}=${f ? typeKey(f.type).slice(0, 70) : "ABSENT"}`;
        if (shape) detail += ` [shape fields: ${shape.fields.map((x) => x.name).join(",").slice(0, 120)}]`;
      }
      console.error(`DYNWHY   recv=${detail}`);
    }
  }

  /** SCRIPTC_TPARAM_WHY=1 — one stderr line per refusal whose blamed type is
   * an unresolved TYPE PARAMETER, naming the parameter, the syntactic form of
   * its constraint, whether that constraint is a CLOSED set of string
   * literals (the only shape a key-pinned widening could use), the
   * declaration that introduces it, and whether a binding was in scope.
   * Measurement only: without the variable nothing is written and no IR
   * changes. */
  tparamWhy(node: ts.Node, type: ts.Type): void {
    if (!process.env["SCRIPTC_TPARAM_WHY"]) return;
    if ((type.flags & ts.TypeFlags.TypeParameter) === 0) return;
    const sf = node.getSourceFile();
    const pos = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf));
    const parts = [`TPWHY ${this.checker.typeToString(type)} ${sf.fileName}:${pos.line + 1}`];
    const sym = type.getSymbol();
    const decl = sym === undefined ? undefined : this.checker.declarationsOf(sym)[0];
    if (decl === undefined || decl.kind !== ts.SyntaxKind.TypeParameter) {
      parts.push("decl=none");
      console.error(parts.join(" "));
      return;
    }
    const tp = decl as ts.TypeParameterDeclaration;
    const dsf = tp.getSourceFile();
    const dpos = ts.getLineAndCharacterOfPosition(dsf, tp.getStart(dsf));
    parts.push(`declAt=${dsf.fileName}:${dpos.line + 1}`);
    parts.push(`owner=${tp.parent === undefined ? "none" : ts.SyntaxKind[tp.parent.kind]}`);
    parts.push(`cnode=${tp.constraint === undefined ? "none" : ts.SyntaxKind[tp.constraint.kind]}`);
    let closed = "n";
    let card = "-";
    if (tp.constraint !== undefined) {
      try {
        const ct = this.checker.getTypeFromTypeNode(tp.constraint);
        const arms = ct.isUnionType() ? ct.getTypes() : [ct];
        card = String(arms.length);
        closed = arms.every((a) => a.isStringLiteralType()) ? "y" : "n";
        parts.push(`ctext=${this.checker.typeToString(ct).slice(0, 90)}`);
      } catch {
        parts.push("ctext=THREW");
      }
    }
    parts.push(`closedLits=${closed}`, `card=${card}`);
    parts.push(`bound=${this.typeParamResolver(type) ? "y" : "n"}`);
    parts.push(`boundTs=${this.typeParamTsResolver(type) ? "y" : "n"}`);
    parts.push(`node=${ts.SyntaxKind[node.kind]}`);
    console.error(parts.join(" "));
  }

  badType(node: ts.Node, type: ts.Type): never {
    this.tparamWhy(node, type);
    const widened = this.checker.getBaseTypeOfLiteralType(type);
    // Types declared by the ADOPTED @types/node (Buffer, NodeJS.Timeout,
    // the undici Response, ...) are supported-surface provenance, not npm
    // packages — their values never lower, so the honest blame is the
    // SC2020-family fence naming @types/node. Checked FIRST: Buffer has
    // an index signature and would otherwise get the misleading use-a-Map
    // hint below, and no user-side remedy the other messages suggest
    // applies to node-typed values.
    const typeSym = widened.getAliasSymbol() ?? widened.getSymbol();
    if (this.nodeTypesOnlySymbol(typeSym)) {
      this.pushDiag(noLoweringDiag(this.checker.typeToString(type), locOf(node), undefined, true));
      throw new PoisonError();
    }
    // Island-backed ambient TYPES (Response, AbortSignal, RequestInit) in a
    // STATIC build: the values live in the embedded engine, so the honest
    // story is the per-site SC2012 — the same one the fetch call itself
    // reports — not the generic supported-types recitation.
    if (
      !this.dynamic &&
      typeSym &&
      (ISLAND_AMBIENT_TYPES as readonly string[]).includes(typeSym.name) &&
      this.isStdlibSymbol(typeSym)
    ) {
      this.pushDiag(requiresDynamicApiDiag(`a value of type '${typeSym.name}'`, locOf(node)));
      throw new PoisonError();
    }
    // ENUM OBJECTS (`typeof e` — a numeric enum's type carries the
    // reverse-map index signature, a string enum's just its members):
    // shaped like a hybrid record, but the enum identifier has no value
    // lowering, so the honest fence names the construct in the same voice
    // as the per-site identifier fence — never the index-signature
    // recitation.
    if (typeSym && (typeSym.flags & ts.SymbolFlags.Enum) !== 0) {
      this.pushDiag(
        unsupportedDiag(
          "SC1090",
          locOf(node),
          `enum objects as values ('${typeSym.name}' — member reads like '${typeSym.name}.X' compile to constants; the object itself has no runtime representation)`,
        ),
      );
      throw new PoisonError();
    }
    // Would-be records with INDEX SIGNATURES (`Record<string, T>`,
    // `{ [k: string]: T }`) get the index-signature fence (SC2006) naming
    // the supported key/value domain instead of the generic
    // supported-types recitation.
    if (
      widened.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) &&
      this.checker.getCallSignatures(widened).length === 0 &&
      this.checker.getConstructSignatures(widened).length === 0 &&
      !this.checker.isTupleType(widened) &&
      !this.checker.isArrayLikeType(widened) &&
      this.checker.getIndexInfosOfType(widened).length > 0
    ) {
      // STANDARD-LIBRARY interface/class types that carry index signatures
      // (the typed arrays — Int8Array..Float16Array): the honest story is
      // the lib fence naming the type (SC2020 — only the supported surface
      // compiles), not a use-a-Map hint no user can act on. NOMINAL lib
      // declarations only: a lib-declared ALIAS or mapped type
      // (`Record<string, object>`) is still a data shape whose own story
      // (the value type, the key domain) the fences below tell better.
      const ownSym = widened.getSymbol();
      if (
        ownSym &&
        this.checker.declarationsOf(ownSym).some(
          (d) =>
            (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
            this.isStdlibFile(d.getSourceFile()),
        )
      ) {
        this.pushDiag(noLoweringDiag(this.checker.typeToString(type), locOf(node)));
        throw new PoisonError();
      }
      // The MEASURED island probe, same mechanism as the general dynamic
      // reroute below: an index-signature shape the dynamic mapping
      // accepts (an `any`-valued signature absorbing into an island
      // object, jsval-entangled members) reports the retry-eligible
      // SC2011 choice instead of the static recitation.
      if (
        !this.dynamic &&
        !(widened.flags & ts.TypeFlags.Any) &&
        mapType(widened, { ...this.typeCtx, dynamic: true }) !== null
      ) {
        this.dynWhy(node, type, widened);
        this.pushDiag(requiresDynamicTypeDiag(this.checker.typeToString(type), locOf(node)));
        throw new PoisonError();
      }
      this.pushDiag(indexSignatureTypeDiag(this.checker.typeToString(type), locOf(node)));
      throw new PoisonError();
    }
    // Package-declared types in a STATIC build: name the package, not the
    // type — the per-package requires-dynamic diagnostic (and the coverage
    // report's one-line-per-package attribution). Under --dynamic these
    // types map to jsval, so reaching here means the type is genuinely
    // unrepresentable (a jsval union arm, a jsval array element) — the
    // generic type message tells that story better.
    if (!this.dynamic) {
      const pkg = this.npmPackageOf(widened);
      if (pkg) {
        this.pushDiag(requiresDynamicPackageDiag(pkg, locOf(node)));
        throw new PoisonError();
      }
    }
    // A type that keeps a GENERIC call signature (`<T>(x: T) => T` slots,
    // stored generic functions, higher-order-generic call results): the
    // pointed monomorphization message instead of the recitation. Union
    // arms count — a `(<T>(x: T) => T) | undefined` slot is the same
    // story through its callable arm. After the package check: a
    // package-declared generic signature stays the package's story.
    {
      const parts = widened.isUnionType() ? widened.getTypes() : [widened];
      if (
        parts.some((p) =>
          this.checker.getCallSignatures(p).some((s) => (s.typeParameters?.length ?? 0) > 0),
        )
      ) {
        this.pushDiag(genericSignatureTypeDiag(this.checker.typeToString(type), locOf(node)));
        throw new PoisonError();
      }
    }
    // A type the DYNAMIC mapping accepts (`any[]`, records/functions with
    // `any`-typed members, .d.ts-declared shapes whose values are island
    // handles): the honest per-site story is the dynamic-family choice, not
    // the supported-types recitation — proved by re-running mapType with
    // `dynamic: true`, never guessed from the type text. Probing is safe
    // here: a diagnostic means this build already failed, so anything the
    // probe interns or registers on the way is never emitted. Checked LAST
    // so every more specific story above (island ambients, index
    // signatures, per-package attribution, generic signatures) keeps its
    // own fence class. Bare `any` is excepted: unsupportedTypeDiag's own
    // SC2011 arm tells that story with the stronger stay-static remedy
    // ('unknown' + a checked cast).
    if (
      !this.dynamic &&
      !(widened.flags & ts.TypeFlags.Any) &&
      // BOTH halves of the message are claims, so BOTH are measured. The
      // dynamic probe alone only proves the second ("runs in the engine");
      // the first ("has no static representation") is about THIS build,
      // and badType is reached by callers that refused for reasons of
      // their own — a construct the lowering cannot build out of a type
      // that maps perfectly well. Without this probe such a site reports
      // a type fence twice over false: the static mapping ANSWERS (an
      // object literal against a union-typed slot maps to that union),
      // and --dynamic does not run it either (the same refusal reports
      // SC2001 there), so the hint sends the user to a build that fails
      // the same way. Measured on zapo: three sites, all object literals
      // whose contextual union maps, all reported as dynamic-capable in
      // the coverage report and none of them dynamic-capable in fact.
      mapType(widened, this.typeCtx) === null &&
      mapType(widened, { ...this.typeCtx, dynamic: true }) !== null
    ) {
      this.dynWhy(node, type, widened);
      this.pushDiag(requiresDynamicTypeDiag(this.checker.typeToString(type), locOf(node)));
      throw new PoisonError();
    }
    // STANDARD-LIBRARY nominal provenance, decided once: interface/class
    // declarations in the lib's own files (Date, ArrayBuffer, WeakMap, the
    // iterator/constructor interfaces). Such types report the SC2020 story
    // below — the same one the index-signature-carrying lib types above
    // tell — rather than an overload/record claim no user can act on.
    const stdlibOwnSym = widened.getSymbol();
    const stdlibNominal =
      stdlibOwnSym !== undefined &&
      this.checker.declarationsOf(stdlibOwnSym).some(
        (d) =>
          (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
          this.isStdlibFile(d.getSourceFile()),
      );
    // OVERLOADED call signatures (SC2007) — after the generic branch, so a
    // generic overload set keeps the monomorphization story: a value of a
    // multi-signature type has no single compiled signature to hold.
    if (!stdlibNominal && this.checker.getCallSignatures(widened).length > 1) {
      this.pushDiag(overloadedSignatureTypeDiag(this.checker.typeToString(type), locOf(node)));
      throw new PoisonError();
    }
    // INTERSECTIONS that resolved to no lowering (SC2008). The ones that
    // compile never get here: member intersections intern through the
    // record path, callable hybrids map to '%call' records, and pinned
    // mixin instantiations resolve by chain structure.
    if (widened.isIntersectionType()) {
      this.pushDiag(intersectionTypeDiag(this.checker.typeToString(type), locOf(node)));
      throw new PoisonError();
    }
    // SUPPORTED shapes over a component outside its slot (SC2009): the
    // Map/Set domains, array/tuple elements, union arms, function
    // parameters/returns. The container is not the blocker — name the
    // component instead of reciting the supported set. Checked BEFORE the
    // lib claim so Map/Set/Promise instantiation failures keep their
    // component story (describeComponentBlocker always answers for those
    // heads).
    {
      const detail = describeComponentBlocker(widened, this.typeCtx);
      if (detail !== null) {
        this.pushDiag(componentTypeDiag(this.checker.typeToString(type), detail, locOf(node)));
        throw new PoisonError();
      }
    }
    // STANDARD-LIBRARY nominal types with no lowering at all: the SC2020
    // story, naming the type — and for the families with a WHY, the same
    // pointed reason the identifier/constructor chokepoints teach.
    if (stdlibNominal) {
      const intlHint =
        "Intl formatter values have no representation — the COMPOSED en-US forms lower: " +
        'new Intl.NumberFormat("en-US").format(x) and x.toLocaleString("en-US") with default options; ' +
        "the rest is ICU locale data the binary does not carry";
      const typeHints: Record<string, string | undefined> = {
        ArrayBuffer:
          "no free-standing ArrayBuffer value exists — typed arrays own their storage " +
          "(new Uint8Array(n) allocates; new Uint8Array(new ArrayBuffer(n)) erases the buffer into the view)",
        SharedArrayBuffer:
          "no shared-memory threads exist in a compiled program — Uint8Array is the byte storage",
        NumberFormat: intlHint,
        DateTimeFormat: intlHint,
        DurationFormat: intlHint,
        PluralRules: intlHint,
        Collator: intlHint,
        ListFormat: intlHint,
        RelativeTimeFormat: intlHint,
        Segmenter: intlHint,
        DisplayNames: intlHint,
      };
      this.pushDiag(
        noLoweringDiag(this.checker.typeToString(type), locOf(node), typeHints[stdlibOwnSym?.name ?? ""]),
      );
      throw new PoisonError();
    }
    // USER record shapes blocked by ONE member (SC2009's record arm):
    // name the member and its type.
    {
      const detail = describeRecordMemberBlocker(widened, this.typeCtx);
      if (detail !== null) {
        this.pushDiag(componentTypeDiag(this.checker.typeToString(type), detail, locOf(node)));
        throw new PoisonError();
      }
    }
    this.pushDiag(unsupportedTypeDiag(this.checker.typeToString(type), locOf(node)));
    throw new PoisonError();
  }

  /** The lib fence (SC2020): a reached use of standard-library surface
   * nothing lowers. Poisons the statement like every other rejection.
   * `sym`, when given, picks the wording: surface declared only by the
   * adopted @types/node is blamed at @types/node. */
  noLowering(surface: string, node: ts.Node, hint?: string, sym?: ts.Symbol | null): never {
    this.pushDiag(noLoweringDiag(surface, locOf(node), hint, this.nodeTypesOnlySymbol(sym)));
    throw new PoisonError();
  }

  stdlibMemberFence(access: ts.PropertyAccessExpression): void {
    return stdlibMemberFence(this, access);
  }

  /** Is `node` an identifier bound, without a type annotation, straight
   * to `Error.prototype`? The binding then holds the checked-dynamic
   * singleton, not an %Error struct — see typeOf. A binding with an
   * explicit `: Error` annotation is NOT this: the program asked for the
   * struct, and it keeps the dynCheck that refuses to fake one. */
  /** ...and the same question for `Uint8Array.prototype`. Split from
   * errorProtoBinding rather than parameterised because the two differ
   * in the ONE place that matters: the checker type to test for before
   * asking (`Error` there, `Uint8Array` here), and a shared helper that
   * takes both would be read as claiming they are interchangeable. */
  u8ProtoBinding(node: ts.Identifier): boolean {
    const sym = this.checker.getSymbolAtLocation(node);
    if (sym === undefined) return false;
    const decls = this.checker.declarationsOf(sym);
    if (decls.length !== 1) return false;
    const decl = decls[0]!;
    if (!ts.isVariableDeclaration(decl) || decl.type !== undefined) return false;
    let init: ts.Expression | undefined = decl.initializer;
    while (init !== undefined && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init))) {
      init = init.expression;
    }
    return (
      init !== undefined &&
      ts.isPropertyAccessExpression(init) &&
      init.name.text === "prototype" &&
      stdlibGlobalMember(this, init, "Uint8Array") === "prototype"
    );
  }

  errorProtoBinding(node: ts.Identifier): boolean {
    const sym = this.checker.getSymbolAtLocation(node);
    if (sym === undefined) return false;
    const decls = this.checker.declarationsOf(sym);
    if (decls.length !== 1) return false;
    const decl = decls[0]!;
    if (!ts.isVariableDeclaration(decl) || decl.type !== undefined) return false;
    let init: ts.Expression | undefined = decl.initializer;
    while (init !== undefined && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init))) {
      init = init.expression;
    }
    return (
      init !== undefined &&
      ts.isPropertyAccessExpression(init) &&
      init.name.text === "prototype" &&
      stdlibGlobalMember(this, init, "Error") === "prototype"
    );
  }

  typeOf(node: ts.Node): ts.Type {
    // Inside an optional-chain body the guarded receiver is typed by its
    // NON-NULLISH type (the chain's tag test proved it), so every
    // receiver-kind check downstream sees the narrowed arm.
    const narrowed = this.chainNarrowedType.get(node);
    if (narrowed) return narrowed;
    // `Error.prototype` is the ONE standard-library prototype object this
    // compiler holds as a value (lowerErrorPrototypeProperty), and it is a
    // CHECKED-DYNAMIC one. tsc types the expression `Error` — that is how
    // the lib declares `ErrorConstructor.prototype` — and every consumer
    // that believed it would be wrong in the same way: a var bound to it
    // would want an %Error struct, `Error.prototype.name` would build a
    // fieldGet over a dyn receiver (an ICE), and maybeNarrow would insert
    // a %Error dynCheck that rebuilds a COPY and loses the identity the
    // prototype link depends on. Node's Error.prototype is not an Error
    // instance at all (`Error.prototype instanceof Error` is false — no
    // [[ErrorData]]); it is an ordinary object. Answering `unknown` HERE,
    // at the one place every consumer asks, is what keeps them agreeing:
    // the keyed read, typeof, ===, String() and the Object.create argument
    // all take their checked-dynamic paths without a special case each.
    if (
      !this.dynamic &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "prototype" &&
      (stdlibGlobalMember(this, node, "Error") === "prototype" ||
        // The same, for %Uint8Array.prototype% — tsc types it
        // `Uint8Array`, which would put a %bytes dynCheck between every
        // consumer and an object that is not a typed array in Node
        // either.
        stdlibGlobalMember(this, node, "Uint8Array") === "prototype")
    ) {
      return this.checker.getUnknownType();
    }
    // `Uint8Array.from` / `Uint8Array.of` (lowerUint8ArrayStaticProperty)
    // are the same story one member over: the value is a RUNTIME function
    // object, and tsc types them as generic callable members. Believing
    // that type would put a compiled-closure dynCheck between every
    // consumer and a box that is not a compiled closure — the shape
    // `e.allocUnsafe` already fails on ("expected function at $, got
    // undefined"). `unknown` is the honest type: a checked-dynamic value
    // whose typeof, ===, String() and call all take the dyn paths.
    if (
      !this.dynamic &&
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "from" || node.name.text === "of") &&
      stdlibGlobalMember(this, node, "Uint8Array") === node.name.text
    ) {
      return this.checker.getUnknownType();
    }
    // ...and so does a BINDING initialized from it (`var P =
    // Error.prototype`, the shape a reader writes first). tsc infers the
    // binding's type from the initializer, so it would be `Error` and the
    // local would be an %Error struct fed by a dynCheck that throws
    // "expected Error, got object" on the one value that IS right. The
    // test costs nothing on the hot path: it runs only for an identifier
    // the checker already types Error.
    if (ts.isIdentifier(node) && !this.dynamic) {
      const t0 = this.checker.getTypeAtLocation(node);
      if (t0.getSymbol()?.name === "Error" && this.errorProtoBinding(node)) {
        return this.checker.getUnknownType();
      }
      // `var P = Uint8Array.prototype` is the same trap one constructor
      // over, and a LOUDER one: tsc types `Uint8ArrayConstructor
      // .prototype` as `Uint8Array`, so the binding wanted a %bytes
      // local fed by a dynCheck, and the dynCheck threw "expected
      // Uint8Array at $, got object" on the one value that IS right.
      // Node's Uint8Array.prototype is not a typed array either (it has
      // no [[TypedArrayName]] — reading its own `.length` THROWS there),
      // so `unknown` is not a concession, it is the honest type.
      if (t0.getSymbol()?.name === "Uint8Array" && this.u8ProtoBinding(node)) {
        return this.checker.getUnknownType();
      }
    }
    const t = this.checker.getTypeAtLocation(node);
    // ALIASED-TYPEOF narrowing: inside a branch a `type === 'string'`
    // test proves (type = typeof val, both never reassigned), references
    // to the tested operand answer the proven arm — the var/let alias
    // form the checker only narrows for consts. Checked before the
    // implicit-param hook: a branch narrow is strictly more specific
    // than a call-site binding.
    if (this.aliasNarrowTypes.size > 0 && ts.isIdentifier(node)) {
      const sym = this.checker.getSymbolAtLocation(node);
      const arm = sym !== undefined ? this.aliasNarrowTypes.get(sym) : undefined;
      if (arm !== undefined) return arm;
    }
    // IMPLICIT-ANY instance bodies: an identifier reference to a BOUND
    // param answers the call site's concrete type wherever the checker
    // still says `any` (there is no `T` for mapType to substitute — the
    // binding rides here instead). Where tsc's own flow analysis DID
    // narrow the `any` (typeof/instanceof guards), a narrow CONSISTENT
    // with the binding wins — it IS the binding, an arm of it, or a
    // subclass; a CONTRADICTING narrow is the statically-dead branch of a
    // typeof dispatch this instantiation cannot take, and answering the
    // bound type there keeps dead branches on honest fences instead of
    // lowering the live value under a lying type.
    if (this.implicitParamTypes !== null && ts.isIdentifier(node)) {
      const sym = this.checker.getSymbolAtLocation(node);
      const bound = sym !== undefined ? this.implicitParamTypes.get(sym) : undefined;
      if (bound !== undefined && bound !== t) {
        if (t.flags & ts.TypeFlags.Any) return bound;
        const narrowedIr = this.mapTypeOf(t);
        const boundIr = this.mapTypeOf(bound);
        if (narrowedIr === null || boundIr === null) return bound;
        if (typeEquals(narrowedIr, boundIr)) return t;
        // A union binding narrowed to one of its arms (typeof/equality
        // guards over string|number bindings) — the narrow is truth.
        if (boundIr.kind === "union") {
          const arms = this.unions.get(boundIr.unionId)?.arms ?? [];
          const nArms =
            narrowedIr.kind === "union" ? (this.unions.get(narrowedIr.unionId)?.arms ?? [narrowedIr]) : [narrowedIr];
          if (nArms.every((n) => arms.some((a) => typeEquals(a, n)))) return t;
          return bound;
        }
        // An instanceof narrow to a SUBCLASS of the bound class — truth.
        if (
          boundIr.kind === "object" && narrowedIr.kind === "object" &&
          this.isSubclassOf(narrowedIr.className, boundIr.className)
        ) {
          return t;
        }
        return bound;
      }
    }
    return t;
  }

  /** mapType with this Lowerer's registries and (while a generic instance
   * body lowers) type-parameter bindings threaded through. */
  mapTypeOf(t: ts.Type): IrType | null {
    return mapType(t, this.typeCtx);
  }

  /** The one position where a contextual UNION must not be adopted over the
   * expression's own: the LEFT operand of `&&`, `||`, or `??`. Adopting a
   * contextual union is normally safe because tsc proved the value
   * assignable to the slot; that proof does not exist here, because tsc
   * builds a logical operator's result by DROPPING the left's falsy (or
   * nullish) arms. `const s: string | null = (c ? env : undefined) || null`
   * contextually types the ternary `string | null` while its value is
   * `string | undefined` — adopting that strands the very arm the operator
   * exists to answer, throwing where Node yields the default. Such operands
   * represent by their own union; the operator's own lowering re-tags on
   * the branch where the dropped arms are gone. Narrow by design: only the
   * union choice is unsound here. A contextual ARRAY still types the
   * element, and an unmappable own type still falls back to the context. */
  inLogicalLeftPosition(node: ts.Expression): boolean {
    let n: ts.Node = node;
    while (n.parent && ts.isParenthesizedExpression(n.parent)) n = n.parent;
    const p = n.parent;
    if (!p || !ts.isBinaryExpression(p) || p.left !== n) return false;
    const k = p.operatorToken.kind;
    return (
      k === ts.SyntaxKind.AmpersandAmpersandToken ||
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken
    );
  }

  /** True when a ?. token blocks this lowering — i.e. it is NOT the one an
   * active optional-chain lowering is currently handling. Every receiver-
   * typed lowering that supports chained receivers guards with this
   * instead of a raw questionDotToken check. */
  chainBlocked(
    ...nodes: (ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression)[]
  ): boolean {
    return nodes.some((n) => n.questionDotToken !== undefined && !this.chainHandled.has(n));
  }

  /** True when `node` is lowering INSIDE the body of an optional chain
   * its OWN receiver spine entered — either because it carries the
   * chain's `?.` itself (the `a?.m()` re-dispatch) or because the token
   * sits deeper in the spine and the chain claimed the whole tail
   * (`a?.b().c()`). Spine-only: an argument's own nested chain is not
   * this node's. */
  inChainBody(node: ts.Expression): boolean {
    let cur: ts.Expression = node;
    for (;;) {
      // The chain's bound receiver read is a LEAF — its token was
      // consumed by the chain that bound it.
      if (this.chainRecvByNode.has(cur)) return false;
      if (this.chainHandled.has(cur)) return true;
      if (
        ts.isCallExpression(cur) ||
        ts.isPropertyAccessExpression(cur) ||
        ts.isElementAccessExpression(cur) ||
        ts.isParenthesizedExpression(cur) ||
        ts.isNonNullExpression(cur)
      ) {
        cur = cur.expression;
        continue;
      }
      return false;
    }
  }

  /** The checker type of `node` as THIS node alone produces it. Inside a
   * chain body the checker folds the guard's undefined into every step's
   * type — that arm is the GUARD's, and finishOptionalChain adds it back
   * around the whole body — so a lowering reading its own result type off
   * the checker must strip it here or it asks for a union the operation
   * never produces. Outside a chain this is typeOf unchanged. */
  chainResultType(node: ts.Expression): ts.Type {
    const t = this.typeOf(node);
    return this.inChainBody(node) ? this.checker.getNonNullableType(t) : t;
  }

  /** formatIrType with this Lowerer's registries (records and unions expand
   * to their structure in diagnostics). */
  fmt(t: IrType): string {
    return formatIrType(t, this.shapes, this.unions);
  }

  /** isJsonSafeType with this Lowerer's registries — the shared fence for
   * what JSON.stringify accepts and what a checked cast can validate. */
  jsonSafe(t: IrType): boolean {
    return isJsonSafeType(
      t,
      (id) => this.shapes.get(id),
      (id) => this.unions.get(id),
    );
  }

  /** True when a type is a BARE undefined-armed union — the one JSON-unsafe
   * shape whose rejections deserve their own wording: Node's stringify of
   * bare undefined is not a string at all and JSON text never matches the
   * arm, so exactness is unreachable and the fixes (narrow first / null arm
   * / make it an optional record FIELD, where drop-and-absent semantics ARE
   * Node's) are specific. Record fields don't count: an undefined-armed
   * union in field position is JSON-safe (isJsonSafeType), so a record that
   * still fails the fence does so for some other reason. */
  bareUndefinedArmedUnion(t: IrType): boolean {
    return isUndefinedArmedUnion(t, (id) => this.unions.get(id));
  }

  /** canCrossIslandBoundary with this Lowerer's registries — THE test
   * behind every marshal/exit decision (the implicit coercions, jsvalIn,
   * the checked island-exit cast). Rejections that follow a false answer
   * speak through boundaryIntoIslandMsg / boundaryOutOfIslandMsg. */
  boundarySafe(t: IrType): boolean {
    return canCrossIslandBoundary(
      t,
      (id) => this.shapes.get(id),
      (id) => this.unions.get(id),
    );
  }

  /** canExitIslandToType with this Lowerer's registries — the EXIT
   * direction's slightly wider test (bare undefined-armed unions of
   * JSON-safe data arms exit; the engine's undefined takes the undefined
   * arm before the JSON round trip). */
  boundaryExitSafe(t: IrType): boolean {
    return canExitIslandToType(
      t,
      (id) => this.shapes.get(id),
      (id) => this.unions.get(id),
    );
  }

  isIslandExpr(node: ts.Expression): boolean {
    return isIslandExpr(this, node);
  }

  /** True when this node's CHECKER type is `any[]`/`unknown[]` — the type
   * tsc's Array.isArray predicate narrows readonly arrays to (its `arg is
   * any[]` quirk), and what a union collapses to when such an arm absorbs
   * its siblings. The VALUE behind it can still be a real static array
   * (maybeNarrow's isArray bridge extracts the union's array arm), so
   * receiver-typed dispatch falls back to the LOWERED type under this
   * test. */
  checkerAnyArray(node: ts.Expression): boolean {
    const t = this.typeOf(node);
    const anyElemArray = (c: ts.Type): boolean =>
      this.checker.isArrayType(c) &&
      ((this.checker.getTypeArguments(c as ts.TypeReference)[0]?.flags ?? 0) &
        (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    if (anyElemArray(t)) return true;
    // THE SAME NARROWING, IN THE SPELLING tsc USES WHEN IT CANNOT DISCARD
    // THE OTHER ARMS. `Array.isArray(x)` is declared `arg is any[]`. Over
    // `string | readonly string[]` tsc drops the non-array arms and the
    // true branch is bare `any[]` — the case above. Over a union whose
    // non-array arms are LITERAL types (`'adv' | readonly ['b','e']`, which
    // is what `as const` on a table produces) it cannot drop them, so it
    // intersects instead and hands back the UNION of the per-arm
    // intersections — printed `("adv" | readonly ["b", "e"]) & any[]`, but
    // carrying the Union flag, not the Intersection one.
    //
    // It is the identical claim: every arm says `any[]`, so tsc has decided
    // the value IS an array here and has lost the element type doing it.
    // Requiring EVERY arm to carry the `any[]` constituent is what keeps it
    // a statement about the value rather than about one possibility, and
    // every caller of this predicate re-checks that the VALUE lowers to a
    // real static array before it uses the answer — this only widens who
    // gets asked. zapo `src/retry/reason.ts:54` is the site:
    // `candidate.every(...)` inside `Array.isArray(candidate)`, where the
    // element type had already been lost and four consumers in a row fenced
    // on the `any` the value never had.
    const armIsAnyArray = (c: ts.Type): boolean =>
      anyElemArray(c) ||
      ((c.flags & ts.TypeFlags.Intersection) !== 0 &&
        (c as ts.UnionOrIntersectionType).getTypes().some(anyElemArray));
    if (!t.isUnionType()) return false;
    const parts = t.getTypes();
    return parts.length > 0 && parts.every(armIsAnyArray);
  }

  /** Substitutes a bound type parameter anywhere inside mapType's recursion
   * (`T`, `T[]`, `{ v: T }`, `(x: T) => T` all resolve). Inert outside
   * generic instantiation. */
  readonly typeParamResolver = (t: ts.Type): IrType | null => {
    if (!this.typeParamBindings || !(t.flags & ts.TypeFlags.TypeParameter)) return null;
    const sym: ts.Symbol | undefined = t.getSymbol();
    return (sym && this.typeParamBindings.get(sym)) ?? null;
  };

  /** The ts-level twin of typeParamResolver: the bound CHECKER type of a
   * type parameter in the current instantiation (typeParamTsBindings), for
   * the resolutions where mapType's widening already dropped what the body
   * needs (indexed accesses over literal-bound keys). Inert outside
   * call-keyed generic instantiation. */
  readonly typeParamTsResolver = (t: ts.Type): ts.Type | null => {
    if (!this.typeParamTsBindings || !(t.flags & ts.TypeFlags.TypeParameter)) return null;
    const sym: ts.Symbol | undefined = t.getSymbol();
    return (sym && this.typeParamTsBindings.get(sym)) ?? null;
  };

  /** The instantiation's symbolic→resolved side table, as mapType sees it:
   * a symbolic type the CALL SITE already resolved answers with that
   * resolution, everything else with null. Inert outside a call-keyed
   * generic instance body (symbolicResolved is null there). */
  readonly symbolicTsResolver = (t: ts.Type): ts.Type | null => {
    return this.symbolicResolved?.get(t) ?? null;
  };

  irTypeOf(node: ts.Node): IrType {
    const t = this.typeOf(node);
    // A never-tainted JS type (neverTaintedJsType) maps — never rides as
    // f64 — but must not: pre-empt the mapping so the JS fallback below
    // answers instead.
    const mapped = neverTaintedJsType(this, node, t) ? null : this.mapTypeOf(t);
    if (!mapped) {
      // The checked-dynamic declaration fallback (dynFallbackType): a
      // JAVASCRIPT binding of any inference residue, or a TypeScript
      // binding of genuine checker-`any`, becomes the checked-dynamic
      // kind instead of a compile fence — 'unknown' with the boundary
      // checks coerceToExpected already applies (dynFrom into the slot,
      // validated dynCheck out) and per-site fences for operations dyn
      // cannot carry. JS arrays keep their array-ness (any[]/never[]
      // evolving arrays become unknown[]), so length/push/index still
      // lower.
      const dyn = dynFallbackType(this, node, t);
      if (dyn) return dyn;
      this.badType(node, t);
    }
    return mapped;
  }

  /** SCRIPTC_DYNCHECK_WHY probe: the FIRST leaf `canDynCheckTo`'s nested
   * walk refuses, as a dotted path. Diagnostic path only. */
  dynCheckRefusal(t: IrType): string {
    const jsonSafe = (x: IrType) => isJsonSafeType(x, (id) => this.shapes.get(id), (id) => this.unions.get(id));
    const walk = (x: IrType, path: string, stack: Set<IrType>): string | null => {
      if (jsonSafe(x)) return null;
      if (x.kind === "bytes" && x.elem === "u8") return null;
      if (stack.has(x)) return null;
      const deeper = new Set(stack).add(x);
      if (x.kind === "array") return walk(x.elem, `${path}[]`, deeper);
      if (x.kind === "record") {
        const shape = this.shapes.get(x.shapeId);
        if (!shape) return `${path}:MISSING-SHAPE`;
        if (shape.tuple) return `${path}:TUPLE`;
        for (const f of shape.fields) {
          const r = walk(f.type, `${path}.${f.name}`, deeper);
          if (r) return r;
        }
        if (shape.indexValue) return walk(shape.indexValue, `${path}[idx]`, deeper);
        return null;
      }
      if (x.kind === "union") {
        const def = this.unions.get(x.unionId);
        if (!def) return `${path}:MISSING-UNION`;
        for (const a of def.arms) {
          if (a.kind === "undefinedT") continue;
          const r = walk(a, `${path}|${a.kind}`, deeper);
          if (r) return r;
        }
        return null;
      }
      return `${path}:${x.kind}${x.kind === "func" ? `(${x.params.length})` : ""}`;
    };
    if (t.kind !== "array" && t.kind !== "record" && t.kind !== "union") {
      return `TOP:${t.kind}`;
    }
    return walk(t, "T", new Set()) ?? "NESTED-OK";
  }

  /** SCRIPTC_DYNCONV_WHY probe: the IN-direction twin of dynCheckRefusal —
   * EVERY leaf `canConvertToDyn` refuses, each as a dotted path. The
   * SC1101 fence names only the outermost type, and in this program that
   * type is routinely a protobuf record of several thousand characters,
   * so the outermost name is never the level worth fixing.
   *
   * ALL the leaves rather than the first, and that is not a cosmetic
   * choice. A container refuses when ANY of its parts does, so the first
   * refusal is only the first one the walk happens to reach; admitting it
   * moves the fence to the next one and nothing else. Reporting one leaf
   * cost a session two whole-program builds to learn that the leaf behind
   * the reported leaf was a different kind entirely. Each path is listed
   * once, in walk order.
   *
   * Diagnostic path only — reachable exclusively from inside the env
   * gate in requireExactShape. */
  dynConvertRefusal(t: IrType): string {
    const out: string[] = [];
    const seen = new Set<string>();
    // Reports whether anything BELOW this node refused, which is not the
    // same question as whether anything was PRINTED: identical paths are
    // printed once (six media arms share `T|record.media`), so a
    // print-count test would call the second arm opaque for having said
    // nothing new.
    const leaf = (p: string): true => {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
      return true;
    };
    const walk = (x: IrType, path: string, stack: Set<IrType>): boolean => {
      if (this.dynConvertible(x)) return false;
      if (stack.has(x)) return false;
      const deeper = new Set(stack).add(x);
      if (x.kind === "array") return walk(x.elem, `${path}[]`, deeper);
      if (x.kind === "promise") return walk(x.inner, `${path}<promise>`, deeper);
      if (x.kind === "record") {
        const shape = this.shapes.get(x.shapeId);
        if (!shape) return leaf(`${path}:MISSING-SHAPE`);
        if (shape.indexValue !== undefined) return leaf(`${path}:INDEX-SIG`);
        let any = false;
        // A FUNCTION field is skipped exactly as the record rule skips it,
        // so a carried method is never blamed for a refusal it did not
        // cause.
        for (const f of shape.fields) {
          if (f.type.kind === "func") continue;
          if (walk(f.type, `${path}.${f.name}`, deeper)) any = true;
        }
        return any || leaf(`${path}:record(opaque)`);
      }
      if (x.kind === "union") {
        const def = this.unions.get(x.unionId);
        if (!def) return leaf(`${path}:MISSING-UNION`);
        let any = false;
        for (const a of def.arms) {
          if (a.kind === "undefinedT") continue;
          if (walk(a, `${path}|${a.kind}`, deeper)) any = true;
        }
        return any || leaf(`${path}:union(opaque)`);
      }
      return leaf(`${path}:${x.kind}${x.kind === "func" ? `(${x.params.length})` : ""}`);
    };
    walk(t, "T", new Set());
    return out.length === 0 ? "CONVERTIBLE" : out.join(" + ");
  }

  /** Exact-shape enforcement (SC2002). Records are monomorphic structs, so
   * everywhere a value flows into a typed slot (call arg, initializer,
   * assignment, field, return) the shapes must MATCH — or width-coerce:
   * coerceToExpected already ran widthCoerce (the copy-reshape family),
   * so what reaches here is the RESIDUE its rules decline, and the
   * diagnostic names the first blocking rule (describeRecordWidthBlocker).
   * Non-record mismatches are not reachable through tsc-clean programs; the
   * validator ICEs on them as the usual backstop. */
  requireExactShape(node: ts.Node, actual: IrType, expected: IrType): void {
    if (typeEquals(actual, expected)) return;
    // dyn mismatches first. A dyn ('unknown') value flowing into a typed
    // slot needs a CHECKED cast — the hint points at `as <type>`; tsc
    // usually rejects this before we do, so the fence is mostly defensive.
    // The reverse — a TYPED value flowing into an 'unknown' slot
    // (`const u: unknown = 5`, an unknown-typed param/return) — IS tsc-clean
    // and rejected here: a typed value has no dynamic representation
    // (constructing a dyn from static values is deliberately out this
    // round; only JSON.parse results are dyn).
    if (actual.kind === "dyn") {
      if (process.env.SCRIPTC_DYNCHECK_WHY) {
        const ok = canDynCheckTo(expected, (id) => this.shapes.get(id), (id) => this.unions.get(id));
        console.error(`DCWHY canDynCheckTo=${ok} :: ${this.dynCheckRefusal(expected)} :: ${typeKey(expected).slice(0, 90)}`);
      }
      this.unsupported(
        "SC1100",
        node,
        `passing 'unknown' values where '${this.fmt(expected)}' is expected`,
      );
    }
    if (expected.kind === "dyn") {
      if (process.env.SCRIPTC_DYNCONV_WHY) {
        const loc = locOf(node);
        console.error(
          `DCONVWHY ${loc.file}@${loc.start} top=${actual.kind} :: ${this.dynConvertRefusal(actual)} :: ${typeKey(actual).slice(0, 110)}`,
        );
      }
      // Function values BOX into dyn when their signature crosses
      // (canBoxFuncIntoDyn — coerceToExpected already converted those), so
      // reaching here with a func means a param/result type outside the
      // conversion domains, a generic signature's residue, or an overload
      // set — name the shape instead of the generic typed-to-unknown
      // wording.
      if (actual.kind === "func") {
        this.unsupported(
          "SC1101",
          node,
          `passing '${this.fmt(actual)}' function values into 'unknown' slots (a parameter or result type has no dynamic representation — only JSON-safe data, Uint8Array, undefined-armed unions of those, 'unknown', and functions over the same set cross)`,
        );
      }
      this.unsupported("SC1101", node);
    }
    // jsval mismatches surviving coerceToExpected involve a type with no
    // island representation (in) or no validated exit (out).
    if (actual.kind === "jsval") {
      this.unsupported("SC1090", node, boundaryOutOfIslandMsg(this.fmt(expected)));
    }
    if (expected.kind === "jsval") {
      this.unsupported("SC1090", node, boundaryIntoIslandMsg(this.fmt(actual)));
    }
    // Class-value mismatches: the pointed stories — a widening whose
    // constructor ABIs differ (construction through the slot would
    // dispatch a mismatched signature), or a structural flow between
    // unrelated classes (nominal identity is the IR's only class
    // subtyping, instances and values alike).
    if (actual.kind === "classval" && expected.kind === "classval") {
      const sub = this.classes.get(actual.className);
      const sup = this.classes.get(expected.className);
      if (sub && sup && this.isSubclassOf(actual.className, expected.className)) {
        this.unsupported(
          "SC1090",
          node,
          `class values whose constructor signatures differ ('${this.fmt(actual)}' into a '${this.fmt(expected)}' slot: construction through the slot completes against the base signature, which '${sub.def.jsName ?? actual.className}' does not share — declare matching constructor parameters)`,
        );
      }
      this.unsupported(
        "SC1090",
        node,
        `structurally-typed class-value flows ('${this.fmt(actual)}' into a '${this.fmt(expected)}' slot: only a class and its subclasses share a slot — extend the base class)`,
      );
    }
    // Union-involving mismatches first: a union flowing into a different
    // union's slot (even a superset) would need a runtime re-tag — its own
    // diagnostic, not the record one. Arm-into-union coercions were already
    // wrapped by coerceToExpected before this check runs.
    // MEASURED at 2b80d2ba (block/unknowns, estado-unknowns.md S5): all
    // three of zapo's SC2003s land on this line, and the two type prints
    // this diagnostic carries cannot tell them apart -- L.fmt caps at 4012
    // characters, so two protobuf mega-records print identically and are
    // still different types. An env-gated dump of the ARM SETS here said:
    //
    //   credentials-flow.ts:204   expected = union(2) [new(...) => RawWebSocket,
    //     undefined],  actual = classval 'typeof WaMobileTcpSocket'. A class
    //     constructor value has no identical arm. The SAME value in the same
    //     slot type WITHOUT the undefined arm lowers, and so does a plain
    //     binding it is new'ed through -- so the nominal-to-structural
    //     construct-signature match exists on the plain-field path and is
    //     missing only here. Fixable.
    //
    //   newsletter.ts:86   expected = ({code: string} | {})[],  actual =
    //     {code?: string; count?: number}[]. The same element width-coerce
    //     is performed when the destination is NOT reached through a union.
    //     Fixable.
    //
    //   messages.ts:497   CLOSED UPSTREAM, and the note that stood here was
    //     wrong about WHY it arrived. It said "the spread of a 6-arm union
    //     merged into a single shape". Measured with SCRIPTC_OBJLIT_WHY=1 on
    //     the 129 MB TU, the source is ONE arm, not six:
    //     `shouldNormalizeVoiceNote` is declared
    //     `content is WaSendMediaMessage & { type: 'audio' }`, so at :497 the
    //     spread source is the audio arm while the slot is still the
    //     parameter's declared six. The merge is what the LITERAL does when
    //     no rule builds it, not what the source is.
    //
    //     Everything the note said about THIS path remains true and remains
    //     the reason the path must not be widened: the merged record
    //     width-lifts into FIVE of the six arms, so accepting it here would
    //     pick an arm out of five -- a normalised voice note built and sent
    //     as the wrong media message kind. Any future widening of the arm
    //     test must keep "exactly one" as a hard gate; the two sites above
    //     are the positive ones and this remains the counter-example.
    //
    //     What closed it is lowerObjectLiteral's paired-arm union spread
    //     reaching a one-arm source (corpus 4651): the arm is known at
    //     compile time, so the literal is BUILT as that arm and never
    //     reaches this pair at all. Nothing is chosen, which is exactly what
    //     this test could not say.
    if (containsUnion(actual) || containsUnion(expected)) {
      this.pushDiag(unionMismatchDiag(this.fmt(expected), this.fmt(actual), locOf(node)));
      throw new PoisonError();
    }
    if (containsRecord(actual) || containsRecord(expected)) {
      // A record→record pair gets the pointed story: WHICH width rule
      // declined (a field that doesn't lift, a required field with no
      // source, an index signature that could hold the completed key).
      const detail =
        actual.kind === "record" && expected.kind === "record"
          ? (this.describeRecordWidthBlocker(actual.shapeId, expected.shapeId) ?? undefined)
          : undefined;
      if (process.env.SCRIPTC_SHAPE_WHY) {
        // The MAPPING MODE in force when the pair was built: a record whose
        // field types differ only by a tuple-vs-array spelling was mapped
        // under two different modes, and this is the only place that can
        // say which one is live at the refusal.
        const l = locOf(node);
        console.error(
          `SHAPE mismatch restTupleFromErasure=${String(this.typeCtx.restTupleFromErasure)} indexUnionOk=${String(this.typeCtx.indexUnionOk)} at ${l.file}:${l.start} detail=${detail?.slice(0, 120) ?? "-"}`,
        );
      }
      if (process.env["SCRIPTC_ORDER_WHY"] !== undefined && actual.kind === "record" && expected.kind === "record") {
        const l = locOf(node);
        console.error(
          `ORDER refuse actual#${actual.shapeId} expected#${expected.shapeId} at ${l.file}:${l.start}` +
          ` rest=${String(this.typeCtx.restTupleFromErasure)} idxU=${String(this.typeCtx.indexUnionOk)}`,
        );
      }
      this.pushDiag(recordShapeMismatchDiag(this.fmt(expected), this.fmt(actual), locOf(node), detail));
      throw new PoisonError();
    }
    // Everything else — a plain-kind mismatch like a string flowing into a
    // class-instance slot — is tsc-rejected in the lowering world and only
    // reaches here through preflight's project-world second chance (e.g. a
    // Promise reject called with a non-Error reason, clean under the lib's
    // `reason?: any`). The honest fence; silence would hand the emitter a
    // reinterpret and the validator an ICE.
    this.unsupported(
      "SC1090",
      node,
      `'${this.fmt(actual)}' values where '${this.fmt(expected)}' is expected`,
    );
  }

  /** Unwraps a HYBRID (function-with-properties) record to its callable:
   * a record whose shape carries the reserved `%call` func field reads
   * that field; anything else returns unchanged. The consumer half of
   * types.ts's chalk-shape mapping — call paths and func-slot coercions
   * share it. */
  hybridCallUnwrap(expr: IrExpr): IrExpr {
    if (expr.type.kind !== "record") return expr;
    const shape = this.shapes.get(expr.type.shapeId);
    const call = shape?.fields.find((f) => f.name === "%call");
    if (!call || call.type.kind !== "func") return expr;
    return { kind: "recordGet", obj: expr, shapeId: expr.type.shapeId, field: "%call", type: call.type, loc: expr.loc };
  }

  /** The tag of the union arm equal to `arm`, or -1 (unknown union / no
   * such arm). Arm lists are canonical (typeKey-sorted) and interned, so
   * this is THE tag for that (union, arm) pair program-wide — every wrap,
   * narrow, and tag test agrees by construction. */
  armTag(unionId: string, arm: IrType): number {
    const def = this.unions.get(unionId);
    return def ? def.arms.findIndex((a) => typeEquals(a, arm)) : -1;
  }

  /** An index-signature keyed READ flowing into a slot that can itself say
   * `undefined` — the read AT THE DESTINATION'S WIDTH. `node.attrs.id` on a
   * `Readonly<Record<string, string>>` types as `string` (tsc, without
   * noUncheckedIndexedAccess), and a MISSING key has nowhere to go: the
   * emitted helper traps, where Node answers undefined. But the value's
   * destination is frequently a slot that CAN hold undefined — an
   * `unknown`-valued log context, an undefined-armed union — and the
   * emitted helper's miss path already answers exactly those two: the dyn
   * undefined singleton, and the union's undefined arm. Only the frontend
   * never asked for them, because it types the read from the CHECKER and
   * then converts one step later.
   *
   * So: when the read cannot say undefined and the slot is a DYN one, the
   * read is re-typed to dyn. A HIT is unchanged — the toDyn conversion
   * that used to wrap the read moves INSIDE the helper and is the same
   * call — and a MISS becomes JS's undefined instead of a trap. Reads into
   * a slot that cannot represent undefined keep the trap: the checker
   * claimed a type nothing can honour, and a silent wrong answer is worse
   * than a loud one (SEMANTICS.md, the array-OOB policy).
   *
   * Only a DYN slot, never an undefined-armed UNION one, even though the
   * helper's miss path can answer that arm too (it does, under
   * noUncheckedIndexedAccess). The difference is what the CHECKER told the
   * readers. `const s: string | undefined = attrs.id` narrows — tsc types
   * the initializer `string`, so every later use of `s` was compiled as
   * "definitely the string arm": `s === undefined` folds to a constant
   * false and the payload read is a bare union peek. Storing the undefined
   * arm there is a wrong answer that SEGFAULTS (probe r03). An `unknown`
   * slot has no such readers — `unknown` is not usable until a runtime
   * guard narrows it, and every guard reads the dyn's own tag — so the dyn
   * width is the one the destination truly promises. Under
   * noUncheckedIndexedAccess the union width is already correct because
   * the checker typed the READ `T | undefined` too, and the readers with
   * it; this arm never fires there (the read can already say undefined).
   *
   * Only INDEX-SIGNATURE shapes take the arm. A signature-free shape's
   * keyed read was proven to name a declared field (tsc's keyof check), so
   * its miss is a smuggled key — the stranded stance, which stays.
   *
   * A slot is not the only destination that can say undefined. A
   * COMPARISON against a unit literal, and a TRUTHINESS test, are both
   * destinations whose whole point is the answer for an absent key —
   * `attrs.offline !== undefined`, `if (attrs.id)`. The checker types
   * those reads `string`, so the comparison folded to a constant and the
   * truthiness test trapped; at dyn width both take the path a
   * `Record<string, unknown>` read has always taken (one dynTest on the
   * node's kind). See unitTestAtDynWidth and ensureBool in
   * lower-exprs.ts. */
  recordKeyReadAtSlotWidth(expr: IrExpr, expected: IrType): IrExpr | null {
    if (expr.kind !== "recordKeyGet") return null;
    if (expected.kind !== "dyn" || expr.type.kind === "dyn") return null;
    // A read that can ALREADY answer a miss keeps its width.
    if (expr.type.kind === "union" && this.armTag(expr.type.unionId, UNDEFINED_T) >= 0) return null;
    const shape = this.shapes.get(expr.shapeId);
    if (!shape?.indexValue) return null;
    const effective = expr.overflowOnly === true ? { ...shape, fields: [] } : shape;
    if (!recordKeyResultOk(this, effective, DYN)) return null;
    return { ...expr, type: DYN };
  }

  /** The same read at an UNDEFINED-ARMED UNION destination. The helper's
   * miss path already answers a union's undefined arm — it does, under
   * noUncheckedIndexedAccess, and both emitters carry the arm-surfacing
   * chain for it (recordKeyGetHelper's union branch; the LLVM
   * keyedRecordRead's "the result union's undefined arm"). Only the
   * frontend never asked for it away from that flag.
   *
   * recordKeyReadAtSlotWidth refuses this width, and says why: a DECLARED
   * `const s: string | undefined = attrs.id` is narrowed by tsc to
   * `string` at the declaration, so every later use of `s` was compiled
   * as "definitely the string arm" — a bare arm peek over a stored
   * undefined, the r03 SEGFAULT. That is a fact about the DESTINATION,
   * not about the width, and it is not true of every destination.
   * Measured on tsc 5.9.3 (repro-pt/lab/narrowq2.ts), `string |
   * undefined` survives to the readers at a RECORD-LITERAL FIELD and is
   * narrowed away at a declaration, at an assignment and at a property
   * write. So this rung is offered to the callers whose readers keep the
   * declared union, never through coerceToExpected — a slot that narrows
   * keeps the dyn widening (where every reader is checked) or the trap.
   *
   * The width must be EXACTLY the read's own plus the undefined arm.
   * Anything wider is a conversion the author asked for and keeps its own
   * coercion, the same line keyedReadLocalAtDynWidth draws. Unlike the dyn
   * widening this is not a dynFrom, so no deep copy severs aliasing and
   * the immutable-primitive restriction that rule carries is not needed
   * here: a union wrap retains the very value the map holds. */
  recordKeyReadAtUndefinedArm(expr: IrExpr, expected: IrType): IrExpr | null {
    if (expr.kind !== "recordKeyGet") return null;
    if (expected.kind !== "union") return null;
    if (this.armTag(expected.unionId, UNDEFINED_T) < 0) return null;
    // A read that can ALREADY answer a miss keeps its width.
    if (expr.type.kind === "union" && this.armTag(expr.type.unionId, UNDEFINED_T) >= 0) return null;
    if (!typeEquals(this.stripUndefinedArm(expected), expr.type)) return null;
    const shape = this.shapes.get(expr.shapeId);
    if (!shape?.indexValue) return null;
    const effective = expr.overflowOnly === true ? { ...shape, fields: [] } : shape;
    if (!recordKeyResultOk(this, effective, expected)) return null;
    return { ...expr, type: expected };
  }

  /** THE SAME PER-DESTINATION QUESTION, ONE BINDING LATER — asked of a
   * REFERENCE to a local that already holds such a read at dyn width.
   *
   * `keyedReadLocalAtDynWidth` (lower-stmts.ts) widens the BINDING so an
   * absent key answers undefined instead of aborting, and then says, in its
   * own doc, what happens next: "the destination decides all over again —
   * one level down, at every REFERENCE: tsc narrows each use to the scalar
   * it believes, and maybeNarrow bridges that with a VALIDATED extraction.
   * So a use that needs the value throws the catchable dyn-boundary
   * TypeError where Node would throw its own."
   *
   * That is true of a use that DEREFERENCES the value — `id.length` on
   * undefined throws in Node too, so the two programs agree. It is NOT
   * true of a use whose DECLARED destination admits `undefined`: Node
   * hands the undefined straight over and the callee's own `v ===
   * undefined` answers it, where the bridge threw `expected string at $,
   * got undefined` several frames early. The bet was made for the
   * dereferencing use and applied to both, which is the whole defect.
   *
   * The two rungs that already ask this question at a destination —
   * `lowerArgExpecting` below and the record-literal field in
   * lower-exprs.ts — both require the lowered value to BE the read
   * (`recordKeyGet`). A reference therefore declines for a reason that is
   * not the reason: the destination is the same destination and the value
   * is the same value, one binding later. This is exactly the
   * `?? narrowBridgeDyn(e)` tail that `stringConvAtDynWidth` already
   * spells for the String() destination, and that the `??` middle operand
   * already spells with a `coerceInto` from the bridged dyn.
   *
   * Soundness is the bridge's own, and the bridge's doc states it: what
   * dropping it removes is a VALIDATION, never the operand, so nothing
   * effectful is lost. The dyn then converts into the armed union through
   * the ORDINARY boundary, whose walker builds the undefined arm from a
   * dyn undefined and validates every other kind. A hit is the value it
   * always was; a miss is the arm the destination itself declared; a kind
   * that is neither still throws. Nothing becomes silent.
   *
   * The width gate is the sibling rung's, unchanged: `expected` strips to
   * the bridge's own narrowed type EXACTLY. Anything wider is a conversion
   * the author asked for and keeps its own coercion.
   *
   * `SCRIPTC_REFARM_OFF=1` ablates it, so one binary emits both sides. */
  keyedReadRefAtUndefinedArm(expr: IrExpr, expected: IrType): IrExpr | null {
    if (process.env["SCRIPTC_REFARM_OFF"] === "1") return null;
    if (expected.kind !== "union") return null;
    if (this.armTag(expected.unionId, UNDEFINED_T) < 0) return null;
    const bridged = narrowBridgeDyn(expr);
    if (bridged === null) return null;
    if (!typeEquals(this.stripUndefinedArm(expected), expr.type)) return null;
    // The armed destination must itself be a checkable target, or the
    // conversion below would leave the value at dyn width in a typed slot.
    if (!canDynCheckTo(expected, (id) => this.shapes.get(id), (id) => this.unions.get(id))) return null;
    const out = this.coerceToExpected(bridged, expected);
    return typeEquals(out.type, expected) ? out : null;
  }

  /** THE ARGUMENT DESTINATION for recordKeyReadAtUndefinedArm.
   *
   * `parseOptionalInt(node.attrs.abprops)` — zapo
   * `transport/stream/parse.ts:79` and
   * `client/coordinators/WaIncomingNodeCoordinator.ts:508`. The checker
   * types an index-signature read by the signature's VALUE type, so the
   * read is spelled `string`; the key is absent on the wire; the helper's
   * miss path is `scr_trap_fmt` — a process ABORT with no `[SCxxxx]` tag,
   * past every one of zapo's 206 catch clauses, where Node hands the
   * callee `undefined` and the callee's own `if (!value) return undefined`
   * answers it.
   *
   * WHY A PARAMETER IS A KEEP-CASE, which is the rung's whole admission
   * rule. tsc narrows `string | undefined` away at a DECLARATION, an
   * ASSIGNMENT and a PROPERTY WRITE — the destinations the rung refuses,
   * because their readers were compiled as "definitely the string arm"
   * and a stored undefined is the r03 segfault. A PARAMETER cannot be
   * narrowed that way: the callee is compiled ONCE against its DECLARED
   * signature, and no call site can change what the body was checked
   * against. Every reader inside the callee already discriminates,
   * because tsc made it. That is a fact about the declaration, not an
   * argument about this call — and it is measurable per site, which is
   * what SCRIPTC_KEYREAD_CENSUS records (`wantArmed`).
   *
   * The gate is the rung's own and nothing else: `expected` is a union
   * carrying an undefined arm, `stripUndefinedArm(expected)` equals the
   * read's own type EXACTLY (a wider slot is a conversion the author
   * asked for and keeps its own coercion), the shape has an index
   * signature, and `recordKeyResultOk`. A parameter typed bare `string`
   * has no arm to offer and is untouched — it keeps the abort, honestly,
   * because there is nowhere for the undefined to go.
   *
   * The syntactic guard is `keyedAccessSyntax`'s access forms, for the
   * reason the `??` consumer gives: lowering the argument here must be
   * exactly what `lowerExprExpecting` would have done with it. That
   * function's own early rules are for `Object.freeze`, array literals
   * and object literals — none of which is a property or element access
   * — so for the admitted syntax the fallback below IS its tail,
   * lowerExpr + coerceInto, and a declined rung changes nothing. */
  lowerArgExpecting(node: ts.Expression, expected: IrType | undefined): IrExpr {
    // SCRIPTC_ARGARM_OFF=1 — the ABLATION lever. One binary can then emit
    // both sides of the A/B, so "the abort is gone" is checkable against
    // the same compiler with only this rung removed.
    if (process.env["SCRIPTC_ARGARM_OFF"] === "1") return this.lowerExprExpecting(node, expected);
    if (expected !== undefined && expected.kind === "union" && this.armTag(expected.unionId, UNDEFINED_T) >= 0) {
      // The parens/cast chain is skipped, and the CAST is the third
      // decliner of this same shape — measured, not guessed.
      //
      // `parseOptionalInt(child.attrs.id as string | undefined)`,
      // `WaProfileCoordinator.ts:256/294/295`. The census says
      // `wantArmed=yes`: the callee IS `parseOptionalInt`, its parameter
      // IS declared `string | undefined`, and the rung nonetheless
      // declined — because the argument node is an `AsExpression` and
      // the guard below only ever looked through parentheses. The author
      // wrote the arm twice, in the cast and in the signature, and the
      // program still aborted.
      //
      // Skipping the cast is sound for exactly the reason the rung's own
      // gate is: `stripUndefinedArm(expected)` must equal the READ's own
      // type, so a cast that actually changed the value's type declines
      // here as it always did. `as const` is not skipped — it is a
      // literal-narrowing assertion, not a widening one, and its result
      // is not the read's type. A cast the rung declines still lowers
      // through `lowerExprExpecting` on the ORIGINAL node, so nothing a
      // cast does is lost on the decline path.
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      // A CAST is only stripped for the rung's own attempt. If the rung
      // declines, the ORIGINAL node lowers through lowerExprExpecting
      // with the cast intact, so a declined cast is byte-for-byte what it
      // was — the same "a declined rung changes nothing" property the
      // paren case has.
      let cast: ts.Expression | null = null;
      if (
        process.env["SCRIPTC_ARGCAST_OFF"] !== "1" &&
        (ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) &&
        !isConstAssertionTypeNode(x.type)
      ) {
        cast = x;
        let inner: ts.Expression = x.expression;
        while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
        x = inner;
      }
      if (
        // An IDENTIFIER is admitted for the reason `keyedAccessSyntax`
        // already admits one: the value may be the READ, or a REFERENCE to
        // the local that holds it at dyn width, and this rung's soundness
        // argument is about the DESTINATION, which is the same either way.
        // The syntactic guard's own justification carries verbatim — an
        // identifier is not an `Object.freeze` call, an array literal or an
        // object literal, so for it too the fallback below IS
        // `lowerExprExpecting`'s tail and a declined rung changes nothing.
        ts.isIdentifier(x) ||
        ((ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) &&
          x.questionDotToken === undefined)
      ) {
        const raw = this.lowerExpr(cast === null ? node : x);
        const armed = this.recordKeyReadAtUndefinedArm(raw, expected)
          ?? this.keyedReadRefAtUndefinedArm(raw, expected);
        if (process.env["SCRIPTC_ARGARM_WHY"]) {
          const l = locOf(node);
          console.error(
            `ARGARM ${armed ? "FIRES" : "declines"} ${l.file}@${l.start} read=${this.fmt(raw.type)} want=${this.fmt(expected)} kind=${raw.kind}${cast ? " (cast)" : ""}`,
          );
        }
        if (armed) return armed;
        // Declined: lower the original node, cast and all.
        return cast === null ? this.coerceInto(node, raw, expected) : this.lowerExprExpecting(node, expected);
      }
    }
    return this.lowerExprExpecting(node, expected);
  }

  /** Implicit union construction. Wherever a value flows into a typed slot
   * (initializer, assignment, call argument, return, field write, record
   * literal field, ternary arm) whose expected type is a union and the
   * value's type is one of its arms, wrap it in a `unionWrap` carrying the
   * arm's canonical tag. Same-union values pass through untouched; anything
   * else (including a DIFFERENT union) is left for requireExactShape, which
   * rejects union mismatches with SC2003. */
  coerceToExpected(expr: IrExpr, expected: IrType): IrExpr {
    // An index-signature keyed read into a DYN slot reads at that slot's
    // width, so an absent key answers undefined the way JS does instead of
    // trapping (recordKeyReadAtSlotWidth). It runs first because the
    // conversion it replaces is the dynFrom the arms below would build.
    const atWidth = this.recordKeyReadAtSlotWidth(expr, expected);
    if (atWidth) return atWidth;
    // Island boundary, both directions. IN: any static value flowing into
    // an any-typed slot marshals implicitly (tsc allows the assignment;
    // the marshal is where its semantics live). OUT: an 'any' value
    // flowing into a typed slot compiles to a VALIDATED exit — like every
    // dyn→static edge, trust-but-verify: a lying `any` throws a catchable
    // TypeError instead of corrupting memory (SEMANTICS.md). Unmarshalable
    // and unextractable types fall through to requireExactShape's fences.
    if (expected.kind === "jsval" && expr.type.kind !== "jsval") {
      // Bare unit literals: the engine's own undefined/null (units have no
      // other producers, so dropping the operand loses nothing).
      if (isUnitType(expr.type)) {
        return { kind: "jsOp", op: expr.type.kind === "undefinedT" ? "undefLit" : "nullLit", args: [], type: JSVAL, loc: expr.loc };
      }
      // A CHECKED-DYNAMIC (dyn/'unknown') value entering the island (the
      // `isJson ? JSON.parse(text) : islandParser(text)` config ternary):
      // the dyn tree deep-copies into engine values — data kinds only; a
      // dyn carrying a boxed function/handle/promise throws the catchable
      // TypeError at runtime (trust-but-verify, like every boundary).
      if (expr.type.kind === "dyn") {
        return { kind: "jsMarshal", value: expr, type: JSVAL, loc: expr.loc };
      }
      if (this.boundarySafe(expr.type)) {
        return { kind: "jsMarshal", value: expr, type: JSVAL, loc: expr.loc };
      }
      // Closures cross as host functions when their signature marshals —
      // the same shapes jsvalIn admits at call arguments (`const f: any =
      // (x: number) => x * 3` is the declaration-slot spelling of the
      // package-callback pattern).
      if (
        expr.type.kind === "func" &&
        canMarshalTypedFuncIntoIsland(expr.type, (id) => this.shapes.get(id), (id) => this.unions.get(id))
      ) {
        return { kind: "jsMarshal", value: expr, type: JSVAL, loc: expr.loc };
      }
      // jsval-BEARING composites (a record holding `any` fields, an array
      // of such records) have no JSON marshal but an honest per-field
      // island construction — see jsvalLiftExpr.
      if (this.jsvalLiftable(expr.type)) {
        return this.jsvalLiftExpr(expr, expr.loc);
      }
      // A RegExp flowing into an 'any' slot: the fresh-engine-RegExp
      // rebuild (see jsvalIn's regex rule); computed regex values fall
      // through to requireExactShape's fence.
      if (expr.type.kind === "regex") {
        const re = islandRegexpOf(expr);
        if (re) return re;
      }
      return expr;
    }
    if (expr.type.kind === "jsval" && expected.kind !== "jsval") {
      // The jsval→dyn crossing (the world unification's engine-handle
      // kind): an 'any'-typed engine value flowing into an 'unknown'/
      // 'object'/JS-residue slot wraps BY REFERENCE as the checked-dynamic tree's island
      // kind — engine scalars normalize to native dyn kinds at wrap time,
      // typeof/truthiness/String()/=== route to the engine, un-armed dyn
      // walks fence loudly, and the value unwraps back identity-preserved
      // (scr_jsval_from_dyn). Monotone under evolution/widening: a value
      // wraps once at its first dyn edge and stays valid through every
      // subsequent dyn slot; narrowing never changes representation.
      // This wrap RETIRES the silent-wrong-answer fence-closure box for
      // jsval members of dyn object literals (lowerDynObjectLiteral's
      // coercion lands here first).
      if (expected.kind === "dyn") {
        return { kind: "dynFromJsval", value: expr, type: DYN, loc: expr.loc };
      }
      // An island value flowing into a PROMISE-typed slot (the inferred
      // `loadPlugins` return — `Promise.all(...)` lowered engine-side
      // against a Promise<any[]> inference): the island→static promise
      // bridge — the engine promise settles a fresh static promise (void
      // fulfillments drop, `any[]`-declared fulfillments exit
      // Array.isArray-gated by reference at the settle, 'any' parks as an
      // island handle). Only inner shapes the bridge can deliver take the
      // arm; the rest keep the exit fence with the type named.
      if (
        expected.kind === "promise" &&
        (expected.inner.kind === "void" ||
          expected.inner.kind === "jsval" ||
          (expected.inner.kind === "array" && expected.inner.elem.kind === "jsval"))
      ) {
        return { kind: "jsBridgePromise", value: expr, type: expected, loc: expr.loc };
      }
      // The exit set: everything round-trippable, plus bare undefined-armed
      // unions of JSON-safe data arms (the engine's undefined takes the
      // undefined arm before the JSON detour) — canExitIslandToType.
      if (this.boundaryExitSafe(expected)) {
        return { kind: "jsExit", value: expr, type: expected, loc: expr.loc };
      }
      return expr;
    }
    // A TYPED value flowing into an 'unknown' slot (`const u: unknown = 5`,
    // an unknown-typed param/return, a dyn-valued index slot): the
    // static→dyn conversion — dynFrom, a DEEP COPY (the jsMarshal aliasing
    // stance intoIndexValueSlot documents; SEMANTICS.md). Bare
    // undefined/null literals store the dyn unit values. Types outside the
    // dyn's domain (bytes, classes, Maps, ...) fall through to
    // requireExactShape's SC1101 fence.
    // A promise flowing into a VOID-promise slot (an inferred
    // Promise<never> return holding a `return Promise.reject(value)` the
    // dyn arm typed promise<dyn>): awaiting through the slot ignores the
    // fulfillment payload (scr_await_void) and rejections flow untyped,
    // so the value passes through — one C representation, no adapter.
    if (
      expected.kind === "promise" &&
      expected.inner.kind === "void" &&
      expr.type.kind === "promise" &&
      expr.type.inner.kind !== "void"
    ) {
      return { kind: "promiseVoidWiden", value: expr, type: expected, loc: expr.loc };
    }
    if (expected.kind === "dyn" && expr.type.kind !== "dyn") {
      // A VOID RESULT flowing into an 'unknown' slot (`return v()` in an
      // `async (): Promise<unknown>`, and every `Promise<void>` payload the
      // promise adapter awaits): JS's void value IS undefined, so the
      // conversion evaluates the operand for its EFFECTS and produces the
      // undefined dyn value — the unionWrap void-payload rule, one kind
      // over (both backends already emit that one). `void` is not a value
      // TYPE anywhere a dyn can be stored — no record field, array element
      // or union arm is void — so it stays OUT of canConvertToDyn (whose
      // answers drive the composite to-dyn walkers) and is spelled here,
      // at the coercion, where the operand is an expression to evaluate.
      if (expr.type.kind === "void") {
        return { kind: "dynFrom", value: expr, type: DYN, loc: expr.loc };
      }
      if (expr.kind === "unitLit" || this.dynConvertible(expr.type)) {
        return { kind: "dynFrom", value: expr, type: DYN, loc: expr.loc };
      }
      // An error-HIERARCHY object (builtin subclass or user `extends
      // Error` class) upcasts to the %Error root first — the caughtToDyn
      // encoding (scr_dyn_from_error) carries name/message/code and the
      // runtime CACHES the identity edge, so `instanceof TypeError` on
      // the dyn side still answers exactly (dyn.errInstanceof). Only the
      // root spelling was convertible before; the harness passes typed
      // errors into untyped helpers constantly.
      if (expr.type.kind === "object" && this.errorHierarchyClassOf(expr.type.className)) {
        return {
          kind: "dynFrom",
          value: this.upcastTo(expr, "%Error"),
          type: DYN,
          loc: expr.loc,
        };
      }
      return expr;
    }
    // A dyn ('unknown') ACTUAL flowing into a typed slot the checker
    // approved (an assertion function's narrowing, the error-any world's
    // forgiven chains): the VALIDATED extraction — dynCheck, the
    // checked-cast machinery, applied automatically. Trust-but-verify,
    // exactly the island exit's stance: a value that doesn't match the
    // slot's type throws a catchable TypeError instead of misreading the
    // payload. The domain is canDynCheckTo — the SAME predicate the `as T`
    // cast path (lower-exprs) and the IR validator's dynCheck rule already
    // apply, so a target the validator would accept is a target this
    // conversion offers. It used to be a hand-rolled subset written out
    // here (jsonSafe / undefined-armed union of jsonSafe arms / bytes<u8>
    // / %Error / adaptable func), and the subset had DRIFTED: it refused
    // every composite carrying a bytes<u8> LEAF — `Uint8Array | null`, a
    // record of Uint8Array fields — which canDynCheckTo's nested walk
    // grants and both emitters already walk field by field. Everything
    // outside it keeps requireExactShape's SC1100 fence.
    if (expr.type.kind === "dyn" && expected.kind !== "dyn") {
      if (canDynCheckTo(expected, (id) => this.shapes.get(id), (id) => this.unions.get(id))) {
        return { kind: "dynCheck", value: expr, type: expected, loc: expr.loc };
      }
      return expr;
    }
    // A HYBRID (function-with-properties) record flowing into a plain
    // func slot extracts its reserved %call field — the chalk shape's
    // "the value IS callable" half (types.ts's hybrid mapping).
    if (expected.kind === "func" && expr.type.kind === "record") {
      const un = this.hybridCallUnwrap(expr);
      if (un !== expr && typeEquals(un.type, expected)) return un;
    }
    // A zero-param function whose RETURN is a wider record array than the
    // slot's (`getRoutes: () => cachedRoutes` against `() => Narrow[]`):
    // the interned width adapter wraps it — each call maps the result
    // through the per-element record width copy.
    if (
      expected.kind === "func" &&
      expr.type.kind === "func" &&
      !typeEquals(expr.type, expected) &&
      expr.type.params.length === 0 &&
      expected.params.length === 0
    ) {
      const adapter = this.funcReturnWidthAdapter(expr.type, expected, expr.loc);
      if (adapter) {
        return { kind: "call", callee: adapter, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // JS func-into-func mismatches ride the checked-dynamic function
    // boundary: box the value (dynFrom), adapt to the slot (dynCheck) —
    // the thunk delivers JS arity exactly (extras ignored, missing args
    // the undefined dyn value), so `return _return` fits _mustCallInner's
    // inferred (unknown) => unknown slot even though the wrapper declares
    // (). JS files only: TypeScript signatures keep the exact-shape
    // fences (a mismatch there is a compile-time story, not a boundary).
    if (expected.kind === "func" && expr.type.kind === "func" && !typeEquals(expr.type, expected)) {
      const sf = this.program.getSourceFile(expr.loc.file);
      if (
        sf !== undefined && isJsSourceFile(sf) &&
        canConvertToDyn(expr.type, (id) => this.shapes.get(id), (id) => this.unions.get(id)) &&
        canAdaptDynFuncTo(expected, (id) => this.shapes.get(id), (id) => this.unions.get(id))
      ) {
        return {
          kind: "dynCheck",
          value: { kind: "dynFrom", value: expr, type: DYN, loc: expr.loc },
          type: expected,
          loc: expr.loc,
        };
      }
    }
    // A spawnSync-runner value (`defaultRunner` — its inferred return is
    // the opaque spawnRes) flowing into a slot whose signature returns
    // the structural result record tsc accepted: the interned adapter
    // forwards the call and converts the result field-wise.
    if (expected.kind === "func" && expr.type.kind === "func" && !typeEquals(expr.type, expected)) {
      const adapter = this.spawnResFnAdapter(expr.type, expected, expr.loc);
      if (adapter) {
        return { kind: "call", callee: adapter, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // The GENERAL function-value adapter (funcCoerceAdapter): a function
    // whose signature differs from the slot's only by coercible pieces —
    // fewer parameters (JS ignores extras: `load(function () {})` into an
    // `(x?: string) => void` slot), parameters/results that wrap into
    // union arms, re-tag union-to-union, take a checked narrow, or cross
    // the dyn boundary — wraps in a fresh closure applying exactly those
    // conversions per call. Runs after the specialized adapters above so
    // their pointed shapes keep winning.
    if (expected.kind === "func" && expr.type.kind === "func" && !typeEquals(expr.type, expected)) {
      const adapter = this.funcCoerceAdapter(expr.type, expected, expr.loc);
      if (adapter) {
        return { kind: "call", callee: adapter, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // The same story one container in: a promise whose PAYLOAD converts.
    if (expected.kind === "promise" && expr.type.kind === "promise" && !typeEquals(expr.type, expected)) {
      const adapter = this.promiseCoerceAdapter(expr.type, expected, expr.loc);
      if (adapter) {
        return { kind: "call", callee: adapter, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // Derived-into-base widening: a legal implicit upcast (prefix layout —
    // a pointer reinterpret). Exactness stays required in every other
    // direction; there is never an implicit DOWNcast.
    if (
      expected.kind === "object" &&
      expr.type.kind === "object" &&
      expr.type.className !== expected.className &&
      this.isSubclassOf(expr.type.className, expected.className)
    ) {
      return { kind: "upcast", value: expr, type: expected, loc: expr.loc };
    }
    // The DUPLEX WIDENING — the second, non-prototype half of Node's
    // stream hierarchy (streamDuplexWidensToWritable says why it is not an
    // isSubclassOf edge). Same node, same pointer reinterpret; the IR
    // validator admits the pair through the SAME predicate.
    if (
      expected.kind === "object" &&
      expr.type.kind === "object" &&
      streamDuplexWidensToWritable(expr.type.className, expected.className, (a, b) => this.isSubclassOf(a, b))
    ) {
      return { kind: "upcast", value: expr, type: expected, loc: expr.loc };
    }
    // An INCOMING MESSAGE into a `Readable` slot. Node's IncomingMessage
    // IS a Readable, but the two are DIFFERENT runtime representations
    // here (an ScrHttpReq against an ScrStream), so unlike the widening
    // directly above this one is not a pointer reinterpret — it is a
    // conversion, and httpReqIsReadableIn names it so the plan copy below
    // and this one cannot disagree. Idempotent at runtime: the view is
    // memoized on the request, so two conversions of one response answer
    // one stream.
    if (httpReqIsReadableIn(expr.type, expected)) return this.httpBodyStream(expr);
    // CLASS-VALUE widening (classval:D into a classval:C slot): the same
    // pointer with only the static type changing — legal exactly when D
    // strictly descends from C AND the two completed constructor ABIs
    // agree, the invariant `newValue` completion against C's one
    // signature rests on. Mismatches fall through to requireExactShape's
    // pointed class-value fences.
    if (
      expected.kind === "classval" &&
      expr.type.kind === "classval" &&
      expr.type.className !== expected.className &&
      this.isSubclassOf(expr.type.className, expected.className)
    ) {
      const sub = this.classes.get(expr.type.className);
      const sup = this.classes.get(expected.className);
      // A generic FAMILY as the destination (`new () => Box<any>` slots):
      // no `%<family>.constructor` exists for the validator's ABI check
      // and no completion target is meaningful — the exact-shape fence
      // downstream names the class-value flow instead.
      if (sub && sup && !sup.generic && this.ctorAbiEquals(sub, sup)) {
        return { kind: "upcast", value: expr, type: expected, loc: expr.loc };
      }
    }
    if (expected.kind !== "union" || typeEquals(expr.type, expected)) {
      // A UNION value flowing into one of its own ARMS: the checker
      // proved the narrowing (control flow through a destructured
      // binding, `d ?? (d = ...)`, a predicate call — tsc typed the SITE
      // as the arm; the IR value still carries the declaration's union)
      // — the CHECKED extraction, exactly `x!`'s machinery: the proven
      // arm's payload comes out, every other arm throws the catchable
      // TypeError (divergence 38's lying-assertion stance — sound
      // narrowing never reaches them).
      if (
        expr.type.kind === "union" &&
        !isUnitType(expected) &&
        expected.kind !== "void" &&
        this.armTag(expr.type.unionId, expected) >= 0
      ) {
        const helper = this.narrowedArmHelper(expr.type.unionId, expected, expr.loc);
        if (helper) {
          return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
        }
      }
      if (!typeEquals(expr.type, expected)) {
        const w = this.widthCoerce(expr, expected);
        if (w) return w;
        // A UNIT (null/undefined) flowing into a plain non-nullable slot
        // the checker approved (`null!` casts, non-strict assignments):
        // the stranded-source stance (divergence 38) without a union in
        // sight — the flow compiles to the catchable TypeError, where
        // Node lets the impossible value ride until (unless) it is used.
        const trap = this.strandedUnitTrap(expr, expected, expr.loc);
        if (trap) return trap;
      }
      return expr;
    }
    if (expr.type.kind === "union") {
      // A DIFFERENT union flowing into this slot: re-tag at runtime when
      // every arm maps (unionRetagHelper); anything unmappable falls
      // through to requireExactShape's SC2003.
      const helper = this.unionRetagHelper(expr.type.unionId, expected.unionId, expr.loc);
      if (helper) {
        return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
      }
      return expr;
    }
    if (expr.type.kind === "void") {
      // A void CALL RESULT flowing into a union with an undefined arm
      // (`var r = foo({})` where foo returns void — tsc's void slots map
      // to undefined-armed unions): JS's void value IS undefined, so the
      // wrap takes the undefined arm. The backends evaluate the void
      // operand for its effects and produce the interned unit instance
      // (the unionWrap void-payload rule).
      const undefTag = this.armTag(expected.unionId, UNDEFINED_T);
      if (undefTag >= 0) {
        return { kind: "unionWrap", unionId: expected.unionId, tag: undefTag, value: expr, type: expected, loc: expr.loc };
      }
      return expr;
    }
    const tag = this.armTag(expected.unionId, expr.type);
    if (tag < 0) {
      // An INCOMING MESSAGE against a union carrying a `Readable` arm —
      // zapo's `body: res` into `Readable | null`, and the shape every
      // "the body may be absent" response record has. Convert first, then
      // wrap like any arm value: the conversion is the very one the bare
      // `Readable` slot takes above, so a union slot and a plain slot
      // cannot disagree about the same response.
      if (expr.type.kind === "httpReq") {
        const readableTag = this.armTag(expected.unionId, READABLE_T);
        if (readableTag >= 0) {
          return {
            kind: "unionWrap",
            unionId: expected.unionId,
            tag: readableTag,
            value: this.httpBodyStream(expr),
            type: expected,
            loc: expr.loc,
          };
        }
      }
      // A derived class flowing into a union with a base-class arm widens
      // first (nearest ancestor arm wins), then wraps like any arm value.
      if (expr.type.kind === "object") {
        for (let c = this.classes.get(expr.type.className)?.base ?? null; c; c = c.base) {
          const baseTag = this.armTag(expected.unionId, { kind: "object", className: c.def.name });
          if (baseTag >= 0) {
            const widened = this.upcastTo(expr, c.def.name);
            return { kind: "unionWrap", unionId: expected.unionId, tag: baseTag, value: widened, type: expected, loc: expr.loc };
          }
        }
      }
      // A derived CLASS VALUE against a union with a base classval arm
      // (`typeof Base | undefined` slots receiving D): the same nearest-
      // ancestor widening, gated by the constructor-ABI rule; a mismatch
      // falls through to the union fence.
      if (expr.type.kind === "classval") {
        const sub = this.classes.get(expr.type.className);
        for (let c = sub?.base ?? null; c; c = c.base) {
          const baseTag = this.armTag(expected.unionId, { kind: "classval", className: c.def.name });
          if (baseTag >= 0) {
            if (!sub || !this.ctorAbiEquals(sub, c)) break;
            const widened: IrExpr = { kind: "upcast", value: expr, type: { kind: "classval", className: c.def.name }, loc: expr.loc };
            return { kind: "unionWrap", unionId: expected.unionId, tag: baseTag, value: widened, type: expected, loc: expr.loc };
          }
        }
      }
      // A PROMISE against a union carrying a promise arm whose payload the
      // source's payload converts into (`Promise<T | Promise<T>>` — what an
      // async callback's contextual return type widens to — landing in the
      // `T | Promise<T>` slot it was written for): adapt the payload, then
      // wrap like any arm value. ONE promise arm only, the same ambiguity
      // stance widthLiftPlan takes: two would make the target a guess.
      if (expr.type.kind === "promise") {
        const def = this.unions.get(expected.unionId);
        const promiseArms = def?.arms.filter((a) => a.kind === "promise") ?? [];
        const arm = promiseArms.length === 1 ? promiseArms[0] : undefined;
        if (arm !== undefined && arm.kind === "promise") {
          const armIdx = this.armTag(expected.unionId, arm);
          const adapter = this.promiseCoerceAdapter(expr.type, arm, expr.loc);
          if (armIdx >= 0 && adapter) {
            const adapted: IrExpr = { kind: "call", callee: adapter, args: [expr], type: arm, loc: expr.loc };
            return { kind: "unionWrap", unionId: expected.unionId, tag: armIdx, value: adapted, type: expected, loc: expr.loc };
          }
        }
      }
      // A FUNCTION value against a union carrying a func arm it adapts into
      // — `(a, b, opts?) => R` flowing into a `((a, b) => R) | undefined`
      // slot: funcCoerceAdapter builds the arity/param bridge (extra trailing
      // optionals fed undefined), then wrap like any arm value. ONE func arm
      // only, the promise-arm ambiguity stance.
      if (expr.type.kind === "func") {
        const def = this.unions.get(expected.unionId);
        const funcArms = def?.arms.filter((a) => a.kind === "func") ?? [];
        const arm = funcArms.length === 1 ? funcArms[0] : undefined;
        if (arm !== undefined && arm.kind === "func") {
          const armIdx = this.armTag(expected.unionId, arm);
          const adapter = this.funcCoerceAdapter(expr.type, arm, expr.loc);
          if (armIdx >= 0 && adapter) {
            const adapted: IrExpr = { kind: "call", callee: adapter, args: [expr], type: arm, loc: expr.loc };
            return { kind: "unionWrap", unionId: expected.unionId, tag: armIdx, value: adapted, type: expected, loc: expr.loc };
          }
        }
      }
      // A CLASS VALUE against a union carrying a CONSTRUCT-SIGNATURE arm —
      // zapo's `rawWebSocketConstructor: WaMobileTcpSocketCtor` flowing into
      // a `readonly rawWebSocketConstructor?: RawWebSocketConstructor` field,
      // whose optionality makes the destination the two-arm
      // `new (url, protocols?, options?) => RawWebSocket | undefined`.
      // widthCoerce already turns a classRef into the construct THUNK for the
      // PLAIN func slot (classCtorThunk, a few rungs down) and a plain
      // binding it is `new`ed through lowers too; the OPTIONAL spelling was
      // the only difference, and the union position simply had no rung for
      // it. ONE func arm only — the promise-arm and func-arm ambiguity stance
      // directly above — and direct classRef sources only, which is
      // classCtorThunk's own gate (the thunk names the class statically, so
      // a classval-typed expression could hold a widened subclass) — read
      // through pinnedClassValueOf, which answers for a class-PINNED
      // binding too: zapo passes `WaMobileTcpSocketCtor`, a module const
      // bound to the class, and the const IS the class object.
      {
        const pinned = this.pinnedClassValueOf(expr);
        if (pinned !== null) {
          const def = this.unions.get(expected.unionId);
          const ctorArms = def?.arms.filter((a) => a.kind === "func") ?? [];
          const arm = ctorArms.length === 1 ? ctorArms[0] : undefined;
          if (arm !== undefined && arm.kind === "func") {
            const armIdx = this.armTag(expected.unionId, arm);
            const thunk = armIdx >= 0 ? this.classCtorThunk(pinned, arm, expr.loc) : null;
            if (thunk) {
              return { kind: "unionWrap", unionId: expected.unionId, tag: armIdx, value: thunk, type: expected, loc: expr.loc };
            }
          }
        }
      }
      // A width-coercible value against a union: coerce into the SINGLE
      // width-liftable arm, then wrap like any arm value (widthLiftPlan's
      // liftWrap — several candidate arms are ambiguous and decline).
      const lift = this.widthLiftPlan(expr.type, expected);
      if (lift) return this.applyWidthLift(lift, expr, expected, expr.loc);
      // Arms OUTSIDE widthLiftPlan's domain keep the historic per-arm
      // widthCoerce probe (first match): index-signature record arms (the
      // overflow CAPTURE helper owns their reshapes) and `any[]` arms
      // (the island-boundary per-element lift). Bounded to those arm
      // shapes so the plan's ambiguity rule for record/array lifts is
      // never undone by a first-match fallback.
      {
        const def = this.unions.get(expected.unionId);
        if (def) {
          for (let i = 0; i < def.arms.length; i++) {
            const arm = def.arms[i]!;
            const boundaryArm =
              (arm.kind === "record" && this.shapes.get(arm.shapeId)?.indexValue !== undefined) ||
              (arm.kind === "array" && arm.elem.kind === "jsval");
            if (!boundaryArm) continue;
            const w = this.widthCoerce(expr, arm);
            if (w) {
              return { kind: "unionWrap", unionId: expected.unionId, tag: i, value: w, type: expected, loc: expr.loc };
            }
          }
        }
      }
      // A checker-approved value the union CANNOT represent: a unit
      // (`getV(): Foo | Bar { return null! }`, `null as any as T`), or a
      // record/array with NO width-lift candidate at all (`{} as
      // InstanceOne | InstanceTwo`). Every one is a LYING assertion —
      // tsc accepted the flow only through a cast/assertion our arm list
      // proves impossible — so it compiles to the stranded-arm TRAP
      // (divergence 38's stance: the catchable TypeError at the flow,
      // where Node lets the impossible value ride). AMBIGUOUS width
      // candidates stay compile fences: honest code lands there.
      // A RUNTIME-KEYED record against a union of exact arms: the CHECKED
      // DYNAMIC EXTRACTION, which is the conversion this compiler already
      // performs for the same value one spelling over.
      {
        const checked = this.runtimeKeyedUnionExtraction(expr, expected, expr.loc);
        if (checked) return checked;
      }
      {
        const trap = this.strandedCoercionTrap(expr, expected, expr.loc);
        if (trap) return trap;
      }
      return expr;
    }
    return { kind: "unionWrap", unionId: expected.unionId, tag, value: expr, type: expected, loc: expr.loc };
  }

  /** Copy-based structural WIDTH coercion — a `Full` record flowing into a
   * narrower `{ id }` slot, or `Full[]` into `{ id }[]` (the Pick-typed
   * display-table pattern): TS's width subtyping is free on erased types,
   * but monomorphic structs must RESHAPE, so the value is rebuilt with the
   * subset of fields copied — per element, via an interned helper, for
   * arrays. A deliberate divergence from JS's aliasing (SEMANTICS.md 35,
   * next to the marshal-copy stance): mutations through the narrowed value
   * don't reach the original and vice versa. Exactly two flows coerce —
   * record→record and record-array→record-array, each target field copied
   * from a same-named source field whose type matches exactly or LIFTS
   * into the target field's union (see recordWidthHelper); anything
   * deeper keeps the exactness fences. Null when the pair isn't
   * width-coercible. */
  widthCoerce(expr: IrExpr, expected: IrType): IrExpr | null {
    if (expected.kind === "record" && expr.type.kind === "record") {
      // Index-signature pairs reshape through the overflow CAPTURE helper
      // (the `Object.fromEntries(e) as ModelPricing` pattern — declared
      // collisions validate at runtime); plain shapes keep the field-copy
      // width helper. Each declines the other's shapes.
      const helper =
        this.recordWidthHelper(expr.type.shapeId, expected.shapeId, expr.loc) ??
        lowerRecordOvfCaptureHelper(this, expr.type.shapeId, expected.shapeId, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    // A CLASS INSTANCE flowing into the record an interface maps to. The
    // instance satisfies the interface -- that is why the checker admitted
    // it -- and the constructor-witness projection already knows how to
    // read one out: bound methods, lifted fields, the undefined arm for a
    // member the class omits.
    //
    // The projection declines whatever it cannot see through (accessors,
    // generics, a builtin base, a field it cannot lift), so this widens
    // only to the classes it can actually witness. Where it declines, the
    // caller's own refusal stands exactly as before.
    if (expected.kind === "record" && expr.type.kind === "object") {
      const proj = this.ctorWitnessProjection(expr.type.className, expected, expr.loc);
      if (proj !== null) {
        // SCRIPTC_PROJ_USE: one line per COERCION SITE (a helper is interned
        // once but coerced at many). Diagnostic only.
        if (process.env["SCRIPTC_PROJ_USE"] !== undefined) {
          const sh = this.shapes.get(expected.shapeId);
          const dataF = (sh?.fields ?? []).filter((f) => !f.name.startsWith("%") && f.type.kind !== "func").map((f) => f.name);
          console.error(`[projuse] ${expr.loc.file}@${expr.loc.start} ${expr.type.className} -> ${expected.shapeId} data=${dataF.length}${dataF.length > 0 ? ` [${dataF.join(",")}]` : ""}`);
        }
        return { kind: "call", callee: proj, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // An ARRAY flowing into a UNIFORM TUPLE slot — the other side of the
    // const-lookup-table rule: the table binds as an array so a computed
    // read has a slot, and a parameter spelling the tuple still wants the
    // record. Positional copy (arrayTupleWidthHelper).
    if (expected.kind === "record" && expr.type.kind === "array") {
      const helper = this.arrayTupleWidthHelper(expr.type, expected.shapeId, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    // A UNION flowing into a RECORD slot: `const n = cond ? { tag, attrs }
    // : { tag, attrs, content }; return n` -- a ternary of literals bound
    // without an annotation types as the union of the two, and the slot
    // that receives it wants the one shape. Every arm has to reach that
    // shape on its own (identity, or the field-copying width coercion an
    // optional member's absence already rides), and the helper picks per
    // tag.
    //
    // Planned purely first, so a failing arm never leaves an interned
    // helper behind. Unit arms decline: `null` carries no fields to copy
    // into a record.
    if (expected.kind === "record" && expr.type.kind === "union") {
      const helper = this.unionRecordCollapseHelper(expr.type.unionId, expected.shapeId, expr.loc);
      // Declining FALLS THROUGH rather than answering null: a later
      // rule may still own this pair, and short-circuiting here
      // would silently take it away.
      if (helper) {
        return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
      }
    }
    // A CLASS INSTANCE flowing into a record slot (`new Point(0, 0)` into
    // `{ x: number; y: number }` — tsc's structural view of classes): the
    // same field-projecting copy, each target field read off the instance.
    if (expected.kind === "record" && expr.type.kind === "object") {
      const helper = this.objRecordWidthHelper(expr.type.className, expected.shapeId, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    // A RECORD flowing into a class-instance slot (`{x: 0, y: 0}` into
    // `A.Point` — the parameter-property data-class pattern): construction
    // IS the projection when the constructor is nothing but parameter
    // properties (recordToClassPlan's gates).
    if (expected.kind === "object" && expr.type.kind === "record") {
      const helper = this.recordClassWidthHelper(expr.type.shapeId, expected.className, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    // A CLASS VALUE flowing into a record slot (`var f: ShapeFactory =
    // Shape` — an interface matched by the class's STATIC side): the
    // record captures the statics — fields as copies, methods as the
    // zero-capture closures `const f = C.m` builds. Direct classRef
    // sources only: the projection reads no runtime value, so an effectful
    // source expression would lose its evaluation.
    if (expected.kind === "record" && expr.type.kind === "classval" && expr.kind === "classRef") {
      return this.classStaticsProjection(expr.type.className, expected.shapeId, expr.loc);
    }
    // A CLASS VALUE flowing into a CONSTRUCT-SIGNATURE slot (`new (…) =>
    // Iface` — types.ts maps single-construct-signature constructables
    // over interface instances to func types): the value enters as a
    // construct THUNK — a zero-capture closure of the slot's exact
    // signature whose body constructs the class and projects the instance
    // into the slot's return shape. Sources that PROVABLY name one class
    // only (pinnedClassValueOf — a direct classRef, or a read of a
    // class-pinned const): the thunk names the class statically, so the
    // runtime value must BE that class, and a plain classval-typed
    // expression could hold a widened subclass.
    if (expected.kind === "func" && expr.type.kind === "classval") {
      const pinned = this.pinnedClassValueOf(expr);
      const thunk = pinned === null ? null : this.classCtorThunk(pinned, expected, expr.loc);
      if (thunk) return thunk;
    }
    if (expected.kind === "array" && expr.type.kind === "array" && expected.elem.kind !== "jsval") {
      const helper = this.arrayWidthHelper(expr.type, expected, expr.loc);
      if (helper) return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
      // The EMPTY-array lift (widthLiftPlan's emptyArr rule), top-level:
      // `cmd.aliases` typed `(null | undefined)[]` (an `aliases: []`
      // table) flowing into a `string[]` slot.
      const lift = this.widthLiftPlan(expr.type, expected);
      if (lift?.how !== "emptyArr") return null;
      return this.applyWidthLift(lift, expr, expected, expr.loc);
    }
    // A TUPLE flowing into an array slot (`const NAMES = [...] as const`
    // assigned to a `readonly T[]` — the const-table pattern): TS erases
    // the arity for free; the monomorphic tuple REBUILDS as a fresh array,
    // each position's value lifted into the element type (the same copy
    // stance as every width coercion — later mutations don't alias).
    if (expected.kind === "array" && expr.type.kind === "record" && expected.elem.kind !== "jsval") {
      const helper = this.tupleArrayWidthHelper(expr.type.shapeId, expected, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    // An `any[]` slot: any liftable element becomes one island handle per
    // element (the messages-array pattern — records holding `any` content).
    if (
      expected.kind === "array" &&
      expected.elem.kind === "jsval" &&
      expr.type.kind === "array" &&
      expr.type.elem.kind !== "jsval"
    ) {
      const helper = this.arrayToJsvalArrayHelper(expr.type.elem, expr.loc);
      if (!helper) return null;
      return { kind: "call", callee: helper, args: [expr], type: expected, loc: expr.loc };
    }
    return null;
  }

  /** THE CLASS A `classval` EXPRESSION STATICALLY NAMES, or null.
   *
   * `classval:C` on its own does NOT name C: the IR's class-value story
   * (nodes.ts) admits C's class object OR a STRICT DESCENDANT's, which is
   * why every construct-thunk and statics-projection site gated on
   * `expr.kind === "classRef"` — a syntactic class reference is the one
   * shape that cannot be holding a subclass. That gate's REASON is
   * "provably this class", not "syntactically a classRef", and a
   * REFERENCE TO A CLASS-PINNED BINDING satisfies it just as completely:
   * the binding is immutable and its initializer was a direct class
   * reference, so its runtime value IS that class object (see
   * classPinnedBinding, and FnCtx.classPins / globalClassPins for where
   * the two scopes record it).
   *
   * This is the whole of the binding analysis these sites needed, and
   * almost all of it already existed — castAliasedClassRefOf (file scope)
   * and lowerVarDecl's classval adoption (function scope) each already
   * prove const-ness and a direct class initializer in order to PIN the
   * binding's type; the only thing missing was carrying that conclusion
   * to the use site. Nothing here widens what a classval means: an
   * unpinned classval binding, a `let`, a parameter, a captured copy and
   * a widening annotation (`const b: typeof Base = Derived`) all still
   * answer null and keep their fences.
   *
   * The pin is re-checked against the expression's own className so a
   * stale or mismatched entry can only ever DECLINE. */
  pinnedClassValueOf(expr: IrExpr): string | null {
    if (expr.type.kind !== "classval") return null;
    if (expr.kind === "classRef") return expr.className;
    if (expr.kind !== "varRef") return null;
    // Inside a construct thunk's own argument planning the varRefs are
    // SYNTHETIC (`p.0`, `p.1` — the slot's parameters), and they are
    // minted against the ENCLOSING frame's counter space rather than a
    // frame of their own. A source `const p = Foo` in that frame owns
    // `p.0` too, so consulting the frame's pins there could answer a
    // thunk parameter with an unrelated binding's class — the one way
    // this lookup could be WRONG rather than merely absent. Module
    // globals are unaffected: their `%g.`-prefixed ids are unique
    // program-wide and no synthetic name can collide with them.
    const pinned = expr.localId.startsWith("%g.")
      ? this.globalClassPins.get(expr.localId)
      : this.ctorThunkDepth > 0
        ? undefined
        : this.ctx.classPins.get(expr.localId);
    if (pinned === undefined || pinned !== expr.type.className) return null;
    if (process.env["SCRIPTC_CLASSPIN_WHY"] !== undefined) {
      console.error(`[classpin] use ${expr.localId} -> ${pinned}`);
    }
    return pinned;
  }

  /** The construct THUNK a class value becomes in a construct-signature
   * func slot (`rawWebSocketConstructor: new (url) => RawWebSocket` fed a
   * class): a closure of the slot's signature whose body is `new C(...)`
   * with each ctor param filled from the same-position slot param (exact,
   * arm-wrap, dyn conversion, or width) or its omitted completion, and
   * the instance projected into the slot's return shape (the objRecord
   * width copy — the same structural view every instance-into-record flow
   * rides). Interned per (class, signature) and ZERO-CAPTURE, so backends
   * intern the closure: one runtime value per class and slot shape, `===`
   * stable across coercion sites. `new` through the slot is the thunk
   * call (lowerNew's func arm). Null declines to the exact-shape fences:
   * a generic class, a rest-marked signature, a slot param the ctor param
   * cannot receive, a required ctor param the slot omits, or an instance
   * the return shape cannot project. */
  classCtorThunk(className: string, expected: IrType & { kind: "func" }, loc: SrcLoc): IrExpr | null {
    if (expected.rest === true) return null;
    const info = this.classes.get(className);
    if (!info || info.generic || info.def.abstract) return null;
    const inst: IrType = { kind: "object", className };
    // Return side first — planned before anything interns.
    let retConv: ((e: IrExpr) => IrExpr) | null = null;
    if (typeEquals(expected.ret, inst)) {
      retConv = (e) => e;
    } else if (
      expected.ret.kind === "object" &&
      this.isSubclassOf(className, expected.ret.className)
    ) {
      const retT = expected.ret;
      retConv = (e) => ({ kind: "upcast", value: e, type: retT, loc });
    } else if (expected.ret.kind === "record") {
      const proj = this.ctorWitnessProjection(className, expected.ret, loc);
      if (!proj) return null;
      const retT = expected.ret;
      retConv = (e) => ({ kind: "call", callee: proj, args: [e], type: retT, loc });
    } else {
      return null;
    }
    // Argument side: positional ctor params only — a rest pack has no
    // adapter shape.
    if (info.ctorParams.some((p) => p.mode === "rest" || p.mode === "dynRest" || p.mode === "islandRest")) {
      return null;
    }
    const args: IrExpr[] = [];
    this.ctorThunkDepth++;
    try {
      for (let i = 0; i < info.ctorParams.length; i++) {
        const shape = info.ctorParams[i]!;
        const src = i < expected.params.length ? expected.params[i]! : null;
        if (src === null) {
          // The slot's signature omits this ctor param: only an omittable
          // one completes (tsc's assignability says required ones cannot
          // reach here, but decline rather than trust).
          const absent =
            shape.type.kind === "dyn"
              ? dynUndefinedExpr(loc)
              : shape.type.kind === "jsval"
                ? ({ kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc } as IrExpr)
                : this.wrappedUndefined(shape.type, loc);
          if (shape.mode !== "omittable" || !absent) return null;
          args.push(absent);
          continue;
        }
        const ref: IrExpr = { kind: "varRef", localId: `p.${i}`, type: src, loc };
        if (typeEquals(src, shape.type)) {
          args.push(ref);
          continue;
        }
        if (shape.type.kind === "union" && this.armTag(shape.type.unionId, src) >= 0) {
          args.push({ kind: "unionWrap", unionId: shape.type.unionId, tag: this.armTag(shape.type.unionId, src), value: ref, type: shape.type, loc });
          continue;
        }
        if (shape.type.kind === "dyn" && this.dynConvertible(src)) {
          args.push({ kind: "dynFrom", value: ref, type: DYN, loc });
          continue;
        }
        const w = this.widthCoerce(ref, shape.type);
        if (w) {
          args.push(w);
          continue;
        }
        // …and the WIDTH-LIFT plan for the pairs widthCoerce has no rung
        // for, which at a construct signature means the UNION ones: zapo's
        // `options?: { headers?; dispatcher?; agent? }` slot parameter
        // against the constructor's own `_options?: WaRawWebSocketInit`,
        // two optional records differing by one further optional field.
        // widthLiftPlan already answers `retag` for that pair — the plan
        // this very function's CALLER uses one rung over (the union
        // destination in coerceToExpected) — so the thunk was declining a
        // conversion the compiler knows how to build, in the one position
        // where declining costs the whole class value rather than one
        // field.
        //
        // Every plan EXCEPT the checked ones: `narrow` extracts a proven
        // arm and THROWS on the others, and `ovfCapture` validates declared
        // collisions at run time. tsc's assignability says a ctor parameter
        // can only ever be WIDER than the slot parameter it receives, so
        // neither shape can arise from a checked flow — and if one ever
        // did, taking it would put an unconditional runtime throw inside a
        // constructor the checker proved total. Those keep the fence.
        const lift = this.widthLiftPlan(src, shape.type);
        if (lift !== null && lift.how !== "narrow" && lift.how !== "ovfCapture") {
          args.push(this.applyWidthLift(lift, ref, shape.type, loc));
          continue;
        }
        if (process.env["SCRIPTC_CTORTHUNK_WHY"] !== undefined) {
          console.error(
            `[ctorthunk] ${className} DECLINE param ${i}: src='${this.fmt(src)}' (${src.kind}) ` +
              `ctor='${this.fmt(shape.type)}' (${shape.type.kind}) mode=${shape.mode} ` +
              `liftPlan=${JSON.stringify(lift)}`,
          );
        }
        return null;
      }
    } finally {
      this.ctorThunkDepth--;
    }
    const key = `ctorthunk:${className}:${typeKey(expected)}`;
    const existing = this.widthHelpers.get(key);
    const name = existing ?? `%ctorthunk.${this.widthHelpers.size}`;
    if (!existing) {
      this.widthHelpers.set(key, name);
      this.noteEdge(`%${className}.constructor`);
      this.liftedFns.push({
        name,
        params: expected.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t })),
        returnType: expected.ret,
        locals: expected.params.map((t, i) => ({ id: `p.${i}`, name: `p${i}`, type: t, mutable: false })),
        body: [
          {
            kind: "return",
            value: retConv({ kind: "new", className, args, type: inst, loc }),
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "closure", fnName: name, captures: [], type: expected, loc };
  }

  /** The fields a projection COPIES that a method of the projected class
   * WRITES — the condition that makes a mixed projection a lie about
   * itself, and the whole of SC6003's admission rule.
   *
   * Constructor bodies and field initializers are excluded on purpose: they
   * run before the value exists to project, so a write there cannot make a
   * copy stale. Everything else in the class body counts, and so does every
   * base in the chain — a method a target shape does not name can still be
   * reached from one that it does, and the projected closures call into the
   * live instance, so the reachable set is "the class", not "the projected
   * methods". Over-approximating that way can only produce advice nobody
   * needed; under-approximating would produce silence somebody did.
   *
   * Deliberately syntactic and deliberately NOT transitive through
   * ordinary functions: `push(): void { helper(this) }` where `helper`
   * writes is not seen. That residue is stated rather than papered over —
   * a call-graph walk here would have to be sound over the whole program
   * to be worth more than this, and an unsound one would move the silence
   * rather than remove it.
   *
   * The result is memoized per class: a shape is projected once but the
   * planner probes the same class from several positions. */
  classMethodWrittenFields(className: string): ReadonlySet<string> {
    const memo = this.methodWrittenFields.get(className);
    if (memo) return memo;
    const out = new Set<string>();
    for (let c: ClassInfo | null = this.classes.get(className) ?? null; c; c = c.base) {
      const decl = c.decl;
      if (!decl) continue;
      for (const m of decl.members) {
        // The CONSTRUCTOR only. A property DECLARATION is walked, not
        // skipped: `n = 0` holds no assignment to find, while
        // `handler = (): void => { this.n++ }` holds one and is reachable
        // through the projection exactly like a declared method. Skipping
        // the whole member kind lost that for nothing.
        if (ts.isConstructorDeclaration(m)) continue;
        const walk = (n: ts.Node): void => {
          const thisProp = (x: ts.Node): ts.PropertyAccessExpression | null =>
            ts.isPropertyAccessExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword ? x : null;
          if (ts.isBinaryExpression(n)) {
            const t = thisProp(n.left);
            const op = n.operatorToken.kind;
            if (
              t &&
              (op === ts.SyntaxKind.EqualsToken ||
                (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment))
            ) {
              out.add(t.name.text);
            }
          }
          if (ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) {
            const t = thisProp(n.operand);
            if (
              t &&
              (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
            ) {
              out.add(t.name.text);
            }
          }
          ts.forEachChild(n, walk);
        };
        walk(m);
      }
    }
    this.methodWrittenFields.set(className, out);
    return out;
  }

  /** SC6003's push, shared by the two builders that produce a mixed
   * projection. `loc` is the coercion's when there is one; the width
   * PLANNER probes with a synthetic `<width>` loc that names no file, and
   * an advisory rendered against it would point at nothing — so that case
   * falls back to the class declaration, which is the other end of the
   * same fact and is always a real span. */
  noteMixedProjection(className: string, lifted: { name: string; type: IrType }[], methodCount: number, loc: SrcLoc): void {
    // The LIVE half is not only a method-named target field. An ARROW
    // FUNCTION class field — `go = (): void => { this.n += 1 }` — is a data
    // field on the class, so the plan has methods=0 and lifts it like any
    // other; but the value lifted is the CLOSURE, and the closure's captured
    // `this` is the instance. Calling it through the projection writes the
    // object exactly as a method does, while the neighbouring data field
    // still reads the copy. Same wrong value, third producer, and the rule
    // was blind to it until the shape was written down and run:
    //
    //     class C { n = 0; go = (): void => { this.n += 1 } }
    //     through(new C())      node 1      scriptc 0    (both backends)
    //
    // A lifted func field that captures nothing makes this advice
    // over-eager rather than wrong, which is the right direction for advice.
    const liveFuncs = lifted.filter((f) => f.type.kind === "func").length;
    const data = lifted.filter((f) => f.type.kind !== "func").map((f) => f.name);
    if (methodCount + liveFuncs === 0 || data.length === 0) return;
    const written = this.classMethodWrittenFields(className);
    const stale = data.filter((n) => written.has(n));
    if (stale.length === 0) return;
    const decl = this.classes.get(className)?.decl ?? null;
    const at = loc.file === "<width>" && decl !== null ? locOf(decl) : loc;
    this.pushAdvice(projectionCopiesAMutatedFieldDiag(className, stale, at));
  }

  /** The record a THUNK-constructed instance projects into (the return
   * side of classCtorThunk): method-named fields become closures bound to
   * the instance — the classWitnessRecord stance, sound here because the
   * thunk's instance is born inside it and never escapes nominally —
   * data fields ride the width-lift copy (the established width stance:
   * later mutations of the source field don't alias), and missing
   * optional-flavored fields complete to their undefined arm. Interned
   * per (class, shape). Null declines to the exact-shape fences: an
   * accessor- or generic-method-satisfied field, an abstract/rest/
   * inexact method signature, a builtin runtime layout, or a field that
   * doesn't lift.
   *
   * The two halves of that first sentence are the SC6003 divergence, and
   * the "sound here" is about the THUNK's caller only — every other caller
   * hands this an instance that does escape. noteMixedProjection above. */
  ctorWitnessProjection(className: string, target: IrType & { kind: "record" }, loc: SrcLoc): string | null {
    // SCRIPTC_PROJ_WHY: name the declining clause. The projection is
    // per-REQUESTED-FIELD and its declines are numerous; three separate
    // reports guessed the wrong clause before this probe existed.
    const why = (m: string): null => {
      if (process.env["SCRIPTC_PROJ_WHY"] !== undefined) {
        console.error(`[projwhy] ${className} -> shape ${target.shapeId}: ${m}`);
      }
      return null;
    };
    const shape = this.shapes.get(target.shapeId);
    const info = this.classes.get(className);
    if (!shape || !info || shape.tuple || shape.indexValue !== undefined || shape.fields.length === 0) {
      return why(`shape/class prelude (shape=${shape !== undefined} class=${info !== undefined} tuple=${shape?.tuple === true} indexValue=${shape?.indexValue !== undefined} fields=${shape?.fields.length ?? -1})`);
    }
    if (shape.fields.some((f) => f.name.startsWith("%"))) return why("a reserved '%' field (accessor slot) in the target shape");
    for (let c: ClassInfo | null = info; c; c = c.base) {
      // A user class that merely EXTENDS node:events EventEmitter IS
      // projectable. registerBuiltinEmitterClass gives %EventEmitter an
      // EMPTY fields map and an EMPTY methods map -- the ScrEmitter
      // registry/name prefix is laid out by the BACKEND, not by IR fields
      // -- so nothing a plan can name ever resolves ONTO it: the emitter
      // surface (`on`, `emit`, ...) lowers through lower-emitter.ts and
      // findMethodOn cannot see it, so a target naming one of those still
      // declines below (no method, no field, no undefined arm). Every
      // member the plan CAN reach is the user class own, and fieldGet /
      // `%Decl.m` on it are exactly what an ordinary method body emits.
      // The Error and stream chains keep declining unchanged: %Error DOES
      // publish `name`/`message`/`toString` as runtime layout, and a
      // stream node is reached before this skip can apply.
      // Checked, not assumed: if %EventEmitter ever grows a field or a
      // method the guard reverts to declining rather than projecting a lie.
      if (
        c !== info &&
        c.builtinEmitter === true &&
        c.fields.size === 0 &&
        c.methods.size === 0 &&
        (c.genericMethods?.size ?? 0) === 0 &&
        (c.symbolFields?.size ?? 0) === 0 &&
        c.def.fields.length === 0
      ) {
        continue;
      }
      if (c.builtinError || c.builtinEmitter || c.builtinStream !== undefined || c.def.runtime) {
        return why(`base chain reached builtin '${c.def.name}' (error=${c.builtinError === true} emitter=${c.builtinEmitter === true} stream=${c.builtinStream !== undefined} runtime=${c.def.runtime === true})`);
      }
    }
    const key = `ctorwitness:${className}:${target.shapeId}`;
    const existing = this.retagHelpers.get(key);
    if (existing) return existing;
    // Probe every field BEFORE interning — a partial projection must not
    // be left half-built in the helper tables.
    type Plan =
      | { how: "method"; name: string; fnT: IrType & { kind: "func" }; callee: string; declarer: string; virtual: boolean; wrap: { unionId: string; tag: number } | undefined; fieldT: IrType; ret: IrType; extraParams: IrType[] }
      | { how: "lift"; name: string; src: IrType; lift: WidthLift; fieldT: IrType }
      | { how: "absent"; name: string; utag: number; fieldT: IrType };
    const plan: Plan[] = [];
    for (const f of shape.fields) {
      const found = findMethodOn(this, info, f.name);
      if (found) {
        // An OPTIONAL method: the interface spells `destroy?: () => void`,
        // so the field is a union of the signature and undefined while the
        // class implements the method outright. Project the method and
        // wrap it into the arm -- refusing here would throw away a whole
        // class over a member it does have.
        let fnT: IrType = f.type;
        let wrap: { unionId: string; tag: number } | undefined;
        if (f.type.kind === "union") {
          const udef = this.unions.get(f.type.unionId);
          const armIdx = udef ? udef.arms.findIndex((a) => a.kind === "func") : -1;
          if (
            !udef ||
            udef.arms.length !== 2 ||
            armIdx < 0 ||
            !udef.arms.some((a) => a.kind === "undefinedT")
          ) {
            return why(`field '${f.name}': a union-typed method field that is not exactly (signature | undefined)`);
          }
          fnT = udef.arms[armIdx]!;
          wrap = { unionId: f.type.unionId, tag: armIdx };
        }
        if (fnT.kind !== "func" || fnT.rest === true) return why(`field '${f.name}': target member is not a plain (rest-free) function type`);
        if (found.sig.abstract === true || found.sig.gen !== undefined) return why(`field '${f.name}': the class method is abstract or generic`);
        if (found.sig.params.some((p) => p.mode === "rest")) return why(`field '${f.name}': the class method takes a rest parameter`);
        const methodParamTypes = found.sig.params.map((p) => p.type);
        const methodT = funcOf(methodParamTypes, found.sig.ret);
        // The class method may carry EXTRA TRAILING OPTIONAL parameters
        // beyond the interface field's arity — `query(node, ms, options?)`
        // satisfies a `(node, ms) => R` field: a call through the field
        // passes the missing optionals as undefined, exactly what Node does.
        // Match the field params positionally against the method's, require
        // equal returns, and require every extra method param to be optional
        // (undefined-armed, so undefined is a legal value the builder feeds).
        let extraParams: IrType[] = [];
        if (!typeEquals(methodT, fnT)) {
          const optionalParam = (t: IrType): boolean =>
            t.kind === "union" && (this.unions.get(t.unionId)?.arms.some((a) => a.kind === "undefinedT") ?? false);
          const compatible =
            methodParamTypes.length >= fnT.params.length &&
            typeEquals(found.sig.ret, fnT.ret) &&
            fnT.params.every((fp, i) => typeEquals(fp, methodParamTypes[i]!)) &&
            methodParamTypes.slice(fnT.params.length).every(optionalParam);
          if (!compatible) {
            return why(`field '${f.name}': signature mismatch — method ${typeKey(methodT).slice(0, 110)} vs target ${typeKey(fnT).slice(0, 110)}`);
          }
          extraParams = methodParamTypes.slice(fnT.params.length);
        }
        plan.push({
          how: "method",
          name: f.name,
          fnT,
          wrap,
          fieldT: f.type,
          callee: `%${found.declarer.def.name}.${f.name}`,
          declarer: found.declarer.def.name,
          virtual: this.overrideBelow(info, f.name),
          ret: found.sig.ret,
          extraParams,
        });
        continue;
      }
      if (findMethodOn(this, info, `get:${f.name}`) || findGenericMethodOn(this, info, f.name)) {
        return why(`field '${f.name}': satisfied by an ACCESSOR or a generic method`);
      }
      const ft = info.fields.get(f.name);
      if (ft === undefined) {
        if (f.type.kind !== "union") return why(`field '${f.name}': the class has no such member and the target slot is not undefined-armed`);
        const def = this.unions.get(f.type.unionId);
        const utag = def ? def.arms.findIndex((a) => a.kind === "undefinedT") : -1;
        if (utag < 0) return why(`field '${f.name}': the class has no such member and the target union has no undefined arm`);
        plan.push({ how: "absent", name: f.name, utag, fieldT: f.type });
        continue;
      }
      const lift = this.widthLiftPlan(ft, f.type);
      if (!lift) {
        return why(`field '${f.name}': the class field does not width-lift — ${typeKey(ft).slice(0, 110)} into ${typeKey(f.type).slice(0, 110)}`);
      }
      plan.push({ how: "lift", name: f.name, src: ft, lift, fieldT: f.type });
    }
    // SCRIPTC_PROJ_CENSUS: one line per INTERNED projection, naming how many
    // target fields ride the method closure (which aliases the instance) and
    // how many ride the width-lift COPY (which does not). Diagnostic only.
    if (process.env["SCRIPTC_PROJ_CENSUS"] !== undefined) {
      const lifted = plan.filter((p) => p.how === "lift").map((p) => p.name);
      const meth = plan.filter((p) => p.how === "method").length;
      const abs = plan.filter((p) => p.how === "absent").length;
      console.error(`[projcensus] ${className} -> ${target.shapeId} methods=${meth} absent=${abs} lift=${lifted.length}${lifted.length > 0 ? ` [${lifted.join(",")}]` : ""}`);
    }
    // SC6003: the census's own two counts are the mixed condition, so the
    // advisory is decided from the same plan rather than from a second walk.
    this.noteMixedProjection(
      className,
      plan.flatMap((p) => (p.how === "lift" ? [{ name: p.name, type: p.fieldT }] : [])),
      plan.filter((p) => p.how === "method").length,
      loc,
    );
    const builder = `%ctorwitness.${this.retagHelpers.size}`;
    this.retagHelpers.set(key, builder);
    const instT: IrType = { kind: "object", className };
    const fields: { name: string; value: IrExpr }[] = [];
    for (const [i, m] of plan.entries()) {
      if (m.how === "absent") {
        fields.push({
          name: m.name,
          value: {
            kind: "unionWrap",
            unionId: (m.fieldT as IrType & { kind: "union" }).unionId,
            tag: m.utag,
            value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
            type: m.fieldT,
            loc,
          },
        });
        continue;
      }
      const self: IrExpr = { kind: "varRef", localId: "self.0", type: instT, loc };
      if (m.how === "lift") {
        const get: IrExpr = { kind: "fieldGet", obj: self, className, field: m.name, type: m.src, loc };
        fields.push({ name: m.name, value: this.applyWidthLift(m.lift, get, m.fieldT, loc) });
        continue;
      }
      if (m.virtual) this.noteVirtualEdge(info, m.name); else this.noteEdge(m.callee);
      const implName = `${builder}.${i}`;
      const params: IrParam[] = m.fnT.params.map((t, k) => ({ localId: `a.${k}`, name: `a${k}`, type: t }));
      const args: IrExpr[] = [
        // A DIRECT call goes to the DECLARER, which may sit above the
        // receiver's own class. Without the upcast, projecting a
        // SUBCLASS instance onto a record whose method the BASE
        // declares fails IR validation (SC9001, a compiler crash on a
        // five-line program).
        m.virtual ? this.upcastTo(self, info.def.name) : this.upcastTo(self, m.declarer),
        ...m.fnT.params.map((t, k): IrExpr => ({ kind: "varRef", localId: `a.${k}`, type: t, loc })),
        // Extra trailing optional method params the field's arity omits: feed
        // undefined (wrapped into the param's own undefined-armed union),
        // exactly the value an omitted optional argument takes.
        ...m.extraParams.map((t): IrExpr => {
          const u = t as IrType & { kind: "union" };
          const tag = this.unions.get(u.unionId)!.arms.findIndex((a) => a.kind === "undefinedT");
          return {
            kind: "unionWrap",
            unionId: u.unionId,
            tag,
            value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
            type: t,
            loc,
          };
        }),
      ];
      const callE: IrExpr = m.virtual
        ? { kind: "virtualCall", className: info.def.name, method: m.name, args, type: m.ret, loc }
        : { kind: "call", callee: m.callee, args, type: m.ret, loc };
      this.liftedFns.push({
        name: implName,
        params,
        returnType: m.ret,
        captures: [{ localId: "self.0", name: "self", type: instT }],
        locals: [
          { id: "self.0", name: "self", type: instT, mutable: false, boxed: true },
          ...m.fnT.params.map((t, k) => ({ id: `a.${k}`, name: `a${k}`, type: t, mutable: false })),
        ],
        body: m.ret.kind === "void"
          ? [{ kind: "exprStmt", expr: callE, loc }, { kind: "return", value: null, loc }]
          : [{ kind: "return", value: callE, loc }],
        loc,
      });
      const clo: IrExpr = {
        kind: "closure", fnName: implName, captures: ["self.0"], type: m.fnT, loc,
      };
      fields.push({
        name: m.name,
        value:
          m.wrap === undefined
            ? clo
            : {
                kind: "unionWrap",
                unionId: m.wrap.unionId,
                tag: m.wrap.tag,
                value: clo,
                type: m.fieldT,
                loc,
              },
      });
    }
    // The hidden toString slot, for the same reason objRecordWidthHelper
    // carries it: this builder MATERIALIZES the instance into a struct,
    // after which the class's own toString is unreachable and every
    // ToString folds "[object Object]" over a method that exists.
    const toStr = this.toStringSlotClosure(className, loc, "self.0");
    if (toStr) this.markToStrSlot(target.shapeId);
    this.liftedFns.push({
      name: builder,
      params: [{ localId: "self.0", name: "self", type: instT }],
      returnType: target,
      locals: [{ id: "self.0", name: "self", type: instT, mutable: false, boxed: true }],
      body: [{ kind: "return", value: { kind: "recordLit", fields, ...(toStr ? { toStr } : {}), type: target, loc }, loc }],
      loc,
    });
    return builder;
  }

  /** One step of the recursive width-lift relation: how a `src`-typed
   * value enters a `dst`-typed slot under the copy-reshape family. The
   * pure planning side — nothing interns here, so whole plans validate
   * before any helper exists. The cases, in order:
   *   copy      — exact same type (typeEquals), the field/element moves as is
   *   retag     — union into union, every arm mapped (unionRetagMappable —
   *               identity arms, trap-less; record/array arms may width-lift
   *               into exactly one destination arm)
   *   wrap      — a non-unit arm value into a union that contains it
   *   liftWrap  — a record/array value into a union with NO identical arm
   *               but exactly ONE arm it width-lifts into (the findRoute
   *               rule applied at every level; several candidates are
   *               ambiguous and decline)
   *   width     — record into a strict-subset record (recordWidthPlan,
   *               recursively — NESTED width)
   *   arr       — array into array whose element pair lifts (per-element
   *               copy loop, arrayWidthHelper)
   *   dynIn     — a typed value into an 'unknown' (dyn) slot — the same
   *               static→dyn deep copy coerceToExpected applies top-level
   *   upcast    — a derived class instance into a base-typed slot (the
   *               prefix-layout pointer reinterpret, no copy)
   *   funcAdapt — a function into a slot whose signature differs only by
   *               CLEAN mechanical conversions (cleanFuncAdaptable); the
   *               stranded (trap-only) dispositions stay out of the plan
   * Null when the pair isn't in the relation — callers keep their fences. */
  widthLiftPlan(src: IrType, dst: IrType): WidthLift | null {
    if (typeEquals(src, dst)) return { how: "copy" };
    // An 'unknown' (dyn) DESTINATION slot: the static→dyn conversion —
    // dynFrom, a DEEP COPY (`{ v: 5 }` into `{ v: unknown }`, `number[]`
    // into `unknown[]` — tsc's top type over the width family's copies).
    if (dst.kind === "dyn" && src.kind !== "dyn" && this.dynConvertible(src)) {
      return { how: "dynIn" };
    }
    if (dst.kind === "union") {
      if (src.kind === "union") {
        return this.unionRetagMappable(src.unionId, dst.unionId) ? { how: "retag" } : null;
      }
      // A unit-typed source can't wrap here (unionWrap requires the
      // LITERAL unit — and no lowered shape carries a bare unit field).
      if (isUnitType(src)) return null;
      const tag = this.armTag(dst.unionId, src);
      if (tag >= 0) return { how: "wrap", tag };
      const def = this.unions.get(dst.unionId);
      if (!def) return null;
      const candidates: { tag: number; arm: IrType }[] = [];
      // TWO PASSES. The first considers only the SAME-FAMILY arms above,
      // exactly as before. The second adds the TUPLE-into-ARRAY arm — a
      // change of REPRESENTATION rather than a width refinement — and runs
      // only when the first found nothing, so a union that already had a
      // candidate can never be made AMBIGUOUS by the new family: no pair
      // that lifts today changes its answer, and the trap population is the
      // only thing that shrinks.
      const collect = (tupleIntoArray: boolean): void => {
        def.arms.forEach((arm, i) => {
          if (isUnitType(arm)) return;
          const sameFamily =
            (src.kind === "record" && arm.kind === "record") ||
            (src.kind === "array" && arm.kind === "array") ||
            (src.kind === "object" && arm.kind === "record") ||
            (src.kind === "record" && arm.kind === "object") ||
            // A FUNCTION arm: `socket.onopen = () => {…}` against
            // `((e: Event) => void) | null`, where JS simply does not pass
            // the argument the callback ignores. The adapter that makes the
            // signatures meet already exists (funcAdapt); it just had no
            // family here, so an EXACT-signature callback reached the arm
            // and an arity-adapted one did not.
            (src.kind === "func" && arm.kind === "func")
          // A TUPLE against an ARRAY arm — `return [a, b]` out of a function
          // whose return type is `string[] | null`. tsc assigns
          // `[string, string]` to `string[]` for free, but a monomorphic
          // tuple is a positional RECORD, so the two never met here and a
          // SOUND assignment was read as a lying assertion: the flow became
          // an UNCONDITIONAL runtime throw (strandedCoercionTrap has no tag
          // test — reaching the call site IS throwing). The bridge is the
          // fresh-array rebuild widthCoerce already performs for the same
          // value in a plain `string[]` slot (tupleArrayWidthHelper, the
          // const-table rule), copy stance and all (SEMANTICS.md 35) — so
          // this makes the union-arm position AGREE with the plain slot
          // one arm over, rather than taking a new stance.
          const tupleArm = tupleIntoArray && src.kind === "record" && arm.kind === "array";
          if ((sameFamily || tupleArm) && this.widthLiftPlan(src, arm) !== null) candidates.push({ tag: i, arm });
        });
      };
      collect(false);
      if (candidates.length === 0) collect(true);
      // THE ZERO-OVERLAP REFINEMENT. "Exactly one candidate" stays the hard
      // gate — this only decides WHICH arms were ever candidates, and only
      // in the direction that turns a refusal into an acceptance, so no pair
      // that lifts today changes its answer.
      //
      // An arm whose every member is undefined-admitting (all-optional, or a
      // required member typed 'unknown') width-lifts from ANY record: the
      // plan fills each of its members with undefined and DROPS every member
      // the source actually has. Such an arm is a candidate for every record
      // in the program, so a union that contains one can never resolve a
      // record source — measured on zapo through its own public API:
      //
      //   client.message.send(jid, { type: 'reaction', emoji, target })
      //   client.message.send(jid, { type: 'text', text }, { quote: target })
      //
      // where `target` is a plain `{ remoteJid; id; fromMe }` binding and the
      // destination is `WaMessageTargetInput` = `WaMessageKey |
      // WaIncomingMessageEvent`. The KEY arm takes all three members; the
      // EVENT arm (`{ key?: …; rawNode: unknown }`) shares NOT ONE name with
      // the source and only "fits" by dropping everything — two candidates,
      // an unconditional runtime throw, and both spellings die. An inline
      // literal in the same slot lowers (tsc picks the arm contextually and
      // no conversion is left), which is what made the pair look arbitrary.
      //
      // The refinement: when several record arms are candidates, an arm that
      // shares NO member NAME with the source record is not what the program
      // meant — the copy it plans reads none of the value's members. Drop
      // those, and take the result only if it leaves exactly one. Arms of
      // other families are never dropped (they keep the ambiguity, and the
      // pair keeps its fence).
      //
      // The counter-example this must NOT swallow is messages.ts:497, where
      // one record width-lifts into FIVE of six media-message arms: those
      // arms all share member names with the source, so all five survive the
      // filter and the site keeps its (correct) fence. Verified by census
      // both sides.
      if (candidates.length > 1 && src.kind === "record") {
        const srcNames = new Set((this.shapes.get(src.shapeId)?.fields ?? []).map((f) => f.name));
        const overlapping = candidates.filter((c) => {
          if (c.arm.kind !== "record") return true;
          return (this.shapes.get(c.arm.shapeId)?.fields ?? []).some((f) => srcNames.has(f.name));
        });
        if (overlapping.length === 1) {
          return { how: "liftWrap", tag: overlapping[0]!.tag, arm: overlapping[0]!.arm };
        }
        // THE WHOLE-VALUE REFINEMENT, the second tier of the same argument.
        // The zero-overlap rule above is the degenerate case of a more general
        // one: an arm that shares NO name with the source drops ALL of it, and
        // "the copy reads none of the value" is why it is not what the program
        // meant. The same objection applies, weaker but still decisive, to an
        // arm that drops SOME of it — when a sibling arm drops NOTHING.
        //
        // Measured on zapo's own public API, the row `block/sixteen` attributed
        // to the test driver rather than to zapo:
        //
        //   client.message.send(jid, { type: 'text', text }, { quote: target })
        //
        // where `target` is a plain `{ remoteJid; id; fromMe }` binding and
        // `WaSendMessageOptions.quote` is the THREE-arm
        // `WaIncomingMessageEvent | WaQuoteRef | WaMessageKey`. The zero-overlap
        // rule drops the EVENT arm (`{key; rawNode; …}`, no shared name) and
        // leaves two:
        //   WaMessageKey  {remoteJid; id; fromMe; participant?}  — holds all three
        //   WaQuoteRef    {id; participant?; remoteJid?; message?} — DROPS `fromMe`
        // Two candidates, so the site kept its fence and the quote-reply step
        // aborted, costing 2 stanzas. The sibling site one arm over —
        // `WaMessageTargetInput = WaMessageKey | WaMessageRef`, two arms — lowers
        // today, so the pair `send(…, {target})` / `send(…, {quote: target})`
        // behaved differently for no reason the author could see.
        //
        // The rule: among the name-overlapping candidates, an arm that can hold
        // EVERY member the source has reads the whole value; the others must
        // silently discard a member the program wrote. Take it only when exactly
        // one arm does, so this is strictly a refinement in the accepting
        // direction and no pair that lifts today changes its answer.
        //
        // It AGREES with the fresh-literal spelling. `{ quote: { remoteJid, id,
        // fromMe } }` written inline already lowers here (tsc picks the arm
        // contextually and leaves no conversion); only the BINDING spelling
        // aborted. This makes the two spellings of the same value agree, which
        // is the same stance the tuple-into-array pass above takes.
        //
        // The counter-example it must NOT swallow is messages.ts:497, where one
        // merged record width-lifts into FIVE of six media-message arms: each of
        // those arms omits the fields belonging to the other media kinds, so
        // EVERY candidate drops part of the source, the filter selects zero, and
        // the site keeps its (correct) fence. Verified by census both sides.
        // THE PRESENCE GUARD, and it is not optional — MEASURED, not reasoned.
        // Without it this refinement closes `messages.ts:497`, the very
        // counter-example the rule above is written to protect, and the census
        // caught it: base 29 refusals -> 27, with BOTH `drmax3.ts:313` and
        // `messages.ts:497` gone where only the first was intended.
        //
        // The whole-value argument is "the winning arm reads every member the
        // program WROTE". That is only sound when every member the source has
        // is actually THERE. A member typed `T | undefined` may be absent at
        // run time, so an arm "holding" it says nothing about whether the
        // program wrote it, and the count of dropped members stops being
        // evidence of anything.
        //
        // That is exactly what separates the two sites, read off the emitted
        // messages rather than guessed:
        //   drmax3.ts:313   src `{ remoteJid: string; id: string; fromMe: boolean }`
        //                   — three members, ALL REQUIRED, a literal binding.
        //   messages.ts:497 src `{ $unknowns: Uint8Array[] | undefined;
        //                   accessibilityLabel: null | string | undefined;
        //                   backgroundArgb: number | null | undefined; … }`
        //                   — the MERGE of a six-arm union produced by
        //                   `{ ...content, media, mimetype }`, whose members are
        //                   optional precisely BECAUSE they come from different
        //                   arms. A merged-union spread is the canonical shape
        //                   this must not resolve, and "every member is
        //                   required" is the property it can never have.
        //
        // So: require every member of the SOURCE to be present-by-type. Any
        // undefined-admitting member and the refinement declines and the site
        // keeps whatever fence it had.
        const admitsUndefined = (t: IrType): boolean =>
          t.kind === "undefinedT" ||
          (t.kind === "union" && this.armTag(t.unionId, UNDEFINED_T) >= 0);
        const srcFields = this.shapes.get(src.shapeId)?.fields ?? [];
        const everySrcMemberPresent =
          srcFields.length > 0 && !srcFields.some((f) => admitsUndefined(f.type));
        const whole =
          overlapping.length > 1 && everySrcMemberPresent
            ? overlapping.filter((c) => {
                if (c.arm.kind !== "record") return false;
                const armNames = new Set((this.shapes.get(c.arm.shapeId)?.fields ?? []).map((f) => f.name));
                for (const n of srcNames) if (!armNames.has(n)) return false;
                return true;
              })
            : [];
        // SCRIPTC_ARMSET_WHY=1 — the ARM-SET dump. The comment on the SC2003
        // diagnostic records that an env-gated dump of exactly this was used to
        // tell zapo's three SC2003s apart and that the two type prints the
        // diagnostic carries CANNOT do it (L.fmt caps at 4012 characters, so two
        // protobuf mega-records print identically and are still different
        // types). It was not left in the tree, and the next block had to build
        // it again. It prints NAMES, which is what the three filters actually
        // decide on, and it names which filter declined.
        if (process.env["SCRIPTC_ARMSET_WHY"]) {
          const names = (t: IrType): string =>
            t.kind === "record"
              ? "{" + (this.shapes.get(t.shapeId)?.fields ?? []).map((f) => f.name).join(",") + "}"
              : t.kind;
          const verdict =
            whole.length === 1
              ? "LIFTS (whole-value)"
              : overlapping.length === 1
                ? "LIFTS (zero-overlap)"
                : !everySrcMemberPresent && overlapping.length > 1
                  ? "DECLINES (presence guard: a source member admits undefined)"
                  : `DECLINES (${candidates.length} candidates, ${overlapping.length} overlapping, ${whole.length} whole)`;
          process.stderr.write(
            `ARMSET ${verdict}\n  src=${names(src)}\n` +
              def.arms.map((a, i) => `  arm[${i}]=${names(a)}\n`).join(""),
          );
        }
        if (whole.length === 1) {
          return { how: "liftWrap", tag: whole[0]!.tag, arm: whole[0]!.arm };
        }
      }
      if (candidates.length !== 1) return null;
      return { how: "liftWrap", tag: candidates[0]!.tag, arm: candidates[0]!.arm };
    }
    // A UNION source into a slot that is ONE of its arms (a width copy
    // whose target field narrowed — the option-table choices shape:
    // `value: boolean | string` copying into a `value: string` slot the
    // checker approved): the CHECKED extraction — narrowedArmHelper,
    // exactly `x!`'s machinery — the proven arm's payload comes out, any
    // other arm throws the catchable TypeError (divergence 38's stance).
    if (src.kind === "union" && !isUnitType(dst) && dst.kind !== "void" && this.armTag(src.unionId, dst) >= 0) {
      return { how: "narrow" };
    }
    // A DERIVED instance into a BASE-typed slot (`{ p: Q }` copying into
    // `{ p: P }`): the same implicit upcast coerceToExpected performs at
    // top level — prefix layout, a pointer reinterpret, no copy.
    if (
      dst.kind === "object" &&
      src.kind === "object" &&
      (this.isSubclassOf(src.className, dst.className) ||
        // ...and the DUPLEX WIDENING, which is the same reinterpret
        // without an extends edge. The top-level rule and this one are
        // the two copies of "may this instance widen"; they read the
        // same predicate so `f(pt)` and `f({ sink: pt })` cannot
        // disagree about a PassThrough in a Writable slot.
        streamDuplexWidensToWritable(src.className, dst.className, (a, b) => this.isSubclassOf(a, b)))
    ) {
      return { how: "upcast" };
    }
    // An IncomingMessage into a `Readable` FIELD (`{ body: res }` copying
    // into a `{ body: Readable }` slot). The second copy of "may this
    // response widen", the duplex lesson applied before it could bite:
    // one predicate, so `f(res)` and `f({ body: res })` answer the same.
    if (httpReqIsReadableIn(src, dst)) return { how: "httpBody" };
    // A FUNCTION into a slot whose signature differs only by CLEAN
    // mechanical conversions (fewer params — JS ignores extras — and
    // coercibleValue pieces): the general function-value adapter, plan-
    // gated to the clean subset. The stranded (trap-only) dispositions
    // funcCoerceAdapter also builds stay TOP-LEVEL only: a width plan
    // never promises a bridge that can only throw.
    if (dst.kind === "func" && src.kind === "func" && this.cleanFuncAdaptable(src, dst)) {
      return { how: "funcAdapt" };
    }
    if (dst.kind === "record" && src.kind === "record") {
      // An INDEX-SIGNATURE target is the overflow-CAPTURE flow, not the
      // field-list width copy (recordWidthPlan refuses it): a source
      // record's declared fields become keyed writes into a fresh hybrid
      // (`attrs: {}` into `{ [key: string]: string }` — an empty source
      // captures to an empty map; a `{ a: 1 }` source writes its fields
      // through). widthCoerce owns this at top level; nesting it here
      // lets a FIELD of an outer width copy carry an index-signature
      // record too (the BinaryNode `attrs` field).
      if (this.shapes.get(dst.shapeId)?.indexValue !== undefined) {
        return ovfCapturePlannable(this, src.shapeId, dst.shapeId) ? { how: "ovfCapture" } : null;
      }
      return this.recordWidthPlan(src.shapeId, dst.shapeId) !== null ? { how: "width" } : null;
    }
    if (dst.kind === "record" && src.kind === "object") {
      if (this.objToRecordPlan(src.className, dst.shapeId) !== null) return { how: "objWidth" };
      // The constructor-witness projection is more capable — async and
      // OPTIONAL methods (the store interfaces: `destroy?: () => Promise<
      // void>`), which the plain plan declines — so a class→record width
      // lift falls back to it. Interned by (class, shape), so the synthetic
      // loc here is harmless; the build reuses the same helper.
      const synthLoc: SrcLoc = { file: "<width>", start: 0, end: 0 };
      if (this.ctorWitnessProjection(src.className, dst, synthLoc) !== null) return { how: "objWidth" };
      return null;
    }
    if (dst.kind === "object" && src.kind === "record") {
      return this.recordToClassPlan(src.shapeId, dst.className) !== null ? { how: "clsWidth" } : null;
    }
    if (dst.kind === "array" && src.kind === "array") {
      if (this.widthLiftPlan(src.elem, dst.elem) !== null) return { how: "arr" };
      // The EMPTY-array lift: a unit-only element type (`readonly []`
      // mapped as the unit-element array, `(null | undefined)[]`) has no
      // per-element conversion into a data element — but the only value
      // such a slot honestly holds in the width family is EMPTY, so the
      // lift is a fresh empty array of the target type, guarded by a
      // runtime non-empty trap (the checked-extraction stance).
      if (this.unitOnlyElem(src.elem) && dst.elem.kind !== "jsval" && !this.unitOnlyElem(dst.elem)) {
        return { how: "emptyArr" };
      }
      return null;
    }
    // A TUPLE flowing into an array FIELD/ELEMENT (`aliases: ["ls"]` into
    // an `aliases: string[]` slot): per-position lifts, the top-level
    // tuple-into-array coercion applied recursively.
    if (dst.kind === "array" && src.kind === "record" && dst.elem.kind !== "jsval") {
      const from = this.shapes.get(src.shapeId);
      if (from?.tuple && from.fields.every((f) => this.widthLiftPlan(f.type, dst.elem) !== null)) {
        return { how: "tupleArr" };
      }
      return null;
    }
    return null;
  }

  /** True for the unit-only element types (`(null | undefined)[]`, the
   * `readonly []` mapping): a union whose every arm is a unit. */
  unitOnlyElem(t: IrType): boolean {
    if (t.kind !== "union") return false;
    const def = this.unions.get(t.unionId);
    return def !== undefined && def.arms.every((a) => isUnitType(a));
  }

  /** The build side of widthLiftPlan: the IrExpr converting `value` into
   * `dst` under a plan the caller validated. Interns whatever helpers the
   * lift needs (planned first, so the interns cannot fail — a failure here
   * is a lowerer bug, not a user diagnostic). */
  applyWidthLift(lift: WidthLift, value: IrExpr, dst: IrType, loc: SrcLoc): IrExpr {
    switch (lift.how) {
      case "copy":
        return value;
      case "wrap": {
        if (dst.kind !== "union") throw new Error("lowerer bug: wrap lift against a non-union");
        return { kind: "unionWrap", unionId: dst.unionId, tag: lift.tag, value, type: dst, loc };
      }
      case "retag": {
        if (dst.kind !== "union" || value.type.kind !== "union") throw new Error("lowerer bug: retag lift shape");
        const retag = this.unionRetagHelper(value.type.unionId, dst.unionId, loc);
        if (!retag) throw new Error("lowerer bug: planned retag lift failed to intern");
        return { kind: "call", callee: retag, args: [value], type: dst, loc };
      }
      case "liftWrap": {
        if (dst.kind !== "union") throw new Error("lowerer bug: liftWrap lift against a non-union");
        const inner = this.widthLiftPlan(value.type, lift.arm);
        if (!inner) throw new Error("lowerer bug: planned liftWrap arm stopped lifting");
        const lifted = this.applyWidthLift(inner, value, lift.arm, loc);
        return { kind: "unionWrap", unionId: dst.unionId, tag: lift.tag, value: lifted, type: dst, loc };
      }
      case "width": {
        if (dst.kind !== "record" || value.type.kind !== "record") throw new Error("lowerer bug: width lift shape");
        const helper = this.recordWidthHelper(value.type.shapeId, dst.shapeId, loc);
        if (!helper) throw new Error("lowerer bug: planned width lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "ovfCapture": {
        if (dst.kind !== "record" || value.type.kind !== "record") throw new Error("lowerer bug: ovfCapture lift shape");
        const helper = lowerRecordOvfCaptureHelper(this, value.type.shapeId, dst.shapeId, loc);
        if (!helper) throw new Error("lowerer bug: planned ovfCapture lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "arr": {
        if (dst.kind !== "array" || value.type.kind !== "array") throw new Error("lowerer bug: arr lift shape");
        const helper = this.arrayWidthHelper(value.type, dst, loc);
        if (!helper) throw new Error("lowerer bug: planned arr lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "tupleArr": {
        if (dst.kind !== "array" || value.type.kind !== "record") throw new Error("lowerer bug: tupleArr lift shape");
        const helper = this.tupleArrayWidthHelper(value.type.shapeId, dst, loc);
        if (!helper) throw new Error("lowerer bug: planned tupleArr lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "emptyArr": {
        if (dst.kind !== "array" || value.type.kind !== "array") throw new Error("lowerer bug: emptyArr lift shape");
        const helper = this.emptyArrayLiftHelper(value.type, dst, loc);
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "objWidth": {
        if (dst.kind !== "record" || value.type.kind !== "object") throw new Error("lowerer bug: objWidth lift shape");
        const helper = this.objRecordWidthHelper(value.type.className, dst.shapeId, loc);
        if (!helper) throw new Error("lowerer bug: planned objWidth lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "clsWidth": {
        if (dst.kind !== "object" || value.type.kind !== "record") throw new Error("lowerer bug: clsWidth lift shape");
        const helper = this.recordClassWidthHelper(value.type.shapeId, dst.className, loc);
        if (!helper) throw new Error("lowerer bug: planned clsWidth lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "narrow": {
        if (value.type.kind !== "union") throw new Error("lowerer bug: narrow lift on a non-union");
        const helper = this.narrowedArmHelper(value.type.unionId, dst, loc);
        if (!helper) throw new Error("lowerer bug: planned narrow lift failed to intern");
        return { kind: "call", callee: helper, args: [value], type: dst, loc };
      }
      case "dynIn": {
        if (dst.kind !== "dyn") throw new Error("lowerer bug: dynIn lift against a non-dyn slot");
        return { kind: "dynFrom", value, type: DYN, loc };
      }
      case "dynOut": {
        if (value.type.kind !== "dyn" || dst.kind === "dyn") throw new Error("lowerer bug: dynOut lift shape");
        return { kind: "dynCheck", value, type: dst, loc };
      }
      case "upcast": {
        if (dst.kind !== "object" || value.type.kind !== "object") throw new Error("lowerer bug: upcast lift shape");
        return this.upcastTo(value, dst.className);
      }
      case "httpBody": {
        if (!httpReqIsReadableIn(value.type, dst)) throw new Error("lowerer bug: httpBody lift shape");
        return this.httpBodyStream(value);
      }
      case "funcAdapt": {
        if (dst.kind !== "func" || value.type.kind !== "func") throw new Error("lowerer bug: funcAdapt lift shape");
        const adapter = this.funcCoerceAdapter(value.type, dst, loc);
        if (!adapter) throw new Error("lowerer bug: planned funcAdapt lift failed to intern");
        return { kind: "call", callee: adapter, args: [value], type: dst, loc };
      }
      default: {
        const _exhaustive: never = lift;
        void _exhaustive;
        throw new Error("unreachable");
      }
    }
  }

  /** Interned `%rec.width.<n>(r)` — builds the target shape from a source
   * record by copying fields: every target field must exist on the source
   * with the EXACT same type, or with a type that LIFTS under
   * widthLiftPlan — an arm value wraps (`text: string` into
   * `text?: string`), a whole union re-tags (unionRetagMappable), a field
   * whose own record/array type needs narrowing reshapes RECURSIVELY
   * (nested width — the copy stance applies per level), and a MISSING
   * optional-flavored field completes to its undefined arm (the
   * literal-completion rule). TUPLES width-coerce too, arity-exact (TS
   * permits no other tuple width): per-position lifts, never completion.
   * Index-signature SOURCES narrow here like any wider record — declared
   * fields copy, the overflow drops with the width (missing target
   * fields decline: the overflow could hold them). Index-signature
   * TARGETS keep the overflow CAPTURE helper (widthCoerce's other arm).
   * Null when the shapes don't relate that way. */
  /** The pure planning half of recordWidthHelper — every target field's
   * lift, or null when the pair isn't width-coercible. Callers that must
   * validate a WHOLE plan before interning anything (the retag helper's
   * per-arm width lifts) probe with this. */
  recordWidthPlan(fromId: string, toId: string): Map<string, { src: IrType; lift: WidthLift } | { absent: true; utag: number } | { absentDyn: true } | { keyRead: IrType; lift: WidthLift }> | null {
    const from = this.shapes.get(fromId);
    const to = this.shapes.get(toId);
    // INDEX-SIGNATURE sources narrow like any wider record — the target
    // fields copy off the declared struct slots and the overflow drops
    // with the rest of the width (divergence 36's stance; the absent-
    // completion rule below is the one extra fence). Index-signature
    // TARGETS keep the overflow CAPTURE helper (widthCoerce's other arm):
    // a fresh hybrid needs keyed writes, not a field-list literal.
    if (!from || !to || to.indexValue) return null;
    // Tuple↔record pairs never relate; tuple↔tuple only arity-exact.
    if (!!from.tuple !== !!to.tuple) return null;
    if (from.tuple && from.fields.length !== to.fields.length) return null;
    const key = `${fromId}:${toId}`;
    // Recursive shapes: an in-progress pair re-entered through its own
    // fields answers "assume coercible" — see widthPlanning.
    if (this.widthPlanning.has(key)) return new Map();
    this.widthPlanning.add(key);
    try {
      type FieldLift =
        | { src: IrType; lift: WidthLift }
        | { absent: true; utag: number }
        | { absentDyn: true }
        | { keyRead: IrType; lift: WidthLift };
      const plan = new Map<string, FieldLift>();
      for (const tf of to.fields) {
        const ff = from.fields.find((f) => f.name === tf.name);
        if (!ff) {
          // A target field MISSING on the source: legal exactly when it is
          // optional-flavored (an undefined-armed union) — the unset field
          // IS the undefined arm, the same rule literal completion applies
          // — or 'unknown' (a dyn slot holds the dyn undefined, exactly
          // the absent-property read: the options-record call shape
          // against `{ plugins: unknown, ... }`). Never for tuples: a
          // completed position would change .length and JSON where Node
          // keeps the source arity.
          if (from.tuple) return null;
          // An INDEX-SIGNATURE source: the overflow MAY hold this very key
          // at runtime (tsc lets the signature satisfy an optional target
          // member), so completing to undefined would drop a value Node
          // keeps. It does not have to be completed — it can be READ. The
          // `Record<string, V>` accumulator returned as the declared shape
          // (`const s: Record<string, WaPrivacyValue> = {}; …; return s`
          // against `{ about?: string; … }`) reads each target field off
          // the overflow map by its literal key: present is the value,
          // absent is the undefined arm — exactly the absent-property
          // read's answer, and exactly what Node's own property read
          // would give. The read's type is `V | undefined` (the same type
          // a keyed access on this shape has), which then lifts into the
          // field like any other source. A field the read cannot reach
          // that way — a REQUIRED target field (no undefined arm to carry
          // "the map has no such key") — still declines the pair.
          if (from.indexValue) {
            // The field must be able to hold ABSENT — the same
            // optional-flavored test the completion rule above applies.
            // Without it the read's undefined would have to be narrowed or
            // stranded away, and a key the map simply does not hold would
            // THROW where the pair used to fence: a width plan never
            // promises a bridge that can only throw, and "the key might
            // not be there" is the whole reason this arm exists. (tsc
            // rejects an index signature as a REQUIRED member anyway, so
            // honest code never lands here.)
            const optionalFlavored =
              tf.type.kind === "dyn" ||
              (tf.type.kind === "union" && this.armTag(tf.type.unionId, UNDEFINED_T) >= 0);
            const readT = this.indexReadType(from.indexValue);
            // The read's own type is what lifts into the field — unless the
            // signature's value type is 'unknown'. Then the read is a DYN,
            // and the conversion that puts a dyn into a typed slot is not a
            // width lift at all: it is the VALIDATED extraction (dynCheck)
            // that coerceToExpected already applies to a dyn flowing into
            // any canDynCheckTo slot, and that coercibleValue already
            // answers yes for. The width family simply never offered it,
            // so `Record<string, unknown>` — the ordinary accumulator
            // spelling, and the ONLY shape tsc lets satisfy an all-optional
            // target through the index-signature hole — had no reshape at
            // all and stranded. Scoped to this arm on purpose: the keyed
            // read is the position with no other bridge, and widening the
            // whole relation would turn ordinary `unknown`-field fences
            // into copies nobody asked for.
            // A REQUIRED target field takes the CHECKED extraction and
            // nothing else. The rule above declines it because "a width
            // plan never promises a bridge that can only throw" — but
            // this bridge does not only throw: it succeeds for every
            // value whose overflow HOLDS the key, which is exactly the
            // value a reshape into an overflow-carrying shape produces,
            // and it throws only where the alternative was
            // strandedCoercionTrap's UNCONDITIONAL throw at the same
            // flow. Strictly better, and never a silent wrong answer.
            // Scoped by dynOutPlan's own domain, which is a DYN read type
            // — i.e. an `unknown`-valued signature, the checked-dynamic
            // boundary where the validated extraction is already the
            // conversion this compiler uses (`as T` on a dyn, dynCheck in
            // coerceToExpected, coercibleValue's dyn answer). A
            // `Record<string, string>` source still declines: its read
            // type is `string | undefined`, which dynOutPlan refuses.
            const lift = optionalFlavored
              ? (this.widthLiftPlan(readT, tf.type) ?? this.dynOutPlan(readT, tf.type))
              : this.dynOutPlan(readT, tf.type);
            if (process.env.SCRIPTC_KEYREAD_WHY) {
              console.error(
                `KEYREAD plan ${fromId}->${toId} field=${tf.name} read=${this.fmt(readT)} want=${this.fmt(tf.type)} opt=${optionalFlavored} lift=${lift?.how ?? "NONE"}`,
              );
            }
            if (!lift) return null;
            plan.set(tf.name, { keyRead: readT, lift });
            continue;
          }
          if (tf.type.kind === "dyn") {
            plan.set(tf.name, { absentDyn: true });
            continue;
          }
          if (tf.type.kind !== "union") return null;
          const def = this.unions.get(tf.type.unionId);
          const utag = def ? def.arms.findIndex((a) => a.kind === "undefinedT") : -1;
          if (utag < 0) return null;
          plan.set(tf.name, { absent: true, utag });
          continue;
        }
        // A DYN source field into a slot dynCheck can check is the
        // VALIDATED EXTRACTION, exactly as coerceToExpected applies it to
        // a dyn value flowing into that same slot at top level. Without
        // this rung the two disagree: `f(u)` compiles and `f({ m: u })`
        // does not, for the same `u` and the same slot — the "one
        // predicate, so f(pt) and f({ sink: pt }) answer the same" rule
        // this file already states for stream widening, applied to the
        // dyn boundary. It is a checked lift, like `narrow` and like the
        // keyed read above, and it is offered here for the same reason:
        // the alternative at this position is strandedCoercionTrap's
        // unconditional throw. zapo's driver is the site — its hand-written
        // event type declares `message?: unknown` where the library's
        // declares `message?: Proto.IMessage`.
        const lift = this.widthLiftPlan(ff.type, tf.type) ?? this.dynOutPlan(ff.type, tf.type);
        if (!lift) return null;
        plan.set(tf.name, { src: ff.type, lift });
      }
      return plan;
    } finally {
      this.widthPlanning.delete(key);
    }
  }

  /** The VALIDATED extraction as a width-plan step: a DYN source into a
   * slot dynCheck can check. Exactly coerceToExpected's own dyn rule and
   * exactly coercibleValue's `src.kind === "dyn"` answer — the same
   * canDynCheckTo domain the `as T` cast path and the IR validator apply —
   * so a position taking this plan agrees with the top-level conversion
   * instead of stranding. It can THROW (a value that does not match the
   * slot gets the catchable TypeError, divergence 38's stance), which is
   * why it is not folded into widthLiftPlan for every caller: `narrow` is
   * the precedent for a checked lift, and like `narrow` it is offered only
   * where the alternative is worse. Null for anything else. */
  dynOutPlan(src: IrType, dst: IrType): WidthLift | null {
    if (src.kind !== "dyn" || dst.kind === "dyn") return null;
    return canDynCheckTo(dst, (id) => this.shapes.get(id), (id) => this.unions.get(id)) ? { how: "dynOut" } : null;
  }

  /** The type a KEYED read of an index-signature shape has, for a key that
   * names no declared field: the signature's value type widened by the
   * undefined a missing key produces. A dyn signature already carries its
   * own undefined singleton (recordKeyGet's dyn rule), so it answers
   * itself; every other value type gains the undefined arm. */
  indexReadType(indexValue: IrType): IrType {
    if (indexValue.kind === "dyn") return DYN;
    if (indexValue.kind === "union" && this.armTag(indexValue.unionId, UNDEFINED_T) >= 0) return indexValue;
    const arms =
      indexValue.kind === "union"
        ? [...(this.unions.get(indexValue.unionId)?.arms ?? []), UNDEFINED_T]
        : [indexValue, UNDEFINED_T];
    return { kind: "union", unionId: this.unions.intern(arms) };
  }

  /** Post-hoc classifier for SC2002's record→record residue: WHY the
   * width family (recordWidthPlan and the overflow capture — widthCoerce's
   * two record arms) declined this pair — the FIRST blocking rule, named.
   * Pure description on the failure path (the site already carries the
   * rejection): mirrors the planners' gates, never changes what coerces,
   * and answers null when no pointed story applies (the generic message
   * stands). */
  describeRecordWidthBlocker(fromId: string, toId: string): string | null {
    const from = this.shapes.get(fromId);
    const to = this.shapes.get(toId);
    if (!from || !to) return null;
    if (to.indexValue) {
      // The overflow CAPTURE's gates (lowerRecordOvfCaptureHelper).
      if (from.tuple || to.tuple) return "a tuple cannot reshape into an index-signature record";
      const tIv = to.indexValue;
      const slotOk = (t: IrType): boolean =>
        typeEquals(t, tIv) ||
        (tIv.kind === "dyn" && (t.kind === "dyn" || this.dynConvertible(t))) ||
        this.widthLiftPlan(t, tIv) !== null ||
        dynSlotCheckOk(this, t, tIv);
      const consumed = new Set<string>();
      for (const tf of to.fields) {
        const sf = from.fields.find((f) => f.name === tf.name);
        if (sf) {
          if (this.widthLiftPlan(sf.type, tf.type) !== null) {
            consumed.add(tf.name);
            continue;
          }
          return `field '${tf.name}': '${this.fmt(sf.type)}' does not lift into '${this.fmt(tf.type)}'`;
        }
        if (tf.type.kind !== "union" || this.armTag(tf.type.unionId, UNDEFINED_T) < 0) {
          return `the expected field '${tf.name}' is required and the source has no field to copy into it`;
        }
        if (tIv.kind === "dyn" ? !this.dynConvertible(tf.type) : !typeEquals(tf.type, tIv)) {
          return `the expected field '${tf.name}' ('${this.fmt(tf.type)}') cannot take a runtime key collision from the '${this.fmt(tIv)}' signature slot`;
        }
      }
      for (const ff of from.fields) {
        if (consumed.has(ff.name)) continue;
        if (!slotOk(ff.type)) {
          return `the source field '${ff.name}' ('${this.fmt(ff.type)}') cannot enter the expected '[key: string]: ${this.fmt(tIv)}' slot`;
        }
      }
      if (from.indexValue && !slotOk(from.indexValue)) {
        return `the source's '[key: string]: ${this.fmt(from.indexValue)}' slot cannot enter the expected '[key: string]: ${this.fmt(tIv)}' slot`;
      }
      // The dispatch-writes gate: runtime-keyed writes can collide with a
      // declared field whose type is not the slot's.
      const dispatchWrites =
        from.indexValue !== undefined ||
        from.fields.some((ff) => !consumed.has(ff.name) && to.fields.some((f) => f.name === ff.name));
      if (dispatchWrites) {
        const bad = to.fields.find((f) =>
          tIv.kind === "dyn" ? !this.dynConvertible(f.type) : !typeEquals(f.type, tIv),
        );
        if (bad) {
          return `runtime-keyed writes can collide with the expected field '${bad.name}' ('${this.fmt(bad.type)}'), which cannot take a '${this.fmt(tIv)}' slot value`;
        }
      }
      return null;
    }
    // The field-copy plan's gates (recordWidthPlan).
    if (!!from.tuple !== !!to.tuple) return null;
    if (from.tuple && from.fields.length !== to.fields.length) {
      return `tuple arities differ (${from.fields.length} vs ${to.fields.length}; TS permits no tuple width)`;
    }
    for (const tf of to.fields) {
      const ff = from.fields.find((f) => f.name === tf.name);
      if (!ff) {
        if (from.tuple) return null;
        if (from.indexValue) {
          // The keyed READ takes this field where it can (recordWidthPlan's
          // keyRead arm); what is left is a target field the read's own
          // type cannot reach — a REQUIRED field above all, which has no
          // undefined arm to carry "the map has no such key".
          const readT = this.indexReadType(from.indexValue);
          const optionalFlavored =
            tf.type.kind === "dyn" ||
            (tf.type.kind === "union" && this.armTag(tf.type.unionId, UNDEFINED_T) >= 0);
          return optionalFlavored
            ? `the expected field '${tf.name}' is not a declared field of the source, and a keyed read of its '[key: string]: ${this.fmt(from.indexValue)}' signature ('${this.fmt(readT)}' — the key may be absent) does not lift into '${this.fmt(tf.type)}'`
            : `the expected field '${tf.name}' ('${this.fmt(tf.type)}') is required, and a keyed read of the source's '[key: string]: ${this.fmt(from.indexValue)}' signature ('${this.fmt(readT)}') is not a value the checked extraction can turn into it`;
        }
        if (tf.type.kind === "dyn") continue;
        if (tf.type.kind !== "union" || this.armTag(tf.type.unionId, UNDEFINED_T) < 0) {
          return `the expected field '${tf.name}' is missing on the source and is not optional`;
        }
        continue;
      }
      if (this.widthLiftPlan(ff.type, tf.type) === null && this.dynOutPlan(ff.type, tf.type) === null) {
        return `field '${tf.name}': '${this.fmt(ff.type)}' does not lift into '${this.fmt(tf.type)}'`;
      }
    }
    return null;
  }

  recordWidthHelper(fromId: string, toId: string, loc: SrcLoc): string | null {
    const from = this.shapes.get(fromId);
    const to = this.shapes.get(toId);
    if (!from || !to) return null;
    // Plan every target field BEFORE interning anything (interned helpers
    // are part of the emitted program; a later field's failure must not
    // orphan one).
    const plan = this.recordWidthPlan(fromId, toId);
    if (!plan) return null;
    // The DROP, recorded against the interned HELPER rather than the target
    // shape: every call of this helper produces a value missing these keys,
    // and no other construction of the shape does. JS's narrowed value is
    // the SAME object and keeps them; the struct copy ends them.
    const droppedByWidth = from.fields.filter(
      (f) => !f.name.startsWith("%") && !to.fields.some((t) => t.name === f.name),
    );
    const key = `rec:${fromId}:${toId}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%rec.width.${this.widthHelpers.size}`;
    if (droppedByWidth.length > 0) {
      this.keyRiskHelpers.set(name, {
        why: "set",
        detail: `a width copy from ${fromId} into ${toId} ends ${droppedByWidth.map((f) => JSON.stringify(f.name)).join(", ")}`,
      });
    }
    // Interned BEFORE the body builds: a recursive nested-width field
    // (self-referential shapes) resolves to this helper itself.
    this.widthHelpers.set(key, name);
    const fromT: IrType = { kind: "record", shapeId: fromId };
    const toT: IrType = { kind: "record", shapeId: toId };
    const r: IrExpr = { kind: "varRef", localId: "r.0", type: fromT, loc };
    this.liftedFns.push({
      name,
      params: [{ localId: "r.0", name: "r", type: fromT }],
      returnType: toT,
      locals: [{ id: "r.0", name: "r", type: fromT, mutable: true }],
      body: [
        {
          kind: "return",
          value: {
            kind: "recordLit",
            fields: to.fields.map((f) => {
              const lift = plan.get(f.name)!;
              if ("absentDyn" in lift) {
                // The unset 'unknown' field: the dyn undefined — exactly
                // the absent-property read's answer.
                return { name: f.name, value: dynUndefinedExpr(loc) };
              }
              if ("keyRead" in lift) {
                if (process.env.SCRIPTC_KEYREAD_WHY) {
                  console.error(`KEYREAD emit ${fromId}->${toId} field=${f.name}`);
                }
                // A field the INDEX SIGNATURE may hold: read it by its
                // literal key off the overflow map. `overflowOnly` is
                // exact here — the plan only takes this arm for a name
                // the source shape does NOT declare — and the read
                // answers the undefined arm when the key is absent.
                const read: IrExpr = {
                  kind: "recordKeyGet",
                  obj: r,
                  shapeId: fromId,
                  key: { kind: "strLit", value: f.name, type: STRING, loc },
                  overflowOnly: true,
                  type: lift.keyRead,
                  loc,
                };
                return { name: f.name, value: this.applyWidthLift(lift.lift, read, f.type, loc) };
              }
              if ("absent" in lift) {
                if (f.type.kind !== "union") throw new Error("lowerer bug: absent lift against a non-union field");
                // The unset optional field: build the undefined arm.
                return {
                  name: f.name,
                  value: {
                    kind: "unionWrap",
                    unionId: f.type.unionId,
                    tag: lift.utag,
                    value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
                    type: f.type,
                    loc,
                  } satisfies IrExpr,
                };
              }
              const get: IrExpr = { kind: "recordGet", obj: r, shapeId: fromId, field: f.name, type: lift.src, loc };
              return { name: f.name, value: this.applyWidthLift(lift.lift, get, f.type, loc) };
            }),
            type: toT,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%arr.width.<n>(a)` — the per-element copy loop over
   * widthLiftPlan's element lift: out = []; n = a.length; for (...)
   * out.push(lift(a[i])); return out. Record elements reshape
   * (recordWidthHelper), union elements wrap or re-tag (`number[]` into
   * `(number | undefined)[]`), nested arrays recurse. Null when the
   * element pair isn't width-liftable. */
  /** Interned `%tup.arr.<n>(t)` — rebuilds a TUPLE as an ARRAY: positions
   * read in order, each lifted into the element type under widthLiftPlan.
   * Null unless the source shape really is a tuple whose every position
   * lifts (records with named fields never relate to arrays). */
  tupleArrayWidthHelper(fromId: string, toT: IrType & { kind: "array" }, loc: SrcLoc): string | null {
    const from = this.shapes.get(fromId);
    if (!from || !from.tuple) return null;
    const lifts: WidthLift[] = [];
    for (const f of from.fields) {
      const lift = this.widthLiftPlan(f.type, toT.elem);
      if (!lift) return null;
      lifts.push(lift);
    }
    const key = `tuparr:${fromId}:${typeKey(toT.elem)}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%tup.arr.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const fromT: IrType = { kind: "record", shapeId: fromId };
    const t: IrExpr = { kind: "varRef", localId: "t.0", type: fromT, loc };
    this.liftedFns.push({
      name,
      params: [{ localId: "t.0", name: "t", type: fromT }],
      returnType: toT,
      locals: [{ id: "t.0", name: "t", type: fromT, mutable: true }],
      body: [
        {
          kind: "return",
          value: {
            kind: "arrayLit",
            elems: from.fields.map((f, i) =>
              this.applyWidthLift(
                lifts[i]!,
                { kind: "recordGet", obj: t, shapeId: fromId, field: f.name, type: f.type, loc },
                toT.elem,
                loc,
              ),
            ),
            type: toT,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%arr.empty.<n>(a)` — the EMPTY-array lift's build side: a
   * unit-only-element array reshapes into any data-element array by
   * answering a FRESH empty array, after a runtime non-empty trap (a
   * genuinely inhabited `(null | undefined)[]` cannot reshape — the
   * catchable-TypeError stance every checked extraction takes). */
  emptyArrayLiftHelper(fromT: IrType & { kind: "array" }, toT: IrType & { kind: "array" }, loc: SrcLoc): string {
    const key = `emptyarr:${typeKey(fromT.elem)}:${typeKey(toT.elem)}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%arr.empty.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const a: IrExpr = { kind: "varRef", localId: "a.0", type: fromT, loc };
    this.liftedFns.push({
      name,
      params: [{ localId: "a.0", name: "a", type: fromT }],
      returnType: toT,
      locals: [{ id: "a.0", name: "a", type: fromT, mutable: true }],
      body: [
        {
          kind: "if",
          cond: {
            kind: "bin",
            op: "!==",
            left: { kind: "arrIntrinsic", method: "length", receiver: a, args: [], type: F64, loc },
            right: { kind: "numLit", value: 0, type: F64, loc },
            type: BOOL,
            loc,
          },
          then: [
            {
              kind: "throw",
              value: {
                kind: "libCall",
                fn: "error.new",
                args: [{ kind: "strLit", value: `expected ${this.fmt(toT)} (a non-empty ${this.fmt(fromT)} has no elements the target can hold)`, type: STRING, loc }],
                type: { kind: "object", className: "%TypeError" },
                loc,
              },
              loc,
            },
          ],
          else_: [],
          loc,
        },
        { kind: "return", value: { kind: "arrayLit", elems: [], type: toT, loc }, loc },
      ],
      loc,
    });
    return name;
  }

  arrayWidthHelper(fromT: IrType & { kind: "array" }, toT: IrType & { kind: "array" }, loc: SrcLoc,): string | null {
    const fromElem = fromT.elem;
    const toElem = toT.elem;
    const elemLift = this.widthLiftPlan(fromElem, toElem);
    if (!elemLift || elemLift.how === "copy") return null;
    const key = `arr:${typeKey(fromElem)}:${typeKey(toElem)}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%arr.width.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const arrT: IrType = { kind: "array", elem: fromElem };
    const outT: IrType = { kind: "array", elem: toElem };
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const num = (value: number): IrExpr => ({ kind: "numLit", value, type: { kind: "f64" }, loc });
    const f64: IrType = { kind: "f64" };
    this.liftedFns.push({
      name,
      params: [{ localId: "a.0", name: "a", type: arrT }],
      returnType: outT,
      locals: [
        { id: "a.0", name: "a", type: arrT, mutable: true },
        { id: "out.0", name: "out", type: outT, mutable: false },
        { id: "n.0", name: "n", type: f64, mutable: false },
        { id: "i.0", name: "i", type: f64, mutable: true },
      ],
      body: [
        { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
        {
          kind: "varDecl",
          localId: "n.0",
          init: { kind: "arrIntrinsic", method: "length", receiver: ref("a.0", arrT), args: [], type: f64, loc },
          loc,
        },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0), loc },
          cond: { kind: "bin", op: "<", left: ref("i.0", f64), right: ref("n.0", f64), type: BOOL, loc },
          update: {
            kind: "assign",
            localId: "i.0",
            value: { kind: "bin", op: "+", left: ref("i.0", f64), right: num(1), type: f64, loc },
            loc,
          },
          body: [
            {
              kind: "exprStmt",
              expr: {
                kind: "arrIntrinsic",
                method: "push",
                receiver: ref("out.0", outT),
                args: [
                  this.applyWidthLift(
                    elemLift,
                    { kind: "arrayGet", arr: ref("a.0", arrT), index: ref("i.0", f64), type: fromElem, loc },
                    toElem,
                    loc,
                  ),
                ],
                type: f64,
                loc,
              },
              loc,
            },
          ],
          loc,
        },
        { kind: "return", value: ref("out.0", outT), loc },
      ],
      loc,
    });
    return name;
  }

  /** The planning half of objRecordWidthHelper — how a CLASS INSTANCE
   * projects into a record shape (tsc's structural view of classes makes
   * `new Point(0,0)` flow into `{x: number; y: number}` slots). Every
   * target field must be a plain instance FIELD on the class (inherited
   * included) whose type lifts, or a missing optional-flavored field
   * completing to its undefined arm, or a field the class satisfies through
   * a METHOD, which becomes a closure bound to the live instance
   * (boundMethodPlan). An ACCESSOR-satisfied field and a generic method
   * still decline. Builtin runtime layouts (the Error/EventEmitter/stream
   * chains) decline: their fields aren't plain emitted storage.
   *
   * This paragraph used to say a method-satisfied field made the plan
   * "decline instead of projecting a lie". It has not for a long time —
   * boundMethodPlan is five lines below and projects one — and the sentence
   * mattered, because the mix of a bound method and a copied data field IS
   * the lie SC6003 now reports (noteMixedProjection). Corrected rather than
   * deleted: the stance the sentence describes is the one somebody meant.
   *
   * Every decline here routes to ctorWitnessProjection (objRecordWidthHelper
   * calls it on a null plan), which re-checks most of them and declines
   * again — except the EventEmitter carve-out, which is deliberately more
   * permissive. */
  objToRecordPlan(className: string, toId: string): Map<string, ObjFieldProj> | null {
    const info = this.classes.get(className);
    const to = this.shapes.get(toId);
    if (!info || !to || to.indexValue || to.tuple) return null;
    // Reserved slots (%call hybrids, %get:/%set: accessor closures) are
    // not projectable storage.
    if (to.fields.some((f) => f.name.startsWith("%"))) return null;
    for (let c: ClassInfo | null = info; c; c = c.base) {
      if (c.builtinError || c.builtinEmitter || c.builtinStream !== undefined || c.def.runtime) return null;
    }
    const key = `obj:${className}:${toId}`;
    if (this.widthPlanning.has(key)) return new Map();
    this.widthPlanning.add(key);
    try {
      const plan = new Map<string, ObjFieldProj>();
      for (const tf of to.fields) {
        // A plain METHOD satisfying a func-typed target field projects as a
        // BOUND closure (capture the instance, call the method) — the slot
        // gets a callable that carries `this`. A getter (no single
        // projectable value), a generic method (no one concrete signature),
        // or a signature the slot cannot mirror declines the whole plan.
        const meth = findMethodOn(this, info, tf.name);
        if (meth && !findGenericMethodOn(this, info, tf.name)) {
          const bm = this.boundMethodPlan(info, tf.name, tf.type, meth.declarer.def.name, meth.sig);
          if (!bm) return null;
          plan.set(tf.name, bm);
          continue;
        }
        if (
          findMethodOn(this, info, `get:${tf.name}`) ||
          findGenericMethodOn(this, info, tf.name)
        ) {
          return null;
        }
        const ft = info.fields.get(tf.name);
        if (ft === undefined) {
          if (tf.type.kind !== "union") return null;
          const def = this.unions.get(tf.type.unionId);
          const utag = def ? def.arms.findIndex((a) => a.kind === "undefinedT") : -1;
          if (utag < 0) return null;
          plan.set(tf.name, { absent: true, utag });
          continue;
        }
        const lift = this.widthLiftPlan(ft, tf.type);
        if (!lift) return null;
        plan.set(tf.name, { src: ft, lift });
      }
      return plan;
    } finally {
      this.widthPlanning.delete(key);
    }
  }

  /** How a METHOD `name` on `info` fills a func-typed target field: bound
   * into a closure only when the slot mirrors the method's signature
   * EXACTLY — same arity, each parameter type equal, the return type equal.
   * A generator, an async method, a rest parameter, or an abstract method
   * with no concrete override below the receiver has no plain-closure form
   * and declines (the whole projection then falls back to the exact-shape
   * fence). Equality is strict on purpose: a mismatch would need an
   * adapting trampoline the record slot cannot describe, so the honest
   * answer is to decline rather than project a coerced call. */
  boundMethodPlan(
    info: ClassInfo,
    name: string,
    fieldType: IrType,
    declarer: string,
    sig: { params: ParamShape[]; ret: IrType; abstract?: true; async?: true; gen?: { yieldT: IrType; nextT: IrType } },
  ): { method: BoundMethodProj } | null {
    if (fieldType.kind !== "func" || fieldType.rest === true) return null;
    // An async method binds fine: the closure `() => this.m()` is SYNC and
    // returns the method's promise, and sig.ret is already the call-site
    // Promise<inner> (the field spells the same). A generator has no
    // plain-closure form. (ctorWitnessProjection admits async the same way.)
    if (sig.gen !== undefined) return null;
    if (sig.params.length !== fieldType.params.length) return null;
    for (let i = 0; i < sig.params.length; i++) {
      const p = sig.params[i]!;
      if (p.mode !== "required" && p.mode !== "omittable") return null;
      if (!typeEquals(p.type, fieldType.params[i]!)) return null;
    }
    if (!typeEquals(sig.ret, fieldType.ret)) return null;
    // An override can exist below the receiver's static class ⇒ the bound
    // call must dispatch dynamically; otherwise the declarer's body is the
    // single implementation and the call is direct. An abstract nearest
    // declaration with no override below has no body to bind — decline.
    const virtual = this.overrideBelow(info, name);
    if (sig.abstract === true && !virtual) return null;
    return { method: { declarer, name, virtual, func: fieldType } };
  }

  /** Arm this shape's HIDDEN per-instance toString slot (IrRecordShape
   * .tostr): from here on both backends lay out one trailing
   * `ScrClosure *` member on it, NULL on every fresh record, and every
   * ToString over the shape reads it instead of folding the constant.
   *
   * Monotone and order-free on purpose. It is called from BOTH directions
   * — a ToString read site over the shape, and a class→record projection
   * whose class has a callable toString — and the two can be lowered in
   * either order: the read sites are backend branches over a slot that is
   * NULL unless a fill wrote it, and the fill sites emit the store from
   * the recordLit node the backend sizes from the same flag. So neither
   * has to run first, and a shape nobody reads and nobody fills never
   * grows the member. */
  markToStrSlot(shapeId: string): void {
    const shape = this.shapes.get(shapeId);
    // Tuples print their ELEMENTS (Array.prototype.toString), never the
    // constant, so there is no slot answer for them; index-signature
    // shapes carry the slot fine (the member sits after the overflow map).
    if (!shape || shape.tuple) return;
    shape.tostr = true;
  }

  /** The `() => string` closure that fills a projected record's hidden
   * toString slot, or null when the class has no toString this compiler
   * can call. Interned per class; captures the projection helper's own
   * instance local, exactly like boundMethodClosure.
   *
   * The BODY is classToStringDispatch — the same dispatch `x.toString()`
   * on the class-typed spelling already emits, virtual where an override
   * can sit below, direct otherwise, omitted-optional arguments minted the
   * way an ordinary omitted argument is. A class with NO toString anywhere
   * answers null here and the slot stays NULL, which is right: the
   * constant IS Node's answer for it. */
  toStringSlotClosure(recvClass: string, loc: SrcLoc, captureLocalId = "o.0"): IrExpr | null {
    const info = this.classes.get(recvClass);
    if (!info || !info.decl) return null;
    const recvT: IrType = { kind: "object", className: recvClass };
    // ONE slot, and `+` reads it too (ensureStringForPlus routes records
    // through ensureString), so the slot may only be filled where the
    // STRING hint and the DEFAULT hint have the SAME answer. They do
    // exactly when the value has no valueOf of its own: Object.prototype
    // .valueOf returns the object and falls through to toString. A class
    // that declares one is the case where they differ — measured on Node
    // v25.9.0, `"" + {valueOf:()=>42, toString:()=>"TS"}` is "42" while
    // String() of it is "TS" — so the slot stays empty there and both
    // spellings keep the constant they answer today. A named remainder,
    // not a regression: nothing that answers correctly now stops.
    if (classHasOwnValueOf(this, recvT)) return null;
    const probe = classToStringDispatch(this, { kind: "varRef", localId: "self.0", type: recvT, loc }, loc);
    if (probe === null) return null;
    const slotT = funcOf([], STRING);
    const key = `tostrslot:${recvClass}`;
    const existing = this.widthHelpers.get(key);
    const name = existing ?? `%tostr.${this.widthHelpers.size}`;
    if (!existing) {
      this.widthHelpers.set(key, name);
      this.liftedFns.push({
        name,
        params: [],
        returnType: STRING,
        captures: [{ localId: "self.0", name: "self", type: recvT }],
        locals: [{ id: "self.0", name: "self", type: recvT, mutable: false, boxed: true }],
        body: [{ kind: "return", value: probe, loc }],
        loc,
      });
    }
    return { kind: "closure", fnName: name, captures: [captureLocalId], type: slotT, loc };
  }

  /** The BOUND-METHOD closure a projected method field becomes: a closure
   * over an interned `%boundmeth.<n>` that captures the instance and calls
   * the method with the slot's own arguments. Interned per (receiver,
   * declarer, method, slot signature) and captures the width helper's `o.0`
   * instance param (boxed there so the capture can retain it). */
  boundMethodClosure(recvClass: string, proj: BoundMethodProj, loc: SrcLoc, captureLocalId = "o.0"): IrExpr {
    const key = `boundmeth:${recvClass}:${proj.declarer}:${proj.name}:${typeKey(proj.func)}`;
    const existing = this.widthHelpers.get(key);
    const name = existing ?? `%boundmeth.${this.widthHelpers.size}`;
    if (!existing) {
      this.widthHelpers.set(key, name);
      const recvT: IrType = { kind: "object", className: recvClass };
      const self: IrExpr = { kind: "varRef", localId: "self.0", type: recvT, loc };
      const params = proj.func.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
      const argRefs: IrExpr[] = proj.func.params.map((t, i) => ({ kind: "varRef", localId: `p.${i}`, type: t, loc }));
      if (proj.virtual) this.noteVirtualEdge(this.classes.get(recvClass)!, proj.name);
      else this.noteEdge(`%${proj.declarer}.${proj.name}`);
      const call: IrExpr = proj.virtual
        ? {
            kind: "virtualCall",
            className: recvClass,
            method: proj.name,
            args: [this.upcastTo(self, recvClass), ...argRefs],
            type: proj.func.ret,
            loc,
          }
        : {
            kind: "call",
            callee: `%${proj.declarer}.${proj.name}`,
            args: [this.upcastTo(self, proj.declarer), ...argRefs],
            type: proj.func.ret,
            loc,
          };
      const body: IrStmt[] =
        proj.func.ret.kind === "void"
          ? [{ kind: "exprStmt", expr: call, loc }]
          : [{ kind: "return", value: call, loc }];
      this.liftedFns.push({
        name,
        params,
        returnType: proj.func.ret,
        captures: [{ localId: "self.0", name: "self", type: recvT }],
        locals: [
          { id: "self.0", name: "self", type: recvT, mutable: false, boxed: true },
          ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        ],
        body,
        loc,
      });
    }
    return { kind: "closure", fnName: name, captures: [captureLocalId], type: proj.func, loc };
  }

  /** `f.bind(thisArg, ...bound)` over a COMPILED FUNCTION VALUE: the real
   * bound function, as a closure over an interned `%bindthis.<n>` wrapper.
   *
   * This replaces an ERASURE. `f.bind(x)` used to compile to `f`, on the
   * stated reason that "a compiled function value carries no runtime
   * `this` to re-route" — which has been false since the ambient-receiver
   * window shipped: a plain JS function's `this` is `dyn.this`
   * (scr_dyn_this_get), the same innermost binding a firing site or a dyn
   * method dispatch pushes. So binding one IS expressible: capture the
   * receiver, open the window for the wrapped call's extent, close it on
   * the way out.
   *
   * The pop lives in a `finally` because the wrapped call can throw and
   * the emitted unwind is an early `return` — a bare push/call/pop would
   * leak a stack entry onto every later `this` read in the program.
   *
   * Leading bound arguments are captured and prepended, so the wrapper's
   * own arity is the REMAINING parameters — which is also what makes
   * `b.length` right for free. Rebinding needs no special case: the outer
   * wrapper pushes second and the inner pushes last, and the innermost
   * binding is what `dyn.this` answers, so the FIRST bind wins exactly as
   * JS specifies.
   *
   * Declines (and the caller keeps its fence) on a rest signature, on more
   * bound arguments than the target declares, and on a target or bound
   * argument whose type cannot ride a capture box. */
  bindThisClosure(fn: IrExpr, thisArg: IrExpr, boundArgs: IrExpr[], loc: SrcLoc): IrExpr | null {
    const ft = fn.type;
    if (ft.kind !== "func" || ft.rest === true) return null;
    if (thisArg.type.kind !== "dyn" && !this.dynConvertible(thisArg.type)) return null;
    if (boundArgs.length > ft.params.length) return null;
    for (let i = 0; i < boundArgs.length; i++) {
      if (!typeEquals(boundArgs[i]!.type, ft.params[i]!)) return null;
    }
    const rest = ft.params.slice(boundArgs.length);
    const outT = funcOf(rest, ft.ret);
    const key = `bindthis:${typeKey(ft)}:${boundArgs.length}`;
    const existing = this.widthHelpers.get(key);
    const name = existing ?? `%bindthis.${this.widthHelpers.size}`;
    if (!existing) {
      this.widthHelpers.set(key, name);
      const capParams: IrParam[] = [
        { localId: "bt.0", name: "bt", type: DYN },
        { localId: "tf.0", name: "tf", type: ft },
        ...boundArgs.map((_, i) => ({ localId: `b.${i}`, name: `b${i}`, type: ft.params[i]! })),
      ];
      const params: IrParam[] = rest.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
      const callArgs: IrExpr[] = [
        ...boundArgs.map((_, i) => ({ kind: "varRef" as const, localId: `b.${i}`, type: ft.params[i]!, loc })),
        ...rest.map((t, i) => ({ kind: "varRef" as const, localId: `p.${i}`, type: t, loc })),
      ];
      const call: IrExpr = {
        kind: "callValue",
        callee: { kind: "varRef", localId: "tf.0", type: ft, loc },
        args: callArgs,
        type: ft.ret,
        loc,
      };
      const body: IrStmt[] = [
        {
          kind: "exprStmt",
          expr: {
            kind: "libCall",
            fn: "dyn.thisPush",
            args: [{ kind: "varRef", localId: "bt.0", type: DYN, loc }],
            type: VOID,
            loc,
          },
          loc,
        },
        {
          kind: "tryCatch",
          tryBody:
            ft.ret.kind === "void"
              ? [{ kind: "exprStmt", expr: call, loc }]
              : [{ kind: "return", value: call, loc }],
          catchBody: null,
          catchLocalId: null,
          finallyBody: [
            { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.thisPop", args: [], type: VOID, loc }, loc },
          ],
          loc,
        },
      ];
      this.liftedFns.push({
        name,
        params,
        returnType: ft.ret,
        captures: capParams,
        locals: [
          ...capParams.map((c) => ({ id: c.localId, name: c.name, type: c.type, mutable: false, boxed: true as const })),
          ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        ],
        body,
        loc,
      });
    }
    // The creation site: one hidden BOXED local per capture (a capture can
    // only retain a box), initialized in order, then the closure over them.
    const ctx = this.ctx;
    const inits: IrStmt[] = [];
    const capIds: string[] = [];
    const hold = (init: IrExpr): void => {
      const n = ctx.localCounters.get("%bind") ?? 0;
      ctx.localCounters.set("%bind", n + 1);
      const id = `%bind.${n}`;
      ctx.locals.push({ id, name: "%bind", type: init.type, mutable: false, boxed: true });
      inits.push({ kind: "varDecl", localId: id, init, loc });
      capIds.push(id);
    };
    hold(thisArg.type.kind === "dyn" ? thisArg : { kind: "dynFrom", value: thisArg, type: DYN, loc });
    hold(fn);
    for (const a of boundArgs) hold(a);
    return {
      kind: "seqExpr",
      stmts: inits,
      result: { kind: "closure", fnName: name, captures: capIds, type: outT, loc },
      type: outT,
      loc,
    };
  }

  /** A class METHOD taken as a BOUND VALUE — `obj.m` / `obj.m.bind(obj)`,
   * the coordinator `.bind(this)` idiom — becomes a closure that captures
   * the receiver and calls the method. The receiver is bound into a fresh
   * BOXED hidden local (so the capture can retain it) initialized to the
   * lowered receiver; the value is a seqExpr of that declaration and the
   * closure over it. Null when the member is not a plain (non-generic)
   * bindable class method, or its signature has no plain-closure form. */
  boundMethodValue(access: ts.PropertyAccessExpression, loc: SrcLoc): IrExpr | null {
    const recvIr = this.mapTypeOf(this.typeOf(access.expression));
    if (recvIr?.kind !== "object") return null;
    const info = this.classes.get(recvIr.className);
    if (!info) return null;
    const meth = findMethodOn(this, info, access.name.text);
    if (!meth || findGenericMethodOn(this, info, access.name.text)) return null;
    const fnT = funcOf(meth.sig.params.map((p) => p.type), meth.sig.ret);
    const proj = this.boundMethodPlan(info, access.name.text, fnT, meth.declarer.def.name, meth.sig);
    if (!proj) return null;
    const recv = this.lowerExpr(access.expression);
    if (recv.type.kind !== "object") return null;
    const ctx = this.ctx;
    const count = ctx.localCounters.get("%bmrecv") ?? 0;
    ctx.localCounters.set("%bmrecv", count + 1);
    const recvId = `%bmrecv.${count}`;
    ctx.locals.push({ id: recvId, name: "%bmrecv", type: recv.type, mutable: false, boxed: true });
    const closure = this.boundMethodClosure(recvIr.className, proj.method, loc, recvId);
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: recvId, init: recv, loc }],
      result: closure,
      type: fnT,
      loc,
    };
  }

  /** Interned `%obj.width.<n>(o)` — builds a record from a class
   * instance's fields under objToRecordPlan: the width-copy stance
   * (divergence 305 — a fresh record, mutations don't alias, extra class
   * members drop). */
  /** An ARRAY flowing into a UNIFORM TUPLE slot: the positional copy.
   *
   * A const lookup table (`const T = ['a', 'b'] as const`) binds as an
   * array, because a computed read has to have a slot to read from; a
   * parameter that spells the tuple maps to a record. Same values, same
   * order, so the projection is position 0..n-1 read off the array.
   *
   * Through a helper because each position reads the source again and the
   * source must be evaluated ONCE — the parameter is what makes that
   * true, exactly as the other width helpers do it.
   *
   * Uniform targets only: every field must already hold the array's
   * element type, so no position can need a conversion of its own. The
   * arity is the shape's, and tsc proved the source has it. */
  arrayTupleWidthHelper(from: IrType & { kind: "array" }, toId: string, loc: SrcLoc): string | null {
    const to = this.shapes.get(toId);
    if (!to?.tuple || to.fields.length === 0 || to.indexValue) return null;
    if (!to.fields.every((f) => typeEquals(f.type, from.elem))) return null;
    const key = `arrtuple:${typeKey(from)}:${toId}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%arr.tuple.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const toT: IrType = { kind: "record", shapeId: toId };
    const a: IrExpr = { kind: "varRef", localId: "a.0", type: from, loc };
    this.liftedFns.push({
      name,
      params: [{ localId: "a.0", name: "a", type: from }],
      returnType: toT,
      locals: [{ id: "a.0", name: "a", type: from, mutable: true }],
      body: [
        {
          kind: "return",
          value: {
            kind: "recordLit",
            fields: to.fields.map((f, i) => ({
              name: f.name,
              value: {
                kind: "arrayGet",
                arr: a,
                index: { kind: "numLit", value: i, type: F64, loc },
                type: f.type,
                loc,
              } satisfies IrExpr,
            })),
            type: toT,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  objRecordWidthHelper(className: string, toId: string, loc: SrcLoc): string | null {
    const to = this.shapes.get(toId);
    if (!to) return null;
    const plan = this.objToRecordPlan(className, toId);
    // The plain plan declines async/optional-method targets (the store
    // interfaces); the constructor-witness projection handles them, and its
    // helper has the same shape (one instance param → the record), so the
    // width lift delegates to it.
    if (!plan) return this.ctorWitnessProjection(className, { kind: "record", shapeId: toId }, loc);
    const key = `obj:${className}:${toId}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%obj.width.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const fromT: IrType = { kind: "object", className };
    const toT: IrType = { kind: "record", shapeId: toId };
    const o: IrExpr = { kind: "varRef", localId: "o.0", type: fromT, loc };
    // MATERIALIZING loses the class's toString: the record that comes out
    // is, to every later question, a plain record, for which
    // "[object Object]" is Node's answer — and is a SILENT wrong answer
    // for a class that has one. The hidden slot carries it across; the
    // shape is armed here so both backends lay the member out.
    const toStr = this.toStringSlotClosure(className, loc);
    if (toStr) this.markToStrSlot(toId);
    // A method field binds the instance into a closure (boundMethodClosure
    // captures `o.0`); the capture retains it, so the instance param must
    // be a boxed local — and the toString slot's closure captures it the
    // same way. Plain data-class projections keep the raw pointer.
    const hasMethodField = to.fields.some((f) => "method" in plan.get(f.name)!);
    const boxInstance = hasMethodField || toStr !== null;
    // SCRIPTC_PROJ_CENSUS's missing half, and SC6003's second producer.
    // ctorWitnessProjection prints one line per interned projection; THIS
    // builder printed none, so every census of the mixed-projection
    // population taken from that dial alone was a lower bound. Same fields,
    // same spelling, so one parser reads both.
    {
      const lifted = to.fields.filter((f) => { const l = plan.get(f.name)!; return !("method" in l) && !("absent" in l); });
      const meth = to.fields.filter((f) => "method" in plan.get(f.name)!).length;
      if (process.env["SCRIPTC_PROJ_CENSUS"] !== undefined) {
        const abs = to.fields.filter((f) => "absent" in plan.get(f.name)!).length;
        const names = lifted.map((f) => f.name);
        console.error(`[projcensus] ${className} -> ${toId} methods=${meth} absent=${abs} lift=${names.length}${names.length > 0 ? ` [${names.join(",")}]` : ""}`);
      }
      this.noteMixedProjection(className, lifted.map((f) => ({ name: f.name, type: f.type })), meth, loc);
    }
    this.liftedFns.push({
      name,
      params: [{ localId: "o.0", name: "o", type: fromT }],
      returnType: toT,
      locals: [{ id: "o.0", name: "o", type: fromT, mutable: true, ...(boxInstance ? { boxed: true } : {}) }],
      body: [
        {
          kind: "return",
          value: {
            kind: "recordLit",
            ...(toStr ? { toStr } : {}),
            fields: to.fields.map((f) => {
              const lift = plan.get(f.name)!;
              if ("method" in lift) {
                return { name: f.name, value: this.boundMethodClosure(className, lift.method, loc) };
              }
              if ("absent" in lift) {
                if (f.type.kind !== "union") throw new Error("lowerer bug: absent lift against a non-union field");
                return {
                  name: f.name,
                  value: {
                    kind: "unionWrap",
                    unionId: f.type.unionId,
                    tag: lift.utag,
                    value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc },
                    type: f.type,
                    loc,
                  } satisfies IrExpr,
                };
              }
              const get: IrExpr = { kind: "fieldGet", obj: o, className, field: f.name, type: lift.src, loc };
              return { name: f.name, value: this.applyWidthLift(lift.lift, get, f.type, loc) };
            }),
            type: toT,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** The planning half of recordClassWidthHelper — how a RECORD enters a
   * class-instance slot. Construction IS the projection, so the class
   * must be a pure parameter-property data class: its own trivial
   * constructor (every parameter a parameter property, empty body), no
   * other fields, no methods/accessors anywhere in the chain (a
   * fabricated instance must carry no behavior the record lacks), no
   * decoration, no base beyond a generic FAMILY ancestor (fieldless and
   * methodless by construction). Each constructor parameter takes the
   * same-named source field under widthLiftPlan, or — omittable params —
   * the absent undefined arm. One entry per constructor parameter, in
   * parameter order. */
  recordToClassPlan(fromId: string, className: string): ({ field: string; src: IrType; lift: WidthLift } | { absent: true })[] | null {
    const from = this.shapes.get(fromId);
    const info = this.classes.get(className);
    if (!from || !info || from.indexValue || from.tuple) return null;
    if (from.fields.some((f) => f.name.startsWith("%"))) return null;
    if (!info.decl || info.def.abstract || info.def.runtime || info.generic) return null;
    if (info.builtinError || info.builtinEmitter || info.builtinStream !== undefined) return null;
    if (info.classDecorators) return null;
    if (info.base && !(info.base.generic && !info.base.base)) return null;
    for (let c: ClassInfo | null = info; c; c = c.base) {
      if (
        c.methods.size > 0 ||
        (c.genericMethods?.size ?? 0) > 0 ||
        (c.symbolFields?.size ?? 0) > 0 ||
        c.throwingSetters.length > 0 ||
        (c.def.abstractMethods?.length ?? 0) > 0
      ) {
        return null;
      }
    }
    if (!info.ctor || info.ctor.body === undefined || info.ctor.body.statements.length > 0) return null;
    const props = info.paramProps ?? [];
    if (props.length !== info.ctorParams.length) return null;
    // Every layout field must come from a parameter property (no declared
    // fields with initializers the projection would silently prefer).
    if (info.def.fields.length !== props.length) return null;
    const key = `cls:${fromId}:${className}`;
    if (this.widthPlanning.has(key)) return [];
    this.widthPlanning.add(key);
    try {
      const plan: ({ field: string; src: IrType; lift: WidthLift } | { absent: true })[] = [];
      for (let i = 0; i < props.length; i++) {
        const shape = info.ctorParams[i];
        if (!shape || (shape.mode !== "required" && shape.mode !== "omittable")) return null;
        const name = props[i]!.name;
        const ff = from.fields.find((f) => f.name === name);
        if (!ff) {
          if (shape.mode !== "omittable" || shape.type.kind !== "union") return null;
          const def = this.unions.get(shape.type.unionId);
          if (!def || !def.arms.some((a) => a.kind === "undefinedT")) return null;
          plan.push({ absent: true });
          continue;
        }
        const lift = this.widthLiftPlan(ff.type, shape.type);
        if (!lift) return null;
        plan.push({ field: name, src: ff.type, lift });
      }
      return plan;
    } finally {
      this.widthPlanning.delete(key);
    }
  }

  /** Interned `%cls.width.<n>(r)` — `new C(r.p1, ..., r.pn)` under
   * recordToClassPlan: the record's fields become the trivial
   * constructor's arguments (divergence 305's copy stance — a fresh
   * instance, mutations don't alias, and `instanceof C` answers true
   * where Node's plain object answers false). */
  recordClassWidthHelper(fromId: string, className: string, loc: SrcLoc): string | null {
    const info = this.classes.get(className);
    if (!info) return null;
    const plan = this.recordToClassPlan(fromId, className);
    if (!plan) return null;
    const key = `cls:${fromId}:${className}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%cls.width.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    this.noteEdge(`%${className}.constructor`);
    const fromT: IrType = { kind: "record", shapeId: fromId };
    const toT: IrType = { kind: "object", className };
    const r: IrExpr = { kind: "varRef", localId: "r.0", type: fromT, loc };
    const args = plan.map((entry, i): IrExpr => {
      const shape = info.ctorParams[i]!;
      if ("absent" in entry) {
        const u = this.wrappedUndefined(shape.type, loc);
        if (!u) throw new Error("lowerer bug: planned absent ctor arg has no undefined arm");
        return u;
      }
      const get: IrExpr = { kind: "recordGet", obj: r, shapeId: fromId, field: entry.field, type: entry.src, loc };
      return this.applyWidthLift(entry.lift, get, shape.type, loc);
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "r.0", name: "r", type: fromT }],
      returnType: toT,
      locals: [{ id: "r.0", name: "r", type: fromT, mutable: true }],
      body: [
        { kind: "return", value: { kind: "new", className, args, type: toT, loc }, loc },
      ],
      loc,
    });
    return name;
  }

  /** A CLASS VALUE's statics projected into a record shape (`var f:
   * ShapeFactory = Shape`): the record literal capturing static FIELDS as
   * copies of their globals and static METHODS as the zero-capture
   * closures `const f = C.m` builds (params all required — value-form
   * completion rules stay out of coercions). Inherited statics resolve
   * like JS's class-object prototype walk. Divergence 305's copy stance:
   * later writes to a writable static field don't flow into the record
   * (Node aliases the one class object). Null when any target field has
   * no projectable static. */
  classStaticsProjection(className: string, toId: string, loc: SrcLoc): IrExpr | null {
    const info = this.classes.get(className);
    const to = this.shapes.get(toId);
    if (!info || !to || to.indexValue || to.tuple) return null;
    if (to.fields.some((f) => f.name.startsWith("%"))) return null;
    if (info.generic || !info.decl) return null;
    const fields: { name: string; value: IrExpr }[] = [];
    for (const tf of to.fields) {
      if (findGenericStaticOn(this, info, tf.name)) return null;
      const found = findStaticOn(this, info, tf.name);
      if (!found) {
        if (tf.type.kind !== "union") return null;
        const u = this.wrappedUndefined(tf.type, loc);
        if (!u) return null;
        fields.push({ name: tf.name, value: u });
        continue;
      }
      if (found.field !== undefined) {
        const read: IrExpr = { kind: "varRef", localId: found.field.globalId, type: found.field.type, loc };
        const lift = this.widthLiftPlan(found.field.type, tf.type);
        if (!lift) return null;
        fields.push({ name: tf.name, value: this.applyWidthLift(lift, read, tf.type, loc) });
        continue;
      }
      if (found.method.params.some((p) => p.mode !== "required")) return null;
      const funcType: IrType = {
        kind: "func",
        params: found.method.params.map((p) => p.type),
        ret: found.method.ret,
      };
      const lift = this.widthLiftPlan(funcType, tf.type);
      if (!lift) return null;
      const fnName = `%${found.declarer.def.name}.static:${tf.name}`;
      this.noteEdge(fnName);
      const closure: IrExpr = { kind: "closure", fnName, captures: [], type: funcType, loc };
      fields.push({ name: tf.name, value: this.applyWidthLift(lift, closure, tf.type, loc) });
    }
    return { kind: "recordLit", fields, type: { kind: "record", shapeId: toId }, loc };
  }

  /** Interned `%fn.width.<n>(f)` — the function-RETURN width adapter: a
   * zero-param `() => Wide[]` value flowing into a `() => Narrow[]` slot
   * (the createProxyServer getRoutes shape) wraps in a fresh closure that
   * calls the original and maps the result through the per-element record
   * width copy (%arr.width). The adapter is a factory lifted function
   * whose param the returned closure captures; each invocation of the
   * adapted value builds a FRESH array of narrowed records (the width
   * machinery's copy stance — callers see the values, not the identity).
   * Null when the return shapes aren't width-coercible; bounded to
   * zero-param signatures (the one observed site — widening needs a
   * param-forwarding story nothing drives yet). */
  funcReturnWidthAdapter(fromT: IrType & { kind: "func" }, toT: IrType & { kind: "func" }, loc: SrcLoc,): string | null {
    if (fromT.params.length !== 0 || toT.params.length !== 0) return null;
    if (fromT.ret.kind !== "array" || toT.ret.kind !== "array") return null;
    const mapper = this.arrayWidthHelper(fromT.ret, toT.ret, loc);
    if (!mapper) return null;
    const key = `fn:${typeKey(fromT.ret.elem)}:${typeKey(toT.ret.elem)}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%fn.width.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const impl = `${name}.impl`;
    // The returned closure's body: call the captured original, width-map.
    this.liftedFns.push({
      name: impl,
      params: [],
      returnType: toT.ret,
      captures: [{ localId: "f.0", name: "f", type: fromT }],
      locals: [{ id: "f.0", name: "f", type: fromT, mutable: false, boxed: true }],
      body: [
        {
          kind: "return",
          value: {
            kind: "call",
            callee: mapper,
            args: [
              {
                kind: "callValue",
                callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
                args: [],
                type: fromT.ret,
                loc,
              },
            ],
            type: toT.ret,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    // The factory: box the incoming function value, mint the closure.
    this.liftedFns.push({
      name,
      params: [{ localId: "f.0", name: "f", type: fromT }],
      returnType: toT,
      locals: [{ id: "f.0", name: "f", type: fromT, mutable: false, boxed: true }],
      body: [
        {
          kind: "return",
          value: { kind: "closure", fnName: impl, captures: ["f.0"], type: toT, loc },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** Whether a `src`-typed VALUE converts into a `dst` slot through the
   * coercions coerceToExpected applies mechanically — the PURE probe
   * behind funcCoerceAdapter (nothing interns): exact types, arm wraps
   * into unions, whole-union re-tags (unionRetagMappable), checked
   * single-arm narrows, void into an undefined-armed union, and the dyn
   * boundary in both directions (dynFrom / dynCheck's JSON-safe domain).
   * Deliberately EXCLUDES the trap-only stranded conversions — an adapter
   * that could only ever throw is a fence, not a bridge. */
  coercibleValue(src: IrType, dst: IrType): boolean {
    if (typeEquals(src, dst)) return true;
    // The island boundary joins the mechanical set: values that MARSHAL
    // in (units, the checked-dynamic deep copy, JSON-safe data, liftable
    // composites, marshalable closures — coerceToExpected's jsval-IN
    // block) and island handles whose exits VALIDATE (boundaryExitSafe) —
    // the `defaultFallback(cfg) { return { login, id, scopes } }` shape,
    // whose slot returns a package ('any') type.
    if (dst.kind === "jsval") {
      return (
        src.kind !== "jsval" &&
        (isUnitType(src) ||
          src.kind === "dyn" ||
          this.boundarySafe(src) ||
          this.jsvalLiftable(src) ||
          (src.kind === "func" &&
            canMarshalTypedFuncIntoIsland(src, (id) => this.shapes.get(id), (id) => this.unions.get(id))))
      );
    }
    if (src.kind === "jsval") return this.boundaryExitSafe(dst);
    // A VOID source: awaiting or calling it yields JS's undefined, which
    // the dyn holds exactly (coerceToExpected's void arm). cleanFuncAdaptable
    // already answered yes for the same pair; this is the predicate catching
    // up, and it is what admits `Promise<void>` into a `Promise<unknown>`
    // slot through the promise recursion below.
    if (dst.kind === "dyn") return src.kind !== "dyn" && (src.kind === "void" || this.dynConvertible(src));
    if (src.kind === "dyn") {
      // The VALIDATED extraction — dynCheck — is what coerceToExpected
      // builds for this pair, so the domain is dynCheck's own:
      // canDynCheckTo. That predicate already folds in the checked-dynamic
      // function boundary's OUT direction (an adaptable func slot takes
      // dynCheck's per-target shim — the production/development
      // function-choice ternary shape), so the func clause that used to
      // stand beside jsonSafe here is a spelling of a case it contains.
      //
      // It used to be `jsonSafe(dst)`, and that had DRIFTED exactly the way
      // coerceToExpected's own hand-rolled subset once had: JSON-safety
      // refuses every composite carrying a bytes<u8> LEAF — a record of
      // Uint8Array fields, `Uint8Array | null` — which canDynCheckTo's
      // nested walk grants and both emitters already walk field by field.
      // The consequence was not a lost conversion but a lost ADAPTER:
      // promiseCoerceAdapter probes this predicate before it commits, so
      // `Promise<unknown>` into a `Promise<{ keyHash: Uint8Array; … }>`
      // slot fenced one container out from a conversion coerceToExpected
      // would have emitted on the bare value. Aligning the two spellings
      // is what unblocks it, and promiseCoerceAdapter's own
      // "payload stopped coercing" assertion is the proof they agree.
      return canDynCheckTo(dst, (id) => this.shapes.get(id), (id) => this.unions.get(id));
    }
    // Promise PAYLOADS convert through promiseCoerceAdapter's async helper
    // (the settle-or-value contract's other half: `Promise<null>` into a
    // `Promise<null | T>` slot, and an async callback whose contextual
    // return widened its own payload).
    if (dst.kind === "promise" && src.kind === "promise") {
      return this.coercibleValue(src.inner, dst.inner);
    }
    if (dst.kind === "union") {
      if (src.kind === "union") return this.unionRetagMappable(src.unionId, dst.unionId);
      if (src.kind === "void") return this.armTag(dst.unionId, UNDEFINED_T) >= 0;
      if (!isUnitType(src) && this.armTag(dst.unionId, src) >= 0) return true;
      // A promise whose payload converts into the union's ONE promise arm
      // (coerceToExpected's adapt-then-wrap; the ambiguity stance is its).
      if (src.kind === "promise") {
        const arms = this.unions.get(dst.unionId)?.arms.filter((a) => a.kind === "promise") ?? [];
        const arm = arms.length === 1 ? arms[0] : undefined;
        if (arm === undefined || arm.kind !== "promise") return false;
        // The payload converts, or awaiting it yields the arm's payload — an
        // async callback written against a settle-or-value slot nests one
        // level (contextual typing puts the slot's whole union inside the
        // promise), and the adapter's double await unwraps exactly that.
        return (
          this.coercibleValue(src.inner, arm.inner) ||
          (src.inner.kind === "union" && this.settleOrValueAwaitYields(src.inner, arm.inner))
        );
      }
      return false;
    }
    if (src.kind === "union") {
      return !isUnitType(dst) && dst.kind !== "void" && this.armTag(src.unionId, dst) >= 0;
    }
    return false;
  }

  /** True when a `src` function value enters a `dst` slot through
   * funcCoerceAdapter with NO stranded (trap-only) piece: no rest packs,
   * no surplus source params, every slot parameter converts into the
   * wrapped function's own type, and the result converts back (a void
   * slot drops it; a void result answers the exact JS undefined for
   * dyn/jsval slots). The width family's func gate — widthLiftPlan
   * bridges only signatures whose every call succeeds by construction. */
  cleanFuncAdaptable(src: IrType & { kind: "func" }, dst: IrType & { kind: "func" }): boolean {
    if (src.rest === true || dst.rest === true) return false;
    if (src.params.length > dst.params.length) return false;
    for (let i = 0; i < src.params.length; i++) {
      if (!this.coercibleValue(dst.params[i]!, src.params[i]!)) return false;
    }
    if (dst.ret.kind === "void") return src.ret.kind !== "jsval";
    if (this.coercibleValue(src.ret, dst.ret)) return true;
    return src.ret.kind === "void" && (dst.ret.kind === "dyn" || dst.ret.kind === "jsval");
  }

  /** Interned `%fn.adapt.<n>(f)` — the GENERAL function-value adapter: a
   * `fromT` function value flowing into a `toT` slot whose pieces differ
   * only by coercibleValue conversions. The slot's callers pass toT's
   * parameters: the wrapper takes them, converts the first
   * fromT.params.length into the wrapped function's own types (surplus
   * slot parameters are DROPPED — JS's extra-argument rule), calls it,
   * and converts the result back (a void slot drops the result; a void
   * result wraps as the slot union's undefined arm). Rest signatures on
   * either side decline (the pack shapes don't line up mechanically).
   * Null when any piece is outside coercibleValue — the exactness fences
   * stay. */
  /** True when awaiting `u` (a settle-or-value union) yields exactly `want` —
   * the test promiseCoerceAdapter needs before it commits to the double
   * await, with no IR built. */
  settleOrValueAwaitYields(u: IrType & { kind: "union" }, want: IrType): boolean {
    const def = this.unions.get(u.unionId);
    const promiseArm = def?.arms.find((a) => a.kind === "promise");
    if (!def || !promiseArm || promiseArm.kind !== "promise") return false;
    return settleOrValueArms(promiseArm, def.arms, this.unions) && typeEquals(promiseArm.inner, want);
  }

  /** Awaiting a SETTLE-OR-VALUE union — `Promise<T> | T`, and the union-payload
   * form `Promise<T | null> | T | null` a persistence hook takes. The
   * non-promise arms are exactly the promise's payload arms, so the result is
   * that payload and nothing has to be told apart: the union's own TAG picks
   * the branch.
   *
   * Built from existing nodes, so neither backend learns anything. The promise
   * arm awaits (parks, re-throws rejections); the data arm takes JS's one
   * microtask hop for a non-thenable await and re-tags itself into the
   * payload. A UNIT arm has no payload to extract — it IS its value, so the
   * literal stands in.
   *
   * Shared on purpose: `await x` reaches it from the expression lowering, and
   * promiseCoerceAdapter reaches it for a payload that is itself one of these
   * unions. `awaitExpr` over a union is not valid IR, so a second copy of the
   * ternary is the only alternative. Null when the union is not that shape. */
  settleOrValueAwait(value: IrExpr, loc: SrcLoc): IrExpr | null {
    if (value.type.kind !== "union") return null;
    const unionId = value.type.unionId;
    const def = this.unions.get(unionId);
    if (!def) return null;
    const promiseTag = def.arms.findIndex((a) => a.kind === "promise");
    const promiseArm = promiseTag >= 0 ? def.arms[promiseTag] : undefined;
    if (!promiseArm || promiseArm.kind !== "promise") return null;
    if (!settleOrValueArms(promiseArm, def.arms, this.unions)) return null;
    const inner = promiseArm.inner;
    const dataTags = def.arms.map((_, i) => i).filter((i) => i !== promiseTag);
    if (dataTags.length === 0) return null;

    const vLocal = this.declareHiddenLocal("%awaited", value.type);
    const uRef: IrExpr = { kind: "varRef", localId: vLocal.id, type: value.type, loc };
    const extract = (tag: number): IrExpr => {
      const arm = def.arms[tag]!;
      if (isUnitType(arm)) {
        const lit: IrExpr = {
          kind: "unitLit",
          unit: arm.kind === "undefinedT" ? "undefined" : "null",
          type: arm,
          loc,
        };
        return this.coerceToExpected(lit, inner);
      }
      const got: IrExpr = { kind: "unionNarrow", unionId, tag, value: uRef, type: arm, loc };
      if (inner.kind !== "union") return got;
      const innerDef = this.unions.get(inner.unionId);
      const innerTag = innerDef ? innerDef.arms.findIndex((a) => typeEquals(a, arm)) : -1;
      if (innerTag < 0) return got;
      return { kind: "unionWrap", unionId: inner.unionId, tag: innerTag, value: got, type: inner, loc };
    };
    let dataBranch = extract(dataTags[dataTags.length - 1]!);
    for (let k = dataTags.length - 2; k >= 0; k--) {
      dataBranch = {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId, tag: dataTags[k]!, negated: false, value: uRef, type: BOOL, loc },
        then: extract(dataTags[k]!),
        else_: dataBranch,
        type: inner,
        loc,
      };
    }
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: vLocal.id, init: value, loc }],
      result: {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId, tag: promiseTag, negated: false, value: uRef, type: BOOL, loc },
        then: {
          kind: "awaitExpr",
          value: { kind: "unionNarrow", unionId, tag: promiseTag, value: uRef, type: promiseArm, loc },
          type: inner,
          loc,
        },
        else_: {
          kind: "seqExpr",
          stmts: [{ kind: "exprStmt", expr: { kind: "libCall", fn: "async.hop", args: [], type: VOID, loc }, loc }],
          result: dataBranch,
          type: inner,
          loc,
        },
        type: inner,
        loc,
      },
      type: inner,
      loc,
    };
  }

  /** `Promise.resolve(u)` over the SAME settle-or-value union — the mirror
   * of settleOrValueAwait, and the only other question a `Promise<T> | T`
   * can be asked. The union's own TAG picks the branch, exactly as it does
   * there: the promise arm is RETURNED AS IT IS (the spec's native-promise
   * identity — `Promise.resolve(p) === p`, which every scriptc promise
   * already satisfies and an `async` wrapper would break by minting a
   * second promise), and the data arms wrap into a freshly fulfilled one.
   *
   * Nothing new is invented: this is settleOrValueAwait's arm walk with
   * `promise.resolve` where the await was, so both backends see only nodes
   * they already emit (seqExpr / unionIsTag / unionNarrow / unionWrap /
   * ternary / the promise.resolve intrinsic). There is no microtask hop on
   * the data side because `Promise.resolve(v)` does not await — the promise
   * is fulfilled at creation, which is why the await twin needs `async.hop`
   * and this one must not have it.
   *
   * Ownership follows the pieces: unionNarrow hands back a +1 payload, the
   * promise.resolve intrinsic MOVES its argument into the fulfilled
   * promise, and the identity branch's +1 promise is the expression's own
   * answer. Null when the union is not the settle-or-value shape, so the
   * caller's fence stands for everything else. */
  settleOrValueResolve(value: IrExpr, loc: SrcLoc): IrExpr | null {
    if (value.type.kind !== "union") return null;
    const unionId = value.type.unionId;
    const def = this.unions.get(unionId);
    if (!def) return null;
    const promiseTag = def.arms.findIndex((a) => a.kind === "promise");
    const promiseArm = promiseTag >= 0 ? def.arms[promiseTag] : undefined;
    if (!promiseArm || promiseArm.kind !== "promise") return null;
    if (!settleOrValueArms(promiseArm, def.arms, this.unions)) return null;
    const inner = promiseArm.inner;
    const dataTags = def.arms.map((_, i) => i).filter((i) => i !== promiseTag);
    if (dataTags.length === 0) return null;
    // A void or unit payload has no fulfill adapter (the same two corners
    // Promise.resolve's own lowering fences on); leave them to it.
    if (inner.kind === "void" || isUnitType(inner)) return null;

    // SCRIPTC_PRESOLVE_WHY: name every Promise.resolve this walk answers.
    if (process.env["SCRIPTC_PRESOLVE_WHY"]) {
      process.stderr.write(`[presolve] ${loc.file}:${loc.start} arms=${def.arms.length} payload=${inner.kind}\n`);
    }
    const vLocal = this.declareHiddenLocal("%presolve", value.type);
    const uRef: IrExpr = { kind: "varRef", localId: vLocal.id, type: value.type, loc };
    const extract = (tag: number): IrExpr => {
      const arm = def.arms[tag]!;
      if (isUnitType(arm)) {
        const lit: IrExpr = {
          kind: "unitLit",
          unit: arm.kind === "undefinedT" ? "undefined" : "null",
          type: arm,
          loc,
        };
        return this.coerceToExpected(lit, inner);
      }
      const got: IrExpr = { kind: "unionNarrow", unionId, tag, value: uRef, type: arm, loc };
      if (inner.kind !== "union") return got;
      const innerDef = this.unions.get(inner.unionId);
      const innerTag = innerDef ? innerDef.arms.findIndex((a) => typeEquals(a, arm)) : -1;
      if (innerTag < 0) return got;
      return { kind: "unionWrap", unionId: inner.unionId, tag: innerTag, value: got, type: inner, loc };
    };
    const wrap = (v: IrExpr): IrExpr =>
      ({ kind: "intrinsic", name: "promise.resolve", args: [v], type: promiseArm, loc });
    let dataBranch = wrap(extract(dataTags[dataTags.length - 1]!));
    for (let k = dataTags.length - 2; k >= 0; k--) {
      dataBranch = {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId, tag: dataTags[k]!, negated: false, value: uRef, type: BOOL, loc },
        then: wrap(extract(dataTags[k]!)),
        else_: dataBranch,
        type: promiseArm,
        loc,
      };
    }
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: vLocal.id, init: value, loc }],
      result: {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId, tag: promiseTag, negated: false, value: uRef, type: BOOL, loc },
        then: { kind: "unionNarrow", unionId, tag: promiseTag, value: uRef, type: promiseArm, loc },
        else_: dataBranch,
        type: promiseArm,
        loc,
      },
      type: promiseArm,
      loc,
    };
  }

  /** promiseCoerceAdapter's decision, asked without building anything:
   * does a `Promise<U>` reach a `Promise<T>` slot at all? Callers that
   * only need to know whether the conversion EXISTS -- the union-equality
   * path, deciding whether identity survives the slot -- ask here rather
   * than interning a helper they may not emit. The two must agree, and
   * the adapter's own post-condition (a probed payload that stops
   * coercing ICEs) is the guard one level down. */
  promiseAdaptable(
    fromT: IrType & { kind: "promise" },
    toT: IrType & { kind: "promise" },
  ): boolean {
    if (this.coercibleValue(fromT.inner, toT.inner)) return true;
    return (
      fromT.inner.kind === "union" &&
      this.settleOrValueAwaitYields(fromT.inner, toT.inner)
    );
  }

  /** The one promise ARM of `union` that a promise value converts into,
   * or null. ONE arm only -- two would make the destination a guess, the
   * same ambiguity stance coerceToExpected's union path takes; this
   * predicate exists to answer FOR that path without running it. */
  promiseArmFor(
    fromT: IrType,
    union: IrType & { kind: "union" },
  ): (IrType & { kind: "promise" }) | null {
    if (fromT.kind !== "promise") return null;
    const def = this.unions.get(union.unionId);
    const promiseArms = (def?.arms ?? []).filter((a) => a.kind === "promise");
    if (promiseArms.length !== 1) return null;
    const arm = promiseArms[0];
    if (arm === undefined || arm.kind !== "promise") return null;
    if (this.armTag(union.unionId, arm) < 0) return null;
    return this.promiseAdaptable(fromT, arm) ? arm : null;
  }

  /** `Promise<U>` into a `Promise<T>` slot, when the PAYLOAD converts:
   * an async helper that awaits the source and coerces what comes out
   * (`async (p) => coerce(await p)`), so the slot receives a promise whose
   * payload slot really is T. A promise's payload slot is typed per kind —
   * there is no reinterpret that would make one stand in for the other, and
   * a bridge that pretended otherwise read the wrong slot and returned a
   * wrong ANSWER rather than failing (the settled_bool-through-the-f64-twin
   * bug). Null when the payload does not convert: the exactness fences stay.
   *
   * Rejection passes through untouched — the helper awaits, so a rejected
   * source rethrows inside it and rejects the adapted promise with the same
   * value, which is what Node does. */
  promiseCoerceAdapter(
    fromT: IrType & { kind: "promise" },
    toT: IrType & { kind: "promise" },
    loc: SrcLoc,
  ): string | null {
    // The payload converts, or it is a SETTLE-OR-VALUE union whose await
    // yields the target payload — the shape contextual typing hands an async
    // callback written against `Promise<T> | T` (its own return nests one
    // level deeper). The helper then awaits twice instead of coercing.
    const viaSettle =
      !this.coercibleValue(fromT.inner, toT.inner) &&
      fromT.inner.kind === "union" &&
      this.settleOrValueAwaitYields(fromT.inner, toT.inner);
    if (!viaSettle && !this.coercibleValue(fromT.inner, toT.inner)) return null;
    const key = `promiseadapt:${viaSettle ? "sv:" : ""}${typeKey(fromT)}:${typeKey(toT)}`;
    const existing = this.retagHelpers.get(key);
    if (existing) return existing;
    const name = `%promise.adapt.${this.retagHelpers.size}`;
    // Call sites are handed the MEMO wrapper, not the adapter. JS's
    // assignment creates no promise, so `m.set("k", p); m.get("k") === p`
    // is true in Node; here the destination's payload kind differs, an
    // adapter has to run, and a SECOND run would answer about a second
    // object -- which is what made a dedup map never evict. The wrapper
    // files the first result under (source, adapterId) and answers with
    // it forever after: same-in/same-out, while a different source keeps
    // a different entry, so different-in/different-out survives too.
    const adaptId = this.promiseAdaptIds++;
    const memoName = `${name}.memo`;
    this.retagHelpers.set(key, memoName);
    // A real function context: the settle-or-value builder declares a hidden
    // local, and it has to land in THIS helper rather than in whatever
    // function happened to be lowering when the coercion was demanded.
    const funcType: IrType & { kind: "func" } = { kind: "func", params: [fromT], ret: toT };
    const fnCtx = newFnCtx(true, null, funcType, toT.inner);
    fnCtx.isAsync = true;
    this.fnStack.push(fnCtx);
    try {
      const pLocal = this.declareHiddenLocal("p", fromT);
      const pRef: IrExpr = { kind: "varRef", localId: pLocal.id, type: fromT, loc };
      const awaited: IrExpr = { kind: "awaitExpr", value: pRef, type: fromT.inner, loc };
      const settled = viaSettle ? this.settleOrValueAwait(awaited, loc) : null;
      const result = this.coerceToExpected(settled ?? awaited, toT.inner);
      if (!typeEquals(result.type, toT.inner)) {
        throw new Error("lowerer bug: probed promise-adapter payload stopped coercing");
      }
      // An async IrFunction's returnType is the INNER type: `return v`
      // fulfills with v and call sites receive Promise<T>.
      this.liftedFns.push({
        name,
        params: [{ localId: pLocal.id, name: pLocal.name, type: fromT }],
        returnType: toT.inner,
        async: true,
        locals: this.ctx.locals,
        body: [{ kind: "return", value: result, loc }],
        loc,
      });
    } finally {
      this.fnStack.pop();
    }
    // The wrapper is NOT async: an async body returns a fresh promise by
    // construction, so the memo check has to stand outside the adapter,
    // at the call. One expression -- ask, answer, or make-and-file.
    const wCtx = newFnCtx(true, null, { kind: "func", params: [fromT], ret: toT }, toT);
    this.fnStack.push(wCtx);
    try {
      const wLocal = this.declareHiddenLocal("p", fromT);
      const src = (): IrExpr => ({ kind: "varRef", localId: wLocal.id, type: fromT, loc });
      const idOf = (): IrExpr => ({ kind: "numLit", value: adaptId, type: F64, loc });
      const memoised: IrExpr = {
        kind: "ternary",
        cond: { kind: "libCall", fn: "promise.adaptHas", args: [src(), idOf()], type: BOOL, loc },
        then: { kind: "libCall", fn: "promise.adaptGet", args: [src(), idOf()], type: toT, loc },
        else_: {
          kind: "libCall",
          fn: "promise.adaptPut",
          args: [src(), idOf(), { kind: "call", callee: name, args: [src()], type: toT, loc }],
          type: toT,
          loc,
        },
        type: toT,
        loc,
      };
      this.liftedFns.push({
        name: memoName,
        params: [{ localId: wLocal.id, name: wLocal.name, type: fromT }],
        returnType: toT,
        locals: this.ctx.locals,
        body: [{ kind: "return", value: memoised, loc }],
        loc,
      });
    } finally {
      this.fnStack.pop();
    }
    return memoName;
  }

  funcCoerceAdapter(fromT: IrType & { kind: "func" }, toT: IrType & { kind: "func" }, loc: SrcLoc): string | null {
    if (fromT.rest === true || toT.rest === true) return null;
    // The source may carry EXTRA trailing parameters the slot omits
    // (`(a, b, opts?) => R` assigned where `(a, b) => R` is wanted — the
    // checker admits it): sound only when each extra is OPTIONAL
    // (undefined-armed), and the adapter feeds them undefined, exactly what
    // an omitted optional argument takes.
    const optionalIr = (p: IrType): boolean =>
      p.kind === "union" && (this.unions.get(p.unionId)?.arms.some((a) => a.kind === "undefinedT") ?? false);
    if (fromT.params.length > toT.params.length) {
      for (let i = toT.params.length; i < fromT.params.length; i++) {
        if (!optionalIr(fromT.params[i]!)) return null;
      }
    }
    // Piece dispositions beyond coercibleValue, all CHECKER-APPROVED
    // function compatibilities (bivariant method params under the suite's
    // non-strict settings, `() => never` throwers displayed as void by
    // the type mapping, void functions into unknown/any-returning slots):
    // - strandParams: some parameter cannot convert — the assignment
    //   compiles, INVOKING the slot throws the stranded TypeError (a
    //   never-called mismatched callback is exact; divergence 38's stance
    //   extended to calls).
    // - voidRet "jsval": calling yields JS's undefined — the exact
    //   undefined engine value after the call's effects. (The dyn twin is
    //   NOT here: a void result entering an 'unknown' slot is an ordinary
    //   coercibleValue conversion now, so it takes the general result path
    //   below and lowers to the same dynFrom-of-a-void-operand every other
    //   void→unknown flow does — one spelling, not two.)
    // - voidRet "strand": a void result where the slot promises a typed
    //   value — the call runs (a `never` thrower never comes back, so the
    //   trap is unreachable there), then the stranded TypeError.
    let strandParams = false;
    for (let i = 0; i < Math.min(fromT.params.length, toT.params.length); i++) {
      if (this.coercibleValue(toT.params[i]!, fromT.params[i]!)) continue;
      // ...and the WIDTH family, which coerceToExpected applies to this very
      // pair one call frame down (the `converted` below is built by it) but
      // which coercibleValue never learned — it answers for arm wraps,
      // re-tags, narrows and the dyn boundary, and a record that width-lifts
      // into the parameter is none of those. Probing it here rather than
      // widening coercibleValue keeps widthLiftPlan's own func rung
      // (cleanFuncAdaptable) exactly where it was, so no NEW pair becomes
      // width-liftable and no recursion is introduced. Strictly a bridge
      // where there was a strand: the adapter body below already builds the
      // conversion, and its `stopped coercing` assertion is the arming.
      if (this.widthLiftPlan(toT.params[i]!, fromT.params[i]!) !== null) continue;
      strandParams = true;
    }
    let voidRet: "jsval" | "strand" | null = null;
    let strandRet = false;
    // A factory returning a CLASS INSTANCE into a slot that spells the
    // instance's shape as a record -- `() => new Store()` passed where the
    // parameter is typed by the store INTERFACE. The instance satisfies
    // that interface, and the constructor-witness path already knows how
    // to project one into the record (bound methods, lifted fields), so
    // this is the same conversion one call deeper. Probed here rather than
    // widened into coercibleValue: that predicate answers for every
    // coercion site, and a class is NOT a record anywhere else.
    const classRetProj =
      toT.ret.kind === "record" && fromT.ret.kind === "object"
        ? this.ctorWitnessProjection(fromT.ret.className, toT.ret, loc)
        : null;
    if (toT.ret.kind !== "void" && !this.coercibleValue(fromT.ret, toT.ret) && classRetProj === null) {
      if (fromT.ret.kind !== "void") {
        // A RESULT that cannot convert — the strandParams stance, result
        // side (the production/development function-choice ternary: the
        // untaken arm's result shape never lands in the slot's): the
        // assignment compiles, INVOKING the slot runs the function and
        // throws the stranded TypeError where its result would convert.
        strandRet = true;
      } else {
        voidRet = toT.ret.kind === "jsval" ? "jsval" : "strand";
      }
    }
    if (toT.ret.kind === "void" && fromT.ret.kind === "jsval") return null;
    const key = `fnadapt:${typeKey(fromT)}:${typeKey(toT)}`;
    const existing = this.retagHelpers.get(key);
    if (existing) return existing;
    const name = `%fn.adapt.${this.retagHelpers.size}`;
    this.retagHelpers.set(key, name);
    const impl = `${name}.impl`;
    const params: IrParam[] = toT.params.map((t, i) => ({ localId: `a.${i}`, name: `a${i}`, type: t }));
    const strandThrow = (why: string): IrStmt => ({
      kind: "throw",
      value: {
        kind: "libCall",
        fn: "error.new",
        args: [{ kind: "strLit", value: why, type: STRING, loc }],
        type: { kind: "object", className: "%TypeError" },
        loc,
      },
      loc,
    });
    let body: IrStmt[];
    if (strandParams) {
      body = [
        strandThrow(
          `a '${this.fmt(fromT)}' function invoked through a '${this.fmt(toT)}' slot (the parameter types cannot convert — the checker's loose function compatibility admitted the assignment, but the call has no exact lowering)`,
        ),
      ];
    } else {
      const args = fromT.params.map((pt, i): IrExpr => {
        if (i >= toT.params.length) {
          // An extra trailing optional param the slot omits: feed undefined,
          // wrapped into the param's own undefined-armed union.
          const u = pt as IrType & { kind: "union" };
          const tag = this.unions.get(u.unionId)!.arms.findIndex((a) => a.kind === "undefinedT");
          return { kind: "unionWrap", unionId: u.unionId, tag, value: { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc }, type: pt, loc };
        }
        const aRef: IrExpr = { kind: "varRef", localId: `a.${i}`, type: toT.params[i]!, loc };
        const converted = this.coerceToExpected(aRef, pt);
        if (!typeEquals(converted.type, pt)) throw new Error("lowerer bug: probed fn-adapter param stopped coercing");
        return converted;
      });
      const call: IrExpr = {
        kind: "callValue",
        callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
        args,
        type: fromT.ret,
        loc,
      };
      if (toT.ret.kind === "void") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: null, loc },
        ];
      } else if (voidRet === "jsval") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc }, loc },
        ];
      } else if (voidRet === "strand") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          strandThrow(
            `a void result where the '${this.fmt(toT)}' slot promises '${this.fmt(toT.ret)}' (a thrower typed 'never' never reaches this; a genuinely void function has no result to hand over)`,
          ),
        ];
      } else if (strandRet) {
        body = [
          { kind: "exprStmt", expr: call, loc },
          strandThrow(
            `a '${this.fmt(fromT)}' function invoked through a '${this.fmt(toT)}' slot (the result cannot convert to '${this.fmt(toT.ret)}' — the checker's loose function compatibility admitted the assignment, but the call has no exact lowering)`,
          ),
        ];
      } else {
        const result =
          classRetProj !== null
            ? { kind: "call" as const, callee: classRetProj, args: [call], type: toT.ret, loc }
            : this.coerceToExpected(call, toT.ret);
        if (!typeEquals(result.type, toT.ret)) throw new Error("lowerer bug: probed fn-adapter return stopped coercing");
        body = [{ kind: "return", value: result, loc }];
      }
    }
    this.liftedFns.push({
      name: impl,
      params,
      returnType: toT.ret,
      captures: [{ localId: "f.0", name: "f", type: fromT }],
      locals: [
        { id: "f.0", name: "f", type: fromT, mutable: false, boxed: true },
        ...toT.params.map((t, i) => ({ id: `a.${i}`, name: `a${i}`, type: t, mutable: false })),
      ],
      body,
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "f.0", name: "f", type: fromT }],
      returnType: toT,
      locals: [{ id: "f.0", name: "f", type: fromT, mutable: false, boxed: true }],
      body: [
        {
          kind: "return",
          value: { kind: "closure", fnName: impl, captures: ["f.0"], type: toT, loc },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** The spawnSync-runner VALUE adapter's plan — a function returning the
   * opaque spawnRes flowing into a slot whose signature returns the
   * STRUCTURAL result record tsc accepted (`defaultRunner` into a
   * `CommandRunner` param: `{ status: number | null; stdout?: string;
   * stderr?: string; error?: Error }`). Parameters must agree pairwise;
   * each target field must be one of the spawnRes reads (status, stdout,
   * stderr, error) at its exact lowered type — string fields optionally
   * undefined-armed. Null when the pair isn't this shape. Pure: callers
   * probe before interning. */
  spawnResFnAdapterPlan(fromT: IrType & { kind: "func" }, toT: IrType & { kind: "func" },): { field: string; build: (r: IrExpr, loc: SrcLoc) => IrExpr }[] | null {
    if (!Array.isArray(fromT.params) || !Array.isArray(toT.params)) return null; // defensive: degenerate func types
    if (fromT.params.length !== toT.params.length) return null;
    if (!fromT.params.every((p, i) => typeEquals(p, toT.params[i]!))) return null;
    if (fromT.ret.kind !== "spawnRes" || toT.ret.kind !== "record") return null;
    const shape = this.shapes.get(toT.ret.shapeId);
    if (!shape || shape.tuple || shape.indexValue) return null;
    const statusT: IrType = { kind: "union", unionId: this.unions.intern([F64, { kind: "nullT" }]) };
    const errorT: IrType = { kind: "union", unionId: this.unions.intern([{ kind: "object", className: "%Error" }, UNDEFINED_T]) };
    const strOptT: IrType = { kind: "union", unionId: this.unions.intern([STRING, UNDEFINED_T]) };
    const plan: { field: string; build: (r: IrExpr, loc: SrcLoc) => IrExpr }[] = [];
    for (const f of shape.fields) {
      if (f.name === "status" && typeEquals(f.type, statusT)) {
        plan.push({ field: f.name, build: (r, loc) => ({ kind: "libCall", fn: "spawnRes.status", args: [r], type: statusT, loc }) });
        continue;
      }
      if ((f.name === "stdout" || f.name === "stderr") && (typeEquals(f.type, strOptT) || f.type.kind === "string")) {
        const fn = f.name === "stdout" ? ("spawnRes.stdout" as const) : ("spawnRes.stderr" as const);
        const strTag = this.armTag(strOptT.kind === "union" ? strOptT.unionId : "", STRING);
        plan.push({
          field: f.name,
          build: (r, loc) => {
            const read: IrExpr = { kind: "libCall", fn, args: [r], type: STRING, loc };
            return f.type.kind === "string"
              ? read
              : { kind: "unionWrap", unionId: (f.type as IrType & { kind: "union" }).unionId, tag: strTag, value: read, type: f.type, loc };
          },
        });
        continue;
      }
      if (f.name === "error" && typeEquals(f.type, errorT)) {
        plan.push({ field: f.name, build: (r, loc) => ({ kind: "libCall", fn: "spawnRes.error", args: [r], type: errorT, loc }) });
        continue;
      }
      return null;
    }
    return plan;
  }

  /** Interned `%fnval.spawnres.<n>(f)` — the runner-value adapter: a
   * fresh closure of the TARGET signature forwarding its arguments to the
   * captured function and converting the opaque spawnRes result into the
   * target's structural record (one eager read per declared field —
   * spawnResFnAdapterPlan's set). Divergence caveat: stdout/stderr read
   * as the captured text ("" when nothing was captured, e.g. stdio
   * "inherit") where Node stores null. */
  spawnResFnAdapter(fromT: IrType & { kind: "func" }, toT: IrType & { kind: "func" }, loc: SrcLoc,): string | null {
    const plan = this.spawnResFnAdapterPlan(fromT, toT);
    if (!plan) return null;
    if (toT.ret.kind !== "record") return null;
    const key = `fnspawn:${typeKey(fromT)}:${typeKey(toT)}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%fnval.spawnres.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const impl = `${name}.impl`;
    const params: IrParam[] = toT.params.map((p, i) => ({ localId: `p${i}.0`, name: `p${i}`, type: p }));
    const rRef: IrExpr = { kind: "varRef", localId: "r.0", type: fromT.ret, loc };
    this.liftedFns.push({
      name: impl,
      params,
      returnType: toT.ret,
      captures: [{ localId: "f.0", name: "f", type: fromT }],
      locals: [
        { id: "f.0", name: "f", type: fromT, mutable: false, boxed: true },
        ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        { id: "r.0", name: "r", type: fromT.ret, mutable: false },
      ],
      body: [
        {
          kind: "varDecl",
          localId: "r.0",
          init: {
            kind: "callValue",
            callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
            args: params.map((p): IrExpr => ({ kind: "varRef", localId: p.localId, type: p.type, loc })),
            type: fromT.ret,
            loc,
          },
          loc,
        },
        {
          kind: "return",
          value: {
            kind: "recordLit",
            fields: plan.map((entry) => ({ name: entry.field, value: entry.build(rRef, loc) })),
            type: toT.ret,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "f.0", name: "f", type: fromT }],
      returnType: toT,
      locals: [{ id: "f.0", name: "f", type: fromT, mutable: false, boxed: true }],
      body: [
        {
          kind: "return",
          value: { kind: "closure", fnName: impl, captures: ["f.0"], type: toT, loc },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%union.retag.<n>(u)` — the runtime re-tag for a value of
   * union `fromId` flowing into a slot of union `toId`: a switch on the
   * source tag re-wraps the payload under its tag in the destination
   * (unionNarrow + unionWrap — the payload pointer moves, no copy, so
   * ref-arm identity is preserved across the re-tag). Arms map by
   * canonical type (typeEquals): every non-unit source arm must exist in
   * the destination, or the pair isn't mappable (null — the caller keeps
   * the SC2003 fence). A stranded UNIT arm (undefined/null with no
   * destination arm) is different: it means tsc's picture at the site was
   * NARROWER than the IR type — control-flow narrowing to a sub-union, or
   * a non-null assertion, both of which erase at lowering — so the arm is
   * exactly the possibility the checker proved (or the source asserted)
   * away. It compiles to a runtime trap case throwing a catchable
   * TypeError-shaped string, the lying-cast stance (SEMANTICS.md): sound
   * narrowing never reaches it, a lying `!` throws instead of smuggling
   * an unrepresentable unit into the destination. */
  /** True when unionRetagHelper can bridge the pair — every non-unit
   * source arm exists (typeEquals) in the destination, or width-lifts
   * into exactly one destination arm (widthLiftPlan — record and array
   * arms compose the re-tag with the per-arm reshape). Pure: callers that
   * must validate a WHOLE plan before interning anything (recordWidthHelper)
   * probe with this so a failed later field never orphans a helper. */
  unionRetagMappable(fromId: string, toId: string): boolean {
    const from = this.unions.get(fromId);
    if (!from || !this.unions.get(toId)) return false;
    // The union-pair face of the widthPlanning cycle guard: recursive
    // aliases can close their cycle through a union without repeating a
    // record pair (`type Json = Json[] | undefined`) — an in-progress
    // pair re-entered answers "assume mappable", same greatest-fixed-point
    // reading as recordWidthPlan's.
    const key = `u:${fromId}:${toId}`;
    if (this.widthPlanning.has(key)) return true;
    this.widthPlanning.add(key);
    try {
      const toT: IrType = { kind: "union", unionId: toId };
      return from.arms.every((arm) => isUnitType(arm) || this.widthLiftPlan(arm, toT) !== null);
    } finally {
      this.widthPlanning.delete(key);
    }
  }

  /** A checker-NARROWED union flowing into a different union: `typeof r
   * === "string" || Buffer.isBuffer(r)` proves the record arm of r away,
   * then `{ data: r }` needs `Buffer | string | Rec` in a `Buffer | string`
   * slot. Control-flow narrowing to a sub-union erases at lowering, so the
   * IR value still carries the wide union — but the SITE's checker type
   * names exactly the arms still possible, and every one of those must
   * exist in both unions. The stranded arms compile to trap cases exactly
   * like stranded units (divergence 38's trust-the-checker stance): sound
   * narrowing never reaches them, a lying cast throws a catchable
   * TypeError instead of smuggling an unrepresentable arm. Null when the
   * site type isn't a genuine sub-union of the source (the SC2003 fence
   * stays). */
  /** Collapses a UNION into ONE record shape: per source arm, the narrowed
   * payload reaches the destination by identity or by the field-copying
   * width coercion, and the helper dispatches on the tag.
   *
   * Every arm must reach it. A unit arm (`null`, `undefined`) has no
   * fields and declines the whole form, which is right: a slot that can
   * hold the absent case spells a union, and this conversion is for the
   * slot that spells one shape. */
  unionRecordCollapseHelper(fromId: string, toShapeId: string, loc: SrcLoc): string | null {
    const from = this.unions.get(fromId);
    const to = this.shapes.get(toShapeId);
    if (!from || !to || from.arms.length === 0) return null;
    const toT: IrType = { kind: "record", shapeId: toShapeId };
    // Plan every arm BEFORE interning anything.
    const plans: (IrExpr | null)[] = from.arms.map((arm, i) => {
      if (isUnitType(arm) || arm.kind !== "record") return null;
      const probe: IrExpr = { kind: "unionNarrow", unionId: fromId, tag: i, value: { kind: "varRef", localId: "u.0", type: { kind: "union", unionId: fromId }, loc }, type: arm, loc };
      if (typeEquals(arm, toT)) return probe;
      return this.widthCoerce(probe, toT);
    });
    if (plans.some((p) => p === null || !typeEquals(p.type, toT))) return null;

    const key = `ucollapse:${fromId}:${toShapeId}`;
    const existing = this.widthHelpers.get(key);
    if (existing) return existing;
    const name = `%union.record.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const fromT: IrType = { kind: "union", unionId: fromId };
    const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
    const body: IrStmt[] = [];
    from.arms.forEach((_, i) => {
      body.push({
        kind: "if",
        cond: { kind: "unionIsTag", unionId: fromId, tag: i, negated: false, value: u, type: BOOL, loc },
        then: [{ kind: "return", value: plans[i]!, loc }],
        else_: null,
        loc,
      });
    });
    body.push({
      kind: "throw",
      value: { kind: "strLit", value: "scriptc: internal error: invalid union tag", type: STRING, loc },
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: fromT }],
      returnType: toT,
      locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
      body,
      loc,
    });
    return name;
  }

  narrowedRetagHelper(node: ts.Node, fromId: string, toId: string, loc: SrcLoc): string | null {
    const from = this.unions.get(fromId);
    if (!from || !this.unions.get(toId)) return null;
    const siteT = this.mapTypeOf(this.typeOf(node));
    if (!siteT) return null;
    const siteArms = siteT.kind === "union" ? this.unions.get(siteT.unionId)?.arms : [siteT];
    if (!siteArms || siteArms.length === 0) return null;
    const allowed = new Set<number>();
    for (const a of siteArms) {
      const fi = this.armTag(fromId, a);
      if (fi < 0) return null; // not a narrowing of the source union
      allowed.add(fi);
    }
    const trappable = new Set<number>();
    from.arms.forEach((_, i) => {
      if (!allowed.has(i)) trappable.add(i);
    });
    if (trappable.size === 0) return null; // nothing stranded: the plain re-tag already declined
    return this.unionRetagHelper(fromId, toId, loc, trappable);
  }

  /** The stranded-UNIT trap for PLAIN (non-union) slots: a null/undefined
   * value flowing into a non-nullable typed slot the checker approved —
   * `null!` and `null as any as T` casts, and the non-strict world's
   * legal `let s: string = null`. The compiled representation has no null
   * to carry, so the FLOW throws the catchable stranded TypeError
   * (divergence 38's stance: Node lets the impossible value ride until it
   * is used; the trap surfaces at the assignment instead). Unit sources
   * only — they are pure, so the nullary helper evaluates nothing. */
  strandedUnitTrap(expr: IrExpr, expected: IrType, loc: SrcLoc): IrExpr | null {
    if (!isUnitType(expr.type)) return null;
    if (
      expected.kind === "union" || expected.kind === "void" || expected.kind === "dyn" ||
      expected.kind === "jsval" || isUnitType(expected)
    ) {
      return null;
    }
    const what = expr.type.kind === "undefinedT" ? "undefined" : "null";
    const key = `strandunit:${typeKey(expected)}:${expr.type.kind}`;
    let name = this.retagHelpers.get(key);
    if (!name) {
      name = `%unit.strand.${this.retagHelpers.size}`;
      this.retagHelpers.set(key, name);
      this.liftedFns.push({
        name,
        params: [],
        returnType: expected,
        locals: [],
        body: [
          {
            kind: "throw",
            value: {
              kind: "libCall",
              fn: "error.new",
              args: [
                {
                  kind: "strLit",
                  value: `${what} is not representable in a '${this.fmt(expected)}' slot (a value narrowed or asserted past the type still held it)`,
                  type: STRING,
                  loc,
                },
              ],
              type: { kind: "object", className: "%TypeError" },
              loc,
            },
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "call", callee: name, args: [], type: expected, loc };
  }

  /** A record whose CONTENT is only known at RUN TIME -- an
   * index-signature shape, the overflow store -- flowing into a union of
   * exact arms, at the one position where the alternative is
   * strandedCoercionTrap's UNCONDITIONAL throw.
   *
   * The static width family can never place such a value's keys: every
   * arm's declared members may live in the store rather than in a
   * declared slot, so recordWidthPlan declines each arm and the candidate
   * list comes back EMPTY -- which is precisely the condition that sends
   * the flow to the trap. But "which arm does this value have" is a
   * RUN-TIME question, and this compiler already answers it: dynCheck
   * picks the arm structurally, and coerceToExpected applies it
   * automatically to any dyn flowing into a canDynCheckTo target. BOTH
   * halves are rungs of this very function -- the `expected.kind ===
   * "dyn"` dynFrom above and the `expr.type.kind === "dyn"` dynCheck
   * below it -- and they never met, because a coercion is one step.
   *
   * So two spellings of ONE cast disagreed:
   *
   *     const ev = bag as unknown as Ev              // unconditional throw
   *     const u: unknown = bag; const ev = u as Ev   // extracts, correctly
   *
   * tsc collapses the first spelling's `unknown`, so the same value
   * reached the trap one way and the checked extraction the other. This
   * makes them agree -- the stance the func-arm, promise-arm and
   * tuple-into-array rungs already take wherever a binding and a literal
   * spelling of one value disagreed.
   *
   * It cannot silently change a program that compiles: the position it
   * fires at throws UNCONDITIONALLY today (the trap has no tag test --
   * reaching the call site IS throwing). What it inherits is the
   * extraction's own stance: a materialised arm carries the arm's
   * members, so a store key NO arm declares is dropped -- the width
   * family's copy stance (SEMANTICS.md 35/36), measured identical on the
   * `const u: unknown` spelling on base.
   *
   * Gated to index-signature SOURCES on purpose. A fixed-shape record has
   * no runtime keys, so the static family already saw everything it has,
   * and a zero-candidate pair there is a genuine mismatch whose trap
   * message is the better answer. Null for everything else. */
  runtimeKeyedUnionExtraction(expr: IrExpr, expected: IrType & { kind: "union" }, loc: SrcLoc): IrExpr | null {
    const src = expr.type;
    if (src.kind !== "record") return null;
    if (this.shapes.get(src.shapeId)?.indexValue === undefined) return null;
    const def = this.unions.get(expected.unionId);
    if (!def) return null;
    // strandedCoercionTrap's OWN gate, spelled the same way -- with the
    // one difference the SOURCE makes. ONE candidate already lowered above
    // (widthLiftPlan's liftWrap) and cannot reach here at all.
    //
    // SEVERAL is where the two part company. For a FIXED-shape source the
    // trap is right to keep the fence: the arm is a STATIC fact and two
    // plans mean the author wrote something genuinely ambiguous. For a
    // RUNTIME-KEYED one it is not a fact at all -- every 'candidate' is a
    // plan to read that arm's fields back out of the overflow store, so
    // several candidates say only that several arms COULD be assembled
    // from a bag whose keys are runtime state. Choosing one statically is
    // the guess; testing the value is the answer, and the checked
    // extraction is exactly that test. (A store with a checked-dynamic
    // value slot makes this the common case rather than the exotic one:
    // dynOutPlan admits every arm's every field, so EVERY arm becomes a
    // candidate at once.)
    const candidates = def.arms.filter((arm) => arm.kind === "record" && this.widthLiftPlan(src, arm) !== null);
    if (candidates.length === 1) return null;
    if (!this.dynConvertible(src)) return null;
    if (!canDynCheckTo(expected, (id) => this.shapes.get(id), (id) => this.unions.get(id))) return null;
    // ...and the arms must be TELLABLE APART by what a match predicate can
    // see. dynCheck tries the record arms widest-first and takes the first
    // one whose REQUIRED fields are all present with matching types
    // (dynCheckArmOrder); an arm tried EARLIER whose required fields are a
    // subset of a later arm's fields therefore takes that later arm's values
    // too, and the extraction is a guess rather than an answer.
    //
    // zapo's `WaAppStateMutationEvent` is that shape and is the reason this
    // gate exists: per schema key it has a `set` arm and a `remove` arm whose
    // fields are the set arm's MINUS a `Partial<DataForKey<K>>` -- all
    // optional, so a `remove` value matches the `set` arm as well, and the
    // only thing that tells them apart is the VALUE of the `operation`
    // string-literal discriminant, which the IR erases to `string`. Taking
    // the extraction there would tag every remove event `set`: the fields
    // read right and the NARROWING throws, which is a wrong answer wearing a
    // fence's clothes. The unconditional trap is the honest answer until the
    // IR can carry the discriminant.
    //
    // Only pairs the emitted ORDER actually exposes count, so this reads the
    // same helper the emitters do: an arm can only steal from arms tried
    // after it. A `dyn` member is untested by dynMatch and an
    // undefined-armed one matches when absent, so neither is required.
    {
      const order = dynCheckArmOrder(def, (id) => this.shapes.get(id));
      const fieldsOf = (i: number): { name: string; type: IrType }[] => {
        const arm = def.arms[i]!;
        return arm.kind === "record" ? (this.shapes.get(arm.shapeId)?.fields ?? []) : [];
      };
      const required = (f: { name: string; type: IrType }): boolean =>
        f.type.kind !== "dyn" &&
        !(f.type.kind === "union" && this.armTag(f.type.unionId, UNDEFINED_T) >= 0);
      const admits = (want: IrType, have: IrType): boolean =>
        typeEquals(want, have) || (want.kind === "union" && this.armTag(want.unionId, have) >= 0);
      for (let a = 0; a < order.length; a++) {
        const ai = order[a]!;
        if (def.arms[ai]!.kind !== "record") continue;
        const req = fieldsOf(ai).filter(required);
        for (let b = a + 1; b < order.length; b++) {
          const bi = order[b]!;
          if (def.arms[bi]!.kind !== "record") continue;
          const later = fieldsOf(bi);
          const steals = req.every((f) => {
            const g = later.find((x) => x.name === f.name);
            return g !== undefined && admits(f.type, g.type);
          });
          // ...unless a STRING-LITERAL DISCRIMINANT tells the two apart.
          // Shadowing is a statement about the arms' FIELD NAMES, and it
          // stops being true the moment the emitted first pass can reject
          // the earlier arm on a value: `operation: 'set'` beside
          // `operation: 'remove'` is exactly that, and it is the whole of
          // what zapo's WaAppStateMutationEvent needed. Both arms must
          // pin the SAME field to DIFFERENT strings -- one-sided
          // knowledge separates nothing (discrimSeparates).
          if (steals && discrimSeparates(def, ai, bi)) {
            this.discrimRelied.push({ unionId: def.id, a: ai, b: bi });
            if (process.env["SCRIPTC_RTKEYED_WHY"]) {
              console.error(
                `RTKEYED KEEPS: arm ${String(ai)} would shadow arm ${String(bi)}, but a literal discriminant separates them`,
              );
            }
            continue;
          }
          if (steals) {
            if (process.env["SCRIPTC_RTKEYED_WHY"]) {
              const pins = (i: number): string => {
                const m = armDiscrimLits(def, i);
                const ks = Object.keys(m).sort();
                return ks.length === 0 ? "pins nothing" : ks.map((k) => `${k}=${JSON.stringify(m[k])}`).join(" ");
              };
              console.error(
                `RTKEYED DECLINES: arm ${String(ai)} shadows arm ${String(bi)} (its required fields are a subset)` +
                  ` | arm ${String(ai)} ${this.fmt(def.arms[ai]!).slice(0, 200)} [${pins(ai)}]` +
                  ` | arm ${String(bi)} ${this.fmt(def.arms[bi]!).slice(0, 200)} [${pins(bi)}]`,
              );
            }
            return null;
          }
        }
      }
    }
    if (process.env["SCRIPTC_RTKEYED_WHY"]) {
      console.error(`RTKEYED ${this.fmt(src)} -> ${this.fmt(expected)}`);
    }
    return {
      kind: "dynCheck",
      value: { kind: "dynFrom", value: expr, type: DYN, loc },
      type: expected,
      loc,
    };
  }

  /** The STRANDED-SOURCE trap: a checker-approved value flowing into a
   * union that cannot represent it (armTag < 0, no class widening, no
   * width lift). Only shapes that PROVE a lying assertion trap: unit
   * sources (null/undefined literals smuggled through `null!` / `as any`
   * casts), and record/array sources with ZERO same-family width-lift
   * candidates among the arms — an AMBIGUOUS lift (several candidates)
   * stays a compile fence, because honest code lands there. The interned
   * helper evaluates the operand (JS evaluates it too) and throws the
   * stranded-arm TypeError verbatim. Null when the shape doesn't prove
   * the lie. */
  strandedCoercionTrap(expr: IrExpr, expected: IrType & { kind: "union" }, loc: SrcLoc): IrExpr | null {
    const def = this.unions.get(expected.unionId);
    if (!def) return null;
    const src = expr.type;
    let what: string;
    if (isUnitType(src)) {
      what = src.kind === "undefinedT" ? "undefined" : "null";
    } else if (src.kind === "f64" || src.kind === "bool" || src.kind === "string") {
      // A SCALAR the union has no arm for (`4 as any as X`, a generic
      // dummy for an unmappable instantiation): no widening exists at
      // all, so the mismatch proves the lie the same way a unit does.
      what = `a '${this.fmt(src)}' value`;
    } else if (src.kind === "record" || src.kind === "array") {
      // Zero width-lift candidates proves no honest mapping was missed.
      const candidates = def.arms.filter(
        (arm) =>
          ((src.kind === "record" && arm.kind === "record") || (src.kind === "array" && arm.kind === "array")) &&
          this.widthLiftPlan(src, arm) !== null,
      );
      if (candidates.length !== 0) return null;
      what = `a '${this.fmt(src)}' value`;
    } else {
      return null;
    }
    // Unit sources have no runtime payload and are pure — the helper is
    // nullary (unit-typed ABI params have no representation); ref sources
    // pass through so the operand still evaluates, exactly JS.
    const takesOperand = !isUnitType(src);
    if (process.env["SCRIPTC_STRAND_TRACE"]) {
      const arms = (this.unions.get(expected.unionId)?.arms ?? []).map((a) => this.fmt(a)).join(" | ");
      process.stderr.write(`STRAND value=${this.fmt(src)}
       arms=${arms}
`);
      // WHY each record arm declined, named field by field. The classifier
      // already exists — describeRecordWidthBlocker is SC2002's residue
      // story — and the trap simply never asked it. Without this the trap
      // says "not representable" and the reader has a union of six arms
      // and no idea which member of which arm refused. Trace only: it
      // changes nothing about what coerces.
      if (src.kind === "record") {
        for (const arm of def.arms) {
          if (arm.kind !== "record") continue;
          const why = this.describeRecordWidthBlocker(src.shapeId, arm.shapeId);
          process.stderr.write(`       arm ${arm.shapeId}: ${why ?? "(no pointed story)"}
`);
        }
      }
    }
    const key = `strand:${expected.unionId}:${typeKey(src)}`;
    let name = this.retagHelpers.get(key);
    if (!name) {
      name = `%union.strand.${this.retagHelpers.size}`;
      this.retagHelpers.set(key, name);
      const toT: IrType = { kind: "union", unionId: expected.unionId };
      this.liftedFns.push({
        name,
        params: takesOperand ? [{ localId: "v.0", name: "v", type: src }] : [],
        returnType: toT,
        locals: takesOperand ? [{ id: "v.0", name: "v", type: src, mutable: false }] : [],
        body: [
          {
            kind: "throw",
            value: {
              kind: "libCall",
              fn: "error.new",
              args: [
                {
                  kind: "strLit",
                  value: `${what} is not representable in the target union (a value narrowed or asserted past it still held it)`,
                  type: STRING,
                  loc,
                },
              ],
              type: { kind: "object", className: "%TypeError" },
              loc,
            },
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "call", callee: name, args: isUnitType(src) ? [] : [expr], type: expected, loc };
  }

  unionRetagHelper(fromId: string, toId: string, loc: SrcLoc, trappable?: ReadonlySet<number>): string | null {
    const from = this.unions.get(fromId);
    const to = this.unions.get(toId);
    if (!from || !to) return null;
    // Per-arm WIDTH LIFTS: a RECORD or ARRAY arm with no identical
    // destination arm may width-lift into exactly ONE destination arm
    // (widthLiftPlan's liftWrap — the findRoute pattern: `{hostname, port,
    // tailscaleUrl?} | undefined` returning as `{hostname, port} |
    // undefined`; nested width and per-element array reshapes compose).
    // Planned PURELY first so a failing arm never orphans an interned
    // width helper; ambiguity (several liftable destination arms) declines
    // — no honest single mapping exists. A lifted arm is a COPY
    // (divergence 35's stance), unlike the identity-preserving plain
    // re-wrap.
    const toT: IrType = { kind: "union", unionId: toId };
    const lifts = new Map<number, WidthLift & { how: "liftWrap" }>();
    from.arms.forEach((arm, i) => {
      if (this.armTag(toId, arm) >= 0 || isUnitType(arm) || (trappable?.has(i) ?? false)) return;
      const lp = this.widthLiftPlan(arm, toT);
      if (lp && lp.how === "liftWrap") lifts.set(i, lp);
    });
    // `trappable` extends the unit-arm rule to arms the CHECKER proved
    // away at the coercion site (narrowedRetagHelper): those may trap too.
    const ok = from.arms.every(
      (arm, i) => this.armTag(toId, arm) >= 0 || isUnitType(arm) || (trappable?.has(i) ?? false) || lifts.has(i),
    );
    if (!ok) return null;
    const mapping = from.arms.map((arm, i) => {
      const identity = this.armTag(toId, arm);
      return identity >= 0 ? identity : (lifts.get(i)?.tag ?? -1);
    });
    const stranded = mapping.flatMap((t, i) => (t < 0 ? [i] : []));
    // Lifts are a pure function of the (from, to) pair, so the historic
    // key stays sound for them; stranded arms depend on the SITE.
    const key = `${fromId}:${toId}:${stranded.join(".")}`;
    const existing = this.retagHelpers.get(key);
    if (existing) return existing;
    const name = `%union.retag.${this.retagHelpers.size}`;
    this.retagHelpers.set(key, name);
    const fromT: IrType = { kind: "union", unionId: fromId };
    const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
    const body: IrStmt[] = [];
    from.arms.forEach((arm, i) => {
      const tag = mapping[i]!;
      const cond: IrExpr = { kind: "unionIsTag", unionId: fromId, tag: i, negated: false, value: u, type: BOOL, loc };
      let then: IrStmt[];
      if (tag < 0) {
        const what = isUnitType(arm)
          ? (arm.kind === "undefinedT" ? "undefined" : "null")
          : `a '${this.fmt(arm)}' value`;
        then = [
          {
            kind: "throw",
            value: {
              kind: "libCall",
              fn: "error.new",
              args: [
                {
                  kind: "strLit",
                  value: `${what} is not representable in the target union (a value narrowed or asserted past it still held it)`,
                  type: STRING,
                  loc,
                },
              ],
              type: { kind: "object", className: "%TypeError" },
              loc,
            },
            loc,
          },
        ];
      } else {
        const value: IrExpr = isUnitType(arm)
          ? { kind: "unitLit", unit: arm.kind === "undefinedT" ? "undefined" : "null", type: arm, loc }
          : { kind: "unionNarrow", unionId: fromId, tag: i, value: u, type: arm, loc };
        const lift = lifts.get(i);
        // Width-lifted arm: the narrowed payload reshapes into the
        // destination arm and wraps (applyWidthLift — planned above, so
        // the interns cannot fail here); identity arms re-wrap the same
        // payload pointer.
        const wrapped: IrExpr = lift
          ? this.applyWidthLift(lift, value, toT, loc)
          : { kind: "unionWrap", unionId: toId, tag, value, type: toT, loc };
        then = [{ kind: "return", value: wrapped, loc }];
      }
      body.push({ kind: "if", cond, then, else_: null, loc });
    });
    // Unreachable when tags are exhaustive (they are, by construction);
    // satisfies the all-paths-return rule and keeps a corrupted tag loud.
    body.push({
      kind: "throw",
      value: { kind: "strLit", value: "scriptc: internal error: invalid union tag", type: STRING, loc },
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: fromT }],
      returnType: toT,
      locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
      body,
      loc,
    });
    return name;
  }

  /** Interned `%union.narrow.<n>(u)` — the CHECKED single-arm extraction
   * behind `x!` on union values: the asserted arm's payload comes out
   * (+1 for ref arms, like any unionNarrow), and every OTHER arm throws
   * the catchable TypeError — divergence 38's lying-assertion stance (an
   * unchecked unionNarrow would misread the payload where JS lets the
   * impossible value flow on). Null when the target isn't a non-unit arm
   * of the union — those uses keep their erasure/fences. */
  narrowedArmHelper(fromId: string, target: IrType, loc: SrcLoc): string | null {
    const from = this.unions.get(fromId);
    if (!from || isUnitType(target)) return null;
    const tag = this.armTag(fromId, target);
    if (tag < 0) return null;
    const key = `${fromId}:${tag}`;
    const existing = this.narrowHelpers.get(key);
    if (existing) return existing;
    // A DESCENDANT arm satisfies the claim too. admissibleArmTags is
    // this compiler's own rule for which tags a narrowing may legally
    // find (the arm itself, plus every arm that strictly descends from
    // it when the target is a CLASS) and the extraction below is a
    // tag-independent payload peek, so a subclass payload reads right
    // and a virtual call still reaches the override. Without this the
    // helper throws on `const p: P = arrOfPorQ[0]!` -- sound TypeScript,
    // which Node runs and this threw an uncoded TypeError for. Records
    // are deliberately NOT widened: two record shapes put different
    // fields at the same offsets, which is what the check exists for.
    const admissible = new Set(this.admissibleArmTags(fromId, target));
    const name = `%union.narrow.${this.narrowHelpers.size}`;
    this.narrowHelpers.set(key, name);
    const fromT: IrType = { kind: "union", unionId: fromId };
    const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
    const body: IrStmt[] = [];
    from.arms.forEach((arm, i) => {
      if (admissible.has(i)) return; // the fall-through extraction below
      const what = isUnitType(arm)
        ? (arm.kind === "undefinedT" ? "undefined" : "null")
        : `a '${this.fmt(arm)}' value`;
      body.push({
        kind: "if",
        cond: { kind: "unionIsTag", unionId: fromId, tag: i, negated: false, value: u, type: BOOL, loc },
        then: [
          {
            kind: "throw",
            value: {
              kind: "libCall",
              fn: "error.new",
              args: [
                {
                  kind: "strLit",
                  value: `${what} is not representable in the target union (a value narrowed or asserted past it still held it)`,
                  type: STRING,
                  loc,
                },
              ],
              type: { kind: "object", className: "%TypeError" },
              loc,
            },
            loc,
          },
        ],
        else_: null,
        loc,
      });
    });
    body.push({
      kind: "return",
      value: { kind: "unionNarrow", unionId: fromId, tag, value: u, type: target, loc },
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: fromT }],
      returnType: target,
      locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
      body,
      loc,
    });
    return name;
  }

  /** The tags a union value may LEGALLY carry when a narrowing claims one
   * arm: the arm itself, plus — when the arm is a CLASS — every arm that
   * strictly descends from it.
   *
   * A subclass value in a base-class position is what tsc's assignability
   * admits AND what the runtime layout supports: the payload pointer is
   * prefix-compatible and carries its own vtable, so the fields read right
   * and a virtual call still reaches the override. A WIDER RECORD in a
   * narrower record's position is neither — tsc admits it, and the two
   * structs put different fields at the same offsets, which is exactly the
   * confusion a checked extraction exists to catch. So the class relation
   * widens the admissible set and the record one does not. */
  admissibleArmTags(fromId: string, want: IrType): number[] {
    const tag = this.armTag(fromId, want);
    if (tag < 0) return [];
    if (want.kind !== "object") return [tag];
    const arms = this.unions.get(fromId)?.arms ?? [];
    const out = [tag];
    arms.forEach((a, i) => {
      if (i !== tag && a.kind === "object" && a.className !== want.className && this.isSubclassOf(a.className, want.className)) {
        out.push(i);
      }
    });
    return out;
  }

  /** Interned `%union.arm.<n>(u)` — narrowedArmHelper with a WIDER guard,
   * for a class arm whose descendants are separate arms of the same union.
   *
   * One admissible tag is the ordinary case and reuses narrowedArmHelper —
   * the program-wide `x!` machinery, interned per (union, arm) — so a
   * caller only gets a helper of its own where the descendant arms exist.
   * `note` names the claim that failed, in the caller's own words.
   *
   * Null when `want` is not an arm of the union; the caller keeps whatever
   * unchecked form or fence it had. */
  checkedArmHelper(fromId: string, want: IrType, loc: SrcLoc, note: string): string | null {
    const tags = this.admissibleArmTags(fromId, want);
    if (tags.length === 0) return null;
    if (tags.length === 1) return this.narrowedArmHelper(fromId, want, loc);
    const from: IrType = { kind: "union", unionId: fromId };
    const key = `unionarm:${typeKey(from)}:${typeKey(want)}`;
    const existing = this.widthHelpers.get(key);
    if (existing !== undefined) return existing;
    const name = `%union.arm.${this.widthHelpers.size}`;
    this.widthHelpers.set(key, name);
    const v = (): IrExpr => ({ kind: "varRef", localId: "u.0", type: from, loc });
    const one = (t: number): IrExpr => ({ kind: "unionIsTag", unionId: fromId, tag: t, negated: false, value: v(), type: BOOL, loc });
    const anyTag = tags
      .slice(1)
      .reduce<IrExpr>((acc, t) => ({ kind: "logical", op: "||", left: acc, right: one(t), type: BOOL, loc }), one(tags[0]!));
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: from }],
      returnType: want,
      locals: [{ id: "u.0", name: "u", type: from, mutable: true }],
      body: [
        {
          kind: "if",
          cond: { kind: "unary", op: "!", operand: anyTag, type: BOOL, loc },
          then: [
            {
              kind: "throw",
              value: {
                kind: "libCall",
                fn: "error.new",
                args: [
                  {
                    kind: "strLit",
                    value: `a '${this.fmt(from)}' value is not representable as '${this.fmt(want)}' (${note})`,
                    type: STRING,
                    loc,
                  },
                ],
                type: { kind: "object", className: "%TypeError" },
                loc,
              },
              loc,
            },
          ],
          else_: null,
          loc,
        },
        { kind: "return", value: { kind: "unionNarrow", unionId: fromId, tag: tags[0]!, value: v(), type: want, loc }, loc },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%class.narrow.<n>(o)` — the CHECKED downcast behind a
   * checker-driven class narrowing. `instanceof` against the target's
   * preorder interval decides: a match reinterprets the pointer exactly
   * as the bare downcast did (prefix layout, no RC traffic), anything
   * else throws the catchable TypeError — divergence 38's stance, the
   * same one narrowedArmHelper takes for a union arm.
   *
   * The bare downcast is sound only when the compiler owns the proof (an
   * instanceof test it just emitted, or the exactness proof behind a
   * generic dispatch). Where the proof is tsc's alone, a sibling subclass
   * shares the base's prefix and puts its OWN field at the same offset,
   * so an unchecked reinterpret serves one subclass's slot as another's
   * (`G:\dc\probe`'s d01 answers a Cat's `sound` where the source asked
   * for `Dog.breed`), and a base instance is simply SHORTER than the
   * subclass struct, so the read runs off the end of the allocation (d02
   * segfaults on LLVM).
   *
   * Null when either class is outside an extends hierarchy — a standalone
   * class carries no vtable word, so there is no interval to test; the
   * caller keeps the un-narrowed value, which fences loudly downstream
   * rather than admitting an unchecked reinterpret. */
  narrowedClassHelper(fromClass: string, toClass: string, loc: SrcLoc): string | null {
    const fromInfo = this.classes.get(fromClass);
    const toInfo = this.classes.get(toClass);
    if (!fromInfo || !toInfo) return null;
    if (!this.inHierarchy(fromInfo) || !this.inHierarchy(toInfo)) return null;
    // The DUPLEX WIDENING is not a narrowing: a Duplex-rooted value
    // reaching a `%Writable` slot is coerceToExpected's upcast, and
    // building the checked bridge here would emit a `downcast` the
    // validator rejects. Declining leaves the value un-narrowed, which
    // is exactly what the caller wants — the upcast runs instead.
    if (streamDuplexWidensToWritable(fromClass, toClass, (a, b) => this.isSubclassOf(a, b))) return null;
    // The source-level spelling: IR class names carry a '%' for the
    // runtime-provided classes and a '%m<n>.' module prefix for the rest
    // (the same normalisation lower-classes' diagnostics use).
    const classDisplayName = (n: string): string => n.replace(/^%m\d+\./, "").replace(/^%/, "");
    const key = `${fromClass}:${toClass}`;
    const existing = this.classNarrowHelpers.get(key);
    if (existing) return existing;
    const name = `%class.narrow.${this.classNarrowHelpers.size}`;
    this.classNarrowHelpers.set(key, name);
    const fromT: IrType = { kind: "object", className: fromClass };
    const toT: IrType = { kind: "object", className: toClass };
    const o: IrExpr = { kind: "varRef", localId: "o.0", type: fromT, loc };
    const body: IrStmt[] = [
      {
        kind: "if",
        // The SAME answer the source-level `instanceof` gives (Node's
        // Writable[Symbol.hasInstance] admits the Duplex subtree): a
        // guard that says yes and a bridge that throws would be worse
        // than either alone.
        cond: streamInstanceOfExpr(this, o, toClass, loc),
        then: [{ kind: "return", value: { kind: "downcast", value: o, type: toT, loc }, loc }],
        else_: null,
        loc,
      },
      {
        kind: "throw",
        value: {
          kind: "libCall",
          fn: "error.new",
          args: [
            {
              kind: "strLit",
              value:
                `a '${classDisplayName(fromClass)}' value is not a '${classDisplayName(toClass)}' ` +
                `(a value narrowed or asserted past it still held another class)`,
              type: STRING,
              loc,
            },
          ],
          type: { kind: "object", className: "%TypeError" },
          loc,
        },
        loc,
      },
    ];
    this.liftedFns.push({
      name,
      params: [{ localId: "o.0", name: "o", type: fromT }],
      returnType: toT,
      locals: [{ id: "o.0", name: "o", type: fromT, mutable: true }],
      body,
      loc,
    });
    return name;
  }

  /** The DEFERRED-INIT field read (`stream!: T` assigned past the
   * constructor's top level — the slot is `T | undefined`): interned
   * `%deferred.read.<n>(u)` extracting the declared type. SCALAR arms
   * whose JS-undefined behavior a unit default reproduces read that
   * default — bool false (conditions are exact: undefined and false are
   * both falsy; only printing/strict-equality could tell) and f64 NaN
   * (arithmetic and conditions exact) — while string and REF arms keep
   * the checked-extraction TRAP: JS itself TypeErrors the first member
   * use of such an undefined, so the catchable TypeError at the read is
   * the same failure, named earlier (SEMANTICS.md). */
  deferredReadHelper(fromId: string, target: IrType, loc: SrcLoc): string | null {
    if (target.kind !== "bool" && target.kind !== "f64") {
      return this.narrowedArmHelper(fromId, target, loc);
    }
    const from = this.unions.get(fromId);
    const tag = this.armTag(fromId, target);
    const utag = from ? from.arms.findIndex((a) => a.kind === "undefinedT") : -1;
    if (!from || tag < 0 || utag < 0) return null;
    const key = `deferred:${fromId}:${tag}`;
    const existing = this.narrowHelpers.get(key);
    if (existing) return existing;
    const name = `%deferred.read.${this.narrowHelpers.size}`;
    this.narrowHelpers.set(key, name);
    const fromT: IrType = { kind: "union", unionId: fromId };
    const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
    const dflt: IrExpr =
      target.kind === "bool"
        ? { kind: "boolLit", value: false, type: BOOL, loc }
        : { kind: "numLit", value: NaN, type: F64, loc };
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: fromT }],
      returnType: target,
      locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
      body: [
        {
          kind: "if",
          cond: { kind: "unionIsTag", unionId: fromId, tag: utag, negated: false, value: u, type: BOOL, loc },
          then: [{ kind: "return", value: dflt, loc }],
          else_: null,
          loc,
        },
        {
          kind: "return",
          value: { kind: "unionNarrow", unionId: fromId, tag, value: u, type: target, loc },
          loc,
        },
      ],
      loc,
    });
    return name;
  }

  /** True when a static value can become ONE island value: jsval itself,
   * anything boundary-safe (the deep JSON marshal), a record whose fields
   * all can (built as an island OBJECT literal, field by field), or an
   * array of such (built as an island ARRAY, element by element). The
   * lift beyond boundarySafe exists for jsval-BEARING composites —
   * `{ role: string; content: any[] }[]` flowing into an `any[]` slot —
   * which have no JSON serialization (a handle isn't JSON) but an honest
   * per-field construction. Recursion terminates: recursive shapes are
   * rejected at mapping time. */
  jsvalLiftable(t: IrType, visiting: Set<string> = new Set()): boolean {
    if (t.kind === "jsval") return true;
    if (this.boundarySafe(t)) return true;
    // Typed arrays and URLs marshal IN without joining the round-trip
    // (JSON) set: an engine typed-array copy / an engine URL from href.
    if (t.kind === "bytes" || t.kind === "url") return true;
    // Checked-dynamic values deep-copy in (scr_jsval_from_dyn — data
    // kinds; a boxed function/handle/promise throws at runtime).
    if (t.kind === "dyn") return true;
    // Marshalable CLOSURES cross as host functions — a record carrying
    // methods (the service-registry entry: `{ label, load: () =>
    // Promise<any>, defaultFallback: (cfg) => any }`) lifts field by
    // field like any other.
    if (t.kind === "func") {
      return canMarshalTypedFuncIntoIsland(t, (id) => this.shapes.get(id), (id) => this.unions.get(id));
    }
    if (t.kind === "record") {
      const shape = this.shapes.get(t.shapeId);
      if (!shape || shape.tuple) return false;
      // Recursive shapes reaching here answer FALSE: this branch is the
      // per-field island lift (jsval/bytes-bearing composites — the
      // JSON-safe ones already answered true through boundarySafe, where
      // a cyclic value throws the circular TypeError at the marshal), and
      // the lift helpers walk values with no circular guard — fencing the
      // TYPE is the honest answer.
      if (visiting.has(t.shapeId)) return false;
      visiting.add(t.shapeId);
      // An INDEX-SIGNATURE record lifts when its value slot does (dyn
      // included): declared fields write first, then the overflow keys.
      if (shape.indexValue && !this.jsvalLiftable(shape.indexValue, visiting)) return false;
      return shape.fields.every((f) => !f.name.startsWith("%") && this.jsvalLiftable(f.type, visiting));
    }
    if (t.kind === "array") return this.jsvalLiftable(t.elem, visiting);
    // A union crossing IN lifts arm by arm (a runtime tag switch — see
    // unionToJsvalHelper) when every arm does: unit arms become the
    // engine's own undefined/null (which is why bare undefined-armed
    // unions lift here despite being JSON-unsafe), the rest lift as
    // themselves. Arms never nest unions, so this terminates (recursive
    // knots pass through records, guarded above).
    if (t.kind === "union") {
      const def = this.unions.get(t.unionId);
      return !!def && def.arms.every((a) => isUnitType(a) || this.jsvalLiftable(a, visiting));
    }
    return false;
  }

  /** A jsval-typed expression carrying `e`'s value into the island —
   * jsvalLiftable's constructive side. Primitives and JSON-safe composites
   * keep the jsMarshal deep copy; jsval-bearing records and arrays go
   * through interned per-type builder helpers (%jsin.*), so the operand is
   * always evaluated exactly once (as the helper's argument). */
  jsvalLiftExpr(e: IrExpr, loc: SrcLoc): IrExpr {
    if (e.type.kind === "jsval") return e;
    if (this.boundarySafe(e.type)) {
      return { kind: "jsMarshal", value: e, type: JSVAL, loc };
    }
    if (e.type.kind === "bytes" || e.type.kind === "url") {
      return { kind: "jsMarshal", value: e, type: JSVAL, loc };
    }
    if (e.type.kind === "record") {
      const helper = this.recordToJsvalHelper(e.type.shapeId, loc);
      return { kind: "call", callee: helper, args: [e], type: JSVAL, loc };
    }
    if (e.type.kind === "array") {
      const helper = this.arrayToJsvalHelper(e.type.elem, loc);
      return { kind: "call", callee: helper, args: [e], type: JSVAL, loc };
    }
    if (e.type.kind === "union") {
      const helper = this.unionToJsvalHelper(e.type.unionId, loc);
      return { kind: "call", callee: helper, args: [e], type: JSVAL, loc };
    }
    // Checked-dynamic values and marshalable closures ride jsMarshal
    // directly (the checked-dynamic tree deep copy / the host-function wrap).
    if (e.type.kind === "dyn" || e.type.kind === "func") {
      return { kind: "jsMarshal", value: e, type: JSVAL, loc };
    }
    throw new Error(`lowerer bug: jsvalLiftExpr of unliftable ${e.type.kind}`);
  }

  /** Interned `%jsin.union.<n>(u)` — the runtime tag switch marshaling a
   * union value INTO the island: unit arms become the engine's own
   * undefined/null (JS-exact — `{ instructions: undefined }` crossing in
   * has the property present and undefined, exactly what the source
   * spells), every other arm narrows and lifts as itself (strings by
   * value, JSON-safe composites as deep copies, typed arrays as engine
   * typed-array copies, URLs as engine URL instances). Caller must have
   * checked jsvalLiftable. */
  unionToJsvalHelper(unionId: string, loc: SrcLoc): string {
    const key = `union:${unionId}`;
    const existing = this.jsinHelpers.get(key);
    if (existing) return existing;
    const def = this.unions.get(unionId);
    if (!def) throw new Error(`lowerer bug: jsval lift of unknown union ${unionId}`);
    const name = `%jsin.union.${this.jsinHelpers.size}`;
    this.jsinHelpers.set(key, name);
    const fromT: IrType = { kind: "union", unionId };
    const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
    const body: IrStmt[] = [];
    def.arms.forEach((arm, i) => {
      const cond: IrExpr = { kind: "unionIsTag", unionId, tag: i, negated: false, value: u, type: BOOL, loc };
      const value: IrExpr = isUnitType(arm)
        ? { kind: "jsOp", op: arm.kind === "undefinedT" ? "undefLit" : "nullLit", args: [], type: JSVAL, loc }
        : this.jsvalLiftExpr({ kind: "unionNarrow", unionId, tag: i, value: u, type: arm, loc }, loc);
      body.push({ kind: "if", cond, then: [{ kind: "return", value, loc }], else_: null, loc });
    });
    // Unreachable when tags are exhaustive (they are, by construction);
    // satisfies the all-paths-return rule and keeps a corrupted tag loud.
    body.push({
      kind: "throw",
      value: { kind: "strLit", value: "scriptc: internal error: invalid union tag", type: STRING, loc },
      loc,
    });
    this.liftedFns.push({
      name,
      params: [{ localId: "u.0", name: "u", type: fromT }],
      returnType: JSVAL,
      locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
      body,
      loc,
    });
    return name;
  }

  /** Interned `%jsin.rec.<n>(r)` — builds an island OBJECT from a
   * jsval-bearing record: marshaled key strings, each field lifted through
   * jsvalLiftExpr (jsval fields pass as handles, JSON-safe fields deep-copy,
   * nested composites recurse through their own helpers). Caller must have
   * checked jsvalLiftable. */
  recordToJsvalHelper(shapeId: string, loc: SrcLoc): string {
    const key = `rec:${shapeId}`;
    const existing = this.jsinHelpers.get(key);
    if (existing) return existing;
    const shape = this.shapes.get(shapeId);
    if (!shape) throw new Error(`lowerer bug: jsval lift of unknown shape ${shapeId}`);
    const name = `%jsin.rec.${this.jsinHelpers.size}`;
    this.jsinHelpers.set(key, name);
    const recT: IrType = { kind: "record", shapeId };
    const r: IrExpr = { kind: "varRef", localId: "r.0", type: recT, loc };
    const args: IrExpr[] = [];
    for (const f of shape.fields) {
      args.push({
        kind: "jsMarshal",
        value: { kind: "strLit", value: f.name, type: STRING, loc },
        type: JSVAL,
        loc,
      });
      args.push(
        this.jsvalLiftExpr(
          { kind: "recordGet", obj: r, shapeId, field: f.name, type: f.type, loc },
          loc,
        ),
      );
    }
    const lit: IrExpr = { kind: "jsOp", op: "objLit", args, type: JSVAL, loc };
    if (!shape.indexValue) {
      this.liftedFns.push({
        name,
        params: [{ localId: "r.0", name: "r", type: recT }],
        returnType: JSVAL,
        locals: [{ id: "r.0", name: "r", type: recT, mutable: true }],
        body: [{ kind: "return", value: lit, loc }],
        loc,
      });
      return name;
    }
    // An INDEX-SIGNATURE shape: the declared pairs build the object, then
    // the overflow map's live keys append in JS own-key order (setIdx —
    // runtime keys have no property-name literal).
    const iv = shape.indexValue;
    const f64: IrType = { kind: "f64" };
    // By SLOT (recordOvfSlots): key and value come out of the same entry,
    // so the lift never re-reads a key it just enumerated.
    const ksT = arrayOf(f64);
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const num = (value: number): IrExpr => ({ kind: "numLit", value, type: f64, loc });
    const kRef = ref("k.0", STRING);
    const slotRef = ref("sl.0", f64);
    this.liftedFns.push({
      name,
      params: [{ localId: "r.0", name: "r", type: recT }],
      returnType: JSVAL,
      locals: [
        { id: "r.0", name: "r", type: recT, mutable: true },
        { id: "out.0", name: "out", type: JSVAL, mutable: false },
        { id: "sls.0", name: "sls", type: ksT, mutable: false },
        { id: "i.0", name: "i", type: f64, mutable: true },
        { id: "sl.0", name: "sl", type: f64, mutable: false },
        { id: "k.0", name: "k", type: STRING, mutable: false },
      ],
      body: [
        { kind: "varDecl", localId: "out.0", init: lit, loc },
        { kind: "varDecl", localId: "sls.0", init: { kind: "recordOvfSlots", obj: r, shapeId, type: ksT, loc }, loc },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0), loc },
          cond: {
            kind: "bin",
            op: "<",
            left: ref("i.0", f64),
            right: { kind: "arrIntrinsic", method: "length", receiver: ref("sls.0", ksT), args: [], type: f64, loc },
            type: BOOL,
            loc,
          },
          update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: ref("i.0", f64), right: num(1), type: f64, loc }, loc },
          body: [
            { kind: "varDecl", localId: "sl.0", init: { kind: "arrayGet", arr: ref("sls.0", ksT), index: ref("i.0", f64), type: f64, loc }, loc },
            { kind: "varDecl", localId: "k.0", init: { kind: "recordOvfSlotGet", obj: r, shapeId, slot: slotRef, part: "key", type: STRING, loc }, loc },
            {
              kind: "exprStmt",
              expr: {
                kind: "jsOp",
                op: "setIdx",
                args: [
                  ref("out.0", JSVAL),
                  { kind: "jsMarshal", value: kRef, type: JSVAL, loc },
                  this.jsvalLiftExpr({ kind: "recordOvfSlotGet", obj: r, shapeId, slot: slotRef, part: "value", type: iv, loc }, loc),
                ],
                type: VOID,
                loc,
              },
              loc,
            },
          ],
          loc,
        },
        { kind: "return", value: ref("out.0", JSVAL), loc },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%jsin.arr.<n>(a)` — builds ONE island ARRAY from a native
   * array whose elements lift: out = []; for (...) out[i] = lift(a[i]);
   * return out. The index marshals by value like any number. Caller must
   * have checked jsvalLiftable of the element. */
  arrayToJsvalHelper(elem: IrType, loc: SrcLoc): string {
    const key = `arr:${typeKey(elem)}`;
    const existing = this.jsinHelpers.get(key);
    if (existing) return existing;
    const name = `%jsin.arr.${this.jsinHelpers.size}`;
    this.jsinHelpers.set(key, name);
    const arrT: IrType = { kind: "array", elem };
    const f64: IrType = { kind: "f64" };
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const num = (value: number): IrExpr => ({ kind: "numLit", value, type: f64, loc });
    this.liftedFns.push({
      name,
      params: [{ localId: "a.0", name: "a", type: arrT }],
      returnType: JSVAL,
      locals: [
        { id: "a.0", name: "a", type: arrT, mutable: true },
        { id: "out.0", name: "out", type: JSVAL, mutable: false },
        { id: "n.0", name: "n", type: f64, mutable: false },
        { id: "i.0", name: "i", type: f64, mutable: true },
      ],
      body: [
        { kind: "varDecl", localId: "out.0", init: { kind: "jsOp", op: "arrLit", args: [], type: JSVAL, loc }, loc },
        {
          kind: "varDecl",
          localId: "n.0",
          init: { kind: "arrIntrinsic", method: "length", receiver: ref("a.0", arrT), args: [], type: f64, loc },
          loc,
        },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0), loc },
          cond: { kind: "bin", op: "<", left: ref("i.0", f64), right: ref("n.0", f64), type: BOOL, loc },
          update: {
            kind: "assign",
            localId: "i.0",
            value: { kind: "bin", op: "+", left: ref("i.0", f64), right: num(1), type: f64, loc },
            loc,
          },
          body: [
            {
              kind: "exprStmt",
              expr: {
                kind: "jsOp",
                op: "setIdx",
                args: [
                  ref("out.0", JSVAL),
                  { kind: "jsMarshal", value: ref("i.0", f64), type: JSVAL, loc },
                  this.jsvalLiftExpr(
                    { kind: "arrayGet", arr: ref("a.0", arrT), index: ref("i.0", f64), type: elem, loc },
                    loc,
                  ),
                ],
                type: { kind: "void" },
                loc,
              },
              loc,
            },
          ],
          loc,
        },
        { kind: "return", value: ref("out.0", JSVAL), loc },
      ],
      loc,
    });
    return name;
  }

  /** Interned `%jsin.elems.<n>(a)` — a NATIVE array of island handles from
   * a native array whose elements lift: the `any[]`-slot coercion (each
   * element becomes one island value; the array stays static). Null when
   * the element doesn't lift. */
  arrayToJsvalArrayHelper(fromElem: IrType, loc: SrcLoc): string | null {
    if (fromElem.kind === "jsval" || !this.jsvalLiftable(fromElem)) return null;
    const key = `elems:${typeKey(fromElem)}`;
    const existing = this.jsinHelpers.get(key);
    if (existing) return existing;
    const name = `%jsin.elems.${this.jsinHelpers.size}`;
    this.jsinHelpers.set(key, name);
    const arrT: IrType = { kind: "array", elem: fromElem };
    const outT: IrType = { kind: "array", elem: JSVAL };
    const f64: IrType = { kind: "f64" };
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const num = (value: number): IrExpr => ({ kind: "numLit", value, type: f64, loc });
    this.liftedFns.push({
      name,
      params: [{ localId: "a.0", name: "a", type: arrT }],
      returnType: outT,
      locals: [
        { id: "a.0", name: "a", type: arrT, mutable: true },
        { id: "out.0", name: "out", type: outT, mutable: false },
        { id: "n.0", name: "n", type: f64, mutable: false },
        { id: "i.0", name: "i", type: f64, mutable: true },
      ],
      body: [
        { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
        {
          kind: "varDecl",
          localId: "n.0",
          init: { kind: "arrIntrinsic", method: "length", receiver: ref("a.0", arrT), args: [], type: f64, loc },
          loc,
        },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0), loc },
          cond: { kind: "bin", op: "<", left: ref("i.0", f64), right: ref("n.0", f64), type: BOOL, loc },
          update: {
            kind: "assign",
            localId: "i.0",
            value: { kind: "bin", op: "+", left: ref("i.0", f64), right: num(1), type: f64, loc },
            loc,
          },
          body: [
            {
              kind: "exprStmt",
              expr: {
                kind: "arrIntrinsic",
                method: "push",
                receiver: ref("out.0", outT),
                args: [
                  this.jsvalLiftExpr(
                    { kind: "arrayGet", arr: ref("a.0", arrT), index: ref("i.0", f64), type: fromElem, loc },
                    loc,
                  ),
                ],
                type: f64,
                loc,
              },
              loc,
            },
          ],
          loc,
        },
        { kind: "return", value: ref("out.0", outT), loc },
      ],
      loc,
    });
    return name;
  }

  jsvalIn(e: IrExpr, node: ts.Node): IrExpr {
    return jsvalIn(this, e, node);
  }

  /** THE coercion path for values flowing into a typed slot: union arms
   * wrap implicitly (coerceToExpected), then the exact-type fence runs
   * (SC2002 for record shapes, SC2003 for unions). Every slot-directed
   * lowering goes through here (via lowerExprExpecting) or calls this
   * directly when the expression was already lowered. */
  coerceInto(node: ts.Node, expr: IrExpr, expected: IrType): IrExpr {
    let e = this.coerceToExpected(expr, expected);
    // An 'any' value PROVABLY null/undefined (the unit literal itself, or
    // a read of a binding nothing ever assigns a non-unit value) flowing
    // implicitly into a primitive slot: the validated exit refuses units
    // unconditionally, so every run would throw the boundary TypeError
    // where Node proceeds silently. A failure certain at compile time is
    // a fence, not a runtime surprise. Explicit casts keep their runtime
    // checked-cast semantics (the cast lowering builds its own jsExit
    // before this runs, so `e !== expr` skips them), and union/composite
    // targets keep the runtime exit (an undefined-armed union ACCEPTS the
    // engine's undefined; composite validation is dynCheck's business).
    if (
      e !== expr && e.kind === "jsExit" &&
      (e.type.kind === "f64" || e.type.kind === "string" || e.type.kind === "bool")
    ) {
      const unit = this.provenUnitAnyOf(node, e.value);
      if (unit !== null) {
        this.unsupported(
          "SC1090",
          node,
          `an 'any' value that is always ${unit} flowing into a '${this.fmt(expected)}' slot (nothing in the program gives this value another shape, and the island boundary's validated exit refuses ${unit} — every run would throw a TypeError where Node proceeds silently)`,
          `give the binding a value other than ${unit} before this use, or keep the slot's type 'any'`,
        );
      }
    }
    // A closure that just BOXED into dyn takes its JS name from the value's
    // CREATION site (jsFuncValueNameOf: through an alias to the declaration
    // that made it, and `"bound "`-prefixed through a bind), falling back to
    // the source node's own spelling where no creation site is provable —
    // inspect prints [Function: name] and call errors spell it, like Node.
    if (e.kind === "dynFrom" && e.value.type.kind === "func" && e.fnName === undefined) {
      const name = jsFuncValueNameOf(this, node);
      if (name !== null) e = { ...e, fnName: name };
    }
    // …and its Function.prototype.toString SOURCE TEXT from the same
    // creation site (jsFuncValueSourceOf). Absent means unprovable, and
    // the box then refuses to stringify rather than claim native code.
    if (e.kind === "dynFrom" && e.value.type.kind === "func" && e.fnSrc === undefined) {
      const src = jsFuncValueSourceOf(this, node);
      if (src !== null) e = { ...e, fnSrc: src };
    }
    // A union the plain re-tag declined (stranded NON-unit arms): when the
    // node's CHECKER type proves those arms away, they trap instead — the
    // sub-union narrowing bridge (narrowedRetagHelper).
    if (e.type.kind === "union" && expected.kind === "union" && !typeEquals(e.type, expected)) {
      const helper = this.narrowedRetagHelper(node, e.type.unionId, expected.unionId, e.loc);
      if (helper) {
        e = { kind: "call", callee: helper, args: [e], type: expected, loc: e.loc };
      }
    }
    // A JS FUNC value outside the island marshal set flowing into a
    // jsval slot (`withPlugins(getSupportInfoWithoutPlugins, 0)` — a
    // wrapper built at module init around a function the run may never
    // call): the crossing defers to a call-time fence closure instead of
    // stopping the statement — jsvalIn's deferral, the implicit-coercion
    // spelling.
    if (expected.kind === "jsval" && e.type.kind === "func" && !typeEquals(e.type, expected)) {
      const diagsBefore = this.diags.length;
      try {
        this.requireExactShape(node, e.type, expected);
      } catch (err) {
        const fence = islandFuncValueFence(this, err, diagsBefore, node);
        if (fence) return fence;
        throw err;
      }
      return e;
    }
    // A freshly CONSTRUCTED class instance flowing into the interface
    // record it satisfies (`useMem ? new MemStore() : NOOP_STORE`, whose
    // two arms are a nominal object and a record — one common type, two
    // representations). The instance becomes a WITNESS record of closures
    // bound to its methods.
    if (expected.kind === "record" && e.type.kind === "object") {
      const witness = this.classWitnessRecord(node, e as IrExpr & { type: IrType & { kind: "object" } }, expected);
      if (witness) return witness;
    }
    this.requireExactShape(node, e.type, expected);
    return e;
  }

  /** The interface record a freshly constructed class instance satisfies,
   * as a record of closures bound to the instance's methods.
   *
   * FRESHNESS is the soundness gate, not a convenience. Records carry
   * reference identity here exactly as in Node, so witnessing an instance
   * that also travels in its own nominal form would hand `===` two
   * different values for one object. An instance built AT the coercion has
   * no other form: the witness is its only shape from birth, so identity
   * cannot diverge. State stays shared — every closure calls the method on
   * the captured instance, so mutation through the witness is visible to
   * anything else holding it.
   *
   * Methods only, matched exactly. A data property would need an accessor
   * pair the record has no slot for, and a signature that merely coerces
   * would put an adapter between the interface and the method it names. */
  classWitnessRecord(
    node: ts.Node,
    instance: IrExpr & { type: IrType & { kind: "object" } },
    target: IrType & { kind: "record" },
  ): IrExpr | null {
    let n: ts.Node = node;
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) n = n.expression;
    if (!ts.isNewExpression(n)) return null;
    const shape = this.shapes.get(target.shapeId);
    if (!shape || shape.tuple || shape.indexValue || shape.fields.length === 0) return null;
    const info = this.classes.get(instance.type.className);
    if (!info) return null;
    const loc = instance.loc;

    const key = `witness:${instance.type.className}:${target.shapeId}`;
    const existing = this.retagHelpers.get(key);
    if (existing) {
      return { kind: "call", callee: existing, args: [instance], type: target, loc };
    }

    // Probe every method BEFORE interning: a partial witness must not be
    // left half-built in the helper tables.
    const plan: { name: string; fnT: IrType & { kind: "func" }; callee: string; declarer: string; virtual: boolean; ret: IrType }[] = [];
    for (const f of shape.fields) {
      if (f.type.kind !== "func" || f.type.rest === true) return null;
      const found = findMethodOn(this, info, f.name);
      if (!found || found.sig.abstract === true || found.sig.gen !== undefined) return null;
      if (found.sig.params.some((p) => p.mode === "rest")) return null;
      const methodT = funcOf(found.sig.params.map((p) => p.type), found.sig.ret);
      if (!typeEquals(methodT, f.type)) return null;
      plan.push({
        name: f.name,
        fnT: f.type,
        callee: `%${found.declarer.def.name}.${f.name}`,
        declarer: found.declarer.def.name,
        virtual: this.overrideBelow(info, f.name),
        ret: found.sig.ret,
      });
    }

    const builder = `%witness.${this.retagHelpers.size}`;
    this.retagHelpers.set(key, builder);
    const instT = instance.type;
    const fields: { name: string; value: IrExpr }[] = [];
    for (const [i, m] of plan.entries()) {
      if (m.virtual) this.noteVirtualEdge(info, m.name); else this.noteEdge(m.callee);
      const implName = `${builder}.${i}`;
      const params: IrParam[] = m.fnT.params.map((t, k) => ({ localId: `a.${k}`, name: `a${k}`, type: t }));
      const self: IrExpr = { kind: "varRef", localId: "self.0", type: instT, loc };
      const args: IrExpr[] = [
        // The DIRECT call goes to the DECLARER, which may sit above the
        // receiver's own class -- pass it a receiver of the declarer's
        // type, exactly as an ordinary method call does. Without the
        // upcast a subclass instance projected onto a record whose
        // method the BASE declares fails IR validation (SC9001).
        m.virtual ? this.upcastTo(self, info.def.name) : this.upcastTo(self, m.declarer),
        ...m.fnT.params.map((t, k): IrExpr => ({ kind: "varRef", localId: `a.${k}`, type: t, loc })),
      ];
      const callE: IrExpr = m.virtual
        ? { kind: "virtualCall", className: info.def.name, method: m.name, args, type: m.ret, loc }
        : { kind: "call", callee: m.callee, args, type: m.ret, loc };
      this.liftedFns.push({
        name: implName,
        params,
        returnType: m.ret,
        captures: [{ localId: "self.0", name: "self", type: instT }],
        locals: [
          { id: "self.0", name: "self", type: instT, mutable: false, boxed: true },
          ...m.fnT.params.map((t, k) => ({ id: `a.${k}`, name: `a${k}`, type: t, mutable: false })),
        ],
        body: m.ret.kind === "void"
          ? [{ kind: "exprStmt", expr: callE, loc }, { kind: "return", value: null, loc }]
          : [{ kind: "return", value: callE, loc }],
        loc,
      });
      fields.push({
        name: m.name,
        value: { kind: "closure", fnName: implName, captures: ["self.0"], type: m.fnT, loc },
      });
    }
    // The builder takes the instance as a PARAMETER, so every closure
    // captures the one object the call site just constructed.
    this.liftedFns.push({
      name: builder,
      params: [{ localId: "self.0", name: "self", type: instT }],
      returnType: target,
      locals: [{ id: "self.0", name: "self", type: instT, mutable: false, boxed: true }],
      body: [{ kind: "return", value: { kind: "recordLit", fields, type: target, loc }, loc }],
      loc,
    });
    return { kind: "call", callee: builder, args: [instance], type: target, loc };
  }

  /** The unit an 'any' expression PROVABLY holds on every run, or null
   * when no proof exists. Two spellings prove: the lowered value IS the
   * engine unit literal (`null as any`, an any-contextual `undefined`),
   * or the node is an identifier whose every declaration is a plain,
   * non-ambient `var`/`let`/`const` declarator under a variable STATEMENT
   * (catch bindings, for-of/for-in cursors, parameters, and imports all
   * fail this shape test — each receives values from elsewhere), each
   * initializer absent or unit-typed by the checker (a unit TYPE has
   * exactly one value, so syntax doesn't matter), and nothing in the
   * declaring file ever assigns it — bindingNeverReassigned, the same
   * file-scan proof the generic-binding machinery leans on (ESM import
   * bindings are read-only, so cross-file writes don't exist). A hoisted
   * `var` read before its unit-initialized statement holds undefined —
   * also a unit — so the mixed case reports both names. */
  provenUnitAnyOf(node: ts.Node, value: IrExpr): string | null {
    if (value.kind === "jsOp" && value.args.length === 0) {
      if (value.op === "undefLit") return "undefined";
      if (value.op === "nullLit") return "null";
    }
    let n: ts.Node = node;
    while (ts.isParenthesizedExpression(n)) n = n.expression;
    if (!ts.isIdentifier(n)) return null;
    const sym = this.resolveValueSymbol(n);
    if (!sym) return null;
    const decls = this.checker.declarationsOf(sym);
    if (decls.length === 0) return null;
    const units = new Set<string>();
    let allConst = true;
    let firstDecl: ts.VariableDeclaration | null = null;
    for (const d of decls) {
      if (
        !ts.isVariableDeclaration(d) ||
        !ts.isIdentifier(d.name) ||
        !ts.isVariableDeclarationList(d.parent) ||
        !ts.isVariableStatement(d.parent.parent) ||
        d.getSourceFile().isDeclarationFile ||
        (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Ambient) !== 0
      ) {
        return null;
      }
      firstDecl ??= d;
      if ((ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) === 0) allConst = false;
      if (d.initializer === undefined) {
        units.add("undefined");
      } else {
        const t = this.typeOf(d.initializer);
        if (!isUnitOnlyTsType(t)) return null;
        for (const p of t.isUnionType() ? t.getTypes() : [t]) {
          units.add((p.flags & ts.TypeFlags.Null) !== 0 ? "null" : "undefined");
        }
      }
      // A hoisted `var` with a unit initializer still reads `undefined`
      // between module/function entry and its statement.
      if ((ts.getCombinedNodeFlags(d) & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0) {
        units.add("undefined");
      }
    }
    if (!allConst && !bindingNeverReassigned(this, sym, firstDecl!)) return null;
    return [...units].sort().join(" or ");
  }

  /** Lowers an expression that flows into a slot of a known expected type,
   * then applies the coercion path (coerceInto). An EMPTY array literal
   * takes the slot's array type directly — the caller-supplied `expected`
   * lowerArrayLiteral documents, for the positions where tsc's contextual
   * API answers nothing (binding-element defaults: `{ json = [] }`) and
   * the literal's own never[] would build the f64 representation. */
  lowerExprExpecting(node: ts.Expression, expected: IrType | undefined): IrExpr {
    // `Object.freeze(<literal>)` in a slot with a known type. Freeze is
    // IDENTITY over a fresh literal -- the call lowering says so and
    // returns the literal untouched -- but it rebuilds that literal at the
    // CHECKER's contextual type, which throws away the type the caller is
    // asking for. Where the two differ, the literal is then built one way
    // and coerced into another, and a shape the coercion cannot bridge
    // (an array literal against a declared tuple) fails at the store
    // instead of simply being built right. Ask for it directly.
    if (expected !== undefined) {
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (
        ts.isCallExpression(x) &&
        x.arguments.length === 1 &&
        ts.isPropertyAccessExpression(x.expression) &&
        x.expression.name.text === "freeze" &&
        this.isStdlibGlobal(x.expression.expression, "Object")
      ) {
        const arg = x.arguments[0]!;
        if (ts.isObjectLiteralExpression(arg) || ts.isArrayLiteralExpression(arg)) {
          return this.coerceInto(node, this.lowerExprExpecting(arg, expected), expected);
        }
      }
    }
    if (expected?.kind === "array") {
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isArrayLiteralExpression(x) && x.elements.length === 0) {
        return this.coerceInto(node, this.lowerArrayLiteral(x, expected), expected);
      }
    }
    // An OBJECT LITERAL against a checked-dynamic slot in a JS file (the
    // getSupportInfo options argument — a dyn-ABI param): the value's
    // world IS the checked-dynamic tree — build the dyn literal directly, before the
    // island gate could claim the checker's `any` context (an island
    // build could never land in the slot: no engine→dyn crossing).
    if (expected?.kind === "dyn") {
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isObjectLiteralExpression(x) && isJsSourceFile(x.getSourceFile())) {
        return lowerDynObjectLiteral(this, x);
      }
    }
    // An ARRAY LITERAL against a UNION slot whose own type has no static
    // home (the JS dyn fallback — the checker gave no usable context):
    // when the union has exactly ONE array-family arm — an array, or an
    // arity-matching tuple (the option-table `default: [{ value: [] }]`
    // shape) — build AS that arm and wrap; the IR-directed twin of
    // lowerArrayLiteral's contextual-union rule.
    if (expected?.kind === "union") {
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isArrayLiteralExpression(x)) {
        const own = this.mapTypeOf(this.checker.getContextualType(x) ?? this.typeOf(x));
        // Elements beyond bare null/undefined literals can never live in
        // a unit-only-element array — a checker type that degraded to one
        // (`[]`-flavored inference over a populated literal) carries no
        // element information.
        const nonUnitElems = x.elements.some(
          (el) =>
            !ts.isOmittedExpression(el) &&
            el.kind !== ts.SyntaxKind.NullKeyword &&
            !(ts.isIdentifier(el) && el.text === "undefined"),
        );
        if (
          own === null || own.kind === "dyn" || own.kind === "jsval" ||
          (own.kind === "array" && nonUnitElems && this.unitOnlyElem(own.elem)) ||
          this.widthLiftPlan(own, expected) === null
        ) {
          const def = this.unions.get(expected.unionId);
          const arms = (def?.arms ?? []).filter(
            (a) =>
              (a.kind === "array" && !(nonUnitElems && this.unitOnlyElem(a.elem))) ||
              (a.kind === "record" &&
                !!this.shapes.get(a.shapeId)?.tuple &&
                this.shapes.get(a.shapeId)!.fields.length === x.elements.length &&
                !x.elements.some(ts.isSpreadElement)),
          );
          if (arms.length === 1) {
            const arm = arms[0]!;
            const built = this.lowerArrayLiteral(x, arm as IrType & { kind: "array" } | (IrType & { kind: "record" }));
            return this.coerceInto(node, built, expected);
          }
        }
      }
    }
    const e = this.lowerExpr(node);
    return expected ? this.coerceInto(node, e, expected) : e;
  }

  /** A value flowing into an index-signature VALUE slot (an overflow
   * literal entry, a dynamic-keyed record write). dyn slots (`unknown`
   * signatures — ModelPricing's) take a dyn conversion: dyn values pass
   * through, JSON-safe static values convert with dynFrom (a deep copy —
   * the jsMarshal aliasing stance), everything else keeps the dyn-boundary
   * fence. Typed slots ride the ordinary coercion path (union slots wrap
   * arm values, exactness enforced). */
  intoIndexValueSlot(value: IrExpr, indexValue: IrType, node: ts.Node): IrExpr {
    if (indexValue.kind !== "dyn") return this.coerceInto(node, value, indexValue);
    if (value.type.kind === "dyn") return value;
    // An index-signature keyed read stored under an 'unknown' signature
    // reads at THIS slot's width, so an absent key answers undefined the
    // way JS does (recordKeyReadAtSlotWidth). This path builds its dynFrom
    // itself rather than going through coerceToExpected, so it asks here.
    const atWidth = this.recordKeyReadAtSlotWidth(value, DYN);
    if (atWidth) return atWidth;
    // Bare `undefined`/`null` literals store the dyn unit values (JS keeps
    // the key; JSON.stringify drops an undefined-valued one, like Node).
    if (value.kind === "unitLit") {
      return { kind: "dynFrom", value, type: DYN, loc: value.loc };
    }
    // An ISLAND ('any') value: the by-reference jsval→dyn wrap — the same
    // edge coerceToExpected converts (dyn slots accept engine values).
    if (value.type.kind === "jsval") {
      return { kind: "dynFromJsval", value, type: DYN, loc: value.loc };
    }
    if (!this.dynConvertible(value.type)) {
      this.unsupported(
        "SC1100",
        node,
        `storing '${this.fmt(value.type)}' values under an 'unknown'-valued index signature (only numbers, strings, booleans, and JSON-safe records/arrays/unions convert)`,
      );
    }
    return { kind: "dynFrom", value, type: DYN, loc: value.loc };
  }

  /** IR-level `t | undefined` through the shared canonicalizer — the
   * declared result type of an index-signature read under
   * noUncheckedIndexedAccess. Null when the type cannot take the arm. */
  withUndefinedArmOf(t: IrType): IrType | null {
    return withUndefinedArmCanonical(t, this.unions);
  }

  /** IR-level `t | <unit>` through the same shared canonicalizer, for
   * either unit arm. `t` comes back UNCHANGED (same union id) when the arm
   * is already present, which is how `lowerNullishCoalesce`'s dyn rung
   * tells "the checker already admits this default" from "the checker's
   * type is a lie the `??` is there to correct". */
  withUnitArmOf(t: IrType, unit: IrType): IrType | null {
    return withUnitArmCanonical(t, unit, this.unions);
  }

  /** True when a static type converts to a dyn value (the dynFrom
   * walker's domain): JSON-safe, bytes<u8> (Uint8Array/Buffer — the checked-dynamic tree's
   * bytes kind, payload SHARED by reference, so writes through the dyn
   * value reach the original; stdin chunks into unknown-typed helpers),
   * an undefined-armed union whose other arms are JSON-safe — the
   * undefined arm becomes the undefined dyn singleton — or a BOXABLE
   * function type (the checked-dynamic function boundary: the closure
   * crosses as the checked-dynamic tree's callable kind, identity preserved). */
  dynConvertible(t: IrType): boolean {
    return canConvertToDyn(t, (id) => this.shapes.get(id), (id) => this.unions.get(id));
  }

  /** The value of a `return` statement. In an async function `return p`
   * where p is a promise flattens (JS: the returned promise's settlement
   * becomes the async function's result), so it lowers exactly as
   * `return await p` — the awaitExpr parks the fiber and re-throws
   * rejections, which IS the flattening. Everything else flows into the
   * function's return slot through the usual coercion path. */
  /** THE RETURN DESTINATION for recordKeyReadAtUndefinedArm, shared by the
   * `return <expr>` statement and the CONCISE ARROW body (lower-calls) --
   * two spellings of one completion, and spelling the rule twice is how the
   * settle-or-value union came to be handled in one and not the other.
   *
   * `function participantOf(n: Node2): string | undefined { return
   * n.attrs.participant }`. The checker types an index-signature read by the
   * signature's VALUE type, so the read is spelled `string`; the key is
   * absent on the wire; the helper's miss path is `scr_trap_fmt` -- a process
   * ABORT with no `[SCxxxx]` tag, past every catch clause, where Node hands
   * the CALLER `undefined` and the caller's own `=== undefined` answers it.
   *
   * WHY A RETURN SLOT IS A KEEP-CASE, which is the whole admission rule. It
   * is lowerArgExpecting's parameter argument with the direction reversed.
   * tsc narrows `string | undefined` away at a DECLARATION, an ASSIGNMENT
   * and a PROPERTY WRITE -- the destinations the rung refuses, because their
   * readers were compiled as "definitely the string arm" and a stored
   * undefined is the r03 segfault. A DECLARED RETURN TYPE cannot be narrowed
   * that way: control-flow analysis inside the body cannot change what the
   * SIGNATURE says, and every caller was checked against the signature, so
   * every caller already discriminates.
   *
   * Measured on tsc 5.9.3 rather than argued (lab/narrowq): `const a: string
   * = viaReturn(n)` is TS2322 where `const c: string | undefined = attrs.k;
   * const s: string = c` is accepted, and so are the assignment and
   * property-write forms. The three tsc narrows are exactly the three this
   * rung refuses.
   *
   * An INFERRED return type is not a counter-example, it is the gate:
   * `function f() { return attrs.k }` infers `string`, which carries no
   * undefined arm, so `expected` fails the first test and the rung declines
   * -- the trap stays, honestly, because there is nowhere for the undefined
   * to go. A slot WIDER than the read plus the undefined arm is a conversion
   * the author asked for and keeps its own coercion
   * (recordKeyReadAtUndefinedArm's own width gate).
   *
   * No syntactic guard is needed here, unlike lowerArgExpecting -- that one
   * has to reproduce lowerExprExpecting's early rules because it lowers the
   * node itself. This rung inspects a value its caller ALREADY lowered, so a
   * declined rung hands the identical expression to the identical tail and
   * the emitted C is byte-for-byte what it was.
   *
   * SCRIPTC_RETARM_OFF=1 ablates it, so one binary emits both sides of the
   * A/B; SCRIPTC_RETARM_WHY names every site it fires or declines on. */
  keyedReadAtReturnSlot(raw: IrExpr, expected: IrType, node: ts.Node): IrExpr | null {
    if (process.env["SCRIPTC_RETARM_OFF"] === "1") return null;
    if (expected.kind !== "union") return null;
    if (this.armTag(expected.unionId, UNDEFINED_T) < 0) return null;
    const armed = this.recordKeyReadAtUndefinedArm(raw, expected)
      ?? this.keyedReadRefAtUndefinedArm(raw, expected);
    if (process.env["SCRIPTC_RETARM_WHY"]) {
      const l = locOf(node);
      console.error(
        `RETARM ${armed ? "FIRES" : "declines"} ${l.file}@${l.start} read=${this.fmt(raw.type)} want=${this.fmt(expected)} kind=${raw.kind}`,
      );
    }
    return armed;
  }

  /** The value of `return <expr>` against the context's declared return —
   * or NULL for a bare return: `return undefined`/`return null` in a
   * void-returning function (`{ bar() { return undefined } }`, inferred
   * `() => null` shapes whose return maps to void) hands the caller JS's
   * undefined, which the void slot drops. Units are pure literals, so
   * nothing evaluates; unit-typed non-literals keep the fences. */
  lowerReturnValue(node: ts.Expression): IrExpr | null {
    const expected = this.ctx.returnType;
    // An EMPTY array literal takes the RETURN slot's element type, exactly
    // as it does in every other typed slot (lowerExprExpecting says so, for
    // the same reason): it has no element type of its own, and lowered bare
    // it builds its never[] as the f64 representation, so the coercion then
    // fences on a 'number[]' the source never wrote.
    //
    // A SYNC return was already fine — tsc hands the literal the declared
    // return type as its contextual type and the inference reads the
    // element off that. An ASYNC one is not: there the contextual type is
    // the awaited-or-thenable union, which has no single element to read,
    // so `async f(): Promise<string[]>` with `return []` fenced where the
    // sync twin compiled. ctx.returnType is the plain AWAITED type in an
    // async frame, which is exactly the type wanted — asking it directly
    // settles both forms the same way.
    if (expected.kind === "array") {
      let x: ts.Expression = node;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isArrayLiteralExpression(x) && x.elements.length === 0) {
        return this.coerceInto(node, this.lowerArrayLiteral(x, expected), expected);
      }
    }
    // THE RETURN DESTINATION for recordKeyReadAtUndefinedArm.
    //
    // `function participantOf(n: Node2): string | undefined { return
    // n.attrs.participant }`. The checker types an index-signature read by
    // the signature's VALUE type, so the read is spelled `string`; the key
    // is absent on the wire; the helper's miss path is `scr_trap_fmt` -- a
    // process ABORT with no `[SCxxxx]` tag, past every catch clause, where
    // Node hands the CALLER `undefined` and the caller's own `=== undefined`
    // answers it. Measured, not argued: a generated destination population
    // (block/aborts, lab/ret) aborts on the plain `return`, the concise
    // arrow, the block arrow and the async return, and agrees with Node on
    // every one of their HIT twins.
    //
    // WHY A RETURN SLOT IS A KEEP-CASE, which is the whole admission rule.
    // It is lowerArgExpecting's parameter argument with the direction
    // reversed. tsc narrows `string | undefined` away at a DECLARATION, an
    // ASSIGNMENT and a PROPERTY WRITE -- the destinations the rung refuses,
    // because their readers were compiled as "definitely the string arm"
    // and a stored undefined is the r03 segfault. A DECLARED RETURN TYPE
    // cannot be narrowed that way: control-flow analysis inside the body
    // cannot change what the SIGNATURE says, and every caller was checked
    // against the signature, so every caller already discriminates.
    //
    // An INFERRED return type is not a counter-example, it is the gate:
    // `function f() { return attrs.k }` infers `string`, which carries no
    // undefined arm, so `expected` fails the first test and the rung
    // declines -- the trap stays, honestly, because there is nowhere for
    // the undefined to go. A slot WIDER than the read plus the undefined
    // arm is a conversion the author asked for and keeps its own coercion
    // (recordKeyReadAtUndefinedArm's own width gate).
    //
    // No syntactic guard is needed here, unlike lowerArgExpecting -- that
    // one has to reproduce lowerExprExpecting's early rules because it
    // lowers the node itself. This rung inspects the value the call below
    // ALREADY made, so a declined rung hands the identical expression to
    // the identical tail and the emitted C is byte-for-byte what it was.
    //
    // SCRIPTC_RETARM_OFF=1 ablates it, so one binary emits both sides of
    // the A/B; SCRIPTC_RETARM_WHY names every site it fires or declines on.
    const raw = this.lowerExpr(node);
    const e = this.keyedReadAtReturnSlot(raw, expected, node) ?? raw;
    if (expected.kind === "void" && e.kind === "unitLit") return null;
    return this.coerceInto(node, this.asyncReturnFlatten(e, expected, this.ctx.isAsync), expected);
  }

  /** JS's RETURN-SIDE flattening in an async function, as one rule with two
   * callers: the `return <expr>` statement above, and the async CONCISE
   * ARROW body (`async () => x`), whose implicit return is the same
   * completion. Answers `value` unchanged when nothing flattens.
   *
   * A returned thenable is adopted by the function's own promise, which is
   * `return await p` — this compiler's long-standing spelling for it, and
   * the reason the plain-promise arm below has been here as long as async
   * has. The tick it costs is the genuine `return p` / `return await p`
   * difference and is already visible on main for the plain case.
   *
   * The SETTLE-OR-VALUE union `T | Promise<T>` is the arm the rule was
   * missing, and missing it was a SILENT WRONG ANSWER rather than a fence.
   * The test was `kind === "promise"`, so a union merely CARRYING a promise
   * arm fell through to the ordinary coercion — which has no
   * union-to-payload conversion and reached for the checked single-arm
   * extraction (narrowedArmHelper), compiling the promise arm to a throw.
   * Both spellings of
   *
   *     async f(x: string | Promise<string>): Promise<string> { return x }
   *
   * therefore printed the string for `f('a')` and rejected `f(g())` with an
   * UNCODED "a 'Promise<string>' value is not representable in the target
   * union" TypeError. No diagnostic code and no census trap; the `??` block
   * found it while deciding not to lift a fence in front of it, and it is
   * why that fence was right to stay. estado-promiseunion.md §3.
   *
   * settleOrValueAwait is the builder — the same one `await u` reaches from
   * the expression lowering and promiseCoerceAdapter reaches for a nested
   * payload — so neither emitter learns anything new.
   *
   * The union guard is written to be as WIDE as it can honestly be and no
   * wider. It stands aside when the destination is the SAME union (the
   * coercion is already identity) and when the destination genuinely
   * CARRIES the promise arm, where the arm-wise re-tag is the right answer
   * and awaiting would change the value. Everywhere else the path it
   * replaces was a throw or a fence, so nothing that compiled can move. */
  asyncReturnFlatten(value: IrExpr, expected: IrType, isAsync: boolean | undefined): IrExpr {
    if (!isAsync || expected.kind === "promise") return value;
    if (value.type.kind === "promise") {
      return { kind: "awaitExpr", value, type: value.type.inner, loc: value.loc };
    }
    if (value.type.kind !== "union" || typeEquals(value.type, expected)) return value;
    const def = this.unions.get(value.type.unionId);
    const promiseArm = def?.arms.find((a) => a.kind === "promise");
    if (promiseArm === undefined) return value;
    if (expected.kind === "union" && this.armTag(expected.unionId, promiseArm) >= 0) return value;
    return this.settleOrValueAwait(value, value.loc) ?? value;
  }

  /** `return <expr>` lowered as a STATEMENT against the declared return.
   * Void-returning contexts get the JS drop: a contextually void-typed
   * function may return a value (`fv = function() { return 0; }` into a
   * `() => void` slot) — the expression evaluates for its effects, the
   * caller never sees a value, so the return goes out bare. Async
   * void-inner returns still resolve a returned promise first. */
  lowerReturnStmt(node: ts.Expression, loc: SrcLoc): IrStmt {
    const expected = this.ctx.returnType;
    if (expected.kind === "void") {
      // The THIRD spelling of the flattening rule, shared rather than
      // copied — copying it is how the settle-or-value union came to be
      // handled in one place and not the others. A contextually
      // void-typed async function still ADOPTS a returned thenable: the
      // value is dropped, but settlement waits for it and a REJECTION on
      // the promise arm has to reach the caller rather than surfacing as
      // an unhandled rejection.
      const e = this.asyncReturnFlatten(this.lowerExpr(node), expected, this.ctx.isAsync);
      if (e.kind === "unitLit") return { kind: "return", value: null, loc };
      if (e.type.kind === "void") return { kind: "return", value: e, loc };
      return {
        kind: "block",
        body: [
          { kind: "exprStmt", expr: e, loc },
          { kind: "return", value: null, loc },
        ],
        loc,
      };
    }
    return { kind: "return", value: this.lowerReturnValue(node), loc };
  }

  /** `Number(x)`'s operand at the read's SLOT width -- the twin of the
   * string conversion's rule, which ensureString has always had. */
  numberConvAtDynWidth(e: IrExpr): IrExpr | null {
    return numberConvAtDynWidth(this, e);
  }

  maybeNarrow(expr: IrExpr, node: ts.Node): IrExpr {
    return maybeNarrow(this, expr, node);
  }

  lowerUnitComparison(left: IrExpr,
    right: IrExpr,
    negated: boolean,
    loc: SrcLoc,): IrExpr | null {
    return lowerUnitComparison(this, left, right, negated, loc);
  }

  lowerNullishCoalesce(expr: ts.BinaryExpression, loc: SrcLoc): IrExpr {
    return lowerNullishCoalesce(this, expr, loc);
  }

  lowerOptionalChain(expr: ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression,): IrExpr {
    return lowerOptionalChain(this, expr);
  }

  finishOptionalChain(expr: ts.Expression,
    id: string,
    receiver: IrExpr,
    body: IrExpr,
    loc: SrcLoc,
    slotWidenedRecv = false,): IrExpr {
    return finishOptionalChain(this, expr, id, receiver, body, loc, slotWidenedRecv);
  }

  /* ── functions ────────────────────────────────────────────────────── */

  /** The union without `t`'s undefined arm (unchanged when there is none, or
   * when `t` isn't a union). The body-facing type of a defaulted parameter:
   * tsc types uses of `x: string | undefined = "hi"` as plain `string` inside
   * the body — the default removes exactly the undefined possibility. */
  stripUndefinedArm(t: IrType): IrType {
    if (t.kind !== "union") return t;
    const def = this.unions.get(t.unionId);
    if (!def || !def.arms.some((a) => a.kind === "undefinedT")) return t;
    const rest = def.arms.filter((a) => a.kind !== "undefinedT");
    if (rest.length === 1) return rest[0]!;
    // Removing an arm keeps canonical (typeKey-sorted) order.
    return { kind: "union", unionId: this.unions.intern(rest) };
  }

  /** The interned `T | undefined` union over a non-union arm type — the ABI
   * type of a defaulted parameter, and the result type of lookups that may
   * miss (process.env reads). "undefined" sorts last among all arm typeKeys,
   * so the sorted pair is always [t, undefined]. */
  withUndefinedArm(t: IrType): IrType {
    const arms = [t, UNDEFINED_T].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    return { kind: "union", unionId: this.unions.intern(arms) };
  }

  paramShape(param: ts.ParameterDeclaration): ParamShape {
    return paramShape(this, param);
  }

  checkDefaultParamBodyType(param: ts.ParameterDeclaration, bodyType: IrType): void {
    return checkDefaultParamBodyType(this, param, bodyType);
  }

  paramShapes(params: readonly ts.ParameterDeclaration[]): ParamShape[] {
    return paramShapes(this, params);
  }

  completeArgs(argNodes: readonly ts.Expression[],
    shapes: readonly ParamShape[],
    loc: SrcLoc,
    blame: ts.Node,): IrExpr[] {
    return completeArgs(this, argNodes, shapes, loc, blame);
  }

  wrappedUndefined(type: IrType, loc: SrcLoc): IrExpr | null {
    return wrappedUndefined(this, type, loc);
  }

  /** The entry value of a binding JS initializes to `undefined` (an
   * initializer-less declaration, a hoisted `var` before its statement):
   * undefined-armed unions hold the interned undefined arm, and 'any'
   * slots hold the ENGINE's undefined — tsc's definite-assignment
   * analysis never guards `any` reads, so a jsval slot IS readable before
   * any assignment and must never stay a C-level NULL (a validated exit
   * or engine op on NULL is memory-unsafe, not a TypeError). Null for
   * every other type: tsc rejects their pre-assignment reads. */
  unassignedSlotInit(type: IrType, loc: SrcLoc): IrExpr | null {
    if (type.kind === "jsval") {
      return { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc };
    }
    return this.wrappedUndefined(type, loc);
  }

  undefinedArgFor(type: IrType, loc: SrcLoc, blame: ts.Node): IrExpr {
    return undefinedArgFor(this, type, loc, blame);
  }

  requireExactArityValue(blame: ts.Node,
    contextual: ts.Expression | null,
    shapes: readonly ParamShape[],
    funcType: IrType,): void {
    return requireExactArityValue(this, blame, contextual, shapes, funcType);
  }

  bodyReturnType(isAsync: boolean, declared: IrType): IrType {
    return bodyReturnType(this, isAsync, declared);
  }
  genBodyReturnType(declared: IrType): IrType {
    return declared.kind === "generator" ? declared.retT : declared;
  }


  declaredReturnType(decl: ts.SignatureDeclaration, blame: ts.Node): IrType {
    return declaredReturnType(this, decl, blame);
  }

  /** Runs one declaration's collection with diagnostics captured: on
   * poison, they DEFER under the declaration's symbol instead of failing
   * the build — an unreached broken declaration costs nothing; the first
   * reference flushes them (flushDeferred). A declaration with no name
   * symbol reports eagerly (nothing could ever reference it). */
  collectDeferring(symbolOf: () => ts.Symbol | undefined, collect: () => void): ts.Symbol | null {
    const sink: ScrDiagnostic[] = [];
    this.diagSink = sink;
    try {
      collect();
      return null;
    } catch (e) {
      this.diagSink = null;
      const symbol = (() => {
        // symbolOf queries the checker too — a second panic must not
        // escape the fence that is handling the first.
        try {
          return symbolOf() ?? null;
        } catch {
          return null;
        }
      })();
      // An upstream tsgo panic reached through this declaration's queries
      // (the 1e999 JSON-marshal signature crossed collectSignature): the
      // declaration poisons under a source-anchored diagnostic, deferred
      // like any collection fence — never a crashed CLI.
      if (isCheckerPanic(e)) {
        const decl = symbol ? this.checker.declarationsOf(symbol)[0] : undefined;
        sink.push(checkerPanicDiag(
          e.message.split("\n", 1)[0]!,
          decl ? locOf(decl) : { file: this.entry.fileName, start: 0, end: 0 },
        ));
      } else if (!(e instanceof PoisonError)) {
        throw e;
      }
      if (!symbol) {
        for (const d of sink) this.pushDiag(d);
        return null;
      }
      const list = this.deferredDiags.get(symbol) ?? [];
      list.push(...sink);
      this.deferredDiags.set(symbol, list);
      return symbol;
    } finally {
      this.diagSink = null;
    }
  }

  /** Pushes a symbol's deferred collection diagnostics: lowering resolved
   * a reference to it, so the declaration is part of what the entry runs.
   * The reference site then proceeds exactly as before (its own rejection
   * may follow) — reached-but-broken declarations report the same set of
   * diagnostics the eager collector historically produced. */
  flushDeferred(symbol: ts.Symbol): void {
    if (this.collecting) return;
    const diags = this.deferredDiags.get(symbol);
    if (!diags) return;
    this.deferredDiags.delete(symbol);
    if (this.alreadyFlushed.has(symbol)) return; // the emit pass reported these
    this.flushedSymbols.add(symbol);
    for (const d of diags) this.pushDiag(d);
  }

  flushDeferredClass(className: string): void {
    const symbol = this.deferredClassByName.get(className);
    if (symbol) this.flushDeferred(symbol);
  }

  collectSignature(decl: ts.FunctionDeclaration): void {
    return collectSignature(this, decl);
  }

  collectSignatureInner(decl: ts.FunctionDeclaration): void {
    return collectSignatureInner(this, decl);
  }

  /* ── generic functions (monomorphization) ─────────────────────────── */

  collectGenericSignature(decl: ts.FunctionDeclaration): void {
    return collectGenericSignature(this, decl);
  }

  genericFnOf(ident: ts.Identifier): GenericFnInfo | null {
    return genericFnOf(this, ident);
  }

  lowerGenericCall(expr: ts.CallExpression, info: GenericFnInfo): IrExpr {
    return lowerGenericCall(this, expr, info);
  }

  lowerGenericFnValue(ref: ts.Expression, info: GenericFnInfo): IrExpr {
    return lowerGenericFnValue(this, ref, info);
  }

  inferTypeParamBindings(expr: ts.CallExpression,
    info: GenericFnInfo,
    rsig: ts.Signature,
    tsBindings?: Map<ts.Symbol, ts.Type>,): Map<ts.Symbol, IrType> {
    return inferTypeParamBindings(this, expr, info, rsig, tsBindings);
  }

  lowerGenericInstance(info: GenericFnInfo, inst: GenericInstance): IrFunction {
    return lowerGenericInstance(this, info, inst);
  }

  /* ── classes ──────────────────────────────────────────────────────── */

  collectClassShape(decl: ts.ClassDeclaration): void {
    return collectClassShape(this, decl);
  }

  collectClassShapeInner(decl: ts.ClassLikeDeclaration, jsNameOverride?: string,
    inst?: { family: ClassInfo; name: string; bindings: Map<ts.Symbol, IrType>; typeArgsText: string; ordinal: number },
    mixin?: { base: ClassInfo; name: string; call: ts.CallExpression; bindings: Map<ts.Symbol, IrType>; context: string; ordinal: number },): void {
    return collectClassShapeInner(this, decl, jsNameOverride, inst, mixin);
  }

  lowerClassExpressionInfo(expr: ts.ClassExpression): ClassInfo {
    return lowerClassExpressionInfo(this, expr);
  }

  lowerClassExpression(expr: ts.ClassExpression): IrExpr {
    return lowerClassExpression(this, expr);
  }

  /* ── the class graph (single inheritance) ─────────────────────────── */

  findMethodOn(info: ClassInfo | null,
    name: string,): { declarer: ClassInfo; sig: { params: ParamShape[]; ret: IrType; abstract?: true; async?: true } } | null {
    return findMethodOn(this, info, name);
  }

  isSubclassOf(sub: string, sup: string): boolean {
    return isSubclassOf(this, sub, sup);
  }

  inHierarchy(info: ClassInfo): boolean {
    return inHierarchy(this, info);
  }

  overrideBelow(info: ClassInfo, name: string): boolean {
    return overrideBelow(this, info, name);
  }

  upcastTo(expr: IrExpr, className: string): IrExpr {
    return upcastTo(this, expr, className);
  }

  /** `res` AS a Readable: the native view over an IncomingMessage's body
   * (scr_http_body.c). The ONE builder for both the top-level coercion
   * and the width-lift plan, so the two spellings emit the same call.
   *
   * There is no interned helper and no temp: the libCall takes the
   * request BORROWED and answers the stream +1, so the argument
   * evaluates exactly once wherever the coercion runs. The runtime
   * memoizes the view on the request, which is what keeps a second
   * conversion of the same response from building a second stream over
   * one body — Node has one object and this is as close as two
   * representations get. */
  httpBodyStream(expr: IrExpr): IrExpr {
    return { kind: "libCall", fn: "http.reqBodyStream", args: [expr], type: READABLE_T, loc: expr.loc };
  }

  /** True when `className` is the %Error root or any class inside its
   * hierarchy (builtin kinds and user `extends Error` subclasses). */
  errorHierarchyClassOf(className: string): boolean {
    if (className === "%Error" || RUNTIME_ERROR_CLASSES.has(className)) return true;
    for (let c = this.classes.get(className)?.base ?? null; c; c = c.base) {
      if (c.def.name === "%Error") return true;
    }
    return false;
  }

  classValueRef(info: ClassInfo, blame: ts.Node): IrExpr {
    return classValueRef(this, info, blame);
  }

  /** Class EXPRESSIONS collected this run, in first-encounter order: the
   * emit pass lowers their members after the init bodies (declaration
   * members ride fp.classDecls; expressions register only when their
   * containing statement lowers). */
  readonly exprClasses: ClassInfo[] = [];
  readonly exprClassInfoByNode = new Map<ts.ClassExpression, ClassInfo>();
  /** Class expressions whose collection is IN FLIGHT — the reentrancy
   * guard for heritage-demanded collection (lowerClassExpressionInfo). */
  readonly collectingExprClasses = new Set<ts.ClassExpression>();
  /** Static-init statements of class expressions inside the statement
   * currently lowering — lowerFileInit drains the buffer immediately
   * BEFORE that statement (JS's order for the supported whole-initializer
   * positions). */
  readonly pendingClassExprInits: IrStmt[] = [];
  /** Discovery hook: registers a just-collected expression class's member
   * bodies as worklist units (the units map is otherwise built before
   * lowering starts). Null in the emit pass. */
  onExprClassCollected: ((info: ClassInfo) => void) | null = null;

  /** Mixin functions (`(Base: T) => class extends Base {…}`) by their
   * function-like node: recognized shape, or null for checked
   * non-qualifiers (lower-mixins.ts). */
  readonly mixinFnShapes = new Map<ts.Node, MixinFnShape | null>();
  /** Mixin instantiations by CALL SITE (one class per once-evaluated call
   * — the class-expression identity rule); null marks a poisoned
   * instantiation so re-demands fence instead of half-collecting. */
  readonly mixinInstanceByCall = new Map<ts.CallExpression, ClassInfo | null>();
  /** Mixin calls whose instantiation is IN FLIGHT — the cyclic-extends
   * backstop (the collectingExprClasses rule). */
  readonly mixinCollectingCalls = new Set<ts.CallExpression>();
  /** Per mixin-class-node demand count: only the FIRST instantiation
   * counts statements toward coverage (the generic-instance rule). */
  readonly mixinOrdinals = new Map<ts.ClassLikeDeclaration, number>();
  /** The mixin instantiation whose source is CURRENTLY collecting or
   * lowering: mapType resolves the inner class node's own instance type
   * (`this` inside members, self-referential fields) to THIS
   * instantiation — the shared AST means the checker keeps answering the
   * one class node for every instantiation, like generic bindings. */
  mixinTypeContext: { classNode: ts.ClassLikeDeclaration; className: string } | null = null;
  /** PINNED mixin instantiations (const-binding / heritage call sites) by
   * their class node — the intersection resolver's candidate sets
   * (mixinIntersectionInstanceType). */
  readonly mixinInstancesByClassNode = new Map<ts.ClassLikeDeclaration, ClassInfo[]>();

  mixinCallClassInfoOf(call: ts.CallExpression): ClassInfo | null {
    return mixinCallClassInfoOf(this, call);
  }

  /** Generic classes (monomorphization by flow): declaration → the family's
   * instance table. Filled by collectClassShapeInner's family mode;
   * consulted by mapType's genericClassInstance hook. */
  readonly genericClassByDecl = new Map<ts.ClassLikeDeclaration, GenericClassInfo>();
  /** Instantiations in demand order — the member-lowering worklist run()'s
   * monomorphization fixpoint drains (an instantiation's methods can
   * demand further instances of either kind). */
  readonly genericClassInstances: ClassInfo[] = [];
  /** Discovery hook: a generic-class instantiation collected mid-lowering
   * (instantiations are demand-driven, not units — their members lower in
   * the instance drain). Null everywhere today; reserved for symmetry with
   * onExprClassCollected should instantiations ever need eager
   * registration. */
  onLateClassCollected: ((info: ClassInfo) => void) | null = null;

  genericClassInstanceType(decl: ts.ClassLikeDeclaration, ref: ts.Type): IrType | null {
    return genericClassInstanceType(this, decl, ref);
  }

  findStaticOn(info: ClassInfo | null, name: string): ReturnType<typeof findStaticOn> {
    return findStaticOn(this, info, name);
  }

  staticShadowBelow(info: ClassInfo, name: string): boolean {
    return staticShadowBelow(this, info, name);
  }

  ctorAbiEquals(sub: ClassInfo, sup: ClassInfo): boolean {
    return ctorAbiEquals(this, sub, sup);
  }

  exactClassOfReceiver(expr: ts.Expression): ClassInfo | null {
    return exactClassOfReceiver(this, expr);
  }

  lowerClassMembers(info: ClassInfo): IrFunction[] {
    return lowerClassMembers(this, info);
  }

  lowerStaticFieldInits(info: ClassInfo): IrStmt[] {
    return lowerStaticFieldInits(this, info);
  }

  /** The method-like members (methods and accessors) of a class that have
   * lowerable bodies, with their collected method-map names. */
  *classMethodMembers(
    info: ClassInfo,
  ): Generator<{ mName: string; member: ts.MethodDeclaration | ts.AccessorDeclaration }> {
    if (!info.decl) return; // builtin error classes: runtime-provided bodies
    for (const member of info.decl.members) {
      const fnLike =
        ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)
          ? member
          : null;
      if (!fnLike) continue;
      // STATIC methods lower separately (`%C.static:m` via staticMethods;
      // accessors stay fenced per site) — and a static member SHARING an
      // instance member's name would match the instance entry in
      // info.methods below and lower a second body under the same %C.name
      // (the duplicate-function ICE, signature 10).
      const mods = ts.canHaveModifiers(fnLike) ? ts.getModifiers(fnLike) : undefined;
      if (mods?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      // Computed method names resolve exactly like collection did
      // (classMemberNameOf — folded keys and the sym:iterator slot);
      // unresolvable ones never collected, so they skip here too.
      const baseName = ts.isMethodDeclaration(fnLike)
        ? classMemberNameOf(this, fnLike.name)
        : ts.isIdentifier(fnLike.name) || ts.isPrivateIdentifier(fnLike.name)
          ? fnLike.name.text
          : null;
      if (baseName === null) continue;
      const mName = ts.isMethodDeclaration(fnLike) ? baseName : `${ts.isGetAccessor(fnLike) ? "get" : "set"}:${baseName}`;
      if (!info.methods.get(mName) || !fnLike.body) continue;
      yield { mName, member: fnLike };
    }
  }

  lowerClassCtor(info: ClassInfo): IrFunction {
    return lowerClassCtor(this, info);
  }

  lowerClassMethodMember(info: ClassInfo,
    fnLike: ts.MethodDeclaration | ts.AccessorDeclaration,): IrFunction | null {
    return lowerClassMethodMember(this, info, fnLike);
  }

  throwingSetterFn(info: ClassInfo, prop: string): IrFunction {
    return throwingSetterFn(this, info, prop);
  }

  fieldInitStmts(info: ClassInfo, thisLocal: IrLocal): IrStmt[] {
    return fieldInitStmts(this, info, thisLocal);
  }

  lowerDerivedCtorBody(info: ClassInfo, thisLocal: IrLocal, forward?: IrExpr[]): IrStmt[] {
    return lowerDerivedCtorBody(this, info, thisLocal, forward);
  }

  superCallStmt(info: ClassInfo,
    thisLocal: IrLocal,
    args: IrExpr[],
    loc: SrcLoc,): IrStmt {
    return superCallStmt(this, info, thisLocal, args, loc);
  }

  /** Declares the `this` param local, registered under the THIS_BINDING
   * sentinel so lexical-this capture in arrows uses the normal machinery. */
  declareThis(type: IrType): IrLocal {
    const ctx = this.ctx;
    const local: IrLocal = { id: "this.0", name: "this", type, mutable: false };
    ctx.locals.push(local);
    ctx.scopes[ctx.scopes.length - 1]!.set(THIS_BINDING, local);
    return local;
  }

  /** Declares this function's synthetic `%arguments` slot — the whole
   * argument list as one dyn array — registered under the
   * ARGUMENTS_BINDING sentinel so nested arrows capture it through the
   * normal machinery, exactly as declareThis does for `this`. The caller
   * still appends the matching trailing IrParam: the slot is part of the
   * ABI (funcType.rest), not a body local. */
  declareArgumentsLocal(): IrLocal {
    const ctx = this.ctx;
    const local = this.declareHiddenLocal("%arguments", DYN);
    ctx.argumentsLocal = local;
    ctx.scopes[ctx.scopes.length - 1]!.set(ARGUMENTS_BINDING, local);
    return local;
  }

  lowerFunction(decl: ts.FunctionDeclaration): IrFunction | null {
    return lowerFunction(this, decl);
  }

  collectGlobals(sf: ts.SourceFile, topStmts: ts.Statement[]): void {
    return collectGlobals(this, sf, topStmts);
  }

  lowerFileInit(sf: ts.SourceFile, stmts: ts.Statement[], name: string): IrFunction {
    return lowerFileInit(this, sf, stmts, name);
  }

  lowerDefaultExport(stmt: ts.ExportAssignment): IrStmt | null {
    return lowerDefaultExport(this, stmt);
  }

  buildMain(): IrFunction {
    return buildMain(this);
  }

  /* ── scoping and captures ─────────────────────────────────────────── */

  declareLocal(nameNode: ts.Node, name: string, type: IrType, mutable: boolean): IrLocal {
    const ctx = this.ctx;
    const count = ctx.localCounters.get(name) ?? 0;
    ctx.localCounters.set(name, count + 1);
    const local: IrLocal = { id: `${name}.${count}`, name, type, mutable };
    ctx.locals.push(local);
    const symbol = this.checker.getSymbolAtLocation(nameNode);
    if (symbol) ctx.scopes[ctx.scopes.length - 1]!.set(symbol, local);
    return local;
  }

  /** A function-scope local bound to NO ts.Symbol — the hidden ABI slot of a
   * defaulted parameter (the parameter's symbol binds to the separately-
   * declared body local; nothing in the source can name this one). */
  declareHiddenLocal(name: string, type: IrType): IrLocal {
    const ctx = this.ctx;
    const count = ctx.localCounters.get(name) ?? 0;
    ctx.localCounters.set(name, count + 1);
    const local: IrLocal = { id: `${name}.${count}`, name, type, mutable: false };
    ctx.locals.push(local);
    return local;
  }

  /** Declares a callee's parameter locals from its ParamShapes and builds
   * the DEFAULT-PARAM PROLOGUE. Required/optional/rest params bind their
   * symbol directly (one local of the ABI type). A defaulted param `x: T = e`
   * gets TWO locals: the hidden ABI slot (the incoming `T | undefined`
   * union) and the body local `x` of plain T, initialized by
   *
   *   const x = <in> is undefined-arm ? e : narrow(<in>)
   *
   * — a lazily-branched ternary, so the default expression evaluates exactly
   * when the argument was omitted or undefined (JS's call-time rule), in the
   * callee scope, left-to-right across params (prologue order), and may
   * reference earlier params (their body locals are already bound) and
   * `this` in methods (param 0, declared before any of these). tsc rejects
   * self- and forward-references inside initializers. Must be called before
   * lowering the body; the returned prologue statements go first. */
  declareParams(
    rawDecls: readonly ts.ParameterDeclaration[],
    shapes: readonly ParamShape[],
  ): { params: IrParam[]; prologue: IrStmt[] } {
    // `this` parameters are type-world (paramShapes skipped them; callers
    // never pass them) — skip here too so decls stay shape-aligned.
    const decls = rawDecls.filter((p) => !isThisParameter(p));
    const params: IrParam[] = [];
    const prologue: IrStmt[] = [];
    decls.forEach((decl, i) => {
      const shape = shapes[i]!;
      if (ts.isArrayBindingPattern(decl.name) || ts.isObjectBindingPattern(decl.name)) {
        // Pattern parameter: one hidden ABI slot carries the source value;
        // the prologue binds each name exactly like a destructuring
        // declaration reading from it (the same lowerBindingPattern —
        // pattern fences included). Bound names are mutable, like any
        // parameter in JS.
        const loc = locOf(decl);
        const slot = this.declareHiddenLocal("%param", shape.type);
        params.push({ localId: slot.id, name: "%param", type: shape.type });
        let srcType = shape.type;
        let srcRef = (): IrExpr => ({ kind: "varRef", localId: slot.id, type: shape.type, loc });
        if (shape.mode === "omittable" && shape.bodyType && decl.initializer) {
          // A WHOLE-PATTERN default (`({ x } = { x: 1 })`): pick the
          // default exactly when the argument was omitted or undefined
          // (the ABI union's undefined arm — JS's call-time rule, the
          // identifier-param prologue's ternary), then destructure the
          // picked value.
          const abi = shape.type;
          if (abi.kind === "dyn" || abi.kind === "jsval") {
            // A DYNAMIC-TIER pattern source (`function f({} = a)` with
            // `a: any` — jsval for island values, dyn for the checked-
            // dynamic dyn): the slot holds its tier's undefined directly,
            // so the default test is the runtime undefined test — then
            // the pattern destructures the picked value.
            const dflt = this.lowerExprExpecting(decl.initializer, abi);
            const src = this.declareHiddenLocal("%psrc", abi);
            const inRef = (): IrExpr => ({ kind: "varRef", localId: slot.id, type: abi, loc });
            const isUndef: IrExpr =
              abi.kind === "jsval"
                ? { kind: "jsOp", op: "eq", args: [inRef(), { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc }], type: BOOL, loc }
                : { kind: "dynTest", test: "undefined", value: inRef(), type: BOOL, loc };
            prologue.push({
              kind: "varDecl",
              localId: src.id,
              init: { kind: "ternary", cond: isUndef, then: dflt, else_: inRef(), type: abi, loc },
              loc,
            });
            const pickedT = abi;
            srcType = pickedT;
            srcRef = () => ({ kind: "varRef", localId: src.id, type: pickedT, loc });
            this.lowerBindingPattern(decl.name, srcRef, srcType, true, prologue);
            return;
          }
          if (abi.kind !== "union") this.unsupported("SC1090", decl, "this parameter form"); // defensive
          const undefTag = this.armTag(abi.unionId, UNDEFINED_T);
          if (undefTag < 0) this.unsupported("SC1090", decl, "this parameter form"); // defensive
          const isUndef: IrExpr = {
            kind: "unionIsTag", unionId: abi.unionId, tag: undefTag, negated: false,
            value: { kind: "varRef", localId: slot.id, type: abi, loc }, type: BOOL, loc,
          };
          let present: IrExpr | null = null;
          if (typeEquals(shape.bodyType, abi)) {
            present = { kind: "varRef", localId: slot.id, type: abi, loc };
          } else if (shape.bodyType.kind === "union") {
            const retag = this.unionRetagHelper(abi.unionId, shape.bodyType.unionId, loc);
            if (retag) present = { kind: "call", callee: retag, args: [{ kind: "varRef", localId: slot.id, type: abi, loc }], type: shape.bodyType, loc };
          } else {
            const tag = this.armTag(abi.unionId, shape.bodyType);
            if (tag >= 0) {
              present = { kind: "unionNarrow", unionId: abi.unionId, tag, value: { kind: "varRef", localId: slot.id, type: abi, loc }, type: shape.bodyType, loc };
            }
          }
          if (!present) this.unsupported("SC1090", decl, "this parameter form"); // defensive: abi = bodyType + undefined by construction
          const dflt = this.lowerExprExpecting(decl.initializer, shape.bodyType);
          const src = this.declareHiddenLocal("%psrc", shape.bodyType);
          prologue.push({
            kind: "varDecl",
            localId: src.id,
            init: { kind: "ternary", cond: isUndef, then: dflt, else_: present, type: shape.bodyType, loc },
            loc,
          });
          const pickedT = shape.bodyType;
          srcType = pickedT;
          srcRef = () => ({ kind: "varRef", localId: src.id, type: pickedT, loc });
        }
        this.lowerBindingPattern(decl.name, srcRef, srcType, true, prologue);
        return;
      }
      const name = (decl.name as ts.Identifier).text;
      if (shape.mode === "omittable" && shape.bodyType && decl.initializer) {
        const abi = shape.type;
        if (abi.kind === "dyn" || abi.kind === "jsval") {
          // A DYNAMIC-TIER defaulted param (`function f(x = a)` with
          // `a: any` — jsval for island values, dyn for the checked-
          // dynamic dyn): the slot holds its tier's undefined directly —
          // the body local picks the default on the runtime test.
          const loc = locOf(decl);
          const slot = this.declareHiddenLocal(name, abi);
          params.push({ localId: slot.id, name, type: abi });
          const inRef = (): IrExpr => ({ kind: "varRef", localId: slot.id, type: abi, loc });
          const isUndef: IrExpr =
            abi.kind === "jsval"
              ? { kind: "jsOp", op: "eq", args: [inRef(), { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc }], type: BOOL, loc }
              : { kind: "dynTest", test: "undefined", value: inRef(), type: BOOL, loc };
          const dflt = this.lowerExprExpecting(decl.initializer, abi);
          const body = this.declareLocal(decl.name, name, abi, true);
          prologue.push({
            kind: "varDecl",
            localId: body.id,
            init: { kind: "ternary", cond: isUndef, then: dflt, else_: inRef(), type: abi, loc },
            loc,
          });
          return;
        }
        if (abi.kind !== "union") this.unsupported("SC1090", decl, "this parameter form"); // defensive
        const undefTag = this.armTag(abi.unionId, UNDEFINED_T);
        if (undefTag < 0) this.unsupported("SC1090", decl, "this parameter form"); // defensive
        const loc = locOf(decl);
        const slot = this.declareHiddenLocal(name, abi);
        params.push({ localId: slot.id, name, type: abi });
        const inRef = (): IrExpr => ({ kind: "varRef", localId: slot.id, type: abi, loc });
        if (typeEquals(shape.bodyType, abi)) {
          // The default may ITSELF be undefined (`x = process.env.FOO`):
          // the body keeps the full `T | undefined` union (tsc's type),
          // so a present argument passes through unchanged and an omitted
          // one takes the default AS IS — no narrow on either branch.
          const dflt = this.lowerExprExpecting(decl.initializer, abi);
          const body = this.declareLocal(decl.name, name, abi, true);
          prologue.push({
            kind: "varDecl",
            localId: body.id,
            init: {
              kind: "ternary",
              cond: { kind: "unionIsTag", unionId: abi.unionId, tag: undefTag, negated: false, value: inRef(), type: BOOL, loc },
              then: dflt,
              else_: inRef(),
              type: abi,
              loc,
            },
            loc,
          });
          return;
        }
        if (shape.bodyType.kind === "union") {
          // UNION body type: a present argument re-tags from the ABI union
          // (body arms + undefined) back into the body union through the
          // interned retag helper — the stranded undefined arm's trap case
          // is unreachable from this else-branch (the ternary just tested
          // it), and every other arm maps by identity.
          const retag = this.unionRetagHelper(abi.unionId, shape.bodyType.unionId, loc);
          if (!retag) this.unsupported("SC1090", decl, "this parameter form"); // defensive
          const dflt = this.lowerExprExpecting(decl.initializer, shape.bodyType);
          const body = this.declareLocal(decl.name, name, shape.bodyType, true);
          prologue.push({
            kind: "varDecl",
            localId: body.id,
            init: {
              kind: "ternary",
              cond: { kind: "unionIsTag", unionId: abi.unionId, tag: undefTag, negated: false, value: inRef(), type: BOOL, loc },
              then: dflt,
              else_: { kind: "call", callee: retag, args: [inRef()], type: shape.bodyType, loc },
              type: shape.bodyType,
              loc,
            },
            loc,
          });
          return;
        }
        const valueTag = this.armTag(abi.unionId, shape.bodyType);
        if (valueTag < 0) this.unsupported("SC1090", decl, "this parameter form"); // defensive
        // The default lowers BEFORE the body local binds, so a same-named
        // outer binding referenced in it can never resolve to the fresh
        // local (tsc separately rejects `x = x`).
        const dflt = this.lowerExprExpecting(decl.initializer, shape.bodyType);
        const body = this.declareLocal(decl.name, name, shape.bodyType, true);
        prologue.push({
          kind: "varDecl",
          localId: body.id,
          init: {
            kind: "ternary",
            cond: { kind: "unionIsTag", unionId: abi.unionId, tag: undefTag, negated: false, value: inRef(), type: BOOL, loc },
            then: dflt,
            else_: { kind: "unionNarrow", unionId: abi.unionId, tag: valueTag, value: inRef(), type: shape.bodyType, loc },
            type: shape.bodyType,
            loc,
          },
          loc,
        });
        return;
      }
      const local = this.declareLocal(decl.name, name, shape.type, true);
      params.push({ localId: local.id, name, type: local.type });
    });
    return { params, prologue };
  }

  /** The binding for `symbol` inside context `ctx` — a scoped local or an
   * already-threaded capture entry. */
  bindingIn(ctx: FnCtx, symbol: ts.Symbol): IrLocal | null {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const local = ctx.scopes[i]!.get(symbol);
      if (local) return local;
    }
    return ctx.captureBySymbol.get(symbol) ?? null;
  }

  /** Resolves an identifier to a local of the CURRENT function, creating
   * capture entries (and boxing the origin binding) when the name lives in
   * an enclosing function. Self-references of a named lambda are NOT
   * resolved here — callers check `isSelfReference` first. */
  resolveLocal(ident: ts.Identifier): IrLocal | null {
    let symbol = this.checker.getSymbolAtLocation(ident);
    // Shorthand names read their VALUE binding (see resolveValueSymbol).
    if (ident.parent && ts.isShorthandPropertyAssignment(ident.parent) && ident.parent.name === ident) {
      symbol = this.checker.getShorthandAssignmentValueSymbol(ident.parent) ?? symbol;
    }
    if (!symbol) return null;
    const direct = this.resolveKey(symbol, ident);
    if (direct) return direct;
    // A PARAMETER PROPERTY declares two symbols: references resolve to the
    // PARAMETER symbol, while the declaration's name binds the PROPERTY
    // symbol — which is what declareParams registered the local under.
    // On a miss, normalize to the declaration's key and retry (ordinary
    // bindings never reach this — their two sides intern to one symbol).
    const vd = this.checker.valueDeclarationOf(symbol);
    if (
      vd && ts.isParameter(vd) && ts.isIdentifier(vd.name) &&
      vd.modifiers?.some(
        (m) =>
          m.kind === ts.SyntaxKind.PublicKeyword ||
          m.kind === ts.SyntaxKind.PrivateKeyword ||
          m.kind === ts.SyntaxKind.ProtectedKeyword ||
          m.kind === ts.SyntaxKind.ReadonlyKeyword ||
          m.kind === ts.SyntaxKind.OverrideKeyword,
      )
    ) {
      const propSym = this.checker.getSymbolAtLocation(vd.name);
      if (propSym && propSym !== symbol) return this.resolveKey(propSym, ident);
    }
    return null;
  }

  /** Lexical `this` — the enclosing method's this-param, possibly captured
   * through arrows (function expressions/declarations reset `this` in JS;
   * their bodies never see an enclosing method's binding). */
  resolveThis(): IrLocal | null {
    return this.resolveKey(THIS_BINDING);
  }

  /** READ-ONLY twin of resolveThis: does ANY frame on the stack carry a
   * `this` local? resolveKey mutates capture state (it boxes the origin
   * and threads a capture through every frame between), so a question
   * asked BEFORE the reference exists has to be asked without it.
   *
   * The question this answers is "could resolveThis() answer non-null
   * here?", and it is the precondition for declining to reject a `this`
   * that a walk stops short of (rejectThisInObjectMethod). Answering by
   * SCANNING THE STACK rather than by scanning ANCESTOR SYNTAX is the
   * point: `this` locals are declared by class members AND by the shims
   * that give an object-literal callback Node's receiver (lower-stream's
   * `new Readable({ read() { this.push(...) } })`), and a class-ancestor
   * test would answer "no binding" inside the second one. */
  peekThis(): IrLocal | null {
    for (let depth = this.fnStack.length - 1; depth >= 0; depth--) {
      const hit = this.bindingIn(this.fnStack[depth]!, THIS_BINDING);
      if (hit) return hit;
    }
    return null;
  }

  /** The `arguments` object visible at the current point, WITHOUT touching
   * capture state — the read-only twin of resolveArgumentsLocal, and the
   * question the `arguments.length` constant fold has to ask before it
   * decides it may fold (resolveKey boxes the origin and threads captures
   * as a side effect, so a speculative query must not use it).
   *
   * The walk is the JS scoping rule and nothing more: the current frame
   * first, then outward for exactly as long as the frames are ARROWS. A
   * non-arrow frame that carries no binding ends the search with null —
   * that function owns an `arguments` the compiler never materialized, and
   * answering with its caller's list would be a different wrong answer. */
  peekArgumentsLocal(): IrLocal | null {
    for (let depth = this.fnStack.length - 1; depth >= 0; depth--) {
      const frame = this.fnStack[depth]!;
      const hit = this.bindingIn(frame, ARGUMENTS_BINDING);
      if (hit) return hit;
      if (frame.isArrow !== true) return null;
    }
    return null;
  }

  /** The `arguments` object as a local OF THE CURRENT FUNCTION: the origin
   * slot when this frame owns one, otherwise a capture threaded through
   * every arrow between here and the function that does. Null when JS
   * itself would not resolve the name here (see peekArgumentsLocal). */
  resolveArgumentsLocal(blame: ts.Node): IrLocal | null {
    if (this.peekArgumentsLocal() === null) return null;
    return this.resolveKey(ARGUMENTS_BINDING, blame);
  }

  /** READ-ONLY twin of resolveLocal for PROBES (isIslandExpr): answers
   * the nearest binding entry without boxing, threading, or predeclaring.
   * resolveKey mutates capture state as a side effect, and a speculative
   * island-ness query through a context that takes no captures (a plain
   * declared function between the origin and the reference) was an ICE —
   * the REAL lowering path still resolves (and diagnoses) the reference
   * itself. */
  peekLocal(ident: ts.Identifier): IrLocal | null {
    let symbol = this.checker.getSymbolAtLocation(ident);
    if (ident.parent && ts.isShorthandPropertyAssignment(ident.parent) && ident.parent.name === ident) {
      symbol = this.checker.getShorthandAssignmentValueSymbol(ident.parent) ?? symbol;
    }
    if (!symbol) return null;
    for (let depth = this.fnStack.length - 1; depth >= 0; depth--) {
      const hit = this.bindingIn(this.fnStack[depth]!, symbol);
      if (hit) return hit;
    }
    return null;
  }

  resolveKey(symbol: ts.Symbol, blame?: ts.Node): IrLocal | null {
    const direct = this.bindingIn(this.ctx, symbol);
    if (direct) return direct;

    // Search enclosing functions, innermost first.
    for (let depth = this.fnStack.length - 2; depth >= 0; depth--) {
      let origin = this.bindingIn(this.fnStack[depth]!, symbol);
      if (!origin) continue;
      // dyn captures ride an UNTRACED obj-box (scr_dyn_retain_v/release_v
      // — boxNewC): the mustCall wrapper closing over its implicit-any
      // `fn` param. A dyn tree is pure data except the function kind,
      // whose closure edge the collector never sees — cycles through a
      // captured dyn are uncollectable (leak, never dangle: trial
      // deletion treats untraced edges as external roots). SEMANTICS.md.
      // jsval captures are fine: the box is an obj-box carrying the
      // island handle's own retain/release (scr_jsval_*_v), untraced like
      // every jsval container position — engine-side back-references are
      // the island's documented collection stance, not the box's.
      if (origin.type.kind === "caught") {
        // A catch binding never escapes its catch (KEEP NARROW): narrow it
        // into a typed local and capture THAT — and where the block's
        // reads are all UN-narrowed, lowerTry already did that lift and
        // left the DYN twin here (caughtDynTwins). Capturing the twin is
        // capturing the very local the fence's message asks the source to
        // write, so the capture threads below like any other dyn binding.
        // No twin ⇔ lowerTry saw a read the lift cannot serve (a rethrow,
        // or a narrowing test whose extraction needs the snapshot cell):
        // the fence is still the answer and still names the workaround.
        const twin = this.caughtDynTwins.get(origin);
        if (twin === undefined) {
          this.unsupported(
            "SC1090",
            blame ?? this.checker.declarationsOf(symbol)[0] ?? this.entry,
            "closures capturing catch bindings (narrow into a typed local first)",
          );
        }
        origin = twin;
      }
      // The binding escapes into a nested function: it must live in a box,
      // shared by everyone (that's what makes mutation visible everywhere).
      origin.boxed = true;
      // Thread a capture through every function between origin and here.
      let parentEntry = origin;
      for (let j = depth + 1; j < this.fnStack.length; j++) {
        const ctx = this.fnStack[j]!;
        let entry = ctx.captureBySymbol.get(symbol);
        if (!entry) {
          // A context that takes NO captures (a plain declared function —
          // monomorphized/implicit instances lower this way) cannot carry
          // the binding through: the shape is a module binding whose only
          // storage is the init function's LOCAL (a typed-but-unmappable
          // const — the file-scope `new Map()` ledger idiom) read from
          // inside a nested instance. Fence it — in JS the statement
          // defers to its runtime trap like every collection failure;
          // asserting here was an ICE on ordinary npm-static JS.
          if (ctx.captures === null) {
            this.unsupported(
              "SC1090",
              blame ?? this.checker.declarationsOf(symbol)[0] ?? this.entry,
              `the binding '${origin.name}' captured through a plain nested function (the declaration has no static storage a capture can thread — bind the value through a typed const, or read it in the declaring scope)`,
            );
          }
          const count = ctx.localCounters.get(origin.name) ?? 0;
          ctx.localCounters.set(origin.name, count + 1);
          entry = {
            id: `${origin.name}.${count}`,
            name: origin.name,
            type: origin.type,
            mutable: origin.mutable,
            boxed: true,
            // TDZ travels with the binding: reads through ANY capture of a
            // forward-captured const must trap while the box is empty.
            ...(origin.tdz ? { tdz: true as const } : {}),
          };
          ctx.locals.push(entry);
          ctx.captureBySymbol.set(symbol, entry);
          ctx.captures.push({ localId: entry.id, name: entry.name, type: entry.type });
          ctx.captureSources.push(parentEntry.id);
        }
        parentEntry = entry;
      }
      return parentEntry;
    }
    // Nothing declared yet anywhere on the stack: the hoisted-handler shape
    // — a function declared BEFORE a const it captures (`const cleanup =
    // () => onSigInt; ...; const onSigInt = ...`). Pre-declare the const as
    // a TDZ box at its scope's entry and resolve again (the recursion finds
    // it in the origin frame and threads captures normally).
    if (blame && predeclareForwardCapture(this, symbol)) {
      return this.resolveKey(symbol, blame);
    }
    // The FUNCTION-DECLARATION twin: JS hoists a nested `function f() {}`
    // to scope entry, so a reference lexically ABOVE the declaration in the
    // same function (`http.createServer(handler).listen(0, cb)` with
    // `function handler(req, res)` below — the suite's standard layout) is
    // a live binding, never a TDZ read. Lower the declaration eagerly at
    // the reference and resolve again; the statement loop skips the source
    // statement when it arrives.
    if (blame && predeclareForwardFnDecl(this, symbol)) {
      return this.resolveKey(symbol, blame);
    }
    // The `var` twin: a reference above the `var` statement (a direct read
    // tsc allowed because the type carries undefined, or a nested function
    // capturing the binding early). JS reads undefined there — never a TDZ
    // error — so only undefined-armed types predeclare; the rest land on
    // rejectUnresolvedSymbol's named fence.
    if (blame && predeclareForwardVar(this, symbol)) {
      return this.resolveKey(symbol, blame);
    }
    return null;
  }

  isSelfReference(ident: ts.Identifier): boolean {
    const ctx = this.ctx;
    if (!ctx.selfSymbol) return false;
    // The self binding can be shadowed by a scoped local of the same symbol?
    // No — a shadow is a different symbol; symbol identity is exact.
    return this.checker.getSymbolAtLocation(ident) === ctx.selfSymbol;
  }

  /* ── statements ───────────────────────────────────────────────────── */

  lowerStmts(stmts: readonly ts.Statement[]): IrStmt[] {
    return lowerStmts(this, stmts);
  }

  noteBlockedBindings(stmt: ts.Statement): void {
    return noteBlockedBindings(this, stmt);
  }

  isBlockedBinding(symbol: ts.Symbol | null): boolean {
    return isBlockedBinding(this, symbol);
  }

  /** The cascade rejection: an honest "inherits its declaration's blocker"
   * diagnostic (SC2004) when the symbol is a known-blocked binding, the
   * caller's own fallback otherwise. */
  rejectUnresolved(ident: ts.Identifier, fallback: string): never {
    this.rejectUnresolvedSymbol(this.resolveValueSymbol(ident), ident.text, ident, fallback);
  }

  rejectUnresolvedSymbol(
    symbol: ts.Symbol | null,
    name: string,
    node: ts.Node,
    fallback: string,
  ): never {
    probeBindWhy(this, symbol, name, node);
    if (this.isBlockedBinding(symbol)) {
      this.pushDiag(blockedBindingUseDiag(name, locOf(node)));
      throw new PoisonError();
    }
    // A binding whose TYPE keeps a generic call signature and whose
    // declaration carries no initializer (`declare const o4: undefined |
    // (<T>(f: (a: T) => T) => T)` — the optional-chained ambient shape):
    // there is no function body to monomorphize, so no use can ever pin a
    // concrete signature — name the shape instead of the generic
    // binding-form text.
    if (symbol) {
      const d = this.checker.valueDeclarationOf(symbol);
      if (d && ts.isVariableDeclaration(d) && d.initializer === undefined) {
        const t = this.checker.getTypeOfSymbol(symbol);
        const parts = t.isUnionType() ? t.getTypes() : [t];
        if (parts.some((p) => this.checker.getCallSignatures(p).some((s) => (s.typeParameters?.length ?? 0) > 0))) {
          this.unsupported(
            "SC1030",
            node,
            `the generic-signature binding '${name}' (its type keeps type parameters and the declaration has no initializer — no function body exists to monomorphize, so nothing can pin a concrete signature)`,
          );
        }
      }
    }
    // An unresolved reference to a LATER `var` whose predeclare was
    // refused: the reads Node would serve before the declaration's
    // assignment are `undefined`, and this binding's type has no slot for
    // that value — name the shape instead of the generic no-lowering text.
    if (symbol) {
      const d = this.checker.valueDeclarationOf(symbol);
      if (d && ts.isVariableDeclaration(d) && (ts.getCombinedNodeFlags(d) & ts.NodeFlags.BlockScoped) === 0) {
        this.unsupported(
          "SC1030",
          node,
          `the reference to '${name}' above its 'var' declaration (a read there would be 'undefined', which the binding's type cannot hold — annotate it '| undefined' or move the declaration up)`,
        );
      }
    }
    this.unsupported("SC1090", node, fallback);
  }

  lowerScopedBlock(stmt: ts.Statement): IrStmt[] {
    return lowerScopedBlock(this, stmt);
  }

  /** Lowers inside a control-construct marker (loop/switch/labeled block/
   * try-with-finally/finally block) so the jump fences below know what a
   * break/continue/return crosses. `labels` carries the construct's JS
   * label names when the source statement was labeled — labeled jumps
   * resolve against them. */
  inCtl<T>(kind: "loop" | "switch" | "block" | "tryFinally" | "finallyBlock", fn: () => T, labels?: string[]): T {
    this.ctx.ctl.push(labels !== undefined && labels.length > 0 ? { kind, labels } : { kind });
    try {
      return fn();
    } finally {
      this.ctx.ctl.pop();
    }
  }

  /** The label names a `lbl:` chain put on the statement currently being
   * lowered — set by lowerLabeled around lowering the labeled construct,
   * consumed exactly once by the construct's own lowering (takeLabels).
   * A lowering that never consumes them signals lowerLabeled to fence:
   * silently dropping a label would compile `break lbl` wrong. */
  pendingLabels: string[] | null = null;

  takeLabels(): string[] | undefined {
    const labels = this.pendingLabels;
    this.pendingLabels = null;
    return labels ?? undefined;
  }

  rejectJumpCrossingFinally(kw: "break" | "continue" | "return", stmt: ts.Statement, label?: string): void {
    return rejectJumpCrossingFinally(this, kw, stmt, label);
  }

  lowerStmt(stmt: ts.Statement): IrStmt | IrStmt[] | null {
    return lowerStmt(this, stmt);
  }

  lowerVarStatement(stmt: ts.VariableStatement): IrStmt[] {
    return lowerVarStatement(this, stmt);
  }

  lowerDestructuringDecl(decl: ts.VariableDeclaration, isLet: boolean): IrStmt[] {
    return lowerDestructuringDecl(this, decl, isLet);
  }

  lowerDestructuringAssignParts(target: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, rhs: ts.Expression, loc: SrcLoc): { stmts: IrStmt[]; value: IrExpr } {
    return lowerDestructuringAssignParts(this, target, rhs, loc);
  }

  lowerBindingPattern(pattern: ts.ArrayBindingPattern | ts.ObjectBindingPattern,
    srcRef: () => IrExpr,
    srcType: IrType,
    isLet: boolean,
    out: IrStmt[],
    dynSpell?: string,): void {
    // An ISLAND source (`const { readFileSync } = await import("fs")` —
    // a namespace handle, or any 'any'-typed object): each bound name is
    // an engine property read, mirroring the island property-read rule —
    // a member the .d.ts declares as a primitive exits eagerly to the
    // static type; everything else (including members whose declared
    // types have no static mapping, like @types/node's function types)
    // stays a HANDLE, and its use sites dispatch to engine ops. Patterns
    // the element-wise walk cannot spell — ARRAY patterns (the iterator
    // protocol), empty patterns (the coercion checks), holes, rest,
    // defaults — run the REAL pattern in a synthesized engine function
    // instead (lowerJsvalBindingPattern).
    const elementWise =
      srcType.kind === "jsval" &&
      ts.isObjectBindingPattern(pattern) &&
      pattern.elements.length > 0 &&
      pattern.elements.every(
        (el) =>
          !el.dotDotDotToken &&
          !el.initializer &&
          el.name !== undefined &&
          ts.isIdentifier(el.propertyName ?? el.name),
      );
    if (srcType.kind === "jsval" && !elementWise) {
      if (lowerJsvalBindingPattern(this, pattern, srcRef, isLet, out)) return;
      // No engine form (computed keys, untransportable defaults): fall
      // through to the static fences below.
    }
    if (srcType.kind === "jsval" && ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        this.checkBindingElement(el);
        // 7's BindingElement declares name optional (array elisions are
        // nameless there); object-pattern elements always carry one.
        if (el.name === undefined) continue;
        const prop = el.propertyName ?? el.name;
        if (!ts.isIdentifier(prop)) {
          this.unsupported("SC1031", el, "destructuring with computed or non-identifier keys");
        }
        const loc = locOf(el);
        const read: IrExpr = {
          kind: "jsOp", op: "getProp", name: prop.text, args: [srcRef()], type: JSVAL, loc,
        };
        if (!ts.isIdentifier(el.name)) {
          // A nested pattern reads through its own handle temp.
          const tmp = this.declareHiddenLocal("%destr", JSVAL);
          out.push({ kind: "varDecl", localId: tmp.id, init: read, loc });
          this.lowerBindingPattern(
            el.name,
            () => ({ kind: "varRef", localId: tmp.id, type: JSVAL, loc }),
            JSVAL, isLet, out,
          );
          continue;
        }
        const declared = this.mapTypeOf(this.typeOf(el.name));
        const primitive =
          declared &&
          (declared.kind === "f64" || declared.kind === "bool" || declared.kind === "string");
        const value: IrExpr = primitive
          ? { kind: "jsExit", value: read, type: declared, loc }
          : read;
        const symbol = this.checker.getSymbolAtLocation(el.name);
        const g = symbol ? this.globalsBySymbol.get(symbol) : undefined;
        if (g) {
          out.push({ kind: "assign", localId: g.id, value: this.coerceInto(el.name, value, g.type), loc });
          continue;
        }
        const local = this.declareLocal(el.name, el.name.text, value.type, isLet);
        out.push({ kind: "varDecl", localId: local.id, init: value, loc });
      }
      return;
    }
    return lowerBindingPattern(this, pattern, srcRef, srcType, isLet, out, dynSpell);
  }

  checkBindingElement(el: ts.BindingElement, allowDefault = false): void {
    return checkBindingElement(this, el, allowDefault);
  }

  bindPatternTarget(name: ts.BindingName,
    value: IrExpr,
    isLet: boolean,
    out: IrStmt[],): void {
    return bindPatternTarget(this, name, value, isLet, out);
  }

  lowerVarDeclList(list: ts.VariableDeclarationList): IrStmt | null {
    return lowerVarDeclList(this, list);
  }

  lowerVarDecl(decl: ts.VariableDeclaration, isLet: boolean): IrStmt | null {
    // ISLAND-HANDLE rescue (--dynamic): `const factory = (await
    // import("./x.mjs")).default` / `const buf = islandReadFileSync(p)` —
    // a binding whose DECLARED type either has no static mapping or has
    // one no island value can EXIT to (bytes, functions, promises), but
    // whose initializer is an island value. The declared type is a .d.ts
    // surface over an engine value; the binding stays a HANDLE (jsval
    // local) and typed use sites go through engine ops and validated
    // exits like any island value. Exit-CAPABLE declared types (numbers,
    // strings, JSON-safe composites, their undefined-armed unions) keep
    // the standard path and its validated-exit machinery; so does
    // everything non-island — including badType here when the
    // initializer turns out not to be island-typed, which is exactly
    // what the standard path would have reported.
    // Only reference-shaped initializers are candidates (awaits, calls,
    // member reads, identifiers, casts/parens over those): they are the
    // island producers, and re-lowering one on the fall-through emits
    // nothing twice — a lambda or literal initializer would (each
    // lowering mints a fresh %fn), and is never an island value anyway.
    const islandCandidate = (e: ts.Expression): boolean => {
      let cur = e;
      while (
        ts.isParenthesizedExpression(cur) ||
        ts.isAsExpression(cur) ||
        ts.isTypeAssertion(cur) ||
        ts.isNonNullExpression(cur)
      ) {
        cur = cur.expression;
      }
      if (
        !ts.isAwaitExpression(cur) &&
        !ts.isCallExpression(cur) &&
        !ts.isPropertyAccessExpression(cur) &&
        !ts.isElementAccessExpression(cur) &&
        !ts.isIdentifier(cur)
      ) {
        return false;
      }
      // A lambda ANYWHERE inside (a call argument) would emit its %fn
      // twice across the fall-through's re-lowering — skip those.
      let lambda = false;
      const scan = (n: ts.Node): void => {
        if (lambda) return;
        if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
          lambda = true;
          return;
        }
        ts.forEachChild(n, scan);
      };
      scan(cur);
      return !lambda;
    };
    if (
      this.dynamic &&
      ts.isIdentifier(decl.name) &&
      decl.initializer !== undefined &&
      // `var` stays out: the rescue's block-positioned jsval local can't
      // model the function-scoped hoisted binding (a redeclaration or an
      // out-of-block read would split the variable in two) — vars take the
      // standard path and its own fences.
      (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.BlockScoped) !== 0 &&
      islandCandidate(decl.initializer) &&
      // createRequire's plumbing decls are COMPILE-TIME erasures (the
      // require binding and its builtin-namespace bindings) — never
      // island values; the standard path's skips own them.
      !createRequireBindingDecl(this, decl.name, decl.initializer) &&
      !createRequireNamespaceDecl(this, decl.name, decl.initializer)
    ) {
      const mapped = this.mapTypeOf(this.typeOf(decl.name));
      const handleOnly =
        mapped === null ||
        (mapped.kind !== "jsval" &&
          mapped.kind !== "void" &&
          !canExitIslandToType(
            mapped,
            (id) => this.shapes.get(id),
            (id) => this.unions.get(id),
          ));
      const symbol = this.checker.getSymbolAtLocation(decl.name);
      if (handleOnly && (!symbol || !this.globalsBySymbol.has(symbol))) {
        const init = this.lowerExpr(decl.initializer);
        if (init.type.kind === "jsval") {
          const local = this.declareLocal(decl.name, decl.name.text, JSVAL, isLet);
          return { kind: "varDecl", localId: local.id, init, loc: locOf(decl) };
        }
        // The CHECKED-DYNAMIC twin of the handle rescue (the runtime-world
        // local rule): an unmappable declared type over a dyn initializer
        // (`const first = plugins[0]` — the checker spells 'string |
        // object' while the read is a dyn keyed read) keeps the binding
        // dyn; typed use sites ride validated extractions and the routed
        // engine ops, exactly the JSON.parse-binding story.
        if (mapped === null && init.type.kind === "dyn") {
          const local = this.declareLocal(decl.name, decl.name.text, DYN, isLet);
          return { kind: "varDecl", localId: local.id, init, loc: locOf(decl) };
        }
        if (mapped === null) this.badType(decl.name, this.typeOf(decl.name));
        // A mappable declared type with a non-island initializer: the
        // standard path owns it (the initializer lowered clean; re-running
        // it re-produces the same IR with no duplicate diagnostics).
      }
    }
    return lowerVarDecl(this, decl, isLet);
  }

  lowerSwitch(stmt: ts.SwitchStatement): IrStmt {
    return lowerSwitch(this, stmt);
  }

  lowerTry(stmt: ts.TryStatement): IrStmt {
    return lowerTry(this, stmt);
  }

  lowerExprStatement(expr: ts.Expression): IrStmt {
    return lowerExprStatement(this, expr);
  }

  lowerForOf(stmt: ts.ForOfStatement): IrStmt {
    return lowerForOf(this, stmt);
  }

  lowerForStatement(stmt: ts.ForStatement): IrStmt {
    return lowerForStatement(this, stmt);
  }

  lowerCondition(expr: ts.Expression): IrExpr {
    return lowerCondition(this, expr);
  }

  ensureBool(e: IrExpr, node: ts.Expression): IrExpr {
    return ensureBool(this, e, node);
  }

  requireTruthyUnion(unionId: string, node: ts.Expression): void {
    return requireTruthyUnion(this, unionId, node);
  }

  eqComparableUnion(unionId: string): boolean {
    return eqComparableUnion(this, unionId);
  }

  /* ── expressions ──────────────────────────────────────────────────── */

  lowerExpr(expr: ts.Expression): IrExpr {
    return lowerExpr(this, expr);
  }

  lowerIntrinsicProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    // The builtin-spoke property extensions (Stats.mtimeMs,
    // SpawnSyncReturns.signal) claim their reads before the intrinsic
    // fallback's member fences fire for them.
    return lowerBuiltinExtraProperty(this, expr) ?? lowerIntrinsicProperty(this, expr);
  }

  /** True for the STANDARD LIBRARY's source files: the shipped ambient
   * .d.ts files (core + overrides + fallback), a lib.*.d.ts bundled with the typescript
   * package (asked via program.isSourceFileDefaultLibrary, never by path
   * matching), or the ADOPTED @types/node surface standing in for the
   * fallback (see loadProgram — the lowering tables recognize the same
   * members by name + this provenance, and everything else those files
   * declare hits the SC2020-family fence). The file half of every
   * supported-surface provenance check. */
  /** The `.d.ts` whose implementation twin this build lowered (declTwinOf in
   * program.ts put it into module order). Cached: the answer is fixed once
   * fileTag is filled. */
  private readonly twinSourceCache = new Map<string, ts.SourceFile | null>();

  declTwinCompiled(sf: ts.SourceFile): boolean {
    return this.declTwinSourceOf(sf) !== null;
  }

  /** The compiled runtime `.js`/`.mjs`/`.cjs` twin of a declaration file
   * (a hand-written / generated `.d.ts` shadowing a real module — the WA
   * spec tables), or null. Cached once fileTag is filled. */
  declTwinSourceOf(sf: ts.SourceFile): ts.SourceFile | null {
    const name = sf.fileName;
    const hit = this.twinSourceCache.get(name);
    if (hit !== undefined) return hit;
    let found: ts.SourceFile | null = null;
    // All three declaration extensions, each with the runtime extension it
    // pairs with: a generated module ships `.d.cts` beside `.cjs` and
    // `.d.mts` beside `.mjs` exactly as it ships `.d.ts` beside `.js`.
    const stem =
      name.endsWith(".d.ts") ? name.slice(0, -".d.ts".length)
      : name.endsWith(".d.cts") ? name.slice(0, -".d.cts".length)
      : name.endsWith(".d.mts") ? name.slice(0, -".d.mts".length)
      : null;
    if (stem !== null) {
      for (const compiled of this.fileTag.keys()) {
        const f = compiled.fileName;
        if (f === `${stem}.js` || f === `${stem}.mjs` || f === `${stem}.cjs`) {
          found = compiled;
          break;
        }
      }
    }
    this.twinSourceCache.set(name, found);
    return found;
  }

  /** True when `sf` (a compiled runtime module) defines at least one
   * ordinary static global — a real record/array/scalar export, not the
   * `%loaded` guard and not an island (jsval) handle. Distinguishes a spec
   * table (WA_APPSTATE_SCHEMAS lives in a static record global) from an
   * uncompilable island twin (the minified proto, whose init is trap-only
   * and whose exports are jsval), so the twin-init redirect skips the
   * latter — forcing its init would fire the first trap. */
  moduleHasStaticGlobal(sf: ts.SourceFile): boolean {
    const tagged = this.fileTag.get(sf);
    if (tagged === undefined) return false;
    const prefix = `%g.${tagged.replace(/^%/, "").replace(/\.$/, "")}`;
    for (const g of this.globalsList) {
      if (g.name === "%loaded" || g.type.kind === "jsval") continue;
      if (g.id.startsWith(prefix) || g.id.startsWith(tagged)) return true;
    }
    return false;
  }

  /** The DECLARATION file a compiled runtime file is the twin of -- the
   * reverse of declTwinSourceOf's question. */
  declSiblingOf(sf: ts.SourceFile): ts.SourceFile | null {
    const name = sf.fileName;
    const hit = this.declSiblingCache.get(name);
    if (hit !== undefined) return hit;
    let found: ts.SourceFile | null = null;
    const m = /[.](js|mjs|cjs)$/.exec(name);
    if (m !== null) {
      const stem = name.slice(0, name.length - m[0].length);
      for (const other of this.fileTag.keys()) {
        const f = other.fileName;
        if (f === `${stem}.d.ts` || f === `${stem}.d.cts` || f === `${stem}.d.mts`) {
          found = other;
          break;
        }
      }
    }
    this.declSiblingCache.set(name, found);
    return found;
  }

  private readonly declSiblingCache = new Map<string, ts.SourceFile | null>();

  /** Data properties that SOME object literal in this program satisfies
   * with a getter.
   *
   * A shape is interned from the TYPE, long before any producer is seen,
   * so a field can only carry an accessor slot if the decision is made
   * here -- over the whole program, once. Two values of one interface must
   * share a layout, so if any producer needs the slot, the field has it
   * and plain data producers fill it with a constant closure.
   *
   * Computed on first ask rather than in the constructor: by then every
   * file is in fileTag, and shape interning has not begun. */
  private accessorProducerCache: Set<ts.Symbol> | null = null;

  accessorProducerProp(sym: ts.Symbol): boolean {
    this.accessorProducerCache ??= this.scanAccessorProducers();
    return this.accessorProducerCache.has(sym);
  }

  /** Hidden symbol slots declared by `Object.defineProperty`, per class
   * declaration — the whole-program pre-pass (lower-classes.ts). Lazy for
   * the same reason accessorProducerCache is: it must run after fileTag is
   * populated and before shape interning. */
  private definePropSlotCache: Map<ts.ClassLikeDeclaration, Map<ts.Symbol, { fieldName: string; values: ts.Expression[] }>> | null = null;

  definePropSymbolSlots(decl: ts.ClassLikeDeclaration): ReadonlyMap<ts.Symbol, { fieldName: string; values: ts.Expression[] }> | undefined {
    this.definePropSlotCache ??= scanDefinePropSymbolSlots(this);
    return this.definePropSlotCache.get(decl);
  }

  private scanAccessorProducers(): Set<ts.Symbol> {
    const out = new Set<ts.Symbol>();
    const dataFilled = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        // A property some literal fills with DATA can never carry an
        // accessor slot: that literal would have nothing to put in it, and
        // synthesizing a constant closure there is plumbing this does not
        // need yet. Recording them first means the slot is only taken when
        // EVERY literal in the program agrees to fill it.
        const ctData = this.checker.getContextualType(n);
        if (ctData !== undefined) {
          for (const pr of n.properties) {
            if (ts.isGetAccessorDeclaration(pr) || ts.isSetAccessorDeclaration(pr)) continue;
            // A SPREAD carries no name, and whatever it brings could fill
            // anything -- treat the literal as data-filling nothing rather
            // than guessing, since the marking below only narrows.
            if (ts.isSpreadAssignment(pr)) continue;
            const nm = pr.name;
            if (!ts.isIdentifier(nm) && !ts.isStringLiteral(nm)) continue;
            const t = this.checker.getPropertyOfType(ctData, nm.text);
            if (t !== undefined) dataFilled.add(t);
          }
        }
        const accs = n.properties.filter((pr) => ts.isGetAccessorDeclaration(pr));
        if (accs.length > 0) {
          const ct = this.checker.getContextualType(n);
          if (ct !== undefined) {
            for (const a of accs) {
              if (!ts.isIdentifier(a.name) && !ts.isStringLiteral(a.name)) continue;
              const target = this.checker.getPropertyOfType(ct, a.name.text);
              if (
                target !== undefined &&
                (target.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) === 0
              ) {
                out.add(target);
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    for (const sf of this.fileTag.keys()) {
      if (sf.isDeclarationFile) continue;
      ts.forEachChild(sf, visit);
    }
    for (const d of dataFilled) out.delete(d);
    return out;
  }

  readonly isStdlibFile = (sf: ts.SourceFile): boolean =>
    sf.fileName === this.ambient ||
    sf.fileName === this.overridesAmbient ||
    sf.fileName === this.fallbackAmbient ||
    this.program.isSourceFileDefaultLibrary(sf) ||
    (sf.isDeclarationFile && isNodeTypesPath(sf.fileName));

  nodeTypesOnlySymbol(sym: ts.Symbol | null | undefined): boolean {
    return nodeTypesOnlySymbol(this, sym);
  }

  /** True for an npm package's shipped declaration files — under
   * node_modules but NOT the standard library (typescript's own lib files
   * live under node_modules too), or inside a registered workspace-linked
   * package (a node_modules symlink whose realpath'd files carry no
   * node_modules segment — shared.ts). The provenance half of the npm
   * typing rule (package types are island handles) and of the per-package
   * requires-dynamic attribution. */
  readonly isNpmFile = (sf: ts.SourceFile): boolean =>
    sf.isDeclarationFile &&
    (sf.fileName.includes("/node_modules/") || workspacePackageOfPath(sf.fileName) !== null) &&
    !this.isStdlibFile(sf);

  npmPackageOf(type: ts.Type): string | null {
    return npmPackageOf(this, type);
  }

  npmMemberFence(access: ts.PropertyAccessExpression): void {
    return npmMemberFence(this, access);
  }

  npmPackageOfSymbol(sym: ts.Symbol | undefined): string | null {
    return npmPackageOfSymbol(this, sym);
  }

  isStdlibMember(access: ts.PropertyAccessExpression): boolean {
    return isStdlibMember(this, access);
  }

  isStdlibSymbol(symbol: ts.Symbol | undefined): boolean {
    return isStdlibSymbol(this, symbol);
  }

  isStdlibGlobal(expr: ts.Expression, name: string): boolean {
    return isStdlibGlobal(this, expr, name);
  }

  stdlibGlobalMember(access: ts.PropertyAccessExpression, name: string): string | null {
    return stdlibGlobalMember(this, access, name);
  }

  lowerArrayLiteral(expr: ts.ArrayLiteralExpression, expected?: (IrType & { kind: "array" }) | (IrType & { kind: "record" })): IrExpr {
    return lowerArrayLiteral(this, expr, expected);
  }

  lowerObjectLiteral(expr: ts.ObjectLiteralExpression): IrExpr {
    return lowerObjectLiteral(this, expr);
  }

  lowerShorthandValue(prop: ts.ShorthandPropertyAssignment): IrExpr {
    return lowerShorthandValue(this, prop);
  }

  rejectThisInObjectMethod(node: ts.Node): void {
    return rejectThisInObjectMethod(this, node);
  }

  lowerElementAccess(expr: ts.ElementAccessExpression): IrExpr {
    return lowerElementAccess(this, expr);
  }

  lowerRecordKeyRead(expr: ts.ElementAccessExpression, shapeId: string, shape: IrRecordShape): IrExpr {
    return lowerRecordKeyRead(this, expr, shapeId, shape);
  }

  lowerElementWrite(expr: ts.BinaryExpression): IrStmt {
    return lowerElementWrite(this, expr);
  }

  ensureString(e: IrExpr, node: ts.Node): IrExpr {
    return ensureString(this, e, node);
  }

  lowerTemplate(expr: ts.TemplateExpression): IrExpr {
    return lowerTemplate(this, expr);
  }

  lowerAsExpression(expr: ts.AsExpression | ts.TypeAssertion): IrExpr {
    // ISLAND value cast to a PROMISE type (`factory(opts) as Promise<Mod>`
    // — the Node-typed async-API shape): promises never have a validated
    // exit, so instead of refusing the build the cast DEFERS the failure
    // to runtime — island.castFail evaluates the value (its side effects
    // are real) and throws a catchable TypeError naming the target, so
    // typed-but-never-executed code (a wasm decode path behind a
    // rejecting import) still compiles and a reached cast fails loudly at
    // the exact site. Claimed only when the source is island-typed by the
    // checker (jsval, or a promise whose inner is a handle); a source
    // that lowers to a real static promise keeps erasure — the standard
    // path's rule for non-island inners. Static builds keep their
    // per-site diagnostics.
    if (this.dynamic) {
      const srcMapped = this.mapTypeOf(this.typeOf(expr.expression));
      const island =
        srcMapped?.kind === "jsval" ||
        (srcMapped?.kind === "promise" && srcMapped.inner.kind === "jsval");
      if (island) {
        const targetTs = this.checker.getTypeFromTypeNode(expr.type);
        const target = this.mapTypeOf(targetTs);
        if (target?.kind === "promise") {
          const inner = this.lowerExpr(expr.expression);
          if (inner.type.kind !== "jsval") return inner; // static promise: erasure
          const loc = locOf(expr);
          const name: IrExpr = {
            kind: "strLit", value: this.fmt(target), type: STRING, loc,
          };
          return { kind: "libCall", fn: "island.castFail", args: [inner, name], type: target, loc };
        }
      }
    }
    return lowerAsExpression(this, expr);
  }

  lowerPrefixUnary(expr: ts.PrefixUnaryExpression): IrExpr {
    return lowerPrefixUnary(this, expr);
  }

  lowerBinary(expr: ts.BinaryExpression): IrExpr {
    return lowerBinary(this, expr);
  }

  lowerCaughtTypeofTest(expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    return lowerCaughtTypeofTest(this, expr, loc);
  }

  caughtRead(node: ts.Identifier, local: IrLocal, loc: SrcLoc): IrExpr {
    return caughtRead(this, node, local, loc);
  }

  caughtLocalOf(node: ts.Expression): IrLocal | null {
    return caughtLocalOf(this, node);
  }

  caughtToString(node: ts.Expression): IrExpr | null {
    return caughtToString(this, node);
  }

  lowerInstanceOf(expr: ts.BinaryExpression, loc: SrcLoc): IrExpr {
    return lowerInstanceOf(this, expr, loc);
  }

  lowerCall(expr: ts.CallExpression): IrExpr {
    // The island-backed ambient fetch and dynamic import() claim their
    // calls before the general dispatch (the general identifier-call paths
    // have no lowering for a promise-returning ambient global, and
    // `import` is a keyword callee no identifier path matches).
    return (
      lowerFfiCall(this, expr) ??
      lowerFetchCall(this, expr) ??
      lowerDynamicImportCall(this, expr) ??
      lowerCall(this, expr)
    );
  }

  isTopLevelFnSymbol(ident: ts.Identifier): boolean {
    return isTopLevelFnSymbol(this, ident);
  }

  lowerNestedFunctionDecl(stmt: ts.FunctionDeclaration): IrStmt {
    return lowerNestedFunctionDecl(this, stmt);
  }

  lambdaSignature(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,): { shapes: ParamShape[]; funcType: IrType & { kind: "func" }; argumentsBound?: true } {
    return lambdaSignature(this, node);
  }

  lowerLambda(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,): IrExpr {
    return lowerLambda(this, node);
  }

  lowerArrayMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerArrayMethodCall(this, call, access);
  }

  lowerMapMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerMapMethodCall(this, call, access);
  }

  lowerMapForEachCall(call: ts.CallExpression,
    receiver: IrExpr,
    mapT: IrType & { kind: "map" },): IrExpr {
    return lowerMapForEachCall(this, call, receiver, mapT);
  }

  buildMapForEachFn(name: string,
    mapT: IrType & { kind: "map" },
    arity: number,
    fnRet: IrType,
    loc: SrcLoc,): IrFunction {
    return buildMapForEachFn(this, name, mapT, arity, fnRet, loc);
  }

  lowerSetMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerSetMethodCall(this, call, access);
  }

  lowerSetForEachCall(call: ts.CallExpression,
    receiver: IrExpr,
    setT: IrType & { kind: "set" },): IrExpr {
    return lowerSetForEachCall(this, call, receiver, setT);
  }

  buildSetForEachFn(name: string,
    setT: IrType & { kind: "set" },
    arity: number,
    fnRet: IrType,
    loc: SrcLoc,): IrFunction {
    return buildSetForEachFn(this, name, setT, arity, fnRet, loc);
  }

  lowerRegexLiteral(expr: ts.RegularExpressionLiteral): IrExpr {
    return lowerRegexLiteral(this, expr);
  }

  lowerRegexMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerRegexMethodCall(this, call, access);
  }

  lowerStringMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerStringMethodCall(this, call, access);
  }

  lowerBytesNew(expr: ts.NewExpression, symbol: ts.Symbol | null | undefined): IrExpr | null {
    return lowerBytesNew(this, expr, symbol);
  }

  lowerBytesMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerBytesMethodCall(this, call, access);
  }

  lowerBufferStaticCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerBufferStaticCall(this, call, access);
  }

  fieldTarget(access: ts.PropertyAccessExpression): FieldTarget | null {
    return fieldTarget(this, access);
  }

  uniqueSymbolKeyOf(key: ts.Expression): { sym: ts.Symbol; fieldName: string } | null {
    return uniqueSymbolKeyOf(this, key);
  }

  foldedStringKeyOf(expr: ts.Expression): string | null {
    return foldedStringKeyOf(this, expr);
  }

  accessorCall(className: string,
    member: string,
    obj: IrExpr,
    extraArgs: IrExpr[],
    ret: IrType,
    loc: SrcLoc,): IrExpr {
    return accessorCall(this, className, member, obj, extraArgs, ret, loc);
  }

  classIteratorOf(t: IrType): ClassIteratorInfo | null {
    return classIteratorOf(this, t);
  }

  classIteratorOpenCall(cit: ClassIteratorInfo, recv: IrExpr, loc: SrcLoc): IrExpr {
    return classIteratorOpenCall(this, cit, recv, loc);
  }

  classIteratorNextCall(cit: ClassIteratorInfo, itRef: IrExpr, loc: SrcLoc): IrExpr {
    return classIteratorNextCall(this, cit, itRef, loc);
  }

  classIteratorDrainCall(src: IrExpr, loc: SrcLoc, elemT?: IrType): IrExpr | null {
    return classIteratorDrainCall(this, src, loc, elemT);
  }

  classIteratorRestDrainCall(cit: ClassIteratorInfo, itVal: IrExpr, loc: SrcLoc): IrExpr {
    return classIteratorRestDrainCall(this, cit, itVal, loc);
  }

  fieldGetExpr(target: FieldTarget, loc: SrcLoc, blame: ts.Node): IrExpr {
    return fieldGetExpr(this, target, loc, blame);
  }

  fieldSetStmt(target: FieldTarget, value: IrExpr, loc: SrcLoc, blame: ts.Node): IrStmt {
    return fieldSetStmt(this, target, value, loc, blame);
  }

  lowerFieldCompound(access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    op: CompoundOp,
    rhsNode: ts.Expression | null,
    loc: SrcLoc,): IrStmt {
    return lowerFieldCompound(this, access, op, rhsNode, loc);
  }

  lowerDeleteValue(expr: ts.DeleteExpression): IrExpr {
    return lowerDeleteValue(this, expr);
  }

  errorMessageArg(args: readonly ts.Expression[], loc: SrcLoc, blame: ts.Node): IrExpr {
    return errorMessageArg(this, args, loc, blame);
  }

  inheritsBuiltinErrorCtor(info: ClassInfo): boolean {
    return inheritsBuiltinErrorCtor(this, info);
  }

  inheritsBuiltinEmitterCtor(info: ClassInfo): boolean {
    return inheritsBuiltinEmitterCtor(this, info);
  }

  lowerNew(expr: ts.NewExpression): IrExpr {
    // `new Uint8Array(handle)` (and the other typed-array ctors) over an
    // ISLAND argument: the construction is an ENGINE operation — the
    // engine's own constructor over the engine's own value (an Emscripten
    // factory's `wasmBinary: new Uint8Array(buf)` where buf came off an
    // island readFileSync) — and the instance stays a handle. The static
    // bytes ctor cannot claim it (bytes never cross the boundary), so
    // this preempts only when the single argument is island-typed;
    // every static form keeps the standard path.
    if (
      this.dynamic &&
      ts.isIdentifier(expr.expression) &&
      expr.arguments?.length === 1 &&
      !ts.isSpreadElement(expr.arguments[0]!) &&
      /^(Uint8|Uint8Clamped|Int8|Uint16|Int16|Uint32|Int32|Float32|Float64|BigInt64|BigUint64)Array$/.test(
        expr.expression.text,
      ) &&
      this.isStdlibSymbol(this.resolveValueSymbol(expr.expression) ?? undefined) &&
      this.isIslandExpr(expr.arguments[0]!)
    ) {
      const loc = locOf(expr);
      const ctor: IrExpr = {
        kind: "jsOp", op: "globalGet", name: expr.expression.text, args: [], type: JSVAL, loc,
      };
      const arg = this.lowerExpr(expr.arguments[0]!);
      return { kind: "jsOp", op: "construct", args: [ctor, arg], type: JSVAL, loc };
    }
    return lowerNew(this, expr);
  }

  lowerFieldRead(expr: ts.PropertyAccessExpression): IrExpr | null {
    // `C.x` static reads first (the receiver is a CLASS, not an instance
    // — the instance field path below could never claim it), then static
    // access through class VALUES (classval-typed bindings).
    return lowerStaticFieldRead(this, expr) ?? lowerClassValueProperty(this, expr) ?? lowerFieldRead(this, expr);
  }

  lowerUnionProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerUnionProperty(this, expr);
  }

  lowerRecordFieldCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerRecordFieldCall(this, call, access);
  }

  lowerObjectMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerObjectMethodCall(this, call, access);
  }

  lowerSuperMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr {
    return lowerSuperMethodCall(this, call, access);
  }

  superThisRef(access: ts.PropertyAccessExpression): { thisRef: IrExpr; base: ClassInfo } {
    return superThisRef(this, access);
  }

  lowerSuperAccessorRead(access: ts.PropertyAccessExpression): IrExpr {
    return lowerSuperAccessorRead(this, access);
  }

  lowerSuperAccessorWrite(access: ts.PropertyAccessExpression,
    rhs: ts.Expression,
    loc: SrcLoc,): IrStmt {
    return lowerSuperAccessorWrite(this, access, rhs, loc);
  }

  /* ── comptime (compile-time evaluation) ───────────────────────────── */

  lowerComptime(expr: ts.CallExpression): IrExpr {
    return lowerComptime(this, expr);
  }

  comptimeBakeable(t: IrType): boolean {
    return comptimeBakeable(this, t);
  }

  rejectComptimeCaptures(cb: ts.ArrowFunction | ts.FunctionExpression): void {
    return rejectComptimeCaptures(this, cb);
  }

  comptimeValueToIr(value: unknown,
    expected: IrType,
    path: string,
    blame: ts.Node,): IrExpr {
    return comptimeValueToIr(this, value, expected, path, blame);
  }

  isConsoleLog(call: ts.CallExpression): boolean {
    return isConsoleLog(this, call);
  }

  consoleCallMember(call: ts.CallExpression): "log" | "info" | "debug" | "error" | "warn" | null {
    return consoleCallMember(this, call);
  }

  /* ── standard library (process + node:fs) ─────────────────────────── */

  builtinImportOf(ident: ts.Identifier): { module: string; member: string } | null {
    return builtinImportOf(this, ident);
  }

  /** The namespace-import twin of builtinImportOf's provenance rule:
   * resolves an expression to the supported builtin MODULE whose members
   * it exposes — an identifier declared by `import * as ns from "node:fs"`
   * (through the symbol, so shadowing locals never match), or a nested
   * member access that IS a module in its own right (`fs.promises` — the
   * same object as node:fs/promises, Node's rule). Null otherwise. */
  builtinNamespaceModuleOf(expr: ts.Expression): string | null {
    if (ts.isIdentifier(expr)) {
      // A runtime-chosen namespace (`const t = c ? https : http`) inside
      // ONE arm of its own use: the override pins which module this arm
      // is being lowered for, so every table below reads it as a plain
      // namespace binding. Outside an arm there is no override and the
      // identifier keeps whatever the ordinary rules say (which for a
      // registered selector is nothing — the value fence owns it).
      {
        const sym = this.checker.getSymbolAtLocation(expr);
        const pinned = sym ? namespaceOverrideOf(this, sym) : undefined;
        if (pinned !== undefined) return pinned;
      }
      const symbol = this.checker.getSymbolAtLocation(expr);
      const decl = symbol ? this.checker.declarationsOf(symbol)[0] : undefined;
      if (!decl) return null;
      // The CommonJS twin: `const fs = require("fs")` binds the same
      // namespace surface as `import * as fs from "node:fs"` — and the
      // createRequire spelling (`const fs = require("node:fs")` through a
      // createRequire binding, the fallback-typed cast idiom stripped)
      // binds it too.
      if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && decl.initializer) {
        const spec = requireSpecOf(decl.initializer);
        if (spec !== null) return canonicalBuiltinModule(spec);
        const init = stripTypeCasts(decl.initializer);
        if (ts.isCallExpression(init)) {
          const cr = createRequireSpecOf(this, init);
          if (cr !== null && cr.spec !== null) return canonicalBuiltinModule(cr.spec);
        }
        return null;
      }
      // A DESTRUCTURED sub-namespace binding — `const { promises } =
      // fs` / `= require('fs')`: the member is itself a supported module
      // ("fs/promises"), so the binding carries that module's namespace
      // surface. canonicalBuiltinModule gates the composition (an
      // ordinary destructured FUNCTION binding composes to an unknown
      // name and answers null — builtinImportOf owns those).
      if (ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent) &&
          ts.isVariableDeclaration(decl.parent.parent) && decl.parent.parent.initializer !== undefined &&
          decl.propertyName === undefined && decl.initializer === undefined) {
        const name = decl.name;
        if (name === undefined || !ts.isIdentifier(name)) return null;
        const init = decl.parent.parent.initializer;
        const spec = requireSpecOf(init);
        const outer = spec !== null
          ? canonicalBuiltinModule(spec)
          : ts.isIdentifier(init) ? this.builtinNamespaceModuleOf(init) : null;
        if (outer !== null) return canonicalBuiltinModule(`${outer}/${name.text}`);
        return null;
      }
    }
    // The INLINE CommonJS spelling: `require("cluster").isPrimary` — the
    // call expression IS the module namespace (Node evaluates the member
    // off the module object; a supported module's members key the same
    // tables as any namespace binding).
    {
      const spec = requireSpecOf(expr);
      if (spec !== null) return canonicalBuiltinModule(spec);
    }
    // The createRequire spelling of the same inline form:
    // `require("node:path").join(...)` through a createRequire binding
    // (the fallback-typed cast idiom strips: `(require("x") as T).m`).
    {
      const inner = stripTypeCasts(expr);
      if (ts.isCallExpression(inner)) {
        const cr = createRequireSpecOf(this, inner);
        if (cr !== null && cr.spec !== null) return canonicalBuiltinModule(cr.spec);
      }
    }
    if (ts.isIdentifier(expr)) {
      const symbol = this.checker.getSymbolAtLocation(expr);
      const decl = symbol ? this.checker.declarationsOf(symbol)[0] : undefined;
      if (!decl) return null;
      // The DEFAULT-import twin: Node's default export of a CJS builtin
      // IS the module object, so `import path from "node:path"` exposes
      // exactly the namespace form's member surface for EVERY supported
      // builtin (preflight admits the spelling in JS sources, plus the
      // callable module objects — assert, events, test — everywhere).
      if (ts.isImportClause(decl) && decl.name) {
        const importDecl = decl.parent;
        if (ts.isImportDeclaration(importDecl) && ts.isStringLiteral(importDecl.moduleSpecifier)) {
          return canonicalBuiltinModule(importDecl.moduleSpecifier.text);
        }
      }
      if (!ts.isNamespaceImport(decl)) return null;
      const importDecl = decl.parent.parent;
      if (!ts.isImportDeclaration(importDecl) || !ts.isStringLiteral(importDecl.moduleSpecifier)) return null;
      return canonicalBuiltinModule(importDecl.moduleSpecifier.text);
    }
    if (ts.isPropertyAccessExpression(expr) && !expr.questionDotToken && ts.isIdentifier(expr.expression)) {
      const outer = this.builtinNamespaceModuleOf(expr.expression);
      if (outer === null) return null;
      return canonicalBuiltinModule(`${outer}/${expr.name.text}`);
    }
    return null;
  }

  /** A member access on a supported builtin namespace import —
   * `fs.readFileSync`, `path.sep`, `fs.promises.readFile` — as the same
   * { module, member } shape builtinImportOf gives named imports, so both
   * import forms key the same lowering tables. Null for everything else. */
  builtinMemberOf(access: ts.PropertyAccessExpression): { module: string; member: string } | null {
    if (this.chainBlocked(access)) return null;
    const module = this.builtinNamespaceModuleOf(access.expression);
    if (module !== null) return { module, member: access.name.text };
    // The RE-EXPORT FACADE's namespace spelling: `import * as assert from
    // "./facade.js"` over `export { ok } from "node:assert"` (the formatter idiom's
    // universal/assert). The member's symbol is the facade's
    // ExportSpecifier, and builtinImportOf's alias chase answers the
    // builtin's own module/member — the same tables as a direct import;
    // ordinary property symbols are not aliases and never match.
    return ts.isIdentifier(access.name) ? builtinImportOf(this, access.name) : null;
  }

  /** `ns.member(...)` on a builtin namespace import: exactly the named-
   * import dispatch — the module tables for lowered members, the module-
   * qualified per-member fence for the rest. Null for non-namespace
   * callees (the call chain keeps trying). */
  lowerNamespaceBuiltinCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    // A member call through a RUNTIME-chosen namespace lowers once per
    // arm under a module override and answers the ternary (lower-nsvalue.ts).
    {
      const cond = lowerNamespaceConditionalCall(this, call, access);
      if (cond) return cond;
    }
    const bi = this.builtinMemberOf(access);
    if (!bi) return null;
    // The timers spoke: `timers.setTimeout(...)` through a namespace or
    // require binding IS the global (Node's timers module re-exports
    // them) — the shared member lowering serves both spellings.
    if (bi.module === "timers") {
      const timersServed = lowerTimersMemberCall(this, call, bi.member, locOf(access));
      if (timersServed) return timersServed;
    }
    // The assert spoke owns node:assert wholesale (every call shape is
    // special-cased — optional messages, per-type comparisons, synthesized
    // deep-equality helpers).
    const assertServed = this.lowerAssertModuleCall(call, bi, locOf(access));
    if (assertServed) return assertServed;
    // The node:test spoke owns its module the same way (`test.skip(...)`
    // through the default import is a namespace-member call here).
    const testServed = this.lowerNodeTestModuleCall(call, bi, locOf(access));
    if (testServed) return testServed;
    // The util spoke owns inspect/format the same way (per-type
    // synthesized traversal helpers, compile-time format strings).
    const utilServed = this.lowerUtilModuleCall(call, bi, locOf(access));
    if (utilServed) return utilServed;
    // The dgram/dns spoke owns those modules for namespace imports too
    // (`import * as dns from "node:dns"` — portless's form): every call
    // shape is special-cased there, so it never rides the param tables.
    const dgramServed = this.lowerDgramDnsModuleCall(call, bi, locOf(access));
    if (dgramServed) return dgramServed;
    // The server-surface spoke owns net and http wholesale — the same
    // dispatch the named-import path takes (`net.createServer(...)` via
    // `import * as net` is portless's own spelling).
    const served = this.lowerNetModuleCall(call, bi, locOf(access));
    if (served) return served;
    // The stream spoke owns finished/pipeline the same way.
    const streamServed = lowerStreamModuleCall(this, call, bi, locOf(access));
    if (streamServed) return streamServed;
    // fs._toUnixTimestamp — off the param tables (an underscore-stable
    // internal), served by its own spoke before the table fence.
    const fsTs = this.lowerFsToUnixTimestampCall(call, bi, locOf(access));
    if (fsTs) return fsTs;
    // The fs validation-ladder spoke (checked-dynamic lane): misuse of
    // implemented-namespace members throws Node's typed errors instead
    // of meeting the table fence.
    const fsLadder = this.lowerFsLadderCall(call, bi, locOf(access));
    if (fsLadder) return fsLadder;
    // The crypto introspection statics (getFips and the name lists) bake
    // at the call site — no runtime entry exists to table.
    const cryptoServed = this.lowerCryptoModuleCall(call, bi, locOf(access));
    if (cryptoServed) return cryptoServed;
    const builtinFn = builtinModuleFnOf(this, bi.module, bi.member);
    if (!builtinFn) {
      this.noLowering(
        `${bi.module}.${bi.member}`,
        call,
        builtinFenceHintOf(bi.module, bi.member),
        this.checker.getSymbolAtLocation(access.name),
      );
    }
    return this.lowerBuiltinModuleCall(call, bi, builtinFn, locOf(access));
  }

  /** `ns.member` on a builtin namespace import as a VALUE: constants
   * (path.sep, os.EOL) read as interned string literals; fs.constants
   * access-mode bits bake as numbers exactly like the named-import form;
   * functions have no closure representation (call sites only); members
   * with no lowering fence with the module-qualified name. Null for
   * non-namespace receivers (the property chain keeps trying). */
  lowerNamespaceBuiltinProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    const loc = locOf(expr);
    // fs.constants.X_OK through the namespace: the same four POSIX
    // access-mode bits the named-import form bakes (lowerFsConstantsProperty).
    if (!expr.questionDotToken && ts.isPropertyAccessExpression(expr.expression)) {
      const inner = this.builtinMemberOf(expr.expression);
      if (inner && inner.module === "fs" && inner.member === "constants") {
        const MODES: Record<string, number | undefined> = { F_OK: 0, X_OK: 1, W_OK: 2, R_OK: 4 };
        const value = own(MODES, expr.name.text);
        if (value === undefined) {
          this.noLowering(
            `fs.constants.${expr.name.text}`,
            expr,
            "F_OK, R_OK, W_OK, and X_OK are the lowered constants",
          );
        }
        return { kind: "numLit", value, type: F64, loc };
      }
    }
    const bi = this.builtinMemberOf(expr);
    if (!bi) return null;
    // events.defaultMaxListeners READS the process-wide default (its
    // write twin routes through emitter.setDefaultMaxChk).
    if (bi.module === "events" && bi.member === "defaultMaxListeners") {
      return { kind: "libCall", fn: "emitter.getDefaultMax", args: [], type: F64, loc };
    }
    const c = builtinModuleConstOf(this, bi.module, bi.member);
    if (c !== undefined) return builtinConstLit(c, loc);
    // module.builtinModules through a namespace binding — the baked
    // Node v24 list, a fresh string[] per read.
    if (bi.module === "module" && bi.member === "builtinModules") {
      return builtinModulesArrayLit(loc);
    }
    // tls.rootCertificates through the namespace: the same runtime-valued
    // constant the named-import read lowers to.
    {
      const roots = lowerTlsRootCertificates(this, bi, loc);
      if (roots) return roots;
    }
    if (bi.member === "constants" && bi.module === "fs") {
      // A bare `fs.constants` read (not one of the baked bits above).
      this.noLowering(`fs.constants`, expr, "F_OK, R_OK, W_OK, and X_OK are the lowered constants");
    }
    if (builtinModuleFnOf(this, bi.module, bi.member)) {
      this.unsupported(
        "SC1090",
        expr,
        `library functions as values (call '${expr.getText()}' directly)`,
      );
    }
    this.noLowering(
      `${bi.module}.${bi.member}`,
      expr,
      builtinFenceHintOf(bi.module, bi.member),
      this.checker.getSymbolAtLocation(expr.name),
    );
  }

  lowerBuiltinModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    fn: BuiltinModuleFn,
    loc: SrcLoc,): IrExpr {
    return lowerBuiltinModuleCall(this, expr, bi, fn, loc);
  }

  lowerFsToUnixTimestampCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerFsToUnixTimestampCall(this, expr, bi, loc);
  }

  lowerFsLadderCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerFsLadderCall(this, expr, bi, loc);
  }

  lowerChildArgsArg(node: ts.Expression | undefined, loc: SrcLoc): IrExpr {
    return lowerChildArgsArg(this, node, loc);
  }

  lowerSpawnSyncCall(expr: ts.CallExpression, loc: SrcLoc): IrExpr {
    return lowerSpawnSyncCall(this, expr, loc);
  }

  lowerSpawnCall(expr: ts.CallExpression, loc: SrcLoc): IrExpr {
    return lowerSpawnCall(this, expr, loc);
  }

  lowerExecSyncCall(expr: ts.CallExpression, shell: boolean, loc: SrcLoc): IrExpr {
    return lowerExecSyncCall(this, expr, shell, loc);
  }

  recordToEnvPairs(node: ts.Expression): IrExpr {
    return recordToEnvPairs(this, node);
  }

  envToPairsHelper(shapeId: string, loc: SrcLoc): string | null {
    return lowerEnvToPairsHelper(this, shapeId, loc);
  }

  lowerJsonMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerJsonMethodCall(this, call, access);
  }

  fencedBuiltinImportOf(ident: ts.Identifier): string | null {
    return fencedBuiltinImportOf(this, ident);
  }

  lowerCryptoComposedCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerCryptoComposedCall(this, call, access);
  }

  lowerUrlMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerUrlMethodCall(this, call, access);
  }

  lowerSearchParamsMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerSearchParamsMethodCall(this, call, access);
  }

  lowerStatsMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerStatsMethodCall(this, call, access);
  }

  lowerFileHandleMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerFileHandleMethodCall(this, call, access);
  }

  lowerChildMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerChildMethodCall(this, call, access);
  }

  lowerAtomicsCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerAtomicsCall(this, call, access);
  }

  // The server-surface spoke (lower-server.ts): net module calls, the
  // netServer/netSocket method surface, and the composed address().port.
  lowerNetModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerNetModuleCall(this, expr, bi, loc);
  }

  lowerServerMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerServerMethodCall(this, call, access);
  }

  lowerServerProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerServerProperty(this, expr);
  }

  // The dgram/dns spoke (lower-dgram.ts): dgram/dns module calls and the
  // dgramSocket method surface.
  lowerAssertModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerAssertModuleCall(this, expr, bi, loc);
  }

  lowerAssertDirectCall(expr: ts.CallExpression, loc: SrcLoc): IrExpr | null {
    return lowerAssertDirectCall(this, expr, loc);
  }

  // The util spoke (lower-inspect.ts): inspect/format/formatWithOptions.
  lowerUtilModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerUtilModuleCall(this, expr, bi, loc);
  }

  lowerDgramDnsModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerDgramDnsModuleCall(this, expr, bi, loc);
  }

  lowerDgramMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerDgramMethodCall(this, call, access);
  }

  // The node:test spoke (lower-test.ts): registrations, suites, hooks,
  // and the TestContext surface.
  lowerNodeTestModuleCall(expr: ts.CallExpression,
    bi: { module: string; member: string },
    loc: SrcLoc,): IrExpr | null {
    return lowerNodeTestModuleCall(this, expr, bi, loc);
  }

  lowerTestDirectCall(expr: ts.CallExpression, loc: SrcLoc): IrExpr | null {
    return lowerTestDirectCall(this, expr, loc);
  }

  lowerTestMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerTestMethodCall(this, call, access);
  }

  lowerTestCtxProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerTestCtxProperty(this, expr);
  }

  lowerHttpHeadersElement(expr: ts.ElementAccessExpression): IrExpr | null {
    return lowerHttpHeadersElement(this, expr);
  }

  lowerJsonProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerJsonProperty(this, expr);
  }

  lowerErrorCodeProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerErrorCodeProperty(this, expr);
  }

  lowerErrorPrototypeProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerErrorPrototypeProperty(this, expr);
  }

  lowerUint8ArrayStaticProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerUint8ArrayStaticProperty(this, expr);
  }

  lowerUint8ArrayPrototypeProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerUint8ArrayPrototypeProperty(this, expr);
  }

  lowerStringDecoderMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerStringDecoderMethodCall(this, call, access);
  }

  lowerReadlineMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerReadlineMethodCall(this, call, access);
  }

  lowerDcChannelMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerDcChannelMethodCall(this, call, access);
  }

  lowerAlsMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerAlsMethodCall(this, call, access);
  }

  lowerDcChannelProperty(access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerDcChannelProperty(this, access);
  }

  lowerDcTracingChannelMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerDcTracingChannelMethodCall(this, call, access);
  }

  lowerDcTracingChannelProperty(access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerDcTracingChannelProperty(this, access);
  }

  strdecHelper(op: "write" | "end", shapeId: string, loc: SrcLoc): string {
    return strdecHelper(this, op, shapeId, loc);
  }

  lowerProcessProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerProcessProperty(this, expr);
  }

  processVersionsMember(expr: ts.PropertyAccessExpression): IrExpr | null {
    return processVersionsMember(this, expr);
  }

  lowerFsConstantsProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerFsConstantsProperty(this, expr);
  }

  lowerBuiltinConstantsProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerBuiltinConstantsProperty(this, expr);
  }

  builtinConstantBindingOf(ident: ts.Identifier): IrExpr | null {
    return builtinConstantBindingOf(this, ident);
  }

  builtinConstantsDestructureDecl(nameNode: ts.Node, init: ts.Expression | undefined): boolean {
    return builtinConstantsDestructureDecl(this, nameNode, init);
  }

  lowerCryptoModuleCall(expr: ts.CallExpression, bi: { module: string; member: string }, loc: SrcLoc): IrExpr | null {
    return lowerCryptoModuleCall(this, expr, bi, loc);
  }

  lowerProcessStreamProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerProcessStreamProperty(this, expr);
  }

  isProcessEnv(node: ts.Expression): boolean {
    return isProcessEnv(this, node);
  }

  envValueType(): IrType {
    return envValueType(this);
  }

  lowerProcessEnvGet(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerProcessEnvGet(this, expr);
  }

  lowerProcessMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerProcessMethodCall(this, call, access);
  }

  lowerProcessOptionalMethodCall(call: ts.CallExpression): IrExpr | null {
    return lowerProcessOptionalMethodCall(this, call);
  }

  lowerTimeoutMethodCall(call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
    return lowerTimeoutMethodCall(this, call, access);
  }

  lowerPromisifiedSettledCall(expr: ts.CallExpression, target: PromisifiedTarget, loc: SrcLoc): IrExpr {
    return lowerPromisifiedSettledCall(this, expr, target, loc);
  }

  promisifiedExecFileDecl(nameNode: ts.Node, init: ts.Expression | undefined): boolean {
    return promisifiedExecFileDecl(this, nameNode, init);
  }

  lowerExecFileAsyncCall(expr: ts.CallExpression, loc: SrcLoc): IrExpr {
    return lowerExecFileAsyncCall(this, expr, loc);
  }

  execFileAsyncHelper(loc: SrcLoc): { name: string; shapeId: string } {
    return execFileAsyncHelper(this, loc);
  }

  envSnapshotHelper(shapeId: string, loc: SrcLoc): string | null {
    return envSnapshotHelper(this, shapeId, loc);
  }

  lowerNumberStaticCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerNumberStaticCall(this, call, access);
  }

  lowerDateCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerDateCall(this, call, access);
  }

  lowerTextCodecCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerTextCodecCall(this, call, access);
  }

  lowerStringStaticCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerStringStaticCall(this, call, access);
  }

  lowerStringLastIndexOfCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerStringLastIndexOfCall(this, call, access);
  }

  lowerFilterNarrowCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerFilterNarrowCall(this, call, access);
  }

  lowerPromiseMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerPromiseMethodCall(this, call, access);
  }

  lowerPromiseStaticCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerPromiseStaticCall(this, call, access);
  }

  lowerNumberStaticProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerNumberStaticProperty(this, expr);
  }

  /* ── the island-backed ambient surface (ISLAND_SURFACE) ───────────── */

  requireDynamicApi(feature: string, node: ts.Node): void {
    return requireDynamicApi(this, feature, node);
  }

  lowerMathProperty(expr: ts.PropertyAccessExpression): IrExpr | null {
    return lowerMathProperty(this, expr);
  }

  islandGlobalFnOf(ident: ts.Identifier): IslandFnEntry | null {
    return islandGlobalFnOf(this, ident);
  }

  lowerIslandMethodCall(call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    return lowerIslandMethodCall(this, call, access);
  }
}
