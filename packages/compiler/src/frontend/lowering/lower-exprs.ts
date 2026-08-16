/* Expression lowering: the expression dispatch (lowerExpr), literals
 * (array/object/regex/template), operators (binary incl. compound targets,
 * unary, instanceof, caught-typeof tests), union narrowing and unit
 * comparisons, nullish coalescing and optional chains, conditions and
 * ToBoolean/ToString coercion helpers, and field/element reads and writes
 * (FieldTarget). */
import * as ts from "../ts7/adapter.js";
import { dirname, relative } from "node:path";
import type { Lowerer, WidthLift } from "./lowerer.js";
import { BIGINT, BOOL, CAUGHT, DYN, type IrBytesElem, type IrLibFn, type IrNumBinOp, DYN_HANDLE_KINDS, F64, IrExpr, IrFunction, IrJsOp, IrLocal, IrRecordShape, IrStmt, IrType, JSVAL, KEYOBJ, NULL_T, REF_TRUTHY_KINDS, REGEX, RUNTIME_ERROR_CLASSES, SEARCH_PARAMS_T, STRING, SrcLoc, UNDEFINED_T, VOID, arrayOf, canAdaptDynFuncTo, canBoxFuncIntoDyn, canDynCheckTo, funcOf, isDynBytes, isJsonSafeType, isRefCounted, isUnitType, jsOpResultKind, httpReqIsReadableIn, shapeHasAccessorSlots, streamDuplexWidensToWritable, typeEquals, typeKey, unionFuncSetArmsOk } from "../../ir/nodes.js";
import { lowerAbortProperty } from "./lower-abort.js";
import { cjsClassExprWholeExportOf, cjsExportAssignmentOf, cjsExportDiscardReason, isCjsExportTableLiteral, isCjsJsFile, isJsSourceFile, isModuleExportsAccess, isNodeEsmFile, locOf } from "../program.js";
import { ARRAY_METHODS, builtinConstLit, builtinFenceHintOf, objectStaticFnValueOf, stdlibExistenceTestOf, stringMethodFnValueOf, builtinModuleConstOf, builtinModulesArrayLit, builtinModuleFnOf, COMPOUND_ASSIGN_OPS, CompoundOp, ISLAND_SURFACE, isChildSurfaceMember, MAP_METHODS, NARROW_FIRST, SET_METHODS, STR_METHODS, UNSUPPORTED_EXPR, sideEffectFreeOptionValue, stdlibGlobalNameOf } from "./surfaces.js";
import { UNSUPPORTED, blockedBindingUseDiag, recordShapeMismatchDiag, requiresDynamicPackageDiag, unsupportedDiag } from "../../diagnostics/diagnostic.js";
import { PoisonError, dynUndefinedExpr, jsFuncValueNameOf, jsFuncValueSourceOf, neverTaintedJsType, nodeThrowExpr, own } from "./lowerer.js";
import { arrayAtOf, BYTES_CTORS, condPresenceSlot, IndexMergeContributor, lowerIndexMergeHelper, lowerNpmStaticSafeIndexRead, strCharsCall } from "./lower-containers.js";
import { npmStaticPackageOfPath } from "../npm-static.js";
import { unsupportedModuleFeatureOf } from "../shared.js";
import { declModuleWithoutTwin, declTwinGlobalOf } from "./lower-modules.js";
import { fenceEnumObjectValue, lowerEnumAccess } from "./lower-enums.js";
import { ambientNsRootOf, ambientUndefReadType, ambientUndefVarRootOf, ambientUndefinedFnSymbolOf, contextualUndefReadType, fenceEarlyAliasUse, fenceEarlyNsMemberRef, lowerNsIdentifierValue, nsMemberIdentOf, nsUndefRead, nsWritableTarget } from "./lower-namespaces.js";
import { expandoMemberRead, expandoWritableTarget } from "./lower-expando.js";
import { lowerSocketInstanceOf, lowerTlsRootCertificates } from "./lower-server.js";
import { fenceNamespaceConditionalValue, lowerNamespaceConditionalDecl } from "./lower-nsvalue.js";
import { findGenericMethodOn, lowerStaticFieldRead } from "./lower-classes.js";
import { bindingNeverReassigned, implicitMonoFile, lowerIntlDefaultLocaleProperty, lowerTaggedTemplate, nullishGenericBindingUnitOf, objLitGenericFnInfoOf, objLitGenericFnNodeOf, requireObjLitGenericReceiver } from "./lower-calls.js";
import { mixinFnOfCallee } from "./lower-mixins.js";
import { isConstAssertionTypeNode, isGenericCallableMemberType, underConstAssertion, unitOnlyUnion } from "../types.js";
import { lowerYield } from "./lower-generators.js";
import { lowerStreamProperty, lowerStreamStateProperty, streamInstanceOfExpr, streamSidesOf } from "./lower-stream.js";
import { lowerWebSocketGlobal } from "./lower-ws.js";
import { emitterRooted } from "./lower-emitter.js";
import { EMITTER_API_MEMBERS, type ClassInfo } from "./lower-classes.js";

/** SCRIPTC_DTSTWIN_WHY probe: how many reads have taken the declaration-
 * module fence instead of the silent erasure stance. Read in the SAME run
 * as the result. */
let declModuleFenceCount = 0;

/** Member names a FUNCTION value's dyn box does NOT serve as own
 * properties. The `Function.prototype` methods stay out because a stored
 * `undefined` would mis-answer `f.call` as a VALUE.
 *
 * `prototype` is NO LONGER on this list. It was, for exactly one reason —
 * "nothing here builds a prototype OBJECT" (estado-objmodel.md §4b) — and
 * the runtime now does: scr_dyn_fn_get mints one on first demand into the
 * same table every other member lives in, `new` links instances to it,
 * and the keyed read walks the chain. Taking it off opens all four arms
 * at once, which is the point: `F.prototype` becomes a dyn value, so
 * `F.prototype.m = fn` reaches the dyn keyed WRITE that has always been
 * there (lower-stmts' probed-dyn receiver arm) with no new write path.
 *
 * The list is shared by the READ, the WRITE and the CALL arms on purpose:
 * the three are one table seen from three sides, and a key one arm serves
 * while another refuses is exactly the split-brain estado-propassign.md §5
 * measured (a routed write whose read still fences turns runtime fences
 * into hard compile errors). Same set, or the halves disagree. */
const FN_OWN_SKIPPED_KEYS = new Set([
  "apply", "bind", "call", "toString", "constructor", "caller", "arguments",
]);

/** True when a member name routes to a function value's own-property
 * table. `name` and `length` READ from the box (its static name and
 * declared arity) but never route a WRITE — see fnOwnPropBox's callers. */
export function fnOwnRoutableKey(key: string): boolean {
  return !FN_OWN_SKIPPED_KEYS.has(key);
}

/** SCRIPTC_FNOWN_WHY: what the function-value own-property route claimed,
 * read in the SAME run as the result it produced. `read` is the arm that
 * has shipped since 23d5918; `write` and `call` are this session's. */
export const fnOwnCounters = { read: 0, write: 0, call: 0, construct: 0, boxed: 0, declinedNotFunc: 0 };

/** The per-use dyn box for a FUNCTION-typed receiver whose own properties
 * are wanted, or null when the receiver is not one.
 *
 * A PER-USE box is correct and no declaration-site interning is needed:
 * `dynFrom` over a function value emits `scr_dyn_new_func(scr_closure_retain(v), …)`
 * (emit-walkers.ts), so every box of one function value shares one
 * `ScrClosure` and therefore one property table (`ScrClosure::props`).
 * Two boxes see each other's writes; a function value created afresh per
 * call of an enclosing factory gets a fresh closure and a fresh table,
 * which is exactly Node. `Object.defineProperties` has boxed a
 * function-typed target per use on this same argument since it shipped
 * (lower-calls.ts, the defineProperties arm).
 *
 * JAVASCRIPT files only, mirroring the read arm this factors out of: in
 * TypeScript the checker has a declared member type at every such access
 * and answering DYN there would cascade through every downstream
 * consumer. */
export function fnOwnPropBox(L: Lowerer, recv: ts.Expression, loc: SrcLoc): IrExpr | null {
  if (!isJsSourceFile(recv.getSourceFile())) return null;
  const probed = probeLower(L, recv);
  // The DECLINE trace, the other half of fnOwnWhy: what the receiver
  // actually probed to, for every site the box refused. Reading it is how
  // the `new` arm learned that an expando-typed module binding probes DYN
  // rather than FUNC (estado-protochain.md §3) — a decline is invisible
  // in the trap message, which only says the construction was refused.
  if (process.env["SCRIPTC_FNOWN_WHY"] !== undefined && probed?.type.kind !== "func") {
    process.stderr.write(`FNOWN decline ${recv.getText()} -> ${probed ? probed.type.kind : "unlowerable"}\n`);
  }
  if (!probed || probed.type.kind !== "func") {
    if (probed) fnOwnCounters.declinedNotFunc++;
    return null;
  }
  if (!canBoxFuncIntoDyn(probed.type, (id) => L.shapes.get(id), (id) => L.unions.get(id))) return null;
  // `fn.name` reads this box, so the name has to be the one the VALUE was
  // created with, not the one this site spells it — see jsFuncValueNameOf.
  const fnName = jsFuncValueNameOf(L, recv);
  fnOwnCounters.boxed++;
  return { kind: "dynFrom", value: probed, type: DYN, ...(fnName !== null ? { fnName } : {}), loc };
}

/** The SCRIPTC_FNOWN_WHY trace line for one claimed site. Off unless the
 * env var is set; the counters above are always live. */
export function fnOwnWhy(arm: string, node: ts.Node, key: string): void {
  if (process.env["SCRIPTC_FNOWN_WHY"] === undefined) return;
  const sf = node.getSourceFile();
  process.stderr.write(`FNOWN ${arm} ${key} ${sf.fileName}@${node.getStart()}\n`);
}

/** An assignable `obj.field` target — a class field, a record field, or a
 * class ACCESSOR property (reads become getter calls, writes setter calls;
 * fieldType is the property's one type). */
export type FieldTarget =
  | { container: "class"; obj: IrExpr; className: string; field: string; fieldType: IrType }
  | { container: "record"; obj: IrExpr; shapeId: string; field: string; fieldType: IrType }
  // An UNDECLARED key of an index-signature shape in dot spelling
  // (`r.openai` on `Record<string, T>`): the same overflow read/write path
  // as the bracket form — fieldType is the index signature's VALUE type
  // (the write-slot type; reads arm it with undefined under
  // noUncheckedIndexedAccess in fieldGetExpr).
  | { container: "recordOvf"; obj: IrExpr; shapeId: string; field: string; fieldType: IrType }
  | { container: "accessor"; obj: IrExpr; className: string; field: string; fieldType: IrType }
  // A RECORD accessor property (an object-literal `get x()`/`set x(v)` —
  // the shape carries %get:/%set: closure slots): reads call the getter
  // closure, writes the setter; fieldType is the property's one value type
  // (getter return = setter param — divergent pairs never map). The slot
  // types ride along so the dispatch needs no shape re-lookup.
  | {
      container: "recordAccessor";
      obj: IrExpr;
      shapeId: string;
      field: string;
      fieldType: IrType;
      getType?: IrType & { kind: "func" };
      setType?: IrType & { kind: "func" };
    };


/** A template piece's RAW text (String.raw's contract: escapes stay
 * characters). 7's client AST ships no rawText at runtime (the typing
 * declares it; the serialized node data omits it), so the raw span comes
 * off the SOURCE: between the piece's delimiters — backticks for the
 * no-substitution form, `\`...${` / `}...${` / `}...\`` for head/middle/
 * tail. 5.9.3's rawText, when a build ever supplies it, wins unchanged. */
export function templateRawTextOf(
  node: ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail,
): string {
  const own = (node as { rawText?: string }).rawText;
  if (own !== undefined) return own;
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const end = node.getEnd();
  const tailTrim = node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle ? 2 : 1;
  return sf.text.slice(start + 1, end - tailTrim);
}

/** Expression lowering recurses once per operand nesting level (plus the
 * recursive locOf/API walks riding each level), so a pathologically deep
 * expression — a ~3000-term left-nested binary chain (the
 * binderBinaryExpressionStress corpus pair) — overflows the JS stack as an
 * ICE. Real programs sit orders of magnitude below this floor; past it, the
 * honest answer is a named fence, not a crash. The threshold leaves ample
 * stack headroom for the fence itself: rendering the diagnostic walks the
 * node's PARENT chain (the remote layer's recursive getSourceFile), which
 * costs roughly one frame per nesting level on top of the lowering's own. */
const LOWER_EXPR_MAX_DEPTH = 200;
let lowerExprDepth = 0;

/** True when a property access names an ABSTRACT property declaration
 * (`abstract p: number` — a PropertyDeclaration, not an accessor): the
 * named-fence test for reads/writes through abstract-typed receivers. */
export function abstractPropertyDeclOf(L: Lowerer, expr: ts.PropertyAccessExpression): boolean {
  const sym = L.checker.getSymbolAtLocation(expr.name);
  if (!sym) return false;
  return L.checker
    .declarationsOf(sym)
    .some(
      (d) =>
        ts.isPropertyDeclaration(d) &&
        ts.getModifiers(d)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) === true,
    );
}

/** JS ToBoolean of an IR value the LOWERING already reduced to a literal,
 * or null when the value is not a compile-time constant.
 *
 * Only genuine literals answer. A literal has no side effects, so a caller
 * that skips evaluating it — which is what the short-circuit folds do —
 * drops nothing observable; anything computed keeps its runtime test. The
 * falsy set is JS's own: `false`, `0`/`-0`/`NaN`, `""`, and the units.
 *
 * A materialized FUNCTION VALUE joins them on the true side. ToBoolean of
 * every function object is `true` — the one exception in the language,
 * an [[IsHTMLDDA]] object (`document.all`), is a DOM host object no
 * lowering here can produce — and a `closure` node is effect-free by
 * construction: its captures are local IDs, not expressions. So it meets
 * both conditions this fold asks of a literal. This is what makes
 * `Number.isInteger || function (value) { ... }` — protobufjs's util,
 * where a lifted static lands in an operand — yield the static and never
 * lower the fallback, JS's own rule for a truthy left operand. */
function staticTruth(e: IrExpr): boolean | null {
  if (e.kind === "boolLit") return e.value;
  if (e.kind === "numLit") return e.value !== 0 && !Number.isNaN(e.value);
  if (e.kind === "strLit") return e.value.length > 0;
  if (e.kind === "unitLit") return false;
  if (e.kind === "closure") return true;
  return null;
}

/** A string comparison, folded when BOTH sides are literals. The fold is
 * what makes a `typeof` sniff DECIDE: `"undefined" != typeof window` is a
 * constant only if the comparison against the folded typeof string is one,
 * and the short-circuit rules downstream read that constant. */
function strEqExpr(negated: boolean, left: IrExpr, right: IrExpr, loc: SrcLoc): IrExpr {
  if (left.kind === "strLit" && right.kind === "strLit") {
    return { kind: "boolLit", value: (left.value === right.value) !== negated, type: BOOL, loc };
  }
  return { kind: "strEq", negated, left, right, type: BOOL, loc };
}

/** The `() => bytes` value behind a bare `diffieHellman` reference: a
 * memoized lifted closure `(opts) => key.dh(opts.privateKey, opts.publicKey)`
 * over the interned `{ privateKey: keyobj; publicKey: keyobj }` options
 * record — the same synchronous X25519 agreement the CALL form lowers to,
 * so a value that IS invoked (rather than only bound) computes the right
 * secret. Zero-capture, so every reference is the one interned closure. */
function diffieHellmanFnValue(L: Lowerer, loc: SrcLoc): IrExpr {
  const name = "%crypto.dh.value";
  const optsShape = L.shapes.intern([
    { name: "privateKey", type: KEYOBJ },
    { name: "publicKey", type: KEYOBJ },
  ]);
  const optsT: IrType = { kind: "record", shapeId: optsShape };
  const bytesT: IrType = { kind: "bytes", elem: "u8" };
  const fnT = funcOf([optsT], bytesT);
  if (!L.liftedFns.some((f) => f.name === name)) {
    const opts: IrExpr = { kind: "varRef", localId: "opts.0", type: optsT, loc };
    const read = (field: string): IrExpr => ({ kind: "recordGet", obj: opts, shapeId: optsShape, field, type: KEYOBJ, loc });
    L.liftedFns.push({
      name,
      params: [{ localId: "opts.0", name: "opts", type: optsT }],
      returnType: bytesT,
      locals: [{ id: "opts.0", name: "opts", type: optsT, mutable: false }],
      body: [
        {
          kind: "return",
          value: { kind: "libCall", fn: "key.dh", args: [read("privateKey"), read("publicKey")], type: bytesT, loc },
          loc,
        },
      ],
      loc,
    });
  }
  return { kind: "closure", fnName: name, captures: [], type: fnT, loc };
}

export function lowerExpr(L: Lowerer, expr: ts.Expression): IrExpr {
    if (lowerExprDepth >= LOWER_EXPR_MAX_DEPTH) {
      L.unsupported("SC1090", expr, `expressions nested deeper than ${LOWER_EXPR_MAX_DEPTH} levels`);
    }
    lowerExprDepth++;
    try {
      return lowerExprInner(L, expr);
    } finally {
      lowerExprDepth--;
    }
  }

/** The stdlib globals whose VALUE is a real OBJECT here rather than the
 * identifier chokepoint's opaque identity token — today exactly one.
 *
 * The token rule (an interned string naming the global) is sound for a
 * value programs only ever COMPARE, and the two things a string cannot
 * do — be called, answer a member — were supposed to meet per-site
 * fences. `Uint8Array` breaks that: programs read THROUGH it, and a
 * member read off a string is not a fence, it is `undefined`. protobufjs
 * does it twice at module init, on both halves of the codec:
 *
 *     util.Array = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
 *     Writer.alloc = util.pool(Writer.alloc, util.Array.prototype.subarray);
 *     Reader.prototype._slice = util.Array.prototype.subarray
 *                            || util.Array.prototype.slice;
 *
 * and the program died three reads downstream, on `.subarray` of
 * undefined, with ZERO traps emitted. The honest answer is the object
 * Node has (scr_dyn_uint8array_ctor: typeof "function", a pinned
 * `prototype`, `new` through it), and it must be a runtime VALUE rather
 * than a lowered member like `String.prototype.charCodeAt` because by
 * the time `.prototype` is read the receiver is a dyn property nobody
 * can see statically.
 *
 * It is NOT the token generalisation the sibling measurement refuted:
 * that one hands every global an object and makes the ones that are
 * genuinely uncallable here lie about it. This is one global, whose
 * whole surface — construction included — the runtime really has.
 *
 * JavaScript sources only, like the token rule it replaces; a TypeScript
 * source keeps the SC2020 fence on the value (the checker types the
 * expression `Uint8ArrayConstructor`, and every consumer of that mapping
 * would need the `Error.prototype` typeOf treatment for no site that
 * exists). Static builds only — under --dynamic the engine owns the real
 * constructor, and a second static one would be a different object from
 * the one every engine-side typed array is linked to. */
export function ctorObjectGlobalValue(L: Lowerer, canonical: string, loc: SrcLoc): IrExpr | null {
  if (canonical !== "Uint8Array" || L.dynamic) return null;
  return { kind: "libCall", fn: "dyn.u8Ctor", args: [], type: DYN, loc };
}

/** Node's `typeof` answer for a stdlib global taken as a VALUE, read off
 * the CHECKER's declared type — or null where the shape says nothing.
 *
 * `typeof` is the one consumer of a stdlib global that never needs the
 * value: the answer is a property of the global's KIND, and the standard
 * library declares the kind. Every other consumer keeps the value it had
 * (the identity token in a JavaScript source, the SC2020 fence in a
 * TypeScript one) — this asks a different question of the same symbol,
 * it does not hand the token a kind. That distinction is why this is not
 * the token generalisation the sibling measurement refuted: nothing here
 * makes an uncallable global claim it can be called; it reports what the
 * declaration already says.
 *
 * A global whose declared type says NOTHING keeps its old answer: the
 * capability-gated pair (`crypto`, `localStorage`, ... — `declare var
 * crypto: unknown`) is deliberately typed for a runtime that does not
 * have them, so there is no fact here to report and the fold declines.
 *
 * A constructor this compiler does not let a program CONSTRUCT is written
 * as a statics-only interface, which is structurally the same thing as
 * `Math` — and Node still answers "function" for it, because the value is
 * a function object. Two of the three such globals say so in the
 * declaration: `readonly prototype: X` is what a library writes to mean
 * "this value is the constructor", and it is the JS marker of a function
 * object (`MessagePort` and `AbortSignal` here — measured, not assumed).
 * `Buffer` is the third and declares no prototype either, so it is a
 * NAMED exception. The whole 93-global census — every name the ambient
 * files and the ES lib declare — agrees with Node on every other entry,
 * which is what makes one name a named exception rather than a shape rule
 * guessing for a family. */
const FUNCTION_VALUED_GLOBALS: ReadonlySet<string> = new Set([
  // `new Buffer()` was removed from Node's API, so the BufferConstructor
  // this compiler declares carries only the statics (from/alloc/concat/
  // ...) and no prototype. `typeof Buffer` is "function" in Node 25.
  "Buffer",
]);

export function stdlibGlobalTypeOfAnswer(L: Lowerer, canonical: string, t: ts.Type): string | null {
  if (
    FUNCTION_VALUED_GLOBALS.has(canonical) ||
    L.checker.getCallSignatures(t).length > 0 ||
    L.checker.getConstructSignatures(t).length > 0
  ) {
    return "function";
  }
  const f = t.flags;
  if (f & ts.TypeFlags.NumberLike) return "number";
  if (f & ts.TypeFlags.StringLike) return "string";
  if (f & ts.TypeFlags.BooleanLike) return "boolean";
  if (f & ts.TypeFlags.BigIntLike) return "bigint";
  if (f & ts.TypeFlags.ESSymbolLike) return "symbol";
  if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return "undefined";
  if (f & ts.TypeFlags.Null) return "object";
  if (f & ts.TypeFlags.Object) {
    return L.checker.getPropertyOfType(t, "prototype") !== undefined ? "function" : "object";
  }
  return null;
}

function lowerExprInner(L: Lowerer, expr: ts.Expression): IrExpr {
    const loc = locOf(expr);

    // An optional chain's guarded receiver: already evaluated by the
    // enclosing optChain — read the bind temp instead of re-lowering.
    const chainRecv = L.chainRecvByNode.get(expr);
    if (chainRecv) return { ...chainRecv, loc };

    if (ts.isBigIntLiteral(expr)) {
      // The scanner's text keeps the `n` suffix and any numeric separators;
      // the runtime parser wants neither (it reads decimal or 0x/0o/0b).
      const text = expr.text.replace(/_/g, "").replace(/n$/, "");
      return { kind: "bigLit", text, type: BIGINT, loc };
    }
    if (ts.isNumericLiteral(expr)) {
      const value = Number(expr.text.replace(/_/g, ""));
      // Ask 4's representability input: a DECIMAL INTEGER source spelling
      // that does not survive the trip through f64 (parse, format back,
      // compare) rides the literal so the library integer-boundary check
      // can refuse on the author's source text. `expr.text` is the
      // scanner's COOKED value (already the nearest double), so the
      // source spelling comes from the file text; numeric separators are
      // spelling sugar and strip first. Round-tripping literals (every
      // integer within ±(2^53−1)) and non-integer spellings carry
      // nothing, so the IR is unchanged for programs that held their
      // numbers.
      const spelled = expr.getText().replace(/_/g, "");
      if (/^\d+$/.test(spelled) && String(Number(spelled)) !== spelled) {
        return { kind: "numLit", value: Number(spelled), spelling: spelled, type: F64, loc };
      }
      return { kind: "numLit", value, type: F64, loc };
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return { kind: "boolLit", value: true, type: BOOL, loc };
    }
    if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return { kind: "boolLit", value: false, type: BOOL, loc };
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) {
      // A unit literal: representable only where a union slot's coercion
      // immediately wraps it (coerceToExpected), or against a union in
      // ===/!== (lowerUnitComparison). Anything else fails on its type.
      return { kind: "unitLit", unit: "null", type: NULL_T, loc };
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return { kind: "strLit", value: expr.text, type: STRING, loc };
    }
    if (ts.isRegularExpressionLiteral(expr)) return L.lowerRegexLiteral(expr);
    if (ts.isTemplateExpression(expr)) return L.lowerTemplate(expr);
    if (ts.isTaggedTemplateExpression(expr)) {
      // `String.raw` — the ONE lowered tag: the template's RAW text,
      // escapes staying characters (String.raw`C:\System` keeps the
      // backslash; the wslpath idiom). Substitutions splice exactly like
      // an untagged template, just over the raw spans. Every other tag
      // is the general lowering — an interned per-site strings object
      // plus an ordinary call (lowerTaggedTemplate).
      if (
        ts.isPropertyAccessExpression(expr.tag) &&
        L.stdlibGlobalMember(expr.tag, "String") === "raw"
      ) {
        if (ts.isNoSubstitutionTemplateLiteral(expr.template)) {
          return { kind: "strLit", value: templateRawTextOf(expr.template), type: STRING, loc };
        }
        const t = expr.template;
        const pieces: IrExpr[] = [];
        const headRaw = templateRawTextOf(t.head);
        if (headRaw !== "") pieces.push({ kind: "strLit", value: headRaw, type: STRING, loc });
        for (const span of t.templateSpans) {
          pieces.push(
            L.caughtToString(span.expression) ??
              L.ensureString(L.lowerExpr(span.expression), span.expression),
          );
          const raw = templateRawTextOf(span.literal);
          if (raw !== "") {
            pieces.push({ kind: "strLit", value: raw, type: STRING, loc: locOf(span.literal) });
          }
        }
        if (pieces.length === 0) return { kind: "strLit", value: "", type: STRING, loc };
        return pieces.reduce((acc, p) => ({ kind: "strConcat", left: acc, right: p, type: STRING, loc }));
      }
      return lowerTaggedTemplate(L, expr);
    }
    if (ts.isParenthesizedExpression(expr)) return L.lowerExpr(expr.expression);
    // Type-level wrappers: `satisfies` and `!` erase completely; the runtime
    // value is the inner expression's. `as` erases too UNLESS the inner
    // value is dyn ('unknown') — then the cast is THE dynamic boundary and
    // compiles to a runtime validation (see lowerAsExpression). A cast
    // between non-dyn IR types can't change representation (the inner
    // expression's own lowering/mapType already rejects what doesn't map).
    // `x!` erases the TYPE but must NARROW the VALUE: tsc types the
    // assertion as the non-nullish type, so a union-typed inner bridges to
    // the asserted arm (`groups.get(k)!.push(v)` — the Map get-or-init
    // idiom). Unlike checker-PROVEN narrowing, `!` is an unchecked
    // assertion, so the extraction is CHECKED: a lying `!` (the value
    // still held undefined/null, or another arm) throws the catchable
    // TypeError — divergence 38's stance, matching the widening-site
    // traps. Sub-union assertions and non-union inners keep their
    // historic erasure (the widening sites re-tag with traps already).
    if (ts.isNonNullExpression(expr)) {
      const inner = L.lowerExpr(expr.expression);
      if (inner.type.kind === "union") {
        const target = L.mapTypeOf(L.typeOf(expr));
        if (target && target.kind !== "union" && !typeEquals(target, inner.type)) {
          const helper = L.narrowedArmHelper(inner.type.unionId, target, loc);
          if (helper) {
            return { kind: "call", callee: helper, args: [inner], type: target, loc };
          }
        }
        return inner;
      }
      return L.maybeNarrow(inner, expr);
    }
    if (ts.isSatisfiesExpression(expr)) {
      return L.lowerExpr(expr.expression);
    }
    if (ts.isAsExpression(expr) || ts.isTypeAssertion(expr)) return L.lowerAsExpression(expr);
    if (ts.isVoidExpression(expr)) {
      // `void e` in VALUE position is the undefined value after evaluating
      // e. A side-effect-free operand drops entirely (`void 0` — the
      // classic undefined spelling; the surrounding slot's coercion wraps
      // the unit like any bare `undefined`). Effectful operands compile
      // where the value is DISCARDED — statement position
      // (lowerExprStatement) and void-returning arrow bodies — and here
      // too: `void e` IS `(e, undefined)`, and the comma operator's own
      // lowering a few hundred lines down already carries that shape as a
      // seqExpr. The operand runs for effect exactly as its statement
      // lowering, the value is the unit. The only operands that stay
      // fenced are the ones the comma operator also fences: a statement
      // lowering needing real control flow, which the seqExpr validator
      // (the C emission point is mid-expression) does not accept.
      if (sideEffectFreeOptionValue(expr.expression)) {
        return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: locOf(expr) };
      }
      const voidLoc = locOf(expr);
      const voidEffect = L.lowerExprStatement(expr.expression);
      if (seqExprSafeStmt(voidEffect)) {
        return {
          kind: "seqExpr",
          stmts: [voidEffect],
          result: { kind: "libCall", fn: "js.voidOperand", args: [], type: VOID, loc: voidLoc },
          type: VOID,
          loc: voidLoc,
        };
      }
      L.unsupported(
        "SC1090",
        expr,
        "'void' with an effectful operand in value position whose operand needs control flow (hoist the operand to its own statement — statement-position 'void e' and void-returning arrow bodies compile)",
      );
    }
    // Literals in an `any`-typed slot (the CONTEXTUAL type is what the
    // record/array lowerings would consult) build natively in the island:
    // each value lowers statically and marshals in. An UNMAPPABLE
    // contextual type falls back to the literal's own type, exactly like
    // lowerObjectLiteral's fallback — a package call's options parameter
    // is often an unmappable intersection while the literal's own type
    // absorbs to jsval (a bare-jsval field, an npm-typed member).
    if (
      (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) &&
      (() => {
        const ctxTs = L.checker.getContextualType(expr);
        const mapped = (ctxTs ? L.mapTypeOf(ctxTs) : null) ?? L.mapTypeOf(L.typeOf(expr));
        if (mapped?.kind !== "jsval") return false;
        // The tsgo readonly-[] panic repair (see lowerArrayLiteral): an
        // EMPTY array literal under a const assertion is the empty tuple —
        // its `any` answer is a panicked query, not an island slot.
        if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0 && underConstAssertion(expr)) {
          return false;
        }
        // A JS variable INITIALIZER whose BINDING registered as a
        // checked-dynamic module global (the typedef-annotated
        // doc-builder consts whose JSDoc types degraded — DYN slots):
        // the island build could never land (no engine→dyn crossing
        // exists), so the literal takes its own world's path instead —
        // the dyn literal, or a static record the slot converts.
        if (
          isJsSourceFile(expr.getSourceFile()) &&
          ts.isVariableDeclaration(expr.parent) &&
          expr.parent.initializer === expr &&
          ts.isIdentifier(expr.parent.name)
        ) {
          const bindSym = L.checker.getSymbolAtLocation(expr.parent.name);
          const g = bindSym ? L.globalsBySymbol.get(bindSym) : undefined;
          if (g?.type.kind === "dyn") return false;
        }
        // A PROJECT-DECLARED contextual type that only ABSORBED to the
        // island (a doc-builder typedef whose field's JSDoc type
        // reference degraded to checker-`any` — the tsgo multi-file
        // value-as-type residue) is not an npm slot: when the literal's
        // OWN type maps statically, it builds that way — the binding's
        // checked-dynamic slot takes the dyn conversion. Genuinely
        // island slots (npm .d.ts provenance, plain `any`) keep the
        // native build.
        if (ctxTs !== undefined && (ctxTs.flags & ts.TypeFlags.Any) === 0) {
          // Intersection/tuple typedefs (`Line & {readonly soft: true}`)
          // carry provenance on the ALIAS symbol.
          const sym = ctxTs.getSymbol() ?? ctxTs.getAliasSymbol();
          const decls = sym ? L.checker.declarationsOf(sym) : [];
          const projectDeclared =
            decls.length > 0 &&
            decls.every((d) => {
              const sf = d.getSourceFile();
              return !sf.isDeclarationFile && !sf.fileName.includes("/node_modules/");
            });
          if (projectDeclared) {
            const own = L.mapTypeOf(L.typeOf(expr));
            if (own?.kind === "record" || own?.kind === "array") return false;
          }
        }
        return true;
      })()
    ) {
      if (ts.isObjectLiteralExpression(expr)) {
        // Two engine literals when a CONDITIONAL spread participates
        // (`{ a, ...(c ? { k: v } : {}) }` — the optional-key idiom): the
        // whole literal becomes `c ? objLit(with) : objLit(without)`. The
        // shared properties' nodes ride BOTH arms (exactly one arm
        // evaluates, so each property still evaluates once); the reorder
        // of `c` before earlier properties is unobservable because the
        // condition must be a side-effect-free read. The spread arm's keys
        // are truly ABSENT when the empty arm is taken — engine-exact
        // (`"k" in o` is false), which the static record path can't say.
        const argsWithout: IrExpr[] = [];
        const argsWith: IrExpr[] = [];
        const getters: { name: string; fn: IrExpr; loc: SrcLoc }[] = [];
        let spread: { cond: IrExpr; whenTrue: boolean } | null = null;
        // A MEMBER a JS file cannot lower or marshal: defer like a
        // statement fence, shaped by what the member IS. A FUNCTION-shaped
        // member (a generic function as a value, a signature with
        // checked-dynamic parameters — the doc-builder public aggregate's
        // degraded pieces) becomes a host closure that THROWS the captured
        // diagnostic when invoked — building the aggregate compiles and
        // only a CALL through the island stops the run. A DATA-shaped
        // member must NOT become a callable (the retired fence box's
        // silent wrong answers: typeof said "function", downstream errors
        // blamed the wrong thing — the withPlugins `plugins:` slot), so it
        // defines through the engine's getter machinery instead: READING
        // the member throws the diagnostic — the honest granularity, since
        // using the value is exactly what cannot be answered. `getterName`
        // null keeps the closure shape (function-shaped members, and the
        // conditional-spread arms where getters cannot combine).
        const islandMemberFence = (diagsBefore: number, err: unknown, valueNode: ts.Node, getterName: string | null = null): IrExpr | null => {
          if (
            !(err instanceof PoisonError) ||
            !isJsSourceFile(expr.getSourceFile()) ||
            L.diagSink !== null ||
            L.diags.length <= diagsBefore ||
            L.diags.slice(diagsBefore).some((d) => d.code === "SC9001")
          ) {
            throw err;
          }
          const captured = L.diags.splice(diagsBefore);
          L.runtimeFences.push(...captured);
          const first = captured[0]!;
          const pos = ts.getLineAndCharacterOfPosition(
            L.program.getSourceFile(first.loc.file) ?? expr.getSourceFile(),
            first.loc.start,
          );
          const fnName = `%fn${L.lambdaCounter++}_islfence`;
          L.liftedFns.push({
            name: fnName,
            params: [],
            returnType: VOID,
            locals: [],
            captures: [],
            body: [
              {
                kind: "runtimeFence",
                code: first.code,
                message: `${first.message} [${first.code} at ${first.loc.file}:${pos.line + 1}]`,
                loc: locOf(valueNode),
              },
            ],
            loc: locOf(valueNode),
          });
          const fence: IrExpr = { kind: "closure", fnName, captures: [], type: funcOf([], VOID), loc: locOf(valueNode) };
          if (getterName !== null) {
            getters.push({ name: getterName, fn: L.jsvalIn(fence, valueNode), loc: locOf(valueNode) });
            return null;
          }
          return L.jsvalIn(fence, valueNode);
        };
        // The member's SHAPE decides the fence's granularity: syntactic
        // functions and checker-callable values keep the call-time
        // closure; everything else (call results, awaits, data reads —
        // the withPlugins `plugins:` shape) fences at the READ.
        const funcShapedMember = (p: ts.ObjectLiteralElementLike): boolean => {
          if (ts.isMethodDeclaration(p)) return true;
          const src: ts.Node | null = ts.isPropertyAssignment(p)
            ? p.initializer
            : ts.isShorthandPropertyAssignment(p)
              ? p.name
              : null;
          if (!src || !ts.isExpression(src)) return true; // unknown form: keep the closure shape
          let inner: ts.Expression = src;
          while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
          if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return true;
          return L.checker.getCallSignatures(L.typeOf(src)).length > 0;
        };
        const pushProp = (
          name: ts.Identifier | ts.StringLiteral,
          value: IrExpr,
          valueNode: ts.Node,
          into: IrExpr[][],
        ): void => {
          const diagsBefore = L.diags.length;
          let marshaled: IrExpr;
          try {
            marshaled = L.jsvalIn(value, valueNode);
          } catch (err) {
            // A value that LOWERED but cannot cross (a promise, a class
            // instance): func-typed values keep the call-time closure;
            // data-shaped values fence at the read (the getter), unless a
            // conditional spread owns the literal (getters cannot combine).
            const asGetter = value.type.kind !== "func" && spread === null;
            const fence = islandMemberFence(diagsBefore, err, valueNode, asGetter ? name.text : null);
            if (fence === null) return; // registered as a fence getter — no data property
            marshaled = fence;
          }
          for (const args of into) {
            args.push({
              kind: "jsMarshal",
              value: { kind: "strLit", value: name.text, type: STRING, loc: locOf(name) },
              type: JSVAL, loc: locOf(name),
            });
            args.push(marshaled);
          }
        };
        const spreadSrcs: IrExpr[] = [];
        let sawPlainProp = false;
        for (const prop of expr.properties) {
          if (ts.isSpreadAssignment(prop)) {
            const cs = conditionalSpreadOf(prop.expression);
            if (cs && cs !== "unsupported" && !spread) {
              if (spreadSrcs.length > 0) {
                L.unsupported(
                  "SC1090",
                  prop,
                  "a conditional spread mixed with plain spreads in an 'any'-typed object literal",
                );
              }
              const cond = L.lowerCondition(cs.cond);
              if (!pureCondExpr(cond)) {
                L.unsupported(
                  "SC1090",
                  prop,
                  "conditional spreads with effectful conditions in an 'any'-typed object literal (bind the condition to a const first)",
                );
              }
              spread = { cond, whenTrue: cs.whenTrue };
              for (const p of cs.props) {
                const v = ts.isPropertyAssignment(p) ? L.lowerExpr(p.initializer) : L.lowerShorthandValue(p);
                pushProp(p.name, v, p, [argsWith]);
              }
              continue;
            }
            // A PLAIN spread (`{ ...options, plugins }` — the withPlugins
            // argument-rebuild shape): the source copies into the fresh
            // engine object through the spec's CopyDataProperties (the
            // objSpread op). Spreads must precede explicit properties
            // (the composition applies explicit keys AFTER the copies —
            // JS's later-wins — which a spread after them would invert);
            // mixing with a conditional spread keeps the fence.
            if (cs === undefined || cs === null) {
              if (sawPlainProp || spread) {
                L.unsupported(
                  "SC1090",
                  prop,
                  "object spread after explicit properties (or mixed with a conditional spread) in an 'any'-typed object literal — spreads must come first",
                );
              }
              spreadSrcs.push(L.jsvalIn(L.lowerExpr(prop.expression), prop.expression));
              continue;
            }
            L.unsupported(
              "SC1090",
              prop,
              "this spread form in an 'any'-typed object literal (one `...(c ? { k: v } : {})` conditional spread is supported — bind other shapes to a const and set keys explicitly)",
            );
          }
          sawPlainProp = true;
          // `name: value`, the shorthand `{ name }` (the value is the
          // identifier itself, resolved through the shorthand VALUE symbol
          // like the static record path), and METHODS — `{ load() {...} }`
          // is a function expression under a shorthand name, marshaled
          // like any closure value (this-uses keep the static path's
          // rejection); everything else keeps the fence. Identifier and
          // string-literal keys — engine property names have no
          // identifier restriction ("content-type").
          const name = prop.name;
          // A GET accessor (`get root() { return ROOT_INDENT; }` — the
          // doc-printer's self-referential root-indent shape): the body
          // lowers as a zero-param closure marshaled into the engine, and
          // the property defines through the engine's own getter
          // machinery AFTER the literal builds (the defineGetter op) —
          // reads through the handle invoke it natively. `this` in the
          // body keeps the object-method rejection; setters stay fenced.
          if (ts.isGetAccessorDeclaration(prop) && prop.body && name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
            L.rejectThisInObjectMethod(prop.body);
            getters.push({ name: name.text, fn: L.jsvalIn(L.lowerLambda(prop), prop), loc: locOf(prop) });
            continue;
          }
          // A member VALUE that cannot lower at all (a generic function
          // referenced as a value — the aggregate's `align`): the same
          // call-time fence deferral pushProp applies to marshal failures.
          let value: IrExpr | null = null;
          const valueDiagsBefore = L.diags.length;
          try {
            value = ts.isPropertyAssignment(prop)
              ? L.lowerExpr(prop.initializer)
              : ts.isShorthandPropertyAssignment(prop)
                ? L.lowerShorthandValue(prop)
                : ts.isMethodDeclaration(prop) && prop.body
                  ? (L.rejectThisInObjectMethod(prop.body), L.lowerLambda(prop))
                  : null;
          } catch (err) {
            const nameText =
              name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
            const asGetter = nameText !== null && spread === null && !funcShapedMember(prop);
            value = islandMemberFence(valueDiagsBefore, err, prop, asGetter ? nameText : null);
            if (value === null) continue; // registered as a fence getter — no data property
          }
          if (value && name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
            pushProp(name, value, prop, [argsWithout, argsWith]);
          } else {
            L.unsupported(
              "SC1090",
              prop,
              "this property form in an 'any'-typed object literal (only `name: value`, shorthand names, methods, and get accessors are supported)",
            );
          }
        }
        const withGetters = (obj: IrExpr): IrExpr =>
          getters.reduce<IrExpr>(
            (acc, g) => ({
              kind: "jsOp",
              op: "defineGetter",
              args: [
                acc,
                { kind: "jsMarshal", value: { kind: "strLit", value: g.name, type: STRING, loc: g.loc }, type: JSVAL, loc: g.loc },
                g.fn,
              ],
              type: JSVAL,
              loc: g.loc,
            }),
            obj,
          );
        if (!spread) {
          if (spreadSrcs.length === 0) {
            return withGetters({ kind: "jsOp", op: "objLit", args: argsWithout, type: JSVAL, loc });
          }
          // Plain spreads compose left to right onto a fresh object, the
          // explicit properties merging LAST (JS's later-wins): spread
          // sources evaluate before later property values by nesting
          // order, exactly the source order.
          let acc: IrExpr = { kind: "jsOp", op: "objLit", args: [], type: JSVAL, loc };
          for (const src of spreadSrcs) {
            acc = { kind: "jsOp", op: "objSpread", args: [acc, src], type: JSVAL, loc };
          }
          if (argsWithout.length > 0) {
            acc = {
              kind: "jsOp",
              op: "objSpread",
              args: [acc, { kind: "jsOp", op: "objLit", args: argsWithout, type: JSVAL, loc }],
              type: JSVAL,
              loc,
            };
          }
          return withGetters(acc);
        }
        if (getters.length > 0) {
          L.unsupported("SC1090", expr, "get accessors combined with conditional spreads in an 'any'-typed object literal");
        }
        const withLit: IrExpr = { kind: "jsOp", op: "objLit", args: argsWith, type: JSVAL, loc };
        const withoutLit: IrExpr = { kind: "jsOp", op: "objLit", args: argsWithout, type: JSVAL, loc };
        return {
          kind: "ternary",
          cond: spread.cond,
          then: spread.whenTrue ? withLit : withoutLit,
          else_: spread.whenTrue ? withoutLit : withLit,
          type: JSVAL,
          loc,
        };
      }
      const args = expr.elements.map((el) => L.jsvalIn(L.lowerExpr(el), el));
      return { kind: "jsOp", op: "arrLit", args, type: JSVAL, loc };
    }
    if (ts.isTypeOfExpression(expr)) {
      // `typeof queueMicrotask` / `typeof Math` on a STDLIB global: folds
      // to Node's answer BEFORE the operand lowers — read off the declared
      // type, because `typeof` is the one consumer that never needs the
      // value. A JavaScript source represents these values as the identity
      // TOKEN (an interned string), so lowering the operand answered
      // "string" for every global that is not callable — `Math`, `JSON`,
      // `globalThis`, `process`, `console`, `Reflect`, `Intl`,
      // `performance` and `Buffer` all lied, silently, in the one shape
      // vendored bundles sniff their environment with; a TypeScript source
      // fenced SC2020 instead, naming a value the program never asked for.
      // An identifier read has no side effects to preserve, and the gate is
      // exactly the one that mints the token (stdlibGlobalNameOf's surface:
      // the bare name, `globalThis.<name>`, and the casts over it), so the
      // two stay in step. Shadowing locals have non-stdlib symbols and keep
      // the ordinary path.
      {
        const g = stdlibGlobalNameOf(L, expr.expression);
        if (g !== null) {
          const answer = stdlibGlobalTypeOfAnswer(L, g, L.typeOf(expr.expression));
          if (answer !== null) return { kind: "strLit", value: answer, type: STRING, loc };
        }
      }
      if (ts.isIdentifier(expr.expression)) {
        const sym = L.checker.getSymbolAtLocation(expr.expression);
        // `typeof window` / `typeof define` — a name NOTHING in the program
        // binds. This is the one read of an undeclared name JavaScript does
        // not throw on, and its answer is fixed: "undefined". The operand
        // has no value to lower (a bare read of the same name IS the
        // ReferenceError), so folding is not an optimization — it is the
        // only lowering the expression has.
        //
        // "Nothing binds it" is the checker's answer, not a guess: an
        // identifier the checker resolves to no symbol at all has no
        // declaration in any program file, no ambient declaration, and no
        // lib declaration. Every source language reports that as a hard
        // type error before a build gets here; what reaches this fold is
        // the provenance lane, where a vendored bundle's environment sniff
        // (`"undefined" != typeof window && window`, the UMD prologue's
        // `"function" == typeof define && define.amd`) is compiled against
        // types that deliberately do not declare a browser. Node running
        // the same bundle answers "undefined" too, which is why the sniff
        // is written this way.
        if (sym === undefined) {
          return { kind: "strLit", value: "undefined", type: STRING, loc };
        }
      }
      // Island values ask the engine; static primitives constant-fold to
      // the JS answer (the operand still evaluates — JS evaluates typeof
      // operands too — but primitives here are side-effect-free varRefs/
      // literals after lowering, so folding away the value is safe only
      // when the operand is trivial; otherwise keep it simple and reject).
      let operand = L.lowerExpr(expr.expression);
      if (operand.type.kind === "jsval") {
        return { kind: "jsOp", op: "typeof", args: [operand], type: STRING, loc };
      }
      // A checker-narrowed dyn read arrives as a VALIDATED extraction
      // (maybeNarrow's dynCheck bridge). typeof needs no extraction — the
      // dyn kind table answers the question directly, and answers it even
      // where the flow type lied (the extraction would throw instead) —
      // so unwrap back to the dyn value and take the dyn.typeof path.
      if (operand.kind === "dynCheck" && operand.value.type.kind === "dyn") {
        operand = operand.value;
      }
      // An index-signature keyed read in typeof position is the PRESENCE
      // TEST idiom. zapo's WaBotCoordinator.ts:204 --
      // `typeof section.attrs.name === 'string' ? section.attrs.name : undefined`
      // -- is asking whether the key is there at all. The checker types the
      // read by the signature's VALUE type, so at that width a MISS has
      // nowhere to go and ABORTS ("record has no key 'name' (typed 'string'
      // -- no undefined is representable)") on precisely the input the guard
      // exists to reject. Read it at the undefined-armed width instead: the
      // rung `recordKeyReadAtUndefinedArm` already offers `??`'s right
      // operand for the same stated reason -- that consumer "is asking
      // whether there is a value at all" -- and typeof is the purest form
      // of that question.
      //
      // The test that says this is right rather than merely more permissive:
      // the BOUND spelling already answers "undefined" here. `const jid =
      // node.attrs.jid; typeof jid !== 'string'` is the very next line of
      // the same zapo function and it compiles and answers Node-exactly
      // today, because the declaration's slot carries the undefined arm.
      // So this makes the DIRECT spelling agree with the bound spelling --
      // which is the spelling the fence's own hint was telling authors to
      // write. Where the rung declines (a declared field, a non-index
      // shape, a read already undefined-armed) nothing changes.
      if (operand.kind === "recordKeyGet") {
        const armedT = L.withUndefinedArmOf(operand.type);
        const armed = armedT ? L.recordKeyReadAtUndefinedArm(operand, armedT) : null;
        if (armed) operand = armed;
      }
      const FOLD: Partial<Record<string, string>> = {
        f64: "number", string: "string", bool: "boolean", func: "function",
        array: "object", object: "object", record: "object",
        symbol: "symbol",
        map: "object", set: "object", promise: "object", bytes: "object",
        regexp: "object", generator: "object", classval: "function",
        undefinedT: "undefined", nullT: "object",
      };
      const folded = FOLD[operand.type.kind];
      if (folded && droppableStatic(operand)) {
        return { kind: "strLit", value: folded, type: STRING, loc };
      }
      // The ANSWER is static but the OPERAND is not droppable: `typeof
      // decodeLength(buf)`, `typeof makeTag()`. JS evaluates a typeof
      // operand exactly like any other expression and only then reports its
      // type, so the answer is the same interned string the fold above
      // returns -- all the effectful case needs is somewhere to put the
      // evaluation, and `seqExpr` is that place. It is the shape the COMMA
      // operator already builds for this exact job ("left runs for effect,
      // right is the value" -- lowerBinary's CommaToken arm), and the one
      // value-position `void e` was fenced for want of: "the effect would
      // need to sequence before it, which no expression shape carries".
      // It does carry it, 9 700 lines further down the same file.
      //
      // The statement is an `exprStmt` over the ALREADY-LOWERED operand --
      // re-lowering the syntax would run every lowering side effect twice,
      // and `exprStmt` is in seqExprSafeStmt's straight-line set, so no
      // seqExpr region rule is bent. Purely additive: this arm only runs
      // where `droppableStatic` said no and the code below therefore
      // called `unsupported`. Operands whose TYPE has no static answer
      // (jsval, dyn, union) never reach here -- they are answered above,
      // and their own fences are untouched.
      if (folded) {
        return {
          kind: "seqExpr",
          stmts: [{ kind: "exprStmt", expr: operand, loc }],
          result: { kind: "strLit", value: folded, type: STRING, loc },
          type: STRING,
          loc,
        };
      }
      // A union operand: every arm's typeof answer is static, so the value
      // form is a ternary chain over runtime TAG tests (arms grouped by
      // answer; the last group needs no test). The operand rides several
      // tests, so only side-effect-free reads compose — and when every arm
      // agrees the whole expression folds to that one string (dropping only
      // the pure read, the trust-the-checker bet lowerUnitComparison makes).
      if (operand.type.kind === "union") {
        const def = L.unions.get(operand.type.unionId);
        const answers = def?.arms.map(typeofAnswer);
        if (def && answers && answers.every((s): s is string => s !== null)) {
          const groups = new Map<string, number[]>();
          answers.forEach((s, i) => groups.set(s, [...(groups.get(s) ?? []), i]));
          const ordered = [...groups.entries()];
          // An operand that is not a pure re-emittable read rides the tag
          // chain once per answer GROUP, so it is BOUND first and the chain
          // reads the binding -- literally "bind the value to a const
          // first", the advice the fence below used to give the author,
          // performed by the lowering. seqExpr carries the binding (the
          // comma operator's shape) and declareHiddenLocal's `%` name puts
          // the local in seqScopedLocals, so its live range ends with the
          // region and no unwind path grows. One answer group needs no
          // binding at all -- the operand still evaluates, for effect.
          const stmts: IrStmt[] = [];
          let src: IrExpr = operand;
          if (!pureReemittable(operand)) {
            if (ordered.length === 1) {
              stmts.push({ kind: "exprStmt", expr: operand, loc });
            } else {
              const tmp = L.declareHiddenLocal("%typeofArm", operand.type);
              stmts.push({ kind: "varDecl", localId: tmp.id, init: operand, loc });
              src = { kind: "varRef", localId: tmp.id, type: operand.type, loc };
            }
          }
          let result: IrExpr = { kind: "strLit", value: ordered[ordered.length - 1]![0], type: STRING, loc };
          for (const [answer, tags] of ordered.slice(0, -1).reverse()) {
            let test: IrExpr = { kind: "unionIsTag", unionId: operand.type.unionId, tag: tags[0]!, negated: false, value: src, type: BOOL, loc };
            for (const t of tags.slice(1)) {
              test = { kind: "logical", op: "||", left: test, right: { kind: "unionIsTag", unionId: operand.type.unionId, tag: t, negated: false, value: src, type: BOOL, loc }, type: BOOL, loc };
            }
            result = { kind: "ternary", cond: test, then: { kind: "strLit", value: answer, type: STRING, loc }, else_: result, type: STRING, loc };
          }
          return stmts.length === 0 ? result : { kind: "seqExpr", stmts, result, type: STRING, loc };
        }
      }
      if (operand.type.kind === "dyn") {
        // Bare typeof on a dyn value: the runtime's kind→string table
        // (null answers "object", boxed closures "function" — JS-exact
        // for every dyn kind; "bigint"/"symbol" have no producers).
        return { kind: "libCall", fn: "dyn.typeof", args: [operand], type: STRING, loc };
      }
      L.unsupported("SC1090", expr, "typeof expressions on statically-typed values");
    }
    if (ts.isIdentifier(expr)) {
      if (L.isSelfReference(expr)) {
        return { kind: "selfRef", type: L.ctx.selfType!, loc };
      }
      // `arguments` in a variadic JS function (the rest-marked form): the
      // synthetic trailing dyn-array param — lambdaSignature marked the
      // type and lowerLambda declared the local. Inside an ARROW the same
      // name is the ENCLOSING function's object (an arrow has none of its
      // own), which resolveArgumentsLocal reaches by capturing that slot.
      if (expr.text === "arguments") {
        const argsLocal = L.resolveArgumentsLocal(expr);
        if (argsLocal) return { kind: "varRef", localId: argsLocal.id, type: DYN, loc };
      }
      // A `const x = promisify(execFile)` binding as a VALUE: the
      // promisified function never exists at runtime (its calls lower to
      // the interned async-exec helper) — call it directly.
      {
        const sym = L.resolveValueSymbol(expr);
        if (sym && L.promisifiedExecFile.has(sym)) {
          L.unsupported(
            "SC1090",
            expr,
            `a promisified execFile as a value (call '${expr.text}' directly)`,
          );
        }
      }
      // The same story for a runtime-chosen module namespace: the slot
      // holds the SELECTOR, so every use that is not a member call on it
      // fences by name rather than reading a bool where Node reads a
      // module object.
      {
        const sym = L.checker.getSymbolAtLocation(expr);
        if (sym) fenceNamespaceConditionalValue(L, expr, sym);
      }
      // Union-typed bindings read through tsc's control-flow narrowing:
      // when the checker types this USE as a single arm, maybeNarrow
      // bridges the tagged representation with a unionNarrow.
      const local = L.resolveLocal(expr);
      if (local) {
        if (local.type.kind === "caught") return L.caughtRead(expr, local, loc);
        return L.maybeNarrow({ kind: "varRef", localId: local.id, type: local.type, loc }, expr);
      }
      // `import x = N.y` aliases resolve transparently through globalOf/
      // fnSigOf below; their source-order guards live here (a no-op for
      // every non-import= binding — see lower-namespaces.ts).
      fenceEarlyAliasUse(L, expr, expr);
      const g = L.globalOf(expr);
      if (g) {
        // A global typed by a class that never REGISTERED (its collection
        // fenced): the initializing assignment never lowered, so the read
        // can only observe garbage — and the emitter would name a struct
        // that does not exist. The blocked-binding cascade names the use;
        // without this the validator's registration check ICEs on the live
        // reference (`@this {T}` inference — signature 07).
        if (L.typeNamesUnregisteredClass(g.type)) {
          L.pushDiag(blockedBindingUseDiag(expr.text, loc));
          throw new PoisonError();
        }
        return L.maybeNarrow({ kind: "varRef", localId: g.id, type: g.type, loc }, expr);
      }
      // `undefined` — tsc's intrinsic global (a local shadowing the name
      // resolved above): a unit literal, exactly like the `null` keyword.
      if (expr.text === "undefined" && L.typeOf(expr).flags & ts.TypeFlags.Undefined) {
        return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc };
      }
      // `__dirname` / `__filename` — the CommonJS module globals: per-
      // MODULE compile-time constants, the containing file's REAL
      // location (Node's exact values when the same tree runs in place;
      // locals shadowing the names resolved above). In a file with ESM
      // syntax Node never defines them (ReferenceError) — fence rather
      // than invent a value there.
      if (
        (expr.text === "__dirname" || expr.text === "__filename") &&
        L.isStdlibGlobal(expr, expr.text)
      ) {
        const sf = expr.getSourceFile();
        if (isNodeEsmFile(sf)) {
          L.unsupported(
            "SC1090",
            expr,
            `'${expr.text}' in an ES module (Node defines the CJS module globals only in CommonJS modules)`,
          );
        }
        const value = expr.text === "__dirname" ? dirname(sf.fileName) : sf.fileName;
        return { kind: "strLit", value, type: STRING, loc };
      }
      const sig = L.fnSigOf(expr);
      if (sig && L.isTopLevelFnSymbol(expr)) {
        // A declared function used as a value: a zero-capture closure. The
        // backend interns one per function so `f === f` holds (JS identity).
        // The value's type is the completed ABI signature — exact-arity, so
        // optional/default/rest declarations pass the value fence first.
        L.noteEdge(sig.name);
        // dynRest slots stay out of the VALUE type's param list (fn.length
        // semantics); the rest marker carries the trailing dyn-array ABI.
        const funcType: IrType = {
          kind: "func",
          params: sig.params.filter((p) => p.mode !== "dynRest").map((p) => p.type),
          ret: sig.returnType,
          ...(sig.params.some((p) => p.mode === "dynRest") ? { rest: true as const } : {}),
        };
        L.requireExactArityValue(expr, expr, sig.params, funcType);
        return { kind: "closure", fnName: sig.name, captures: [], type: funcType, loc };
      }
      {
        // A generic function as a VALUE: monomorphized by flow — the
        // reference's pinned concrete signature (contextual type or an
        // instantiation expression) names the instance; unpinned
        // references fence inside (lowerGenericFnValue).
        const gfn = L.genericFnOf(expr);
        if (gfn) return L.lowerGenericFnValue(expr, gfn);
      }
      // A CJS export-table ACCESSOR read (`tmpdir.path`, or a destructured
      // binding aliasing one): the getter is a real function of module
      // scope — its body reads module globals, so it lifts like a lambda
      // (interned per declaration) and every read is a call. Node runs the
      // getter per read; so does this.
      {
        const acc = cjsExportAccessorRead(L, expr);
        if (acc) return acc;
      }
      // A binding destructured from a baked constants object
      // (http2.constants / crypto.constants): the literal — the
      // declaration emitted nothing (builtinConstantsDestructureDecl).
      {
        const h2c = L.builtinConstantBindingOf(expr);
        if (h2c) return h2c;
      }
      // Builtin-module import bindings: constants (path.sep, os.EOL) read
      // as interned string literals; functions have no closure
      // representation (they lower to libCall at call sites only); members
      // with no lowering at all fence with the module-qualified name.
      {
        const bi = L.builtinImportOf(expr);
        if (bi) {
          const c = builtinModuleConstOf(L, bi.module, bi.member);
          if (c !== undefined) return builtinConstLit(c, loc);
          // module.builtinModules — the baked Node v24 list, a fresh
          // string[] per read.
          if (bi.module === "module" && bi.member === "builtinModules") {
            return builtinModulesArrayLit(loc);
          }
          // tls.rootCertificates: a runtime-valued module constant (the
          // cached bundled-CA array) — the one member read that lowers
          // to a libCall instead of a baked literal.
          {
            const roots = lowerTlsRootCertificates(L, bi, loc);
            if (roots) return roots;
          }
          // crypto.diffieHellman taken as a VALUE (`const dhWithCb =
          // diffieHellman as ...` — the callback-probe binding in the X25519
          // module): a lifted closure over the same key.dh agreement the
          // CALL form lowers to. It is only bound and fed to promisify in a
          // branch a synchronous DH never takes, but the binding runs at
          // module init, so the value needs a representation.
          if (bi.module === "crypto" && bi.member === "diffieHellman") {
            return diffieHellmanFnValue(L, loc);
          }
          // JavaScript sources: a builtin member taken as a bare VALUE is
          // the same identity-token story as stdlib globals above (the
          // harness adds worker_threads.Worker to its identity Set).
          if (isJsSourceFile(expr.getSourceFile())) {
            return { kind: "strLit", value: `[builtin ${bi.module}.${bi.member}]`, type: STRING, loc };
          }
          // (The shape-probing diffieHellman lift that used to sit here was
          // DEAD: the branch above returns unconditionally for the same
          // `crypto.diffieHellman` test, so nothing ever reached it. Its
          // `getCallSignatures(...).length !== 1` guard read like the reason
          // this surface fenced under real @types/node -- which declares two
          // signatures -- and it was not: the fence is on the BINDING's type,
          // not on the reference. Removed so the next reader measures instead
          // of patching a function with no callers.)
          if (builtinModuleFnOf(L, bi.module, bi.member)) {
            L.unsupported(
              "SC1090",
              expr,
              `library functions as values (call '${expr.text}' directly)`,
            );
          }
          L.noLowering(
            `${bi.module}.${bi.member}`,
            expr,
            builtinFenceHintOf(bi.module, bi.member),
            L.resolveValueSymbol(expr),
          );
        }
      }
      // A builtin namespace import used as a bare VALUE (`const f = fs`):
      // the namespace object has no representation — members lower at
      // their access sites only. The CommonJS namespace binding
      // (`const lib = require("./lib.js")`) gets the same fence.
      if (L.builtinNamespaceModuleOf(expr) !== null || L.cjsLocalModuleBindingOf(expr)) {
        L.unsupported(
          "SC1090",
          expr,
          `module namespace objects as values (access '${expr.text}' members directly)`,
        );
      }
      if (L.islandGlobalFnOf(expr)) {
        // Island-backed functions have no closure representation (they
        // lower to engine ops at call sites only).
        L.unsupported(
          "SC1090",
          expr,
          `library functions as values (call '${expr.text}' directly)`,
        );
      }
      // npm import bindings in a STATIC build: the binding's value lives
      // in the embedded engine — the per-package requires-dynamic
      // diagnostic, not the generic fallthrough. (Under --dynamic these
      // resolve as jsval globals above.)
      if (!L.dynamic) {
        const pkg = L.npmPackageOfSymbol(L.resolveValueSymbol(expr) ?? undefined);
        if (pkg) {
          L.pushDiag(requiresDynamicPackageDiag(pkg, loc));
          throw new PoisonError();
        }
      }
      // Bindings imported from an UNSUPPORTED builtin module: coverage
      // analyzes past import fences, so uses of `spawn` from
      // child_process reach lowering — the use site reports the same
      // "the '<module>' module" diagnostic as the import line, and the
      // report groups them into one blocker. (Builds never get here: the
      // import already failed preflight.)
      {
        const spec = L.fencedBuiltinImportOf(expr);
        if (spec !== null) {
          L.pushDiag(unsupportedDiag("SC1010", loc, unsupportedModuleFeatureOf(spec)));
          throw new PoisonError();
        }
      }
      // The globals `Infinity` and `NaN` (lib-declared, provenance-checked
      // like every stdlib name): non-finite numLits — `-Infinity` arrives
      // through the unary-minus literal fold. Arithmetic, comparisons, and
      // formatting are IEEE-exact in C (String(Infinity) is "Infinity" and
      // String(NaN) is "NaN" in the number formatter; `NaN !== NaN` holds
      // because f64 compares are IEEE compares).
      if (expr.text === "Infinity" || expr.text === "NaN") {
        const sym = L.checker.getSymbolAtLocation(expr);
        if (L.isStdlibSymbol(sym)) {
          return { kind: "numLit", value: expr.text === "NaN" ? NaN : Infinity, type: F64, loc };
        }
      }
      // The primitive constructors as VALUES (`const f = String`, an
      // option table's `type: Boolean` field, `opt.type === Number`): the
      // interned coercion closure — one synthesized module function per
      // constructor per program, so every reference is the SAME zero-
      // capture closure and `===` is JS identity (the type mapping in
      // types.ts pins the one concrete signature `(value: string) =>
      // primitive`; direct calls `String(x)` never reach here — the call
      // lowering intercepts them with the wider static coercions).
      // JavaScript sources keep the identity-token path below.
      if (
        (expr.text === "String" || expr.text === "Number" || expr.text === "Boolean") &&
        !isJsSourceFile(expr.getSourceFile()) &&
        L.isStdlibSymbol(L.checker.getSymbolAtLocation(expr))
      ) {
        return primitiveCtorClosure(L, expr.text, loc);
      }
      // The lib fence's IDENTIFIER chokepoint: the real standard library
      // resolves names the old minimal ambient world never declared
      // (Symbol, Reflect, Infinity, Date, ...) — and the adopted
      // @types/node resolves its whole global surface (Buffer, fetch,
      // setInterval, URL, ...). Reaching one that no lowering above
      // claimed is SC2020, never an ICE — EXCEPT in JavaScript sources,
      // where a stdlib global taken as a VALUE (never called through this
      // path — call sites lower earlier) becomes an opaque IDENTITY TOKEN:
      // an interned string naming the global. Identity flows (the
      // harness's knownGlobals Set, === comparisons) are exact — one
      // global, one token; what a token cannot do (be called, answer
      // typeof "function") meets per-site fences/divergences, and
      // SEMANTICS.md documents the stance.
      {
        const sym = L.checker.getSymbolAtLocation(expr);
        if (L.isStdlibSymbol(sym) || expr.text === "globalThis") {
          if (isJsSourceFile(expr.getSourceFile())) {
            const canonical = stdlibGlobalNameOf(L, expr) ?? expr.text;
            return (
              ctorObjectGlobalValue(L, canonical, loc) ??
              { kind: "strLit", value: `[builtin ${canonical}]`, type: STRING, loc }
            );
          }
          // The families with a WHY: each hint states what makes the
          // surface genuinely non-static (or what to use instead).
          const globalHints: Record<string, string | undefined> = {
            BigInt: "arbitrary-precision integers have no static representation — f64 is the one number type (Number.MAX_SAFE_INTEGER bounds exact integers)",
            Proxy: "property-access metaprogramming has no static lowering (every property read must resolve at compile time)",
            Reflect: "reflective property access has no static lowering — read and call members directly",
            Intl: "locale- and ICU-backed behavior lives outside the static runtime (the localeCompare stance: code-unit order, no collation/locale data) — what lowers: the composed new Intl.NumberFormat(\"en-US\").format(x) and x.toLocaleString(\"en-US\") with default options",
            SharedArrayBuffer: "no shared-memory threads exist in a compiled program — Uint8Array is the byte storage",
            ArrayBuffer: "no free-standing ArrayBuffer value exists — typed arrays own their storage (new Uint8Array(n) allocates; new Uint8Array(new ArrayBuffer(n)) erases the buffer into the view)",
            WeakRef: "deref()-after-collect exposes GC timing — genuinely dynamic; hold a strong reference instead",
            FinalizationRegistry: "finalization callbacks expose GC timing — genuinely dynamic; release resources explicitly instead",
            eval: "runtime code evaluation cannot be compiled ahead of time",
          };
          L.noLowering(expr.text, expr, globalHints[expr.text], sym ?? undefined);
        }
      }
      // `declare const __VERSION__: string` — an ambient global NOTHING
      // defines (a bundler define in the real pipeline; scriptc has no
      // define mechanism, and neither does Node running the source —
      // the oracle). The read compiles to exactly what Node does at the
      // access: the catchable ReferenceError "<name> is not defined".
      // Stdlib/@types/node ambients never reach here (their chokepoint
      // is above); only user-file declares do.
      //
      // NOT an export of a declaration MODULE (declModuleWithoutTwin):
      // every declaration inside a `.d.ts` carries the Ambient flag, so
      // the modifier alone cannot tell "nothing defines this name" from
      // "the implementation ships in the file beside it". Node loads that
      // file and the value IS defined, so the erasure stance would answer
      // a WRONG value here — and say nothing while doing it. The fence
      // below names the real cause instead.
      {
        const sym = L.resolveValueSymbol(expr);
        const decl = sym ? L.checker.declarationsOf(sym)[0] : undefined;
        if (
          sym !== null &&
          decl !== undefined &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer === undefined &&
          ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Ambient &&
          !L.declTwinCompiled(decl.getSourceFile()) &&
          declModuleWithoutTwin(L, sym) === null
        ) {
          const declared = L.mapTypeOf(L.typeOf(expr));
          if (declared && declared.kind !== "void") {
            return {
              kind: "libCall",
              fn: "global.undefRead",
              args: [{ kind: "strLit", value: expr.text, type: STRING, loc }],
              type: declared,
              loc,
            };
          }
        }
      }
      // An ambient `declare function` nothing defines, taken as a VALUE
      // (call sites lower earlier, in lowerCall): the same story as the
      // ambient `declare const` above — Node erases the declaration and
      // the read throws the catchable ReferenceError at the access.
      {
        if (ambientUndefinedFnSymbolOf(L, expr)) {
          const t = ambientUndefReadType(L, expr);
          if (t) return nsUndefRead(L, expr.text, expr, t);
        }
      }
      // A read of a TRAP binding — a declaration whose own initializer
      // provably threw (module init unwound there), so this reference can
      // never execute: any lowering is sound, and the trap keeps the
      // shape honest. Typed by the use site when it maps, the F64 dummy
      // otherwise (never observed — never even reached).
      {
        const sym = L.resolveValueSymbol(expr);
        if (sym !== null && L.trapBindings.has(sym)) {
          const t = ambientUndefReadType(L, expr) ?? contextualUndefReadType(L, expr) ?? F64;
          return nsUndefRead(L, expr.text, expr, t);
        }
      }
      // A program CLASS NAME as a value: the classRef over the class's
      // immortal class object (member accesses and construction never
      // reach here — their hooks claim the property/new forms first).
      {
        const sym = L.resolveValueSymbol(expr);
        const classInfo = sym ? L.classBySymbol.get(sym) : undefined;
        // A GENERIC class name whose CONTEXTUAL type pins one instantiation
        // (`const B: new (v: string) => Counter<string> = Counter`): the
        // value is that instantiation's class object — the generic-fn
        // pinning rule on the static side. Unpinned references fall
        // through to classValueRef's family fence.
        if (classInfo?.generic) {
          const ctxT = L.checker.getContextualType(expr);
          const mapped = ctxT ? L.mapTypeOf(ctxT) : null;
          const instInfo = mapped?.kind === "classval" ? L.classes.get(mapped.className) : undefined;
          if (instInfo && instInfo.genericInstance?.family === classInfo) {
            return L.classValueRef(instInfo, expr);
          }
        }
        if (classInfo) {
          // A decorated name a replacing decorator can REBIND: the value
          // is the decoration result — the mutable classval global %init
          // assigned at the class statement (TC39's name binding), never
          // the declaration's own class object.
          const decoratedGlobal = classInfo.classDecorators?.valueGlobalId;
          if (decoratedGlobal !== undefined) {
            return {
              kind: "varRef",
              localId: decoratedGlobal,
              type: { kind: "classval", className: classInfo.def.name },
              loc,
            };
          }
          return L.classValueRef(classInfo, expr);
        }
        // The enum OBJECT as a value (member reads never reach here — the
        // access hooks fold them): iteration, storage, reverse lookups
        // through variables all land on this pointed fence.
        if (sym) fenceEnumObjectValue(L, expr, sym);
        // A MIXIN function as a first-class value: no runtime function
        // exists — calls instantiate a class per call site
        // (lower-mixins.ts). Generic mixins took the generic-fn value
        // fence above; this names the non-generic spelling.
        if (mixinFnOfCallee(L, expr)) {
          L.unsupported(
            "SC1090",
            expr,
            `the mixin function '${expr.text}' as a value (mixin calls compile per call site — call it directly)`,
          );
        }
      }
      // A NAMESPACE object as a first-class value: members lower at their
      // qualified access sites; the object itself has no runtime
      // representation (ambient namespaces compile to Node's
      // ReferenceError instead — the object never exists at runtime).
      {
        const ns = lowerNsIdentifierValue(L, expr);
        if (ns) return ns;
      }
      // Preflight guarantees no unresolved identifiers; anything else here
      // is a blocked declaration's binding (the SC2004 cascade) or a
      // binding form we don't model yet.
      // A binding declared in a `.d.ts` whose runtime twin is compiled
      // here: the import resolved to the DECLARATION, which owns no
      // storage, while the twin holds it initialized and in the shape
      // this declaration gave it.
      {
        const twinSym = L.resolveValueSymbol(expr);
        const twinG = twinSym ? declTwinGlobalOf(L, twinSym) : undefined;
        if (twinG) return { kind: "varRef", localId: twinG.id, type: twinG.type, loc };
        // ...and the same binding when the twin is NOT compiled: the
        // declaration module claims a value whose implementation this
        // build never saw. That is precisely what the method-call fence
        // reports (uncompilableExternMethodTrap), so it reports it in the
        // same words — one cause, one message, whether the binding is
        // reached by a call or read as a value.
        const declHome = twinSym ? declModuleWithoutTwin(L, twinSym) : null;
        if (declHome !== null) {
          declModuleFenceCount++;
          if (process.env["SCRIPTC_DTSTWIN_WHY"] !== undefined) {
            process.stderr.write(
              `DTSTWIN fence#${declModuleFenceCount} '${expr.text}' <- ${declHome.fileName} @ ${loc.file}+${loc.start}\n`,
            );
          }
          // Named RELATIVE to the file that referred to it: the absolute
          // path of a generated declaration is a content-addressed cache
          // path in the builds where this fires, and the relative one is
          // both shorter and machine-independent.
          const where = relative(dirname(expr.getSourceFile().fileName), declHome.fileName)
            .replaceAll("\\", "/");
          L.unsupported(
            "SC1090",
            expr,
            `the reference to '${expr.text}' (it has no compiled implementation — its module ` +
              `'${where.startsWith(".") ? where : `./${where}`}' ships only a declaration file)`,
          );
        }
      }
      L.rejectUnresolved(expr, `the reference to '${expr.text}' (a binding form with no lowering)`);
    }
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      return L.lowerLambda(expr);
    }
    // `class {…}` in expression position: a class definition plus a
    // classRef over it (top-level evaluation positions only — each
    // evaluation mints a distinct class in JS, and the immortal class
    // object is exact exactly when the expression evaluates once).
    if (ts.isClassExpression(expr)) {
      return L.lowerClassExpression(expr);
    }
    // `identity<number>` / `Box<number>` — an INSTANTIATION EXPRESSION (a
    // generic function or class reference with explicit type arguments, in
    // value position): the expression's own checker type is the
    // substituted signature, so it pins the instance like a
    // contextually-typed reference. For a generic CLASS the value is the
    // instantiation's class object (classRef — construction, statics,
    // identity and instanceof through it ride the classval machinery).
    if (ts.isExpressionWithTypeArguments(expr) && ts.isIdentifier(expr.expression)) {
      const gfn = L.genericFnOf(expr.expression);
      if (gfn) return L.lowerGenericFnValue(expr, gfn);
      const clsSym = L.resolveValueSymbol(expr.expression);
      const cls = clsSym ? L.classBySymbol.get(clsSym) : undefined;
      if (cls?.generic) {
        const t = L.typeOf(expr);
        const mapped = L.mapTypeOf(t);
        const instInfo = mapped?.kind === "classval" ? L.classes.get(mapped.className) : undefined;
        if (!instInfo) L.badType(expr, t);
        return L.classValueRef(instInfo, expr);
      }
    }
    if (expr.kind === ts.SyntaxKind.ThisKeyword) {
      // Only arrows can see an enclosing method's `this` (JS lexical-this);
      // `this` in plain nested functions is already a tsc error under
      // noImplicitThis, so the generic scope walk here is preflight-safe.
      const local = L.resolveThis();
      if (local) return { kind: "varRef", localId: local.id, type: local.type, loc };
      // `this` in a plain JS FUNCTION (not a method): the AMBIENT
      // RECEIVER (libCall dyn.this — scr_dyn_this_get). Firing sites bind
      // the emitting handle around each listener call (Node calls
      // listeners with `this` === the server/socket/req/res:
      // `server.listen(0, function() { this.address().port })`), dyn OBJ
      // method dispatch binds the object, and apply/call bind their
      // thisArg — so the wrapper idiom `fn.apply(this, arguments)`
      // (test/common's mustCall) forwards the receiver. With no binding
      // the read answers the strict-mode plain-call undefined, the old
      // constant. TypeScript keeps the fence (noImplicitThis makes it a
      // compile-time story there).
      if (isJsSourceFile(expr.getSourceFile())) {
        return { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc };
      }
      L.unsupported("SC1080", expr);
    }
    if (expr.kind === ts.SyntaxKind.SuperKeyword) {
      // super(...) and super.method(...) are handled at their call sites;
      // any other super position (field reads, bare references) stays out.
      L.unsupported("SC1090", expr, "'super' outside super() and super.method() calls");
    }
    if (ts.isNewExpression(expr)) return L.lowerNew(expr);
    if (ts.isAwaitExpression(expr)) {
      if (!L.ctx.isAsync) {
        // A tsc-clean occurrence here is outside both an async function
        // and an async module initializer. CommonJS/script files are
        // normally rejected by tsc before lowering; keep the defensive
        // boundary for malformed/upstream ASTs.
        L.unsupported("SC1090", expr, "top-level await (await outside async functions)");
      }
      const value = L.lowerExpr(expr.expression);
      // A promise-or-absent union (`Promise<T> | undefined` values, calls
      // of `(...) => Promise<void> | void` callbacks): the await handles
      // both arms — the promise arm parks like any await, a unit arm takes
      // exactly one microtask hop (JS: await of a non-thenable) and yields
      // itself. The result is void when the inner is void and the only
      // unit is undefined; otherwise the union of the inner type and the
      // unit arms — what the checker types the await as.
      if (value.type.kind === "union") {
        const def = L.unions.get(value.type.unionId);
        const promiseTag = def ? def.arms.findIndex((a) => a.kind === "promise") : -1;
        if (
          def &&
          promiseTag >= 0 &&
          def.arms.every((a, i) => i === promiseTag || isUnitType(a))
        ) {
          const promiseArm = def.arms[promiseTag]!;
          const inner = promiseArm.kind === "promise" ? promiseArm.inner : VOID;
          const units = def.arms.filter(isUnitType);
          if (inner.kind === "union" || inner.kind === "dyn" || inner.kind === "jsval") {
            // A union inner would need an arm-wise re-tag into the result
            // union; dyn/jsval inners have their own boundary stories.
            L.unsupported(
              "SC1090",
              expr,
              `awaiting '${L.fmt(value.type)}' (the promise's inner type has no combined result union — await the promise arm after narrowing instead)`,
            );
          }
          let type: IrType;
          if (inner.kind === "void" && units.every((u) => u.kind === "undefinedT")) {
            type = VOID;
          } else if (inner.kind === "void") {
            // `Promise<void> | null`: the result would mix undefined and
            // null units with no non-unit arm — degenerate; keep it out.
            L.unsupported(
              "SC1090",
              expr,
              `awaiting '${L.fmt(value.type)}' (narrow the null away first)`,
            );
          } else {
            const arms = [inner, ...units];
            arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
            type = { kind: "union", unionId: L.unions.intern(arms) };
          }
          return { kind: "awaitUnionExpr", value, promiseTag, type, loc };
        }
        // The SETTLE-OR-VALUE contract — `Promise<T> | T`, and the
        // union-payload form `Promise<T | null> | T | null`. `await` is the
        // only consumer such a union has, and it needs no narrowing test:
        // the union's own TAG picks the branch. The builder lives on the
        // Lowerer because promiseCoerceAdapter needs the same shape for a
        // payload that is itself one of these unions.
        {
          const settled = L.settleOrValueAwait(value, loc);
          if (settled) return settled;
        }
      }
      if (value.type.kind !== "promise") {
        // A CHECKED-DYNAMIC operand (`await v` where v rode an untyped
        // binding — a destructured helper's return, a dyn call result):
        // the runtime decides — a dyn promise adopts (rejections
        // re-throw), anything else takes JS's one-hop non-thenable await
        // and answers itself. Thenable adoption stays unmodeled
        // (SEMANTICS.md).
        if (value.type.kind === "dyn") {
          return { kind: "libCall", fn: "async.awaitDyn", args: [value], type: DYN, loc };
        }
        // A jsval whose CHECKER type is a promise is a package-returned
        // promise: the value lives in the engine. Bridge it — a static
        // promise the engine promise settles (fulfillment = the retained
        // handle or void, rejection = the bridged reason) — and await
        // THAT: the fiber parks like any await, resumes with the settled
        // jsval, or re-throws the crossed rejection.
        if (value.type.kind === "jsval") {
          // ANY island value bridges — the runtime's Promise.resolve(v)
          // .then(...) wiring awaits thenables and non-thenables exactly
          // like JS (`await reg.load()` where the checker only knows
          // 'any' must still park on the returned engine promise).
          const mapped = L.mapTypeOf(L.typeOf(expr.expression));
          const inner: IrType = mapped?.kind === "promise" && mapped.inner.kind === "void" ? VOID : JSVAL;
          const bridged: IrExpr = {
            kind: "jsBridgePromise",
            value,
            type: { kind: "promise", inner },
            loc,
          };
          return { kind: "awaitExpr", value: bridged, type: inner, loc };
        }
        // A TYPED non-promise operand (`await 42`, an awaited record):
        // JS awaits non-thenables through exactly one microtask turn and
        // yields the value itself — evaluate the operand, hop, answer it.
        // Void operands (an awaited void call) hop and stay void.
        if (value.type.kind === "void") {
          return {
            kind: "seqExpr",
            stmts: [{ kind: "exprStmt", expr: value, loc }],
            result: { kind: "libCall", fn: "async.hop", args: [], type: VOID, loc },
            type: VOID,
            loc,
          };
        }
        // A bare-UNIT operand (`await null`, `await undefined` — the
        // async-hooks tests' turn-forcing idiom): same one-hop non-thenable
        // await, but a bare unit has no standalone representation (locals
        // and results may not carry bare unit types) — the value rides the
        // unit-only union, its literal wrapping into the matching arm (the
        // `const x = null` slot rule).
        if (isUnitType(value.type)) {
          const uT = unitOnlyUnion(L.unions);
          const wrapped = L.coerceToExpected(value, uT);
          const vLocal = L.declareHiddenLocal("%awaited", uT);
          return {
            kind: "seqExpr",
            stmts: [
              { kind: "varDecl", localId: vLocal.id, init: wrapped, loc },
              {
                kind: "exprStmt",
                expr: { kind: "libCall", fn: "async.hop", args: [], type: VOID, loc },
                loc,
              },
            ],
            result: { kind: "varRef", localId: vLocal.id, type: uT, loc },
            type: uT,
            loc,
          };
        }
        {
          const vLocal = L.declareHiddenLocal("%awaited", value.type);
          return {
            kind: "seqExpr",
            stmts: [
              { kind: "varDecl", localId: vLocal.id, init: value, loc },
              {
                kind: "exprStmt",
                expr: { kind: "libCall", fn: "async.hop", args: [], type: VOID, loc },
                loc,
              },
            ],
            result: { kind: "varRef", localId: vLocal.id, type: value.type, loc },
            type: value.type,
            loc,
          };
        }
      }
      return { kind: "awaitExpr", value, type: value.type.inner, loc };
    }
    if (ts.isYieldExpression(expr)) return lowerYield(L, expr);
    // `delete o.k` is an OPERATOR, not a statement form: it evaluates to
    // a boolean, and a minifier writes every guarded delete that way
    // (`k !== name && delete this[k]`).
    if (ts.isDeleteExpression(expr)) return L.lowerDeleteValue(expr);
    if (ts.isPrefixUnaryExpression(expr)) return L.lowerPrefixUnary(expr);
    // `x++` / `x--` in expression position: yields the OLD value.
    if (ts.isPostfixUnaryExpression(expr)) return lowerIncDec(L, expr, false);
    if (ts.isBinaryExpression(expr)) return L.lowerBinary(expr);
    if (ts.isCallExpression(expr)) {
      // The tail of an optional chain whose `?.` sits deeper
      // (`x?.trim().toLowerCase()`): the whole tail short-circuits with
      // the guard, so it lowers as one chain (dyn/island receivers keep
      // their own undefined-propagating reads — see chainTailClaimed).
      if (chainTailClaimed(L, expr)) return L.lowerOptionalChain(expr);
      return L.lowerCall(expr);
    }
    if (ts.isArrayLiteralExpression(expr)) return L.lowerArrayLiteral(expr);
    if (ts.isObjectLiteralExpression(expr)) return L.lowerObjectLiteral(expr);
    if (ts.isElementAccessExpression(expr)) return L.lowerElementAccess(expr);
    if (ts.isConditionalExpression(expr)) return lowerTernary(L, expr);

    if (ts.isPropertyAccessExpression(expr)) {
      // `super.x`: the base chain's GETTER, called directly (super
      // dispatch is static in JS — never through the dynamic class).
      // super.method() calls are routed at the call site; a bare super
      // property read lands here.
      if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
        return L.lowerSuperAccessorRead(expr);
      }
      // Enum member reads (`E.A`) fold to their compile-time constants —
      // claimed FIRST so no receiver-shaped path (records, islands, the
      // identifier fence on the enum object) sees them. lower-enums.ts.
      {
        const en = lowerEnumAccess(L, expr);
        if (en) return en;
      }
      // `require.main.filename` / `require.main?.filename` — CommonJS
      // entry-module identity: in a compiled binary require.main IS the
      // entry module (never undefined in a CJS graph, so the chain's guard
      // folds away), and its filename is the ENTRY file's real path —
      // Node's exact value when the same tree runs in place, exactly the
      // __filename stance. Checked BEFORE the optional-chain gate: the
      // checker types the chain `string | undefined`, but the value is a
      // compile-time string.
      if (isRequireMainFilename(L, expr)) {
        return { kind: "strLit", value: L.entry.fileName, type: STRING, loc };
      }
      // `process?.versions?.node` — the runtime-detection probe, written
      // with optional links (zapo's transport asks it of a `process`
      // snapshot the ambient types made optional). Claimed here for the
      // require.main.filename reason: neither `?.` can short-circuit, so
      // the chain's value is the member's, but the guard the gate below
      // would build needs `process.versions` as a STANDALONE value — which
      // has no lowering of its own and would fence a result that is
      // already known. Only the optional spellings come through here; the
      // plain one keeps its place in the ordinary property chain.
      if (
        expr.questionDotToken ||
        (ts.isPropertyAccessExpression(expr.expression) && expr.expression.questionDotToken)
      ) {
        const pv = L.processVersionsMember(expr);
        if (pv) return pv;
      }
      // Optional chaining `a?.b`: the guard lowers here (a tag test around
      // the plain property lowering below); the handled marker keeps this
      // re-entrant dispatch from looping.
      if (expr.questionDotToken && !L.chainHandled.has(expr)) {
        return L.lowerOptionalChain(expr);
      }
      // `a?.b.c` — the tail of a chain whose token sits deeper: the whole
      // tail short-circuits with the guard.
      if (!expr.questionDotToken && chainTailClaimed(L, expr)) {
        return L.lowerOptionalChain(expr);
      }
      // Island receiver: o.x is an engine property read (getProp may throw
      // — reading off null/undefined — bridged catchably like everything
      // at the boundary). `o?.x` arrives here too, through the chain
      // lowering's re-dispatch (a questionDotToken past the gate above is
      // always chain-handled; the receiver reads back as the chain's
      // bound handle).
      if (L.isIslandExpr(expr.expression)) {
        const receiver = L.lowerExpr(expr.expression);
        // The checker said 'any' but the VALUE lives in the checked-dynamic tree (`this`
        // in a plain JS function — dyn.this — or a checked-dynamic local
        // behind an any-typed spelling): the property read is the checked-dynamic tree's
        // own keyed read, dyn results and dyn chains exactly like every
        // checked-dynamic member access (a nullish receiver throws V8's
        // catchable TypeError, exactly Node). Never a jsOp over a dyn —
        // the two dynamic worlds don't share a value representation.
        if (receiver.type.kind === "dyn") {
          return {
            kind: "dynKeyGet",
            key: { kind: "strLit", value: expr.name.text, type: STRING, loc },
            value: receiver,
            type: DYN,
            loc,
          };
        }
        const read: IrExpr = { kind: "jsOp", op: "getProp", name: expr.name.text, args: [receiver], type: JSVAL, loc };
        // A member the .d.ts DECLARES as a primitive exits eagerly to that
        // static type (`f.mediaType` on a package handle IS a string):
        // primitives copy by value across the boundary — no aliasing, no
        // cost — and every static consumer (intrinsics, templates,
        // comparisons) works on the result. Trust-but-verify: a lying
        // declaration throws the catchable TypeError instead of smuggling
        // a mistyped handle into string ops. A Uint8Array member exits the
        // same way (`result.audio.uint8Array` — the generated-media
        // payload) as a validated u8 COPY, the boundary's aliasing stance
        // (divergences 44/45; engine Buffers pass — they ARE Uint8Arrays).
        // Other composites stay handles (eager JSON copies would change
        // aliasing), and chain-handled reads stay jsval (the chain's unit
        // path is the engine's undefined — see lowerOptionalChain).
        if (!expr.questionDotToken) {
          const declared = L.mapTypeOf(L.typeOf(expr));
          if (
            declared &&
            (declared.kind === "f64" || declared.kind === "bool" || declared.kind === "string" ||
              (declared.kind === "bytes" && declared.elem === "u8"))
          ) {
            return { kind: "jsExit", value: read, type: declared, loc };
          }
        }
        return read;
      }
      // `m.groups` on a match result whose regex is statically known:
      // the compile-time record projection over the honest slice (or
      // Node's undefined when the pattern has no named groups) — see
      // lowerMatchGroupsRead.
      {
        const g = lowerMatchGroupsRead(L, expr);
        if (g !== null) return g;
      }
      // `m.index` on a for-of-over-matchAll binding reads the companion-
      // index array at this iteration's cursor — always a number: every
      // drained row matched, so the lib's `.index` is never undefined
      // here (lowerForOfMatchAll).
      if (expr.name.text === "index" && !expr.questionDotToken && ts.isIdentifier(expr.expression)) {
        const sym = L.checker.getSymbolAtLocation(expr.expression);
        const companion = sym !== undefined ? L.matchAllIndexBindings.get(sym) : undefined;
        if (companion !== undefined) {
          return {
            kind: "arrayGet",
            arr: { kind: "varRef", localId: companion.idxsLocalId, type: arrayOf(F64), loc },
            index: { kind: "varRef", localId: companion.curLocalId, type: F64, loc },
            type: F64,
            loc,
          };
        }
      }
      // `arguments.length` in a TYPED function whose signature is
      // FIXED-ARITY (no optional/default/rest parameters): tsc enforces
      // exact arity at every call site and call/apply/bind indirection is
      // fenced, so the actual count IS the declared count — a compile-time
      // constant. Arrows don't bind `arguments` (the walk skips them,
      // exactly JS's scoping); variable-arity signatures keep the fence
      // (the count would need a hidden argc). The variadic `arguments`
      // object (dynRest) was claimed at identifier lowering — asked here
      // through peekArgumentsLocal, because inside an arrow the slot
      // belongs to an ENCLOSING frame and this frame's own field is null.
      if (
        expr.name.text === "length" &&
        !expr.questionDotToken &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "arguments" &&
        L.peekArgumentsLocal() === null &&
        L.typeOf(expr.expression).getSymbol()?.name === "IArguments" &&
        L.isStdlibSymbol(L.typeOf(expr.expression).getSymbol())
      ) {
        let fn: ts.Node | undefined = expr.parent;
        while (
          fn !== undefined &&
          !ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) &&
          !ts.isMethodDeclaration(fn) && !ts.isConstructorDeclaration(fn) &&
          !ts.isGetAccessorDeclaration(fn) && !ts.isSetAccessorDeclaration(fn)
        ) {
          fn = ts.isSourceFile(fn) ? undefined : fn.parent;
        }
        if (fn !== undefined) {
          // The fold's whole warrant is that tsc ENFORCES the arity it
          // reads off the declaration. A JavaScript source file has no
          // such enforcement — `outer(1, 2, 3)` against `function outer()`
          // type-checks there — so in JS the declared count is not the
          // call's count and folding to it is a SILENTLY WRONG answer.
          // JS functions that CAN answer honestly already did: their
          // `%arguments` slot is above (peekArgumentsLocal). Landing here
          // from JS means this function's calling convention carries no
          // argument list at all — a class method or constructor (the ABI
          // is the vtable's), or a callback whose ABI a shim fixed. Refuse
          // out loud rather than answer with the declaration's count.
          //
          // ACCESSORS are the one exception and stay folded: JavaScript
          // itself fixes their arity at the CALL, not at the declaration.
          // A [[Get]] passes nothing and a [[Set]] passes exactly the
          // value, whatever the property access looks like — so here the
          // declared count is the call's count in JS too.
          if (isJsSourceFile(fn.getSourceFile()) && !ts.isAccessor(fn)) {
            L.unsupported(
              "SC1090",
              expr,
              "'arguments' in a JavaScript function whose calling convention carries no argument list (a class method or constructor — its ABI is the vtable's — or a callback with a fixed shim signature; a plain function or an object-literal method materializes one)",
            );
          }
          const fixedArity = (fn as ts.FunctionLikeDeclaration).parameters.every(
            (p) => p.questionToken === undefined && p.initializer === undefined &&
              p.dotDotDotToken === undefined,
          );
          if (fixedArity) {
            return {
              kind: "numLit",
              value: (fn as ts.FunctionLikeDeclaration).parameters.length,
              type: F64,
              loc,
            };
          }
          L.unsupported(
            "SC1090",
            expr,
            "'arguments.length' in functions with optional, default, or rest parameters (the count varies per call — a fixed-arity signature folds to a constant)",
          );
        }
      }
      // CommonJS namespace binding (`const lib = require("./lib.js")`):
      // `lib.member` IS the member — the export table is alias plumbing,
      // so the NAME resolves exactly like a bare identifier reference
      // (resolveValueSymbol lands on the exporter's declaration and every
      // existing path — globals, function values, classes — applies).
      if (!expr.questionDotToken && L.cjsLocalModuleBindingOf(expr.expression)) {
        // A binding whose dep is a class-expression WHOLE export
        // (`module.exports = class {…}`): the member surface is the
        // CLASS's — `C.name` folds to NamedEvaluation's answer and own
        // statics read their globals (lowerStaticFieldRead resolves the
        // binding through the expression's own symbol). The plain
        // member-name delegation below would resolve `name` against the
        // stdlib var instead — a wrong VALUE, not a fence. Unknown
        // members fall through to the delegation (expando statics ride
        // their pre-registered export globals).
        const viaClass = lowerStaticFieldRead(L, expr);
        if (viaClass) return viaClass;
        return lowerExpr(L, expr.name);
      }
      // `module.exports` READ in a CommonJS file whose whole export IS a
      // class expression (`module.exports = class …{}`): the read answers
      // the class VALUE — `new module.exports()` inside the module is the
      // requirer's `new C()` spelled locally. Top-level reads ABOVE the
      // assignment fall through to their existing fences (Node still
      // answers the original export object there); function bodies
      // resolve unconditionally — they run after the module evaluated,
      // the same approximation identifier exports already make. Every
      // other module.exports read keeps its existing story.
      if (!expr.questionDotToken && isModuleExportsAccess(expr) && isCjsJsFile(expr.getSourceFile())) {
        const whole = cjsClassExprWholeExportOf(expr.getSourceFile());
        if (whole) {
          let inBody = false;
          for (let p: ts.Node = expr.parent; !ts.isSourceFile(p); p = p.parent) {
            if (ts.isFunctionLike(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) {
              inBody = true;
              break;
            }
          }
          if (inBody || expr.getStart() > whole.stmt.getEnd()) {
            return L.classValueRef(L.lowerClassExpressionInfo(whole.classExpr), expr);
          }
        }
      }
      // `module.exports.Sub` / `exports.Sub` READ in the same module: an
      // EXPRESSION-valued member rides its pre-registered export global —
      // exactly what requirers see through `require('./x').Sub`, and the
      // global IS the storage every `exports.Sub =` statement assigns, so
      // the read is Node's live member. Identifier-valued members have no
      // global (pure alias plumbing) and fall through unchanged; write
      // positions belong to the export-assignment machinery.
      {
        const sf = expr.getSourceFile();
        const cjsMemberRecv =
          isModuleExportsAccess(expr.expression) ||
          (ts.isIdentifier(expr.expression) &&
            expr.expression.text === "exports" &&
            !L.resolveLocal(expr.expression) &&
            !L.globalOf(expr.expression));
        const writePos =
          ts.isBinaryExpression(expr.parent) &&
          expr.parent.left === expr &&
          expr.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (!expr.questionDotToken && cjsMemberRecv && !writePos && isCjsJsFile(sf)) {
          const sym =
            L.checker.getSymbolAtLocation(expr.name) ??
            L.cjsModuleExportSymbol(sf, expr.name.text);
          const resolved =
            sym !== undefined && sym.flags & ts.SymbolFlags.Alias
              ? L.checker.getAliasedSymbol(sym)
              : sym;
          const g =
            (sym ? L.globalsBySymbol.get(sym) : undefined) ??
            (resolved ? L.globalsBySymbol.get(resolved) : undefined);
          if (g) return { kind: "varRef", localId: g.id, type: g.type, loc };
        }
      }
      // Namespace-qualified reads (`N.x`, `A.B.C.f`, import= alias
      // chains): the member is a compile-time-known declaration of a
      // lowered namespace block — it resolves exactly like a bare
      // identifier reference (globals, function values, classes), guarded
      // by the namespace source-order fences (lower-namespaces.ts).
      if (!expr.questionDotToken) {
        const nsMember = nsMemberIdentOf(L, expr);
        if (nsMember) {
          const memberSym = L.checker.getSymbolAtLocation(nsMember);
          if (memberSym) fenceEarlyNsMemberRef(L, expr, memberSym);
          return lowerExpr(L, nsMember);
        }
        // Expando function members (`foo.bar` after `foo.bar = 12`): the
        // member's module global (lower-expando.ts), before the ambient-
        // namespace fence — a declare-namespace merge over a real function
        // (`declare namespace Foo { var baz: number }` + `function Foo`)
        // reads its assigned members, not the ambient ReferenceError.
        {
          const ex = expandoMemberRead(L, expr);
          if (ex) return L.maybeNarrow(ex, expr);
        }
        // An AMBIENT namespace receiver (`M.x` where only `declare
        // namespace M` exists): the namespace object never exists at
        // runtime — Node's exact catchable ReferenceError at the access,
        // the ambient `declare const` stance.
        const ambientRoot = ambientNsRootOf(L, expr.expression);
        if (ambientRoot !== null) {
          const t = ambientUndefReadType(L, expr);
          if (t) return nsUndefRead(L, ambientRoot.text, expr, t);
        }
      }
      // `exports.<name>` READS in a module whose export object was
      // REPLACED (`module.exports = ...`): `exports` still references the
      // ORIGINAL object — Node's aliasing rule — so when nothing ever
      // attached this name to it (`exports.<name> =` nowhere in the
      // file), the honest answer is undefined. tsc types the read off the
      // REPLACEMENT (its CJS model is identity-blind), which is exactly
      // the silent divergence this lowering closes. Reads in modules with
      // real `exports.<name> =` attachments keep their fences.
      {
        const ex = lowerReplacedExportsRead(L, expr);
        if (ex) return ex;
      }
      // `this.<name>` inside a CJS export-table getter: Node binds the
      // receiver to module.exports — the read is the sibling getter's
      // lifted call.
      {
        const tm = lowerCjsExportTableThisMember(L, expr);
        if (tm) return tm;
      }
      // `Error.prototype` — the process singleton, and the ONE member of
      // the `Error` global with a value (every other member, `Error`
      // itself included, keeps the stdlib member fence below).
      //
      // Returned WITHOUT maybeNarrow on purpose. tsc types this
      // expression `Error`, because that is how the lib declares
      // `ErrorConstructor.prototype`, and maybeNarrow would read the dyn
      // through a %Error dynCheck and hand back a runtime error OBJECT.
      // Node's Error.prototype is not an Error instance (`Error.prototype
      // instanceof Error` is false — it carries no [[ErrorData]]); it is an
      // ordinary object, which is exactly what the singleton is.
      {
        const ep = L.lowerErrorPrototypeProperty(expr);
        if (ep) return ep;
        // `Uint8Array.prototype` — the same shape, and returned without
        // maybeNarrow for the same reason (tsc types it `Uint8Array`, and
        // a %bytes dynCheck would answer a COPY with no identity where
        // the prototype LINK is the whole point).
        const up = L.lowerUint8ArrayPrototypeProperty(expr);
        if (up) return up;
        // `Uint8Array.from` / `Uint8Array.of` — the two static methods,
        // and the pair protobufjs reads. Here, above `handled`, because
        // the generic-method-as-value fence in lowerFieldRead would
        // otherwise claim `from` on the checker type alone (SC1090) and
        // never reach the singleton the runtime holds.
        const us = L.lowerUint8ArrayStaticProperty(expr);
        if (us) return us;
      }
      const handled =
        // A stdlib global's declared METHOD read where ToBoolean is the
        // ONLY consumer (`Object.freeze ? Object.freeze([]) : []`): the
        // capability TEST, constant true. FIRST in the chain on purpose —
        // for a callable member in that position there is no better answer
        // than the constant, so nothing below can be preempting one. Some
        // of these members' value positions are deliberate FENCES (Math
        // methods as values, the generic-method-as-value rule), and the
        // existence question is not the value question.
        stdlibExistenceTestOf(L, expr) ??
        L.lowerProcessEnvGet(expr) ??
        L.lowerServerProperty(expr) ??
        // diagnostics_channel Channel receivers — name/hasSubscribers
        // over the f64 channel handle.
        L.lowerDcChannelProperty(expr) ??
        // TracingChannel receivers — the five event channels and
        // hasSubscribers over the f64 tracing handle.
        L.lowerDcTracingChannelProperty(expr) ??
        L.lowerTestCtxProperty(expr) ??
        L.lowerProcessProperty(expr) ??
        L.lowerProcessStreamProperty(expr) ??
        L.lowerFsConstantsProperty(expr) ??
        // http2.constants.NGHTTP2_CANCEL (any constants-object spelling):
        // the baked-literal table.
        L.lowerBuiltinConstantsProperty(expr) ??
        // Builtin namespace imports (`path.sep`, `os.EOL`,
        // `fs.constants.R_OK` where the root is `import * as ...`): the
        // same constants and per-member fences as named builtin imports.
        L.lowerNamespaceBuiltinProperty(expr) ??
        L.lowerJsonProperty(expr) ??
        L.lowerErrorCodeProperty(expr) ??
        // signal.aborted / signal.reason / controller.signal. Its own
        // entry rather than a lowerIntrinsicProperty arm because that
        // function's receiver filter drops handle kinds before its member
        // switch is ever reached.
        lowerAbortProperty(L, expr) ??
        L.lowerNumberStaticProperty(expr) ??
        // The composed default-locale form
        // `Intl.DateTimeFormat().resolvedOptions().locale` — claimed at
        // the MEMBER, because the receiver (a resolved-options record)
        // has no representation of its own and would fence first.
        lowerIntlDefaultLocaleProperty(L, expr) ??
        L.lowerMathProperty(expr) ??
        L.lowerIntrinsicProperty(expr) ??
        // The _readableState/_writableState scalar READS (the suite's
        // asserts) — checked before the generic stream property surface:
        // the inner access maps no type of its own.
        lowerStreamStateProperty(L, expr) ??
        lowerStreamObjectProperty(L, expr) ??
        // `globalThis.WebSocket` — the WHATWG global, matched
        // STRUCTURALLY against the record the program declared for it
        // (there is no lib.dom to anchor on). Ahead of lowerFieldRead
        // because the receiver is a cast of globalThis, not a record.
        lowerWebSocketGlobal(L, expr) ??
        L.lowerUnionProperty(expr) ??
        L.lowerFieldRead(expr);
      // A union-typed field read narrows like an identifier when the
      // checker has narrowed this use to one arm.
      if (handled) return L.maybeNarrow(handled, expr);
      // `globalThis.<name>` that no lowering above claimed
      // (globalThis.crypto, globalThis.SubtleCrypto, globalThis.localStorage
      // — the harness's capability-conditional knownGlobals adds): the
      // PROPERTY spelling of the identifier chokepoint's JS rule — a stdlib
      // global taken as a VALUE in a JavaScript source is the same opaque
      // IDENTITY TOKEN the bare spelling answers (`globalThis.crypto` IS
      // `crypto` — one global, one token, or identity flows through Sets
      // and === would disagree between the two spellings). TypeScript
      // sources keep the SC2020 member fence below, like the bare form.
      if (
        !expr.questionDotToken &&
        stdlibGlobalNameOf(L, expr.expression) === "globalThis" &&
        isJsSourceFile(expr.getSourceFile())
      ) {
        const canonical = stdlibGlobalNameOf(L, expr);
        if (canonical !== null) {
          return (
            ctorObjectGlobalValue(L, canonical, loc) ??
            { kind: "strLit", value: `[builtin ${canonical}]`, type: STRING, loc }
          );
        }
      }
      // A JS receiver whose CHECKER type has no mapping (`mustCallChecks
      // .length` where the binding is an evolving any[] living as a
      // checked-dynamic global): the stdlib member fence below would blame
      // the unmappable checker type (`any[].length`), but the VALUE is a
      // dyn node — lower the receiver first and read through the dyn keyed
      // read (ARR answers length; everything else JS's own-property
      // answer). Mapped receivers keep the fence-first order: their
      // members' gaps are real surface gaps ([1,2].entries), not
      // representation artifacts. `.length` on a receiver whose checker
      // ARRAY type lowers to the checked-dynamic representation —
      // `unknown[]`, the collapsed `(string | object)[]`, and the `any[]`
      // an Array.isArray guard narrows a collapsed union to — is the checked-dynamic tree
      // array's OWN length (a keyed read the ARR kind answers exactly),
      // never an `Array.prototype` surface gap; both source languages.
      // Prototype-method VALUE reads (`ps.map` unparenthesized) keep the
      // fence-first order: a stored-member undefined would mis-answer
      // them, and calls dispatch through the dyn method machinery
      // instead.
      if (
        (isJsSourceFile(expr.getSourceFile()) &&
          (L.mapTypeOf(L.typeOf(expr.expression)) === null ||
            // A never-tainted receiver type maps (never rides as f64) but
            // its VALUE lowered checked-dynamic — same dyn read.
            neverTaintedJsType(L, expr.expression, L.typeOf(expr.expression)))) ||
        (expr.name.text === "length" &&
          (L.checkerAnyArray(expr.expression) ||
            (L.checker.isArrayType(L.typeOf(expr.expression)) &&
              L.mapTypeOf(L.typeOf(expr.expression))?.kind === "dyn")))
      ) {
        const recv = L.lowerExpr(expr.expression);
        if (recv.type.kind === "dyn") {
          const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
          const opt = chainGuardedByQuestionDot(expr.expression);
          return L.maybeNarrow(
            { kind: "dynKeyGet", key, ...(opt ? { optional: true as const } : {}), value: recv, type: DYN, loc },
            expr,
          );
        }
      }
      // `f.name` / `f.length` / own properties on a FUNCTION-typed JS
      // value (the mustCall wrapper's function-instance members): read
      // through the dyn box — the closure's own-property table answers
      // first (defineProperties writes land there), then the box's
      // best-effort static name and the declared arity; anything else is
      // the own-property answer, undefined. Function.prototype METHOD
      // names stay fenced (a stored-member undefined would mis-answer
      // `f.call` as a value). JS files only; TS keeps the fence.
      if (fnOwnRoutableKey(expr.name.text)) {
        const boxed = fnOwnPropBox(L, expr.expression, loc);
        if (boxed) {
          const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
          fnOwnCounters.read++;
          fnOwnWhy("read", expr, expr.name.text);
          return L.maybeNarrow({ kind: "dynKeyGet", key, value: boxed, type: DYN, loc }, expr);
        }
      }
      // A NARROWED IteratorResult receiver (`if (!r.done) r.value` — the
      // checker narrows to IteratorYieldResult/IteratorReturnResult, whose
      // own type cannot map: the shared record shape needs BOTH channels):
      // the receiver's LOWERED record still carries the field, so the read
      // is an ordinary recordGet — maybeNarrow then bridges the union slot
      // to the checker's narrowed arm, exactly like a union field read.
      if (expr.name.text === "done" || expr.name.text === "value") {
        const recvSym = L.typeOf(expr.expression).getSymbol();
        if (
          (recvSym?.name === "IteratorYieldResult" || recvSym?.name === "IteratorReturnResult") &&
          L.checker.declarationsOf(recvSym).some(
            (d) => ts.isInterfaceDeclaration(d) && L.isStdlibFile(d.getSourceFile()),
          )
        ) {
          const recv = L.lowerExpr(expr.expression);
          if (recv.type.kind === "record") {
            const shape = L.shapes.get(recv.type.shapeId);
            const field = shape?.fields.find((f) => f.name === expr.name.text);
            if (field) {
              return L.maybeNarrow(
                { kind: "recordGet", obj: recv, shapeId: recv.type.shapeId, field: field.name, type: field.type, loc },
                expr,
              );
            }
          }
        }
      }
      // A chain rooted at an initializer-less ambient `declare const/var`
      // whose declared type has NO mapping (mappable roots compose through
      // the bare-read undefRead and never reach here): Node throws the
      // catchable ReferenceError at the ROOT read before any member
      // matters, so the whole access lowers to that throw — typed by the
      // use site, or by the context it flows into (the throw never
      // returns, so the dummy is never observed).
      {
        const ambientRoot = ambientUndefVarRootOf(L, expr);
        if (ambientRoot !== null) {
          const t = ambientUndefReadType(L, expr) ?? contextualUndefReadType(L, expr);
          if (t) return nsUndefRead(L, ambientRoot.text, expr, t);
        }
      }
      // A member read through a NULLISH generic binding (`const i: I<A &
      // B> = null as any; const _i: I<A> = i.something` — the receiver
      // provably holds null/undefined forever): the read throws Node's
      // exact TypeError at the access.
      if (ts.isIdentifier(expr.expression) && expr.questionDotToken === undefined) {
        const unit = nullishGenericBindingUnitOf(L, L.resolveValueSymbol(expr.expression));
        if (unit !== null) {
          const t = ambientUndefReadType(L, expr) ?? contextualUndefReadType(L, expr) ?? F64;
          return nodeThrowExpr(
            1,
            "",
            `Cannot read properties of ${unit} (reading '${expr.name.text}')`,
            t,
            loc,
          );
        }
      }
      // `Object.getOwnPropertyNames` / `Object.keys` taken as a VALUE: a
      // lifted closure over the same runtime walk the CALL form lowers to.
      // esbuild's `__commonJS` binds it at module scope and reads it from
      // inside the memoizing thunk, so fencing the binding also strands
      // the thunk's capture of it.
      {
        const lifted = objectStaticFnValueOf(L, expr);
        if (lifted) return lifted;
      }
      // The lib fence's PROPERTY chokepoint: a stdlib-declared member that
      // no lowering above claimed ([1,2].entries, Math.SQRT2, Promise.all,
      // re.exec as a value, ...) reports SC2020 here.
      L.stdlibMemberFence(expr);
      // The npm chokepoint: a member on a package-typed receiver in a
      // static build — attributed to the package, like every other site.
      L.npmMemberFence(expr);
      // A property read rooted at a BLOCKED binding: the declaration
      // carries the real diagnostic — the SC2004 cascade, not a generic
      // "property access" rejection.
      {
        let root: ts.Expression = expr.expression;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (ts.isIdentifier(root) && L.isBlockedBinding(L.resolveValueSymbol(root))) {
          L.pushDiag(blockedBindingUseDiag(root.text, loc));
          throw new PoisonError();
        }
      }
      // Nothing claimed the member. Lower the RECEIVER before rejecting:
      // when the receiver itself is the blocker (`(await import(x)).y` —
      // the dynamic import is the unsupported part), ITS diagnostic is the
      // honest one, not a generic recitation about the outer dot. A
      // receiver that lowers cleanly means the MEMBER is the gap — name
      // the property and the receiver's type instead of "property access".
      const recvLowered = L.lowerExpr(expr.expression);
      // A dyn receiver — JSON.parse's `any`, or `unknown` the checker
      // narrowed to `object` — reads through the dyn keyed read: member
      // or undefined (JS's own-property answer), throwing JS's TypeError
      // on undefined/null receivers unless an earlier `?.` guards the
      // chain. Scalar-narrowed occurrences bridge via maybeNarrow's
      // validated dynCheck as usual.
      if (recvLowered.type.kind === "dyn") {
        const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
        const opt = chainGuardedByQuestionDot(expr.expression);
        return L.maybeNarrow(
          { kind: "dynKeyGet", key, ...(opt ? { optional: true as const } : {}), value: recvLowered, type: DYN, loc },
          expr,
        );
      }
      // The lowered receiver is a RECORD the checker spelled wider —
      // `s.match(re).groups.key` in a JS file: the checker says
      // `{ [key: string]: string } | undefined`, but the groups
      // projection already answered the record arm (its null trap
      // included). Declared fields read directly; an index-signature
      // shape serves undeclared keys through the overflow read, exactly
      // the dot-access rule on checker-spelled hybrids.
      if (recvLowered.type.kind === "record") {
        const recvShape = L.shapes.get(recvLowered.type.shapeId);
        const field = recvShape?.fields.find((f) => f.name === expr.name.text);
        if (field) {
          return L.maybeNarrow(
            { kind: "recordGet", obj: recvLowered, shapeId: recvLowered.type.shapeId, field: field.name, type: field.type, loc },
            expr,
          );
        }
        if (recvShape?.indexValue !== undefined && !recvShape.tuple) {
          return L.maybeNarrow(
            {
              kind: "recordKeyGet",
              obj: recvLowered,
              shapeId: recvLowered.type.shapeId,
              key: { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) },
              overflowOnly: true,
              type: recvShape.indexValue,
              loc,
            },
            expr,
          );
        }
      }
      // An ABSTRACT property through an abstract-typed receiver: the
      // declaration is erased at runtime — Node defines no field for it,
      // each concrete subclass declares its OWN (at its own layout
      // position), so no shared base slot exists to read. Abstract
      // ACCESSORS are the supported spelling: they declare a vtable slot.
      if (recvLowered.type.kind === "object" && abstractPropertyDeclOf(L, expr)) {
        L.unsupported(
          "SC1090",
          expr,
          `reading the abstract property '${expr.name.text}' through a '${L.checker.typeToString(L.typeOf(expr.expression))}'-typed receiver (abstract property declarations are erased at runtime, so no shared slot exists — type the receiver as the concrete class, or declare an abstract getter instead)`,
        );
      }
      // An EventEmitter API member taken as a VALUE (`this.emit.bind(this)`
      // — the coordinator idiom that hands a class's emit to a collaborator
      // through a function-typed field). These members are the RUNTIME's,
      // not the class's: a subclass declaration of one is erased at
      // collection, and every call compiles against a statically known
      // EVENT NAME, because each event carries its own payload tuple. So
      // there is no single function to take the address of, and the generic
      // property-read recitation names neither that fact nor a way round
      // it. A direct call is the working spelling.
      if (recvLowered.type.kind === "object" && EMITTER_API_MEMBERS.has(expr.name.text)) {
        const emitterInfo = L.classes.get(recvLowered.type.className);
        if (emitterRooted(L, emitterInfo)) {
          L.unsupported(
            "SC1090",
            expr,
            `the EventEmitter member '${expr.name.text}' as a VALUE (it is the runtime's, and every call compiles against a statically known event name — each event has its own payload tuple, so no single function value exists to bind or pass; call '${expr.name.text}' directly, or wrap it in an arrow that names the event)`,
          );
        }
      }
      // The ADOPTED-INSTANCE read. A binding whose VALUE is a class
      // instance keeps the INSTANCE type even where the checker spells a
      // record — lowerVarDecl adopts the initializer's type for a const
      // whose declared type maps to a record ("the interface is erasure
      // over a nominal value"), and `c as unknown as { f: ... }` erases to
      // that same instance. The adoption's own promise is that members
      // then read as the CLASS's own; the METHOD side keeps that promise
      // (lowerObjectMethodCall's exactInstanceClassOf rescue) and the DATA
      // side never did, so `x.v` fenced on the very shape the rule was
      // written for. The read is the same fieldGet a method body's
      // `this.v` emits, over the flattened instance-field map.
      //
      // Placed ONE LINE before the last-resort fence, so no read that
      // lowers today changes: this can only turn a fence into an answer.
      // An ACCESSOR-satisfied name declines — a getter has no data slot
      // and a raw fieldGet would read past the dispatch (the exact-shape
      // stance ctorWitnessProjection already draws for the same pair).
      if (recvLowered.type.kind === "object") {
        const adoptedInfo = L.classes.get(recvLowered.type.className);
        const adoptedFieldT = adoptedInfo?.fields.get(expr.name.text);
        if (
          adoptedInfo !== undefined &&
          adoptedFieldT !== undefined &&
          L.findMethodOn(adoptedInfo, `get:${expr.name.text}`) === null &&
          L.findMethodOn(adoptedInfo, expr.name.text) === null
        ) {
          return {
            kind: "fieldGet",
            obj: recvLowered,
            className: recvLowered.type.className,
            field: expr.name.text,
            type: adoptedFieldT,
            loc,
          };
        }
      }
      if (process.env["SCRIPTC_READ_WHY"] !== undefined) {
        console.error(
          `[readwhy] .${expr.name.text} lowered-recv=${typeKey(recvLowered.type).slice(0, 90)}` +
            ` checker=${L.checker.typeToString(L.typeOf(expr.expression)).slice(0, 90)}`,
        );
      }
      // The lowered receiver is a UNION the CHECKER spelled `any`.
      // `Array.isArray(n.content)` over a `Uint8Array | string | readonly
      // T[]` member narrows to `any[]` — `readonly T[]` is not assignable
      // to the `arg is any[]` predicate — so `.find(...)`'s answer arrives
      // here with checker type `any` while the VALUE still carries the
      // real union. lowerUnionProperty cannot claim it: that path gates on
      // `mapTypeOf(checkerType)`, which is `dyn` here, and returns null
      // before it ever looks at the lowered value. The union field read is
      // the same helper that path uses; it answers only when every arm can
      // serve the field and declines otherwise, so this can only turn a
      // fence into an answer — never change a read that lowers today.
      if (recvLowered.type.kind === "union") {
        const served = lowerUnionFieldRead(L, expr, recvLowered, expr.name.text);
        if (served) return L.maybeNarrow(served, expr);
      }
      L.unsupported(
        "SC1090",
        expr,
        `reading '${expr.name.text}' from a value of type '${L.checker.typeToString(L.typeOf(expr.expression))}'`,
      );
    }

    // Meta-properties, named: `new.target` reflects HOW a function was
    // invoked (compiled functions are never constructors of themselves —
    // no runtime invocation record exists), and `import.meta`/
    // `import.defer` are module-loader surface a native binary does not
    // carry.
    if (ts.isMetaProperty(expr)) {
      const name =
        expr.keywordToken === ts.SyntaxKind.NewKeyword ? "new.target" : `import.${expr.name.text}`;
      L.unsupported(
        "SC1090",
        expr,
        name === "new.target"
          ? "'new.target' (no runtime invocation record exists in compiled code)"
          : `'${name}' (module-loader metadata has no equivalent in a compiled binary)`,
      );
    }

    const entry = UNSUPPORTED_EXPR[expr.kind];
    if (entry) L.unsupported(entry.code as `SC${number}` & keyof typeof UNSUPPORTED, expr, entry.feature);
    L.unsupported("SC1090", expr, `syntax '${ts.SyntaxKind[expr.kind]}'`);
  }


/** `c ? a : b` — see the inline comments. `expected` plays the contextual
   * array type's role when the caller knows the slot's array type and tsc's
   * API doesn't surface it (a ternary as a SPREAD source — lowerArrayLiteral
   * threads the literal's own type in). */
  export function lowerTernary(L: Lowerer, expr: ts.ConditionalExpression,
    expected?: IrType & { kind: "array" },): IrExpr {
    const loc = locOf(expr);
      // `const t = cond ? https : http` — a module NAMESPACE chosen at
      // runtime. There is no module object in a compiled binary, so the
      // declaration lowers to its CONDITION and the binding's slot becomes
      // the selector each use branches on (lower-nsvalue.ts).
      {
        const sel = lowerNamespaceConditionalDecl(L, expr);
        if (sel) return sel;
      }
      // `Array.isArray(x) ? x : [x]` over a `T | readonly T[]` union: tsc
      // narrows the TRUE branch to `any[]` (maybeNarrow's isArray bridge
      // rides that) but leaves the FALSE branch wide — a readonly array
      // is not assignable to `any[]`, so the arm never subtracts. The
      // RUNTIME tag test proves the remaining arm exactly, so the false
      // arm's reads of x narrow to the union's one non-array checker
      // constituent (the certs configuredTlds shape). Nested functions
      // stay out (they run later, when the proof is stale — tsc's own
      // invalidation rule).
      const falseArmNarrows: ts.Identifier[] = [];
      let falseArmNarrowType: ts.Type | null = null;
      {
        let c: ts.Expression = expr.condition;
        while (ts.isParenthesizedExpression(c)) c = c.expression;
        if (
          ts.isCallExpression(c) &&
          ts.isPropertyAccessExpression(c.expression) &&
          c.arguments.length === 1 &&
          ts.isIdentifier(c.arguments[0]!) &&
          L.stdlibGlobalMember(c.expression, "Array") === "isArray"
        ) {
          const argIdent = c.arguments[0] as ts.Identifier;
          const sym = L.resolveValueSymbol(argIdent);
          const t = L.checker.getTypeAtLocation(argIdent);
          const constituents = t.isUnionType() ? t.getTypes() : [];
          const nonArray = constituents.filter((a) => !L.checker.isArrayType(a) && !L.checker.isTupleType(a));
          const mapped = L.mapTypeOf(t);
          const armCount =
            mapped?.kind === "union"
              ? (L.unions.get(mapped.unionId)?.arms.filter((a) => a.kind === "array").length ?? 0)
              : 0;
          if (sym && nonArray.length === 1 && armCount === 1) {
            falseArmNarrowType = nonArray[0]!;
            const collect = (n: ts.Node): void => {
              if (ts.isFunctionLike(n)) return;
              if (ts.isIdentifier(n) && L.resolveValueSymbol(n) === sym && !L.chainNarrowedType.has(n)) {
                falseArmNarrows.push(n);
              }
              n.forEachChild(collect);
            };
            collect(expr.whenFalse);
          }
        }
      }
      // The TRUE-arm twin of the rule above, and the other half of the same
      // tsc quirk. `Array.isArray(x)` is declared `arg is any[]`; a
      // `readonly T[]` arm is NOT assignable to `any[]`, so the arm never
      // survives the narrowing and tsc falls back to the predicate's own
      // type — the TRUE arm's reads of x come out bare `any[]`, with T
      // gone. maybeNarrow's isArray bridge already proves the union's ONE
      // array arm with a runtime tag test, and lowerArrayMethodCall rides
      // that bridge to lower the VALUE correctly — but the CHECKER type
      // stays `any[]` and poisons everything derived from it in turn: a HOF
      // callback's parameter, the call's own result, the const that binds
      // it, and every read off that const, each fencing on an `any` the
      // value never had. One `.find` cost four fences in a row that way.
      //
      // Answer those reads with the union's array constituent at the one
      // place every consumer asks (typeOf). Deliberately narrow:
      //   * exactly ONE array constituent, so the arm the runtime test
      //     selects is never ambiguous (the same count the false arm needs);
      //   * only nodes tsc ITSELF narrowed to `any[]` are overridden — the
      //     checker already decided the narrowing holds at that read, so
      //     this only changes WHICH type it narrowed to, never whether;
      //   * nested functions stay out (they run later, when the proof is
      //     stale — tsc's own invalidation rule, and the false arm's).
      // A reference is an identifier or a chain of property reads off one,
      // which is what the guard argument is at every zapo site
      // (`node.content`, `check?.suggestions`).
      const trueArmNarrows: ts.Expression[] = [];
      let trueArmNarrowType: ts.Type | null = null;
      {
        let c: ts.Expression = expr.condition;
        while (ts.isParenthesizedExpression(c)) c = c.expression;
        if (
          ts.isCallExpression(c) &&
          ts.isPropertyAccessExpression(c.expression) &&
          c.arguments.length === 1 &&
          L.stdlibGlobalMember(c.expression, "Array") === "isArray"
        ) {
          const argExpr = c.arguments[0]!;
          const t = L.checker.getTypeAtLocation(argExpr);
          const constituents = t.isUnionType() ? t.getTypes() : [];
          const arrays = constituents.filter(
            (a) => L.checker.isArrayType(a) || L.checker.isTupleType(a),
          );
          const sameRef = (a: ts.Expression, c2: ts.Expression): boolean => isArrayNarrowSameRef(L, a, c2);
          if (arrays.length === 1 && L.mapTypeOf(arrays[0]!) !== null) {
            const collect = (n: ts.Node): void => {
              if (ts.isFunctionLike(n)) return;
              if (
                (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) &&
                !L.chainNarrowedType.has(n) &&
                sameRef(n, argExpr) &&
                L.checkerAnyArray(n)
              ) {
                trueArmNarrows.push(n);
                return;
              }
              n.forEachChild(collect);
            };
            collect(expr.whenTrue);
            if (trueArmNarrows.length > 0) trueArmNarrowType = arrays[0]!;
          }
        }
      }
      if (process.env["SCRIPTC_ISARR_WHY"] !== undefined && trueArmNarrowType !== null) {
        console.error(
          `[isarrwhy] true-arm ${trueArmNarrows.length} read(s) -> ` +
            `${L.checker.typeToString(trueArmNarrowType)} at ` +
            `${expr.getSourceFile().fileName}:${
              expr.getSourceFile().getLineAndCharacterOfPosition(expr.pos).line + 1
            }`,
        );
      }
      for (const n of falseArmNarrows) L.chainNarrowedType.set(n, falseArmNarrowType!);
      for (const n of trueArmNarrows) L.chainNarrowedType.set(n, trueArmNarrowType!);
      try {
      const cond = L.lowerCondition(expr.condition);
      // A condition the LOWERING proved constant (typeof-dyn against a
      // kind no dyn box can hold — the bigint/symbol/function fold): only
      // the taken arm exists at runtime, so only it lowers — which is
      // exactly what lets a dual-mode arm with no static lowering (bigint
      // literals) sit untaken in compiled JS. A boolLit carries no
      // effects, so dropping the condition read loses nothing.
      if (cond.kind === "boolLit") {
        return L.lowerExpr(cond.value ? expr.whenTrue : expr.whenFalse);
      }
      const ctxTs = L.checker.getContextualType(expr);
      const ctxMapped = ctxTs ? L.mapTypeOf(ctxTs) : null;
      // Array-literal arms build directly as the slot's array type when
      // the ternary sits under an ARRAY context (tsc accepts each arm
      // covariantly — `[stdin]` types string[] against an
      // (Uint8Array | string)[] slot — but a tagged element representation
      // must be BUILT as the slot's element type, the same rule element
      // expressions follow inside every array literal). And an EMPTY
      // array-literal arm with no usable type of its own (tsc infers
      // `never[]`; no mappable contextual type reaches into the arm — the
      // conditional-spread idiom `[...(c ? [x] : [])]`) adopts the SIBLING
      // arm's array type: the ternary twin of the union-slot rule in
      // lowerArrayLiteral, and just as unambiguous — tsc already typed the
      // whole ternary by the filled arm alone. Both arms empty stays
      // fenced (no element type exists anywhere).
      const ctxArray = expected ?? (ctxMapped?.kind === "array" ? ctxMapped : null);
      const armLiteral = (e: ts.Expression): ts.ArrayLiteralExpression | null => {
        let x = e;
        while (ts.isParenthesizedExpression(x)) x = x.expression;
        return ts.isArrayLiteralExpression(x) ? x : null;
      };
      const emptyUntypedArrayArm = (e: ts.Expression): boolean => {
        const lit = armLiteral(e);
        if (!lit || lit.elements.length !== 0) return false;
        const t = L.checker.getContextualType(lit) ?? L.typeOf(lit);
        if (!L.mapTypeOf(t)) return true;
        // never[] MAPS (the f64 representation for the uninhabited) but
        // carries no element information — an empty literal typed that way
        // still adopts the sibling arm's array type, tsc's own reading.
        if (L.checker.isArrayType(t)) {
          const elem = L.checker.getTypeArguments(t as ts.TypeReference)[0];
          if (elem !== undefined && elem.flags & ts.TypeFlags.Never) return true;
        }
        return false;
      };
      const lowerArm = (e: ts.Expression, siblingType?: IrType): IrExpr => {
        const lit = armLiteral(e);
        if (lit && ctxArray) return L.lowerArrayLiteral(lit, ctxArray);
        if (lit && siblingType?.kind === "array") {
          if (emptyUntypedArrayArm(e)) {
            return { kind: "arrayLit", elems: [], type: siblingType, loc: locOf(lit) };
          }
          // A FILLED literal arm whose own element type is a UNION
          // carrying the sibling's element as an arm (`Array.isArray(x) ?
          // x : [x]` — the false arm's x checker-types as the whole union
          // even though the runtime tag proved the non-array arm): build
          // as the sibling's array type — each element coerces into the
          // sibling element or fences on its own.
          const ownT = L.mapTypeOf(L.typeOf(lit));
          if (
            ownT?.kind === "array" &&
            ownT.elem.kind === "union" &&
            siblingType.elem.kind !== "union" &&
            L.armTag(ownT.elem.unionId, siblingType.elem) >= 0
          ) {
            return L.lowerArrayLiteral(lit, siblingType);
          }
          // A FILLED literal arm whose own array type has NO lift into the
          // sibling's (`isWindows ? ['cmd.exe', ['/d']] : ['pwd', []]` —
          // the empty nested literal types never[], whose f64-element
          // representation re-tags into nothing): the generic path could
          // only fence the whole ternary, so build AS the sibling type —
          // each element coerces into the sibling's element slot or fences
          // on its own, and a nested empty literal adopts the slot's array
          // arm (the union-slot rule). tsc already accepted the arm
          // covariantly against the join, so a fitting literal is exactly
          // the value the checker typed.
          if (ownT?.kind === "array" && !typeEquals(ownT, siblingType) && L.widthLiftPlan(ownT, siblingType) === null) {
            return L.lowerArrayLiteral(lit, siblingType);
          }
        }
        return L.lowerExpr(e);
      };
      // Lower the filled arm first so an empty arm can adopt its type.
      // When the checker's OWN join for the ternary maps to an ARRAY,
      // literal arms build against it directly (tsc collapses the arms'
      // covariant array types into one — `c ? ['sh', []] : ['cmd', ['/d']]`
      // joins as (string | string[])[] whichever arm nests the empty
      // literal), so neither arm's uninhabited never[] reading decides.
      const ownArrayJoin = (() => {
        const m = L.mapTypeOf(L.typeOf(expr));
        return m?.kind === "array" ? m : null;
      })();
      let thenRaw: IrExpr;
      let elseRaw: IrExpr;
      if (!ctxArray && emptyUntypedArrayArm(expr.whenTrue) && !emptyUntypedArrayArm(expr.whenFalse)) {
        elseRaw = L.lowerExpr(expr.whenFalse);
        thenRaw = lowerArm(expr.whenTrue, elseRaw.type);
      } else {
        thenRaw = lowerArm(expr.whenTrue, ownArrayJoin ?? undefined);
        elseRaw = lowerArm(expr.whenFalse, thenRaw.type);
      }
      // The ternary's IR type is normally the checker's own: it collapses
      // same-kind literal unions ("a" | "b" → string) and forms tagged
      // unions for mixed arms that map (`c ? okRec : errRec`); anything
      // left unmappable gets the type fence (badType) here. A record/union CONTEXTUAL type
      // takes over exactly when the own type can't carry the value —
      // unmappable, or a DIFFERENT union (branch literals omitting
      // DIFFERENT optional subsets make the own type a union of the
      // narrower fresh shapes, and a union-typed slot can sub-union the
      // same way; neither has a runtime re-tag, while tsc guarantees each
      // branch is assignable to the context). A base-CLASS context absorbs
      // the same case: branches producing different subclasses make the
      // own type a class union (`c ? new Dog() : new Bird()` against an
      // Animal slot), while each branch upcasts into the context fine. A
      // collapsed own type must WIN over a wider contextual union
      // (`console.log(c ? "yes" : "no")` stays string against the ambient
      // string | number | boolean parameter), and an 'unknown'/'any'
      // context never absorbs the ternary (`JSON.stringify(c ? 1 : 2)`
      // stays f64-typed). Arms that AGREE on an array type decide it
      // themselves (a context- or sibling-built literal arm can carry a
      // tagged element type the checker's own type doesn't spell).
      const own = L.mapTypeOf(L.typeOf(expr));
      const useCtx =
        (ctxMapped?.kind === "record" || ctxMapped?.kind === "union" || ctxMapped?.kind === "object") &&
        (own === null ||
          (own.kind === "union" && !typeEquals(own, ctxMapped) && !L.inLogicalLeftPosition(expr)));
      // Mixed dyn/unit arms under an unmappable own type (`typeof pkg.name
      // === "string" ? pkg.name : null` — the lowering world types the
      // unknown-receiver read `any`, which a static build cannot hold):
      // dyn represents null and undefined directly, so the ternary stays
      // dyn — a unit arm converts to the dyn unit value (the dynFrom form
      // the index-signature lowerings already use). A FRESH literal arm
      // (`... ? pkg.scripts : {}` — the default-object idiom) converts the
      // same way when it is JSON-safe: nothing else aliases a literal, so
      // the dyn copy is unobservable.
      const dynish = (e: IrExpr): boolean =>
        e.type.kind === "dyn" ||
        e.kind === "unitLit" ||
        ((e.kind === "recordLit" || e.kind === "arrayLit") && L.dynConvertible(e.type));
      const dynJoin =
        own === null &&
        !(useCtx && ctxMapped) &&
        dynish(thenRaw) &&
        dynish(elseRaw) &&
        (thenRaw.type.kind === "dyn" || elseRaw.type.kind === "dyn");
      // A checker-`any` ternary whose lowered arms are STATIC (`rawName ?
      // rawName.replace(...) : null` — the dyn-receiver string machinery
      // answers a static string): the checker's `any` carries no shape,
      // but the arms do — equal arms take their shared type, a unit arm
      // joins the other arm as its null/undefined-armed union. Gated on
      // genuine `any` so every other unmappable keeps its own diagnostic.
      let anyJoin: IrType | null = null;
      if (
        own === null && !dynJoin && !(useCtx && ctxMapped) &&
        (L.typeOf(expr).flags & ts.TypeFlags.Any) !== 0
      ) {
        const a = thenRaw.type;
        const b = elseRaw.type;
        const staticArm = (t: IrType): boolean =>
          t.kind !== "dyn" && t.kind !== "caught" && t.kind !== "jsval" && t.kind !== "void";
        if (staticArm(a) && staticArm(b)) {
          if (typeEquals(a, b)) {
            anyJoin = a;
          } else if (isUnitType(a) !== isUnitType(b)) {
            const unit = isUnitType(a) ? a : b;
            const val = isUnitType(a) ? b : a;
            const arms =
              val.kind === "union" ? (L.unions.get(val.unionId)?.arms ?? null) : [val];
            if (arms && !arms.some((x) => typeEquals(x, unit))) {
              anyJoin = { kind: "union", unionId: L.unions.intern([...arms, unit]) };
            } else if (arms) {
              anyJoin = val; // the unit is already an arm
            }
          }
        }
      }
      const type =
        thenRaw.type.kind === "array" && typeEquals(thenRaw.type, elseRaw.type)
          ? thenRaw.type
          : dynJoin
            ? DYN
            : (anyJoin ??
              (useCtx && ctxMapped
                ? ctxMapped
                : L.irTypeOf(expr)));
      // Each arm flows into the ternary's type through the slot-coercion
      // path: union arms wrap, dyn slots reject the non-dyn arm with
      // SC1101, mismatched record shapes get SC2002; coerceInto is
      // inert when the types already agree.
      const intoDyn = (e: IrExpr): IrExpr =>
        e.type.kind === "dyn" ? e : { kind: "dynFrom", value: e, type: DYN, loc: e.loc };
      const then = dynJoin ? intoDyn(thenRaw) : L.coerceInto(expr.whenTrue, thenRaw, type);
      const else_ = dynJoin ? intoDyn(elseRaw) : L.coerceInto(expr.whenFalse, elseRaw, type);
      if (then.type.kind !== type.kind || else_.type.kind !== type.kind) {
        L.badType(expr, L.typeOf(expr));
      }
      return { kind: "ternary", cond, then, else_, type, loc };
      } finally {
        for (const n of falseArmNarrows) L.chainNarrowedType.delete(n);
        for (const n of trueArmNarrows) L.chainNarrowedType.delete(n);
      }
  }

/** The dyn behind a checker-driven scalar narrow bridge, or null. Only the
   * bridge maybeNarrow builds is unwrapped — never a written `as` cast,
   * whose check is the program's own request. The operand still evaluates,
   * so nothing effectful is dropped; what is dropped is a validation that
   * a TEST does not need, because a test has an answer for the kinds the
   * check would have rejected. */
  export function narrowBridgeDyn(e: IrExpr): IrExpr | null {
    if (e.kind !== "dynCheck" || e.narrowBridge !== true) return null;
    return e.value.type.kind === "dyn" ? e.value : null;
  }

/** Checker-driven union narrowing. tsc's control-flow analysis narrows a
   * union-typed reference at use sites (`if (r.kind === "ok") { ...r... }`
   * types `r` as the ok-arm inside the branch); the IR value is still the
   * tagged union, so the read is bridged with an extraction of the arm's
   * payload. That extraction is TAG-CHECKED (checkedArmBridge): tsc's
   * proof decides which arm to ask for, the runtime decides whether the
   * value really carries it, and a narrowing the runtime cannot confirm
   * throws the catchable TypeError. Trusting the proof outright is what
   * this bridge used to do, and it is not merely unsound in theory — the
   * arms of a union routinely share a runtime layout, so an unchecked
   * peek serves one arm's slot as another's and the program carries on
   * with the wrong string (`G:\ur\probe`'s m01) or dereferences a double
   * as a pointer (p05). A checker type that maps to the same union
   * (unnarrowed use), to a SUB-union (partial narrowing — unrepresentable
   * without a re-tag), or to nothing (`never` in an exhaustive default)
   * leaves the expression union-typed. */
/** Two syntactic REFERENCES that denote the same value: an identifier
 * resolving to one symbol, or a chain of property reads off one. This is
 * the identity the Array.isArray narrowing rules compare a read against the
 * guard argument with, and it is deliberately syntactic — tsc's own
 * reference identity for narrowing is the same shape. */
function isArrayNarrowSameRef(L: Lowerer, a: ts.Expression, b: ts.Expression): boolean {
  let x = a;
  let y = b;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  while (ts.isParenthesizedExpression(y) || ts.isNonNullExpression(y)) y = y.expression;
  if (ts.isIdentifier(x) && ts.isIdentifier(y)) {
    // resolveValueSymbol answers NULL when it cannot resolve, so a
    // truthiness test is required: `sx === sy` alone would make two
    // UNRESOLVABLE identifiers compare equal and narrow a read that
    // has nothing to do with the guard.
    const sx = L.resolveValueSymbol(x);
    return sx !== null && sx === L.resolveValueSymbol(y);
  }
  if (ts.isPropertyAccessExpression(x) && ts.isPropertyAccessExpression(y)) {
    return x.name.text === y.name.text && isArrayNarrowSameRef(L, x.expression, y.expression);
  }
  return false;
}

/** The ROOT identifier of a reference chain (a.b.c gives a), or null. */
function narrowRefRoot(e: ts.Expression): ts.Identifier | null {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  if (ts.isIdentifier(x)) return x;
  if (ts.isPropertyAccessExpression(x)) return narrowRefRoot(x.expression);
  return null;
}

/** True when the guarded REGION writes the reference's root binding — an
 * assignment, a compound assignment or a ++/-- whose target chain roots at
 * the same symbol. tsc resets a narrowing on such a write; this rule has no
 * tsc narrowing to reset (that is the whole point of it), so it declines
 * instead. Conservative in both directions: a write ANYWHERE in the region
 * counts, including one after the read, and an unresolvable root declines. */
function narrowRefWrittenIn(L: Lowerer, region: ts.Node, ref: ts.Expression): boolean {
  const root = narrowRefRoot(ref);
  if (!root) return true;
  const sym = L.resolveValueSymbol(root);
  if (sym === null) return true;
  let hit = false;
  const targets = (t: ts.Expression): boolean => {
    const r = narrowRefRoot(t);
    return r !== null && L.resolveValueSymbol(r) === sym;
  };
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const lhs = n.left;
      if (ts.isIdentifier(lhs) || ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
        const base = ts.isElementAccessExpression(lhs) ? lhs.expression : lhs;
        if (targets(base)) hit = true;
      }
    } else if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) &&
      targets(n.operand)
    ) {
      hit = true;
    }
    if (!hit) n.forEachChild(walk);
  };
  walk(region);
  return hit;
}

/** `Array.isArray(<ref>)` as the guard of a condition, or as its left-most
 * `&&` conjunct (which guards the rest of the chain and the consequent
 * alike) — the argument it proves, or null. */
function isArrayGuardArgOf(L: Lowerer, cond: ts.Expression): ts.Expression | null {
  let c = cond;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isArrayGuardArgOf(L, c.left);
  }
  if (
    ts.isCallExpression(c) &&
    ts.isPropertyAccessExpression(c.expression) &&
    c.arguments.length === 1 &&
    L.stdlibGlobalMember(c.expression, "Array") === "isArray"
  ) {
    return c.arguments[0]!;
  }
  return null;
}

/** SYNTACTIC evidence that this read sits under an `Array.isArray(<same
 * reference>)` guard — the proof maybeNarrow's isArray bridge normally
 * takes from the CHECKER, for the reads where the checker has nothing left
 * to give.
 *
 * The bridge's usual key is "tsc narrowed this read to `any[]`", which IS
 * tsc's own record of the guard: the `arg is any[]` predicate cannot keep a
 * `readonly T[]` constituent, so the true branch comes out bare `any[]`.
 * That key needs tsc to have narrowed at all. One hop further out it has
 * not: `const tosNode = Array.isArray(n.content) ? n.content.find(...) :
 * undefined` types `tosNode` bare `any` (the quirk poisons the ternary's
 * result and the const that binds it), so `tosNode.content` inside a SECOND
 * `Array.isArray` guard is `any`, not `any[]`, and there is no tsc
 * narrowing to read off. The VALUE is a real union all along — the field
 * read already lowered it — and the guard is right there in the source.
 * This reads it there. zapo's `parseTosQueryResponse` is that shape exactly.
 *
 * Deliberately narrow, and each restriction is the checker's own:
 *   * only a read the checker gave up on ENTIRELY (`any`/`unknown`) is
 *     eligible, so nothing that types today can move;
 *   * only the TRUE side of an if / ternary / `&&`, never the else;
 *   * nested functions stay out (they run later, when the proof is
 *     stale — tsc's invalidation rule, and the ternary rule's);
 *   * a region that WRITES the reference's root declines.
 * The caller adds the last condition: the lowered union must have EXACTLY
 * ONE array arm, so the arm the guard selects is never ambiguous. And the
 * extraction is checkedArmBridge, the same tag-checked helper every
 * checker-driven union narrowing goes through — a proof that is somehow
 * wrong throws the catchable TypeError rather than reading one arm's
 * payload through another arm's struct. */
function isArrayGuardProven(L: Lowerer, node: ts.Expression): boolean {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p !== undefined; child = p, p = p.parent) {
    if (ts.isFunctionLike(p)) return false;
    let arg: ts.Expression | null = null;
    let region: ts.Node | null = null;
    if (ts.isIfStatement(p) && child === p.thenStatement) {
      arg = isArrayGuardArgOf(L, p.expression);
      region = p.thenStatement;
    } else if (ts.isConditionalExpression(p) && child === p.whenTrue) {
      arg = isArrayGuardArgOf(L, p.condition);
      region = p.whenTrue;
    } else if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      child === p.right
    ) {
      arg = isArrayGuardArgOf(L, p.left);
      region = p.right;
    }
    if (
      arg !== null &&
      region !== null &&
      isArrayNarrowSameRef(L, node, arg) &&
      !narrowRefWrittenIn(L, region, arg)
    ) {
      return true;
    }
  }
  return false;
}

  export function maybeNarrow(L: Lowerer, expr: IrExpr, node: ts.Node): IrExpr {
    // A dyn read tsc narrowed to a SCALAR (a typeof test proved the kind):
    // bridge with a VALIDATED extraction — dynCheck, the checked-cast
    // machinery — rather than a trusted one. After the guard the check
    // never fires; a read smuggled past it throws a catchable TypeError
    // instead of misreading the payload (the dyn boundary's usual stance).
    // Object/array narrowings stay dyn-typed and keep their fences.
    //
    // BIGINT is a scalar of this family and was missing from the list.
    // The premise that kept it out went stale the same way the folded
    // `typeof v === "bigint"` test's did: SCR_DYN_BIG exists, the dyn
    // tree really can carry a bigint, the test beside this one is a REAL
    // runtime test, and `v as bigint` already extracts one through this
    // very dynCheck. So the guard proved the kind, the extraction was
    // built, and only the bridge between them was missing — which reads
    // at the use site as `Number(v)` refusing an 'unknown' the program
    // had just narrowed. Identity, not a list: what belongs here is
    // "a scalar the checked cast extracts", and bigint is one.
    if (expr.type.kind === "dyn") {
      const narrowed = L.mapTypeOf(L.typeOf(node));
      if (
        narrowed &&
        (narrowed.kind === "f64" ||
          narrowed.kind === "bool" ||
          narrowed.kind === "string" ||
          narrowed.kind === "bigint")
      ) {
        // SCRIPTC_BIGNARROW_WHY: name the reads this bridge answers with a
        // bigint, so "the rule fires nowhere" and "nothing changed" are
        // different observations in the same run.
        if (narrowed.kind === "bigint" && process.env["SCRIPTC_BIGNARROW_WHY"]) {
          const p = ts.getLineAndCharacterOfPosition(node.getSourceFile(), locOf(node).start);
          process.stderr.write(`[bignarrow] ${locOf(node).file}:${p.line + 1} ${node.getText().slice(0, 40)}\n`);
        }
        return { kind: "dynCheck", value: expr, type: narrowed, narrowBridge: true, loc: expr.loc };
      }
      // An `instanceof Uint8Array` narrow: the checked-dynamic tree's bytes kind, extracted
      // with the same validated copy the checked cast uses (a Buffer that
      // crossed in rides the kind too — it IS a Uint8Array in Node).
      //
      // `instanceof ArrayBuffer` narrows to the OTHER dyn bytes flavor and
      // bridges the same way — through scr_dyn_arrbuf_unbox, which hands
      // back the SAME payload rather than a copy (a copy would detach
      // every view already taken over the buffer). isDynBytes is the one
      // spelling of "this flavor crosses", so admitting a third would not
      // have to be remembered here.
      if (isDynBytes(narrowed ?? VOID)) {
        return { kind: "dynCheck", value: expr, type: narrowed!, loc: expr.loc };
      }
      // An `instanceof Error` narrow: the checked-dynamic tree's error encoding rebuilds a
      // fresh %Error (name/message/code from the marker object — a COPY,
      // the unknown boundary's stance; SEMANTICS.md 67), validated like
      // every dyn extraction.
      if (narrowed?.kind === "object" && narrowed.className === "%Error") {
        return { kind: "dynCheck", value: expr, type: narrowed, loc: expr.loc };
      }
      return expr;
    }
    // Checker-driven narrowing for classes: tsc types this USE as a
    // subclass of the IR value's class, and the read bridges with a
    // downcast. That downcast is INSTANCEOF-CHECKED (checkedDowncastBridge)
    // for the same reason the union bridge below is tag-checked: the
    // narrowing is not always an instanceof test the runtime performed. A
    // user type predicate (`a is Dog`) and an assertion function
    // (`asserts a is Dog`) are tsc's word alone, and a bare reinterpret
    // believes them. Sibling subclasses share the base's prefix and place
    // their own fields at the SAME offsets, so believing a lie serves one
    // subclass's slot as another's; a base instance is shorter than the
    // subclass struct, so it runs off the end of the allocation. Where the
    // narrowing is honest the check is one predictable interval compare
    // that always passes.
    if (expr.type.kind === "object") {
      const narrowed = L.mapTypeOf(L.typeOf(node));
      if (
        narrowed?.kind === "object" &&
        narrowed.className !== expr.type.className &&
        L.isSubclassOf(narrowed.className, expr.type.className)
      ) {
        return checkedDowncastBridge(L, expr, narrowed, expr.loc);
      }
      return expr;
    }
    if (expr.type.kind !== "union") return expr;
    const narrowed = L.mapTypeOf(L.typeOf(node));
    // `Array.isArray(u)` on a `string | readonly string[]` union: the lib
    // predicate narrows the READONLY arm to `any[]` (tsc's readonly-array
    // quirk), which maps to the island's array-of-handles (or nothing) —
    // but the tag test proved the union's one array arm, so the bridge is
    // the same trusted unionNarrow the mapped case below builds (the
    // certs configuredTlds shape).
    if (!narrowed || (narrowed.kind === "array" && narrowed.elem.kind === "jsval")) {
      const t = L.typeOf(node);
      const anyElem =
        (L.checker.isArrayType(t) &&
          ((L.checker.getTypeArguments(t as ts.TypeReference)[0]?.flags ?? 0) &
            (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) ||
        // The read the checker gave up on ENTIRELY (bare `any`/`unknown`,
        // one hop past the quirk), with the guard read off the source
        // instead of off a narrowing tsc never recorded.
        ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 &&
          ts.isExpression(node) &&
          isArrayGuardProven(L, node));
      if (anyElem) {
        const def = L.unions.get(expr.type.unionId);
        const arrayTags = def ? def.arms.flatMap((a, i) => (a.kind === "array" ? [i] : [])) : [];
        if (arrayTags.length === 1) {
          const arm = def!.arms[arrayTags[0]!]!;
          return checkedArmBridge(L, expr, arm, expr.loc);
        }
      }
    }
    // A checker type narrowed to a UNIT arm (the `=== undefined` branch)
    // also stays union-typed: a unit arm has no payload to extract, and
    // nothing useful reads such a value anyway. (Standalone undefined maps
    // to void and standalone null to nothing, so the isUnitType guard is
    // defensive.)
    if (!narrowed || narrowed.kind === "union" || narrowed.kind === "void" || isUnitType(narrowed)) {
      return expr;
    }
    if (L.armTag(expr.type.unionId, narrowed) < 0) return expr;
    return checkedArmBridge(L, expr, narrowed, expr.loc);
  }

/** The checker-driven union bridge's ONE extraction, tag-checked.
 *
 * tsc proved the arm; the runtime never did. Where the proof is real the
 * check is a predictable compare that always passes, and where it is not —
 * a user type predicate that lied, an `in`/`typeof`/discriminant narrowing
 * over arms the runtime cannot tell apart — the alternative to checking is
 * to peek one arm's payload through another arm's struct: `G:\ur\probe`'s
 * `p05` segfaults on it and `m01` silently answers a `Txt`'s `text` where
 * the source asked for `Img.media`. So the extraction goes through
 * narrowedArmHelper, the SAME checked machinery `x!` on a union already
 * uses (divergence 38: a lying assertion throws the catchable TypeError
 * instead of smuggling). No new stance, no new IR node, no emitter arm.
 *
 * The bare unionNarrow stays everywhere the COMPILER owns the tag — inside
 * a switch it emitted, or after a unionIsTag it just wrote. This is only
 * the bridge that trusts tsc's control-flow analysis.
 *
 * Falls back to the un-narrowed union when the helper declines (target not
 * a non-unit arm — already excluded by the callers), which fences loudly
 * downstream rather than admitting an unchecked read. */
  function checkedArmBridge(L: Lowerer, value: IrExpr, arm: IrType, loc: SrcLoc): IrExpr {
    if (value.type.kind !== "union") return value;
    const helper = L.narrowedArmHelper(value.type.unionId, arm, loc);
    if (!helper) return value;
    return { kind: "call", callee: helper, args: [value], type: arm, narrowBridge: true, loc };
  }

/** The checker-driven CLASS bridge's one reinterpret, instanceof-checked.
 *
 * tsc proved the subclass; the runtime never did. The two failure shapes
 * are the union bridge's two exactly (`estado-maybenarrow.md` §2), one
 * layer down: a SIBLING subclass has the same width and different field
 * names, so a lying narrowing answers with the wrong field and nothing
 * crashes (probe d01 prints a Cat's `sound` as `Dog.breed`); the BASE
 * itself is narrower than the subclass struct, so the read leaves the
 * allocation (probe d02 segfaults under LLVM). The check is the preorder
 * interval `instanceof` already uses — the class carries its vtable, the
 * target's interval is a compile-time constant, and an honest narrowing
 * pays one always-true compare.
 *
 * Marked `narrowBridge` for the same reason the union bridge is: every
 * predicate that has to see the read underneath a bridge — purity, the
 * instanceof folds, integer refinement's five transparency points — asks
 * narrowBridgeArm / narrowBridgeArg, and a bridge that did not carry the
 * marker would be havoc'd by the generic `call` case instead.
 *
 * Falls back to the UN-NARROWED value when the helper declines (a class
 * outside an extends hierarchy carries no vtable word). That fences
 * loudly at the first subclass member read rather than admitting an
 * unchecked reinterpret. */
  function checkedDowncastBridge(L: Lowerer, value: IrExpr, target: IrType & { kind: "object" }, loc: SrcLoc): IrExpr {
    if (value.type.kind !== "object") return value;
    const helper = L.narrowedClassHelper(value.type.className, target.className, loc);
    if (!helper) return value;
    return { kind: "call", callee: helper, args: [value], type: target, narrowBridge: true, loc };
  }

/** The value behind a checker-driven narrowing bridge, or null — the union
 * arm bridge (%union.narrow) and the class downcast bridge (%class.narrow)
 * alike. Both are CALLS now, so every predicate that used to recognise the
 * unionNarrow or downcast node — purity, the instanceof folds, the
 * volatile env read, integer refinement — asks this instead. The call is
 * over one argument and cannot be re-associated; only `args[0]` is the
 * pre-narrowing value. */
  export function narrowBridgeArm(e: IrExpr): IrExpr | null {
    if (e.kind !== "call" || e.narrowBridge !== true) return null;
    return e.args[0] ?? null;
  }

/** `v === undefined` / `v !== null` — the narrowing tests for unit-armed
   * unions. A union operand compared with a unit literal lowers to a
   * runtime TAG test (unionIsTag); afterwards tsc's control-flow narrowing
   * types the branches and reads bridge through maybeNarrow as usual. When
   * the checker already narrowed the non-literal side PAST the union
   * (`w = 5; if (w !== null)`), the comparison is statically decided and
   * folds to a bool literal — that drops only a side-effect-free read
   * (flow narrowing applies to references, never to calls), and soundness
   * is the same trust-the-checker bet unionNarrow already makes. Null when
   * neither side is a unit literal (not a unit comparison). */
  export function lowerUnitComparison(L: Lowerer, left: IrExpr,
    right: IrExpr,
    negated: boolean,
    loc: SrcLoc,): IrExpr | null {
    const unit = left.kind === "unitLit" ? left : right.kind === "unitLit" ? right : null;
    if (!unit) return null;
    const other = unit === left ? right : left;
    if (other.kind === "unitLit") {
      // Two unit literals (`undefined === undefined`): statically decided.
      return { kind: "boolLit", value: (other.unit === unit.unit) !== negated, type: BOOL, loc };
    }
    if (other.type.kind === "union") {
      const tag = L.armTag(other.type.unionId, unit.type);
      if (tag < 0) {
        // An index-signature keyed read: the miss the union cannot spell
        // is exactly what this test asks about (see unitTestAtDynWidth).
        const atWidth = unitTestAtDynWidth(L, other, unit.unit, negated, loc);
        if (atWidth) return atWidth;
        // A union WITHOUT that unit arm: legal TS (`miss === null` on a
        // `number | undefined` — null/undefined guard comparisons are
        // permitted against nullable-adjacent types), and === never
        // coerces, so the answer is the constant `negated`. The literal
        // must NOT flow into the union representation (the unionEq
        // fallback would coerce it through the stranded-arm trap and
        // throw where Node answers false). JS still evaluates the
        // operand, so a non-droppable one (`xs.find(f) === null` — the
        // callback's effects are observable) rides one throwaway tag
        // test; droppable reads fold to the bare literal.
        const answer: IrExpr = { kind: "boolLit", value: negated, type: BOOL, loc };
        if (droppableStatic(other)) return answer;
        const evalOnce: IrExpr = {
          kind: "unionIsTag", unionId: other.type.unionId, tag: 0, negated: false, value: other, type: BOOL, loc,
        };
        return { kind: "logical", op: negated ? "||" : "&&", left: evalOnce, right: answer, type: BOOL, loc };
      }
      return {
        kind: "unionIsTag",
        unionId: other.type.unionId,
        tag,
        negated,
        value: other,
        type: BOOL,
        loc,
      };
    }
    // A process.env read tsc narrowed past its union (an earlier write to
    // the same key): the environment is VOLATILE — `delete process.env.K`
    // undoes the write the narrowing rode on — so folding would bake a
    // stale answer. Compare the fresh read's union tag instead.
    const envRead = volatileEnvRead(other);
    if (envRead && envRead.type.kind === "union") {
      const tag = L.armTag(envRead.type.unionId, unit.type);
      if (tag >= 0) {
        return { kind: "unionIsTag", unionId: envRead.type.unionId, tag, negated, value: envRead, type: BOOL, loc };
      }
    }
    // A VOID-typed operand (`foo() === undefined` where foo's declared
    // return is undefined/void — the mapping folds both to void): JS
    // yields undefined from such a call, so the compare is TRUE-when-equal
    // — the opposite of the never-holds-units fold below — and the IR has
    // no value (nor a sequence form to keep the call's effects). Fall
    // through to the caller's comparison fence instead of folding a lie.
    if (other.type.kind === "void") return null;
    // An index-signature keyed read is the one operand whose declared type
    // is not the whole story: `attrs.offline` types `string` and a MISSING
    // key still answers undefined at runtime. Test it, do not fold it.
    {
      const atWidth = unitTestAtDynWidth(L, other, unit.unit, negated, loc);
      if (atWidth) return atWidth;
    }
    // Non-union operand: it can never hold undefined/null at runtime (the
    // checker narrowed it to a concrete arm), so `=== unit` is false and
    // `!== unit` is true.
    return { kind: "boolLit", value: negated, type: BOOL, loc };
  }

/** The runtime answer for a unit comparison whose operand is an
   * INDEX-SIGNATURE keyed read — the reads whose declared type the checker
   * derived from the signature's VALUE type, which says nothing about
   * whether the key is there. `node.attrs.offline !== undefined` types
   * `string !== undefined`, so every fold above calls it statically true,
   * and the read is DELETED with it: no value, no trap, no diagnostic —
   * zapo counted every incoming stanza as an offline stanza. But a
   * comparison against `undefined` is itself a destination that can say
   * undefined, so the read is taken at DYN width
   * (recordKeyReadAtSlotWidth, the same routing a dyn SLOT gets) and the
   * kind test that a `Record<string, unknown>` read has always used
   * answers it: hit → the value's kind, miss → the undefined singleton.
   * The key expression evaluates, so its effects survive too.
   *
   * Null (keep the caller's fold) when the read cannot be widened — no
   * index signature, a value type outside the toDyn walker's domain, or a
   * read that can ALREADY say undefined (which the caller answers with a
   * real tag test anyway). */
  function unitTestAtDynWidth(L: Lowerer, other: IrExpr, unit: "undefined" | "null" | "nullish", negated: boolean, loc: SrcLoc,): IrExpr | null {
    const atWidth = L.recordKeyReadAtSlotWidth(other, DYN) ?? narrowBridgeDyn(other);
    if (!atWidth) return null;
    return {
      kind: "dynTest",
      test: unit,
      ...(negated ? { negated: true as const } : {}),
      value: atWidth,
      type: BOOL,
      loc,
    };
  }

/** The union-typed process.envGet read inside a checker-narrowed operand,
   * or null — the volatility escape above (and lowerLooseNullCompare's). */
  function volatileEnvRead(e: IrExpr): IrExpr | null {
    if (e.kind === "libCall" && e.fn === "process.envGet") return e;
    const inner = e.kind === "unionNarrow" ? e.value : narrowBridgeArm(e);
    if (inner && inner.kind === "libCall" && inner.fn === "process.envGet") return inner;
    return null;
  }

/** `x == null` / `x != null` — JS's idiomatic null-OR-undefined test, the
   * ONE loose comparison with static semantics: `== null` matches exactly
   * null and undefined (0, "", and false do not). Requires a syntactic
   * null LITERAL on either side; the other operand's unit arms become a
   * runtime tag test — one `unionIsTag` when the union has a single unit
   * arm, a short-circuit pair over both tags otherwise (that shape re-emits
   * the operand, so only side-effect-free reads compose; anything else
   * keeps the fence). A unit-literal operand folds (null and undefined are
   * mutually loose-equal), and a non-nullable operand folds statically —
   * the same trust-the-checker bet as lowerUnitComparison. Null (fence)
   * when this isn't a null-literal comparison or the operand has no
   * lowering here (dyn/jsval/void). */
  export function lowerLooseNullCompare(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc,): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
    const unwrap = (e: ts.Expression): ts.Expression =>
      ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
    const left = unwrap(expr.left);
    const right = unwrap(expr.right);
    const leftIsNull = left.kind === ts.SyntaxKind.NullKeyword;
    if (!leftIsNull && right.kind !== ts.SyntaxKind.NullKeyword) return null;
    const otherNode = leftIsNull ? right : left;
    const other = L.lowerExpr(otherNode);
    if (isUnitType(other.type)) {
      // `null == null`, `undefined == null`: units are mutually loose-equal.
      return { kind: "boolLit", value: !negated, type: BOOL, loc };
    }
    if (other.type.kind === "dyn") {
      // `v != null` on unknown: one dyn kind test covers both units.
      return {
        kind: "dynTest",
        test: "nullish",
        ...(negated ? { negated: true as const } : {}),
        value: other,
        type: BOOL,
        loc,
      };
    }
    if (other.type.kind === "union") {
      const ut = other.type;
      const def = L.unions.get(ut.unionId);
      if (!def) L.badType(otherNode, L.typeOf(otherNode));
      const tags = def.arms.flatMap((a, i) => (isUnitType(a) ? [i] : []));
      if (tags.length === 0) {
        // An index-signature keyed read answers a MISS here (see
        // unitTestAtDynWidth); otherwise never null-ish (defensive — the
        // fold below).
        const atWidth = unitTestAtDynWidth(L, other, "nullish", negated, loc);
        if (atWidth) return atWidth;
        return { kind: "boolLit", value: negated, type: BOOL, loc };
      }
      const isTag = (tag: number): IrExpr => ({
        kind: "unionIsTag", unionId: ut.unionId, tag, negated, value: other, type: BOOL, loc,
      });
      if (tags.length === 1) return isTag(tags[0]!);
      // Both null AND undefined arms: tag-in-set as a short-circuit pair
      // (De Morgan for `!=`). The operand IrExpr rides both tests, so the
      // backend emits it per test — restricted to re-emittable pure reads;
      // anything effectful gets its own actionable fence (the generic
      // SC1040 hint would wrongly suggest `== null` as the fix).
      if (!pureReemittable(other)) {
        L.unsupported(
          "SC1090",
          expr,
          `'== null' / '!= null' on a '${L.fmt(ut)}' value that isn't a plain read ` +
            `(both unit arms need the operand twice — bind it to a const first)`,
        );
      }
      return {
        kind: "logical",
        op: negated ? "&&" : "||",
        left: isTag(tags[0]!),
        right: isTag(tags[1]!),
        type: BOOL,
        loc,
      };
    }
    if (other.type.kind === "jsval" || other.type.kind === "void") {
      return null; // no static tag to test — keep the fence
    }
    // The env-volatility escape (see lowerUnitComparison): a narrowed
    // process.env read compares its FRESH union tag instead of folding.
    const envRead = volatileEnvRead(other);
    if (envRead && envRead.type.kind === "union") {
      const def = L.unions.get(envRead.type.unionId);
      const tag = def ? def.arms.findIndex((a) => isUnitType(a)) : -1;
      if (tag >= 0) {
        return { kind: "unionIsTag", unionId: envRead.type.unionId, tag, negated, value: envRead, type: BOOL, loc };
      }
    }
    // An index-signature keyed read: `!= null` is the idiomatic presence
    // test for exactly these, and folding it deleted the read (see
    // unitTestAtDynWidth). One nullish kind test covers both units.
    {
      const atWidth = unitTestAtDynWidth(L, other, "nullish", negated, loc);
      if (atWidth) return atWidth;
    }
    // A non-nullable operand (tsc allows the comparison as a guard):
    // `== null` is statically false, `!= null` statically true.
    return { kind: "boolLit", value: negated, type: BOOL, loc };
  }

/** Safe to EMIT twice: plain reads with no side effects — local/global
   * reads and record/class field reads over such (accessor properties
   * lower to getter CALLS, so they never appear as field reads). Used by
   * the two-unit-arm `== null` composition, the union `typeof` forms, and
   * the union-switch desugar, whose operands ride several tests. */
  /** A static expression whose evaluation is unobservable — safe to DROP
   * (typeof's constant fold: JS evaluates the operand, but when nothing in
   * it can throw, call, write, or allocate observably, folding it away
   * changes nothing). Strictly wider than pureReemittable: numeric
   * arithmetic (f64 ops never throw — division by zero is Infinity),
   * string concatenation, logical/ternary composition, and unit/literal
   * leaves compose; anything with a call, an island op, an index read (can
   * trap), or an unknown kind answers false. */
  export function droppableStatic(e: IrExpr): boolean {
    switch (e.kind) {
      case "numLit":
      case "strLit":
      case "boolLit":
      case "unitLit":
        return true;
      case "bin":
        return droppableStatic(e.left) && droppableStatic(e.right);
      case "unary":
        return droppableStatic(e.operand);
      case "logical":
        return droppableStatic(e.left) && droppableStatic(e.right);
      case "ternary":
        return droppableStatic(e.cond) && droppableStatic(e.then) && droppableStatic(e.else_);
      case "strConcat":
        return droppableStatic(e.left) && droppableStatic(e.right);
      case "toBool":
        return droppableStatic(e.operand);
      case "unionIsTag":
        return droppableStatic(e.value);
      case "unionWrap":
        return droppableStatic(e.value);
      // Fresh allocations are unobservable too — only their PIECES can
      // carry effects (a spread re-reads its source: pure; element and
      // field initializers recurse).
      case "arrayLit":
        return e.elems.every(droppableStatic);
      case "recordLit":
        return e.fields.every((f) => droppableStatic(f.value));
      case "closure":
        return true;
      // A zero-argument CONSTANT builtin: reads nothing, touches nothing,
      // and answers the same interned string on every call. Dropping one
      // is unobservable, which is what the runtime-detection idiom needs —
      // `typeof process.versions.node === 'string'` asks the question of a
      // value it never uses, and without this the typeof fold refuses and
      // the probe fences on a string it could have answered statically.
      // Deliberately a NAMED set rather than a purity flag on libCall:
      // most libCalls do observable work, and the two here are the only
      // ones whose result is a compile-time constant of the runtime build.
      case "libCall":
        return e.args.length === 0 && CONST_LIB_CALLS.has(e.fn);
      default:
        return pureReemittable(e);
    }
  }

/** Builtins whose value is a constant of the runtime build — see
   * droppableStatic. */
  const CONST_LIB_CALLS: ReadonlySet<string> = new Set([
    "process.versionsNode",
    "process.versionsOpenssl",
  ]);

/** `{ ...maybe }` where `maybe` is `Record<K, V> | undefined` (an OPTIONAL
   * field, an optional parameter) inside an index-signature merge: JS
   * spreads NOTHING for the nullish arm, which is exactly what copying an
   * EMPTY record of the same index shape does — so the argument becomes
   * `tag-test ? narrow(src) : {}` and the merge helper needs no absent
   * case of its own. Only a PURE source takes this (the tag test and the
   * narrow are two emissions of it; `pureReemittable` is the same standard
   * the field-by-field spread copies use), only a two-arm union, and only
   * a PURE index-signature record arm — a source with declared fields has
   * no empty value to stand in for it. Anything else comes back unchanged
   * and meets the caller's fence. */
  function optionalIndexSpreadSource(L: Lowerer, src: IrExpr, loc: SrcLoc): IrExpr {
    if (src.type.kind !== "union" || !pureReemittable(src)) return src;
    const arms = L.unions.get(src.type.unionId)?.arms ?? [];
    if (arms.length !== 2) return src;
    const recTag = arms.findIndex((a) => a.kind === "record");
    const nullTag = arms.findIndex((a) => a.kind === "undefinedT" || a.kind === "nullT");
    if (recTag < 0 || nullTag < 0) return src;
    const recArm = arms[recTag] as IrType & { kind: "record" };
    const from = L.shapes.get(recArm.shapeId);
    if (!from || !from.indexValue || from.tuple || from.fields.length > 0) return src;
    if (process.env.SCRIPTC_CONDSPREAD_WHY) {
      console.error(`CONDSPREAD optional-source ${L.fmt(recArm)} ${loc.file}@${loc.start}`);
    }
    return {
      kind: "ternary",
      cond: { kind: "unionIsTag", unionId: src.type.unionId, tag: nullTag, negated: true, value: src, type: BOOL, loc },
      then: { kind: "unionNarrow", unionId: src.type.unionId, tag: recTag, value: src, type: recArm, loc },
      else_: { kind: "recordLit", fields: [], type: recArm, loc },
      type: recArm,
      loc,
    };
  }

export function pureReemittable(e: IrExpr): boolean {
    if (e.kind === "varRef") return true;
    if (e.kind === "recordGet" || e.kind === "fieldGet") return pureReemittable(e.obj);
    // The trust-the-checker narrowing bridges over a pure read: extraction
    // and downcast are reads too (the +1 on ref payloads is RC bookkeeping,
    // not an observable effect — each emission owns its own copy). The
    // union arm bridge is a CALL, and it is the one call that qualifies:
    // its only effects are that same +1 and a tag check whose verdict is
    // the same on every emission, so re-emitting it either throws on the
    // first emission or is as pure as the read underneath.
    if (e.kind === "unionNarrow" || e.kind === "downcast") return pureReemittable(e.value);
    const arm = narrowBridgeArm(e);
    if (arm) return pureReemittable(arm);
    return false;
  }

/** A side-effect-free CONDITION: the ToBoolean/test wrappers lowerCondition
   * builds over pure reads (evaluating one early or twice changes nothing
   * observable). Used by the island-literal conditional spread, whose
   * desugar hoists the condition ahead of the properties. */
  function pureCondExpr(e: IrExpr): boolean {
    if (e.kind === "boolLit") return true;
    if (e.kind === "toBool") return pureReemittable(e.operand);
    if (e.kind === "unionIsTag" || e.kind === "dynTest") return pureReemittable(e.value);
    if (e.kind === "unary" && e.op === "!") return pureCondExpr(e.operand);
    if (e.kind === "logical") return pureCondExpr(e.left) && pureCondExpr(e.right);
    if (e.kind === "jsOp" && (e.op === "truthy" || e.op === "not")) return e.args.every(pureReemittable);
    return pureReemittable(e);
  }

/** A plain keyed ACCESS — `o.k` / `o["k"]`, no optional chain — or a bare
 * IDENTIFIER. The syntaxes an index-signature read can wear directly or
 * one binding later, and the ones for which lowerExprExpecting is exactly
 * lowerExpr followed by the coercion (its own rules are for
 * `Object.freeze`, array literals and object literals — none of these). */
function keyedAccessSyntax(n: ts.Expression): boolean {
  if (ts.isIdentifier(n)) return true;
  return (
    (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
    n.questionDotToken === undefined
  );
}

/** Is this expression's value tested for nullish by the operator that
 * consumes it — i.e. is it the LEFT operand of an enclosing `??`
 * (parentheses tolerated)? Deliberately syntactic and deliberately
 * narrow: it is the one destination where an `undefined` this node
 * produces is not merely representable but the answer the consumer is
 * asking for. */
function nullishTestedByParent(expr: ts.Expression): boolean {
  let n: ts.Node = expr;
  while (n.parent && ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  return (
    p !== undefined && ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    p.left === n
  );
}

/** `a ?? b` — JS-exact nullish coalescing: ONLY null/undefined take the
   * default (0, "", and false do not), and the right side evaluates lazily.
   * On a unit-armed union left this is the `nullish` node (a runtime tag
   * test against the unit arms, docs/ir.md); the two lowered shapes follow
   * the checker's result type — pass-through (`(s: string | undefined) ??
   * t` with t also `string | undefined`) and narrowed (`s ?? "d"` → plain
   * string, the single non-unit arm). A left the checker types non-nullish
   * never takes the right side, so the whole expression folds to the left
   * value — dropping only the never-evaluated default, the same
   * trust-the-checker bet as lowerUnitComparison's static fold. Sub-union
   * results (several non-unit arms) and defaults that change the result
   * type are fenced with narrow-first hints. */
  export function lowerNullishCoalesce(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr {
    const left = L.lowerExpr(expr.left);
    if (left.type.kind === "dyn") {
      // `a ?? b` on a CHECKED-DYNAMIC left: the deciding test is the
      // runtime kind (scr_dyn_is_nullish — UNDEF/NULL take the default;
      // a wrapped island value routes to the engine's test, defensively:
      // the wrap constructor scalar-normalizes engine null/undefined
      // away). Both sides live in the checked-dynamic tree — the right converts through
      // the usual boundary and evaluates lazily in its branch; a default
      // with no dyn representation keeps the fence.
      const right = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
      if (right.type.kind !== "dyn") {
        L.unsupported("SC1100", expr, "nullish coalescing on 'unknown' values against defaults with no dynamic representation");
      }
      return { kind: "nullish", left, right, type: DYN, loc };
    }
    if (left.type.kind === "jsval") {
      // `a ?? b` on an ISLAND value: the engine's own nullish test — the
      // left evaluates once, the right runs lazily in its branch and
      // marshals in (the emitter's jsval nullish arm).
      const right = L.jsvalIn(L.lowerExpr(expr.right), expr.right);
      return { kind: "nullish", left, right, type: JSVAL, loc };
    }
    // `node.attrs.from ?? hostDomain`, and the same read one binding later
    // (`const from = node.attrs.from; from ?? hostDomain`). The checker
    // types an index-signature read by the signature's value type, so the
    // non-nullish fold below would DROP the default the absent key exists
    // to select — and drop it SILENTLY, which is the one outcome this
    // rung must not produce. Ask the dyn: a nullish kind takes the right,
    // anything else validates back to the checker's type, the same
    // trust-but-verify edge every other reader of a widened read takes.
    // On a soundly narrowed dyn the test is false by construction and the
    // check never fires, so the answer is the fold's answer. A default
    // with no dyn representation falls through to the fold.
    {
      const atWidth = L.recordKeyReadAtSlotWidth(left, DYN) ?? narrowBridgeDyn(left);
      // A result with NO IDENTITY only — a scalar, a union of scalars, or
      // dyn: that is what an index-signature read's `??` produces, and it
      // keeps the validated exit a plain extraction. A COMPOSITE result
      // would turn the fold into a deep arm match, which is a different
      // question than this one.
      const want = atWidth ? L.irTypeOf(expr) : VOID;
      if (atWidth && (want.kind === "dyn" || isImmutablePrimitiveWidth(L, want))) {
        const right = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
        if (right.type.kind === "dyn") {
          const test: IrExpr = { kind: "nullish", left: atWidth, right, type: DYN, loc };
          // `attrs.a ?? attrs.b ?? "tail"` — BOTH keys absent. The
          // validated exit back to `want` is the right edge for every
          // consumer but one: an enclosing `??` is about to test this
          // value for nullish, and undefined is the answer it is asking
          // for. Checking it back to a width that cannot say undefined
          // threw an uncoded "expected string at $, got undefined" where
          // Node prints the tail default — pre-existing, identical on
          // `main` (repro-pt/lab/n1.ts). Hand it over at dyn width
          // instead; the enclosing `??` has a total dyn arm, and the
          // predicate guarantees that arm is the consumer.
          return want.kind === "dyn" || nullishTestedByParent(expr)
            ? test
            : { kind: "dynCheck", value: test, type: want, loc };
        }
      }
    }
    if (left.type.kind !== "union") return left;
    const def = L.unions.get(left.type.unionId);
    if (!def) L.badType(expr.left, L.typeOf(expr.left));
    if (!def.arms.some(isUnitType)) return left;
    const type = L.irTypeOf(expr);
    const rest = def.arms.filter((a) => !isUnitType(a));
    if (typeEquals(type, left.type) || (rest.length === 1 && typeEquals(type, rest[0]!))) {
      // `event.key.participant ?? event.rawNode.attrs.participant ??
      // event.key.remoteJid` (zapo mailbox.ts:99). The MIDDLE operand is
      // this `??`'s default, and its value is handed straight to the
      // ENCLOSING `??`, whose entire job is to test it for nullish. So
      // the destination can say undefined and must: JS evaluates the
      // chain left to right and takes the first non-nullish, which for an
      // absent key is `remoteJid`. tsc types the middle read `string`,
      // the fold above then demanded a string, and the miss aborted the
      // process one operand short of the answer.
      //
      // The enclosing test is asked of the SYNTAX (a `??` whose left this
      // node is, parentheses tolerated) because that is the fact being
      // relied on, and it is the only destination this rung claims: a
      // chain of two takes the plain fold and keeps its trap. The right
      // operand is restricted to a plain keyed ACCESS so that lowering it
      // here is exactly what lowerExprExpecting would have done with it
      // (that function's own rules are for `Object.freeze`, array and
      // object literals — none of them this syntax).
      if (keyedAccessSyntax(expr.right) && nullishTestedByParent(expr)) {
        const raw = L.lowerExpr(expr.right);
        // The middle operand is the read itself, or a REFERENCE to the
        // local that holds it at dyn width (zapo persistContacts:
        // `const rawParticipant = event.rawNode.attrs.participant` on the
        // line above, then `event.key.participant ?? rawParticipant ??
        // event.key.remoteJid`). tsc narrows each such reference back to
        // the scalar it believes and maybeNarrow bridges it with a
        // VALIDATED extraction — right for a use that needs the value,
        // wrong for THIS one, which is asking whether there is a value at
        // all: it threw "expected string at $, got undefined" where Node
        // takes the tail. Pre-existing and identical on `main`
        // (repro-pt/lab/q1.ts). narrowBridgeDyn drops the validation and
        // keeps the operand; the dyn then converts into the armed union
        // through the ordinary boundary, whose walker builds the undefined
        // arm from a dyn undefined and validates every other kind.
        //
        // The armed union is interned only once a candidate is in hand: a
        // union the rung then declines would still be a new entry in the
        // program-wide table, and renumbering the unions of a program that
        // does not use this rule is churn with no answer behind it.
        const bridged = raw.kind === "recordKeyGet" ? null : narrowBridgeDyn(raw);
        const armedT = raw.kind === "recordKeyGet" || bridged ? L.withUndefinedArmOf(type) : null;
        if (armedT !== null) {
          const armed = L.recordKeyReadAtUndefinedArm(raw, armedT);
          if (armed) return { kind: "nullish", left, right: armed, type: armedT, loc };
          if (bridged) {
            return { kind: "nullish", left, right: L.coerceInto(expr.right, bridged, armedT), type: armedT, loc };
          }
        }
        return { kind: "nullish", left, right: L.coerceInto(expr.right, raw, type), type, loc };
      }
      const right = L.lowerExprExpecting(expr.right, type);
      return { kind: "nullish", left, right, type, loc };
    }
    // The RETAGGED shape — the default changes the result union (`s ??
    // null` over `string | undefined` answers `null | string`, `p ?? gen()`
    // over `string | undefined` answers `Promise<string> | string`): every
    // non-unit arm of the left has a home in the result, so the non-nullish
    // path re-wraps the payload arm-wise into the result union.
    //
    // This is the SAME nullish node as the two shapes above, and that is the
    // point. The interned helper this replaced took the default as an
    // ARGUMENT, so the default was evaluated EAGERLY where JS evaluates it
    // lazily — which restricted the shape to effect-free defaults (the
    // literal null/0/"" spellings) and fenced everything else. The three
    // defaults zapo actually writes here are a clock call, an optional-chain
    // index read and an `await`, and pre-evaluating that last one would have
    // awaited on the path that must not await. The re-tag belongs in the
    // emitters' non-nullish BRANCH, where the default is not evaluated at
    // all; the arm map is derivable from the two union types, so the node
    // carries no extra field (validate.ts pins the shape; both emitters
    // answer for it).
    if (type.kind === "union") {
      const leftT = left.type;
      const armPairs = rest.map((a) => ({ arm: a, src: L.armTag(leftT.unionId, a), dst: L.armTag(type.unionId, a) }));
      // The DEFAULT needs a home in the result union too, and this is not
      // pedantry: lowerExprExpecting answers a throwing `%union.strand`
      // helper for a value the union cannot hold, and that throw carries no
      // diagnostic code. `p ?? gen()` over `string | undefined` types
      // `Promise<string> | string`, whose promise arm has no
      // representation — admitting it retired an SC1090 from the census and
      // left an uncaught TypeError in its place at run time, which is
      // strictly worse than the fence. The eager-default restriction used
      // to exclude that by accident (a strand is a call, so it was never
      // droppable); this states the exclusion instead of inheriting it.
      // Spelled as "not a STRAND" rather than as a type test on purpose. A
      // type test ("the default's own type is an identical arm") would have
      // refused a record literal that width-lifts into an arm — a shape the
      // eager form ACCEPTED, since a literal is droppable. Every strand is
      // a call and no call is droppable, so this predicate is strictly
      // wider than the one it replaces and nothing that compiled can move.
      const strandFn = (e: IrExpr): boolean =>
        e.kind === "call" &&
        typeof e.callee === "string" &&
        (e.callee.startsWith("%union.strand.") || e.callee.startsWith("%unit.strand."));
      // A PROMISE arm in the result was refused here, because
      // `T | Promise<T>` did not survive the trip to its consumer: four
      // lines with no `??` in them threw an UNCODED "a 'Promise<string>'
      // value is not representable in the target union" TypeError
      // (repro-pu/lab/n3.ts). That was never a fact about `??` — the
      // ASYNC RETURN rule tested for a value whose whole type was
      // `promise` and let a union CARRYING a promise arm fall through to
      // the ordinary coercion, which reached for the checked single-arm
      // extraction. lowerReturnValue routes it to settleOrValueAwait now,
      // so the shape `provided ?? deps.generateStanzaId()` produces has a
      // consumer that reads it correctly, and the fence is retired:
      // measured, not assumed — repro-pu/lab/s1.ts is that exact site in
      // seven lines, byte-identical to Node on both backends, and
      // estado-promiseunion.md §4 has the before/after.
      //
      // The retag itself needed nothing: both arms of the settle-or-value
      // union exist in the destination, so the arm-wise wrap was always
      // right. What remains of the guard is only the non-empty test — a
      // union with no arms has nothing to map.
      const resArms = L.unions.get(type.unionId)?.arms ?? [];
      const carriable = resArms.length > 0;
      if (armPairs.every((p) => p.src >= 0 && p.dst >= 0) && carriable) {
        const right = L.lowerExprExpecting(expr.right, type);
        if (!strandFn(right)) return { kind: "nullish", left, right, type, loc };
      }
    }
    // The default is a WIDTH-SUBSET of the left's single non-unit arm. The
    // result type tsc computes for `a ?? b` is `NonNullable<typeof a> |
    // typeof b`, and an OBJECT LITERAL default keeps its own FRESH type
    // there even when the only slot it was ever written for is the left's
    // arm: `config.webInfo ?? { webSubPlatform: 0 }` over a
    // `WebInfo | null | undefined` left types
    // `{ webSubPlatform: number } | WebInfo`. Those are not two
    // representations — the default names only fields the arm declares,
    // and every arm field it omits is optional-flavored, so building it AT
    // the arm is exactly the literal completion an annotated slot performs
    // (`const w: WebInfo = { webSubPlatform: 0 }`, which lowers today).
    // Build it there and the whole expression IS the arm — the ordinary
    // narrowed shape above, with the default still LAZY. The retag helper
    // cannot take this one: it pre-evaluates the default, and a default
    // that calls something is not droppable.
    // LOSSLESS only: a default carrying a field the arm does not declare
    // would have that field dropped by the width copy, and Node keeps it.
    if (rest.length === 1) {
      const arm = rest[0]!;
      const rightT = L.mapTypeOf(L.typeOf(expr.right));
      if (rightT !== null && losslessWidthInto(L, rightT, arm)) {
        const right = L.lowerExprExpecting(expr.right, arm);
        if (typeEquals(right.type, arm)) return { kind: "nullish", left, right, type: arm, loc };
      }
    }
    L.unsupported(
      "SC1090",
      expr,
      rest.length !== 1
        ? `'??' on '${L.fmt(left.type)}' (the non-nullish result is a sub-union; check a discriminant field first)`
        : `'??' where the default changes the result type (left is '${L.fmt(left.type)}' but the whole expression is '${L.fmt(type)}' — give both sides one type)`,
    );
  }

/** True when a `src`-typed value enters a `dst` record slot by the width
   * copy WITHOUT LOSING ANYTHING: both are plain records (no tuple, no
   * index signature on the source — an overflow map could hold keys the
   * copy would drop), every field `src` declares is declared by `dst` too,
   * and the pair is in the width relation. widthLiftPlan alone is not
   * enough: recordWidthPlan only walks the DESTINATION's fields, so it
   * happily accepts a source whose extra fields the copy silently drops.
   * The direction this adds is the one a `??` default needs — the fields
   * `dst` contributes are exactly the optional-flavored ones completion
   * fills with undefined, which is what an annotated slot already does to
   * the same literal. */
  function losslessWidthInto(L: Lowerer, src: IrType, dst: IrType): boolean {
    if (src.kind !== "record" || dst.kind !== "record") return false;
    const s = L.shapes.get(src.shapeId);
    const d = L.shapes.get(dst.shapeId);
    if (!s || !d || s.tuple || d.tuple || s.indexValue !== undefined) return false;
    if (s.fields.some((f) => !d.fields.some((g) => g.name === f.name))) return false;
    return L.widthLiftPlan(src, dst) !== null;
  }

/** One optional-chain STEP: `a?.b`, `a?.m(...)`, `a?.[i]` (the token on
   * the member access) and `f?.()` (the token on the call). The receiver
   * lowers once; when it is a unit-armed union with ONE non-unit arm, the
   * member/call lowers exactly as its non-optional spelling would — the
   * receiver node reads back as the chain's bound narrowed value
   * (chainRecv) and types as its non-nullish type — and the whole thing
   * becomes an optChain node: tag test, undefined on the unit path (JS:
   * null receivers still yield undefined), the body lazily otherwise,
   * argument side effects included. A receiver the checker types
   * never-nullish makes `?.` behave exactly like `.` — the guard folds
   * away and the plain lowering is the value (trust-the-checker, like
   * ??'s fold). Multi-step TAILS (`a?.b.c`, `x?.trim().toLowerCase()`)
   * short-circuit whole: the guarded member step is the chain's dot and
   * every later step lowers inside the guard, checker-narrowed non-nullish
   * (see chainTailDot); sub-union receivers are fenced with rewrite
   * hints. */
  /** The unhandled `?.`-carrying MEMBER step in this node's receiver
   * spine, when the node is the TAIL of an optional chain whose token sits
   * deeper — `x?.trim().toLowerCase()` reads nothing past the guard when x
   * is nullish, so the whole tail must lower inside it. Walks
   * property/element accesses and call steps only (parens and `!` break
   * the chain per the grammar: `(a?.b).c` throws on undefined in JS);
   * the node's OWN token — and a call's immediate callee token — are the
   * plain entries' cases, not tails, and handled markers make the chain
   * lowering's re-dispatch walk past its own step. `f?.()` steps stay out
   * (a call carrying the token has no member step to re-enter — the
   * split-it fence keeps them). */
  export function chainTailDot(
    L: Lowerer,
    expr: ts.Expression,
  ): ts.PropertyAccessExpression | ts.ElementAccessExpression | null {
    let cur: ts.Expression = expr;
    for (;;) {
      // An active chain's bound receiver read is a LEAF — its own token
      // was consumed by the chain that bound it.
      if (L.chainRecvByNode.has(cur)) return null;
      if (ts.isCallExpression(cur)) {
        // `f?.()` steps route through their own entry (or are being
        // handled); a deeper token under one is that chain's business.
        if (cur.questionDotToken) return null;
        cur = cur.expression;
        continue;
      }
      if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
        if (cur.questionDotToken) {
          // The node's own token and a call's immediate callee token are
          // the plain entries' cases; a handled one is mid-re-dispatch
          // (its receiver read, further down, ends the walk). The walk
          // NEVER continues past an unhandled deeper token: that guard is
          // where this tail's chain enters — anything below it belongs to
          // the receiver's own (nested) chain.
          if (cur === expr || L.chainHandled.has(cur)) {
            cur = cur.expression;
            continue;
          }
          if (ts.isCallExpression(expr) && expr.expression === cur) return null;
          return cur;
        }
        cur = cur.expression;
        continue;
      }
      return null;
    }
  }

  /** True when `expr` is `require.main.filename` (either dot optional) on
   * the AMBIENT CommonJS require — the entry-module identity read. The
   * value is the ENTRY file's path, a compile-time constant like
   * __filename; ESM files stay out (Node never defines require there —
   * the ambient symbol would not resolve anyway). Shared by the property
   * lowering (the fold) and lowerStringMethodCall's receiver gate (the
   * checker types the chain `string | undefined`, but the folded receiver
   * IS a string). */
  export function isRequireMainFilename(L: Lowerer, expr: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(expr) || expr.name.text !== "filename") return false;
    const main = expr.expression;
    if (!ts.isPropertyAccessExpression(main) || main.name.text !== "main") return false;
    if (!L.isStdlibGlobal(main.expression, "require")) return false;
    return !isNodeEsmFile(expr.getSourceFile());
  }

  /** True when `expr` is the tail of an optional chain the STATIC chain
   * machinery should short-circuit whole: an unhandled deeper `?.` whose
   * guarded receiver lowers as a unit-armed union. Dyn ('unknown') and
   * island ('any') receivers answer their tails through their own
   * undefined-propagating reads and stay out; never-nullish receivers fold
   * at the token's own entry. */
  export function chainTailClaimed(L: Lowerer, expr: ts.Expression): boolean {
    const tail = chainTailDot(L, expr);
    if (!tail) return false;
    const recvT = L.mapTypeOf(L.typeOf(tail.expression));
    if (recvT?.kind !== "union") return false;
    const def = L.unions.get(recvT.unionId);
    return !!def && def.arms.some(isUnitType);
  }

  /** True when an EARLIER step of this access chain carries `?.` — JS
   * short-circuits the whole tail (`a?.b.c` reads nothing when a is
   * nullish), so a dyn tail read must answer undefined instead of
   * throwing. Walks the receiver spine only; the argument of the access
   * itself is not part of the guard. */
  export function chainGuardedByQuestionDot(expr: ts.Expression): boolean {
    let cur: ts.Expression = expr;
    for (;;) {
      if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
        cur = cur.expression;
        continue;
      }
      if (
        ts.isPropertyAccessExpression(cur) ||
        ts.isElementAccessExpression(cur) ||
        ts.isCallExpression(cur)
      ) {
        if (cur.questionDotToken) return true;
        cur = cur.expression;
        continue;
      }
      return false;
    }
  }

  /** True when the checker proves this expression is neither null nor
   * undefined — so an optional link over it cannot short-circuit and `?.`
   * IS `.`. `any` and `unknown` answer FALSE deliberately: their values do
   * exist as island handles and dyn nodes, and their own arms of
   * lowerOptionalChain answer the guard over them. Reads through L.typeOf,
   * so an enclosing chain's narrow counts. A PROOF, in the direction where
   * a wrong `true` would stop declining and start evaluating what `?.`
   * skips — so every nullish constituent, and `void`/`never` besides,
   * answers `false`, and `false` is the pre-existing behaviour exactly. */
  function recvNeverNullish(L: Lowerer, node: ts.Expression): boolean {
    const t = L.typeOf(node);
    const bad = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Null |
      ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never;
    if ((t.flags & bad) !== 0) return false;
    const parts = t.isUnionType() ? t.getTypes() : [t];
    return !parts.some((p) => (p.flags & bad) !== 0);
  }

export function lowerOptionalChain(L: Lowerer, expr: ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression,): IrExpr {
    const loc = locOf(expr);
    // The node CARRYING the ?. token and the receiver expression it guards.
    let dotNode: ts.Node;
    let recvNode: ts.Expression;
    if (ts.isCallExpression(expr) && expr.questionDotToken) {
      dotNode = expr; // f?.()
      recvNode = expr.expression;
    } else if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.questionDotToken
    ) {
      dotNode = expr.expression; // a?.m()
      recvNode = expr.expression.expression;
    } else if (
      (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) &&
      expr.questionDotToken
    ) {
      dotNode = expr; // a?.b / a?.[i]
      recvNode = expr.expression;
    } else {
      // TAIL entry: the token sits deeper in the receiver spine and JS
      // short-circuits the WHOLE tail with it (`x?.trim().toLowerCase()`
      // reads nothing when x is nullish). The guarded member step becomes
      // the chain's dot; every step above it lowers inside the guard, its
      // checker type narrowed non-nullish below (the tag test proved it).
      const tail = chainTailDot(L, expr);
      if (!tail) {
        // A `f?.()` step under a member tail, or no token at all (a
        // dispatch bug): short-circuiting those is not modeled.
        L.unsupported(
          "SC1090",
          expr,
          "multi-step optional chains (split them: const v = a?.b; then use v?.c)",
        );
      }
      dotNode = tail;
      recvNode = tail.expression;
    }
    // A receiver the checker proves NEITHER null NOR undefined: `?.` IS `.`
    // — no short-circuit can happen, so the chain's value is the plain
    // form's. The gate below opens by lowering that receiver as a
    // STANDALONE value, and a great many receivers deliberately have none:
    // `JSON.stringify` as a function value, `process.versions`, a `new
    // Intl.NumberFormat(...)` instance, and — in a JavaScript source — the
    // `[builtin Object]` identity token that stands in for a stdlib global.
    // Demanding a value there refuses a result that is already known, and
    // the receiver subtree is DISCARDED a few lines below anyway (the
    // never-nullish arm re-lowers `expr` from scratch), so building it buys
    // nothing and costs whatever the lowering interned on the way past — a
    // dead class layout, a dead record shape, a dead %env.snapshot helper.
    // Re-dispatch the plain lowering with the token marked handled: the
    // receiver and the arguments evaluate exactly as the unguarded
    // spelling's do, which is what JS does when the receiver is not
    // nullish. This is the stance isRequireMainFilename and
    // processVersionsMember take one construct up, generalized instead of
    // special-cased a third time. 'any'/'unknown' receivers stay out — the
    // island and dyn worlds answer their own optional links below, over
    // values that DO exist — and a checker-nullish receiver keeps the old
    // path entirely, so nothing that already worked is re-routed. No narrow
    // is written: the gate IS "the checker says non-nullish", so
    // getNonNullableType would be the identity, and a TAIL's intermediate
    // steps carry their plain types for the same reason (TypeScript adds
    // the `| undefined` only where the chain CAN short-circuit).
    if (recvNeverNullish(L, recvNode)) {
      L.chainHandled.add(dotNode);
      try {
        return L.lowerExpr(expr);
      } finally {
        L.chainHandled.delete(dotNode);
      }
    }
    const receiver = L.lowerExpr(recvNode);
    if (receiver.type.kind === "dyn") {
      // `pkg?.name` / `pkg?.scripts?.[k]` on a JSON.parse result: dyn
      // represents undefined directly, so the chain step IS the keyed
      // read with the optional (unit-answers-undefined) policy — no
      // optChain wrapper needed; nested steps compose the same way.
      if (dotNode === expr && ts.isPropertyAccessExpression(expr)) {
        const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
        return L.maybeNarrow({ kind: "dynKeyGet", key, optional: true, value: receiver, type: DYN, loc }, expr);
      }
      if (dotNode === expr && ts.isElementAccessExpression(expr)) {
        const key = L.lowerExpr(expr.argumentExpression);
        if (key.type.kind === "string") {
          return L.maybeNarrow({ kind: "dynKeyGet", key, optional: true, value: receiver, type: DYN, loc }, expr);
        }
        // NUMBER-typed indices (`entries?.[0]`): the property key is
        // ToString(i), exactly JS — the canonical number text answers
        // array indices in the dyn helper, anything else (fractions,
        // negatives, NaN) reads as an absent key.
        if (key.type.kind === "f64") {
          const skey: IrExpr = { kind: "toString", operand: key, type: STRING, loc: key.loc };
          return L.maybeNarrow({ kind: "dynKeyGet", key: skey, optional: true, value: receiver, type: DYN, loc }, expr);
        }
      }
      // The METHOD-call step (`rawName?.match(re)` on a dyn value): a
      // nullish receiver short-circuits to the undefined dyn singleton
      // (dyn represents undefined directly); anything else runs the
      // VALIDATED dynamic dispatch — the same one the truthy-guarded
      // spelling (`v ? v.match(...) : null`) compiles to, Node-shaped
      // TypeError on a kind mismatch included. The dispatch's static
      // result converts back into the checked-dynamic tree (the chain's checker type is
      // the error-any world's `any`, so dyn IS its representation).
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(dotNode) &&
        dotNode === expr.expression
      ) {
        const m = dotNode.name.text;
        const id = `chain.${L.chainCounter++}`;
        const recvRef: IrExpr = { kind: "chainRecv", id, type: DYN, loc: locOf(recvNode) };
        L.chainRecvByNode.set(recvNode, recvRef);
        L.chainHandled.add(dotNode);
        let body: IrExpr;
        try {
          body = L.lowerExpr(expr);
        } finally {
          L.chainRecvByNode.delete(recvNode);
          L.chainHandled.delete(dotNode);
        }
        if (body.type.kind !== "dyn") {
          if (body.type.kind !== "void" && !L.dynConvertible(body.type)) {
            L.unsupported(
              "SC1100",
              expr,
              `optional METHOD calls on 'unknown' values where the result ('${L.fmt(body.type)}' ` +
                `from '.${m}(...)') has no dynamic representation`,
            );
          }
          if (body.type.kind === "void") {
            return { kind: "optChain", id, receiver, body, type: VOID, loc };
          }
          body = { kind: "dynFrom", value: body, type: DYN, loc };
        }
        return { kind: "optChain", id, receiver, body, type: DYN, loc };
      }
      L.unsupported("SC1100", expr, "optional chaining on 'unknown' values");
    }
    // An 'any' (island-handle) receiver: the nullish test asks the ENGINE
    // value at runtime — null/undefined short-circuit to the engine's
    // undefined (JS: null receivers yield undefined too), anything else
    // proceeds as the plain island operation with the receiver evaluated
    // once (argument side effects stay lazy, like every optChain). The
    // result is an island value again ('any' in, 'any' out).
    if (receiver.type.kind === "jsval") {
      const id = `chain.${L.chainCounter++}`;
      const recvRef: IrExpr = { kind: "chainRecv", id, type: JSVAL, loc: locOf(recvNode) };
      if (dotNode === expr && ts.isCallExpression(expr)) {
        // `a.b?.(...)` — a MEMBER callee: JS calls it with `this` bound to
        // `a` and short-circuits a nullish member — exactly the engine's
        // own `o.name?.()` (optCallMethod: the RECEIVER is `a`, evaluated
        // once through the chain; a nullish `a` itself short-circuits
        // earlier like any optional chain). Computed members keep a fence.
        if (ts.isPropertyAccessExpression(recvNode) || ts.isElementAccessExpression(recvNode)) {
          if (
            ts.isPropertyAccessExpression(recvNode) &&
            !recvNode.questionDotToken
          ) {
            const obj = L.lowerExpr(recvNode.expression);
            if (obj.type.kind !== "jsval") L.badType(recvNode.expression, L.typeOf(recvNode.expression));
            const args = expr.arguments.map((a) => L.jsvalIn(L.lowerExpr(a), a));
            return { kind: "jsOp", op: "optCallMethod", name: recvNode.name.text, args: [obj, ...args], type: JSVAL, loc };
          }
          L.unsupported(
            "SC1090",
            expr,
            "optional calls of computed 'any' member values (a[k]?.() — bind the member to a const first)",
          );
        }
        const args = expr.arguments.map((a) => L.jsvalIn(L.lowerExpr(a), a));
        const body: IrExpr = { kind: "jsOp", op: "callFn", args: [recvRef, ...args], type: JSVAL, loc };
        return { kind: "optChain", id, receiver, body, type: JSVAL, loc };
      }
      // Member forms (`x?.y`, `x?.y(...)`, `x?.[i]`): re-dispatch the plain
      // island lowering with the receiver node bound to the chain.
      L.chainRecvByNode.set(recvNode, recvRef);
      L.chainHandled.add(dotNode);
      let body: IrExpr;
      try {
        body = L.lowerExpr(expr);
      } finally {
        L.chainRecvByNode.delete(recvNode);
        L.chainHandled.delete(dotNode);
      }
      if (body.type.kind !== "jsval") L.badType(expr, L.typeOf(expr));
      return { kind: "optChain", id, receiver, body, type: JSVAL, loc };
    }
    const def = receiver.type.kind === "union" ? L.unions.get(receiver.type.unionId) : undefined;
    if (!def || !def.arms.some(isUnitType)) {
      // Never nullish: `?.` IS `.` — re-dispatch the plain lowering. The
      // receiver subtree above is discarded (lowering is pure IR
      // construction); the fresh dispatch lowers it again in place. The
      // checker may still SPELL the receiver nullable while the lowering
      // answers the plain value (`process.getuid?.()` is the POSIX
      // number), so narrow the node too — downstream receiver-typed
      // dispatch must agree with the lowered value, not the spelling.
      L.chainHandled.add(dotNode);
      const hadNarrow = L.chainNarrowedType.has(recvNode);
      if (!hadNarrow) {
        L.chainNarrowedType.set(
          recvNode,
          L.checker.getNonNullableType(L.checker.getTypeAtLocation(recvNode)),
        );
      }
      try {
        return L.lowerExpr(expr);
      } finally {
        L.chainHandled.delete(dotNode);
        if (!hadNarrow) L.chainNarrowedType.delete(recvNode);
      }
    }
    const rest = def.arms.filter((a) => !isUnitType(a));
    if (rest.length !== 1) {
      L.unsupported(
        "SC1090",
        expr,
        `'?.' on '${L.fmt(receiver.type)}' (the guarded receiver is a sub-union; check a discriminant field first)`,
      );
    }
    const narrowed = rest[0]!;
    const id = `chain.${L.chainCounter++}`;
    const recvRef: IrExpr = { kind: "chainRecv", id, type: narrowed, loc: locOf(recvNode) };

    // `f?.()`: the callee IS the guarded value — build the indirect call
    // directly (no member dispatch exists to re-enter).
    if (dotNode === expr && ts.isCallExpression(expr)) {
      if (narrowed.kind !== "func") L.badType(recvNode, L.typeOf(recvNode));
      const params = narrowed.params;
      const args = expr.arguments.map((a, i) => L.lowerExprExpecting(a, params[i]));
      const body: IrExpr = { kind: "callValue", callee: recvRef, args, type: narrowed.ret, loc };
      return L.finishOptionalChain(expr, id, receiver, body, loc);
    }

    // Member forms: re-dispatch the normal lowering with the receiver node
    // bound to the chain (reads as chainRecv, types as non-nullish).
    const narrowedTs = L.checker.getNonNullableType(L.checker.getTypeAtLocation(recvNode));
    L.chainRecvByNode.set(recvNode, recvRef);
    L.chainNarrowedType.set(recvNode, narrowedTs);
    L.chainHandled.add(dotNode);
    // A TAIL entry's intermediate steps (`x?.trim()` inside
    // `x?.trim().toLowerCase()`) checker-type with the chain's `|
    // undefined` even though inside the guard they are proven non-nullish
    // — narrow each so the downstream method/member dispatch rides the
    // real receiver kind. Only nodes this chain registers are cleaned up.
    const tailSteps: ts.Expression[] = [];
    if (dotNode !== expr && !(ts.isCallExpression(expr) && expr.expression === dotNode)) {
      for (let cur: ts.Expression = expr; cur !== dotNode; ) {
        const next: ts.Expression = ts.isCallExpression(cur)
          ? cur.expression
          : (cur as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
        if (next === dotNode) break;
        if (!L.chainNarrowedType.has(next)) {
          L.chainNarrowedType.set(
            next,
            L.checker.getNonNullableType(L.checker.getTypeAtLocation(next)),
          );
          tailSteps.push(next);
        }
        cur = next;
      }
      if (!L.chainNarrowedType.has(dotNode)) {
        L.chainNarrowedType.set(
          dotNode,
          L.checker.getNonNullableType(L.checker.getTypeAtLocation(dotNode)),
        );
        tailSteps.push(dotNode as ts.Expression);
      }
    }
    let body: IrExpr;
    try {
      body = L.lowerExpr(expr);
    } finally {
      L.chainRecvByNode.delete(recvNode);
      L.chainNarrowedType.delete(recvNode);
      L.chainHandled.delete(dotNode);
      for (const n of tailSteps) L.chainNarrowedType.delete(n);
    }
    return L.finishOptionalChain(expr, id, receiver, body, loc);
  }

/** The optChain node around a lowered chain body: void bodies keep the
   * statement form (`cb?.();` — the checker's `void | undefined` result IS
   * void here); value bodies wrap into the checker's undefined-armed
   * result union. */
  export function finishOptionalChain(L: Lowerer, expr: ts.Expression,
    id: string,
    receiver: IrExpr,
    body: IrExpr,
    loc: SrcLoc,): IrExpr {
    if (body.type.kind === "void") {
      return { kind: "optChain", id, receiver, body, type: VOID, loc };
    }
    // A dyn body (`pricing?.[key]` — an unknown-valued index-signature
    // read) stays dyn: `unknown | undefined` IS unknown, and dyn represents
    // undefined directly (the unit path yields the undefined dyn value).
    if (body.type.kind === "dyn") {
      return { kind: "optChain", id, receiver, body, type: DYN, loc };
    }
    const type = L.irTypeOf(expr);
    if (type.kind !== "union" || L.armTag(type.unionId, UNDEFINED_T) < 0) {
      L.unsupported(
        "SC1090",
        expr,
        `'?.' where the result '${L.fmt(type)}' has no undefined arm (narrow the receiver with 'if (x !== undefined)' instead)`,
      );
    }
    const wrapped = L.coerceToExpected(body, type);
    if (!typeEquals(wrapped.type, type)) L.badType(expr, L.typeOf(expr));
    return { kind: "optChain", id, receiver, body: wrapped, type, loc };
  }

/** A CONDITION-position expression: the result is consumed as a bool
   * only, so `&&`/`||` descend recursively over ToBoolean'd operands —
   * JS-exact (`ToBoolean(a && b)` ≡ `ToBoolean(a) && ToBoolean(b)`), still
   * short-circuiting, and mixed operand kinds that have no VALUE
   * representation (`u && flag` — a union and a bool) test fine here. */
  export function lowerCondition(L: Lowerer, expr: ts.Expression): IrExpr {
    let e: ts.Expression = expr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const isAnd = op === ts.SyntaxKind.AmpersandAmpersandToken;
        const left = L.lowerCondition(e.left);
        // A left operand that DECIDED at compile time answers the whole
        // test, and the right one never evaluates — so it never lowers
        // either. The value-position twin of this fold carries the
        // argument; in TEST position the answer is simply the constant.
        if (left.kind === "boolLit" && left.value !== isAnd) return left;
        // The right operand evaluates only when the left already answered
        // (true for &&, false for ||) — aliased-typeof narrows the left
        // PROVES under that polarity hold while it lowers (`type ===
        // 'string' && val.length > 0`, the ms entry shape).
        const right = L.narrowingAliases(aliasTypeofNarrows(L, e.left, isAnd), () =>
          L.lowerCondition(e.right),
        );
        // ...and a left that decided the OTHER way leaves the right as the
        // whole answer (`false || cond` IS cond).
        if (left.kind === "boolLit") return right;
        return {
          kind: "logical",
          op: isAnd ? "&&" : "||",
          left,
          right,
          type: BOOL,
          loc: locOf(expr),
        };
      }
    }
    return L.ensureBool(L.lowerExpr(expr), expr);
  }

/** JS ToBoolean: bool passes through; f64/string get a `toBool` wrapper
   * (falsy: 0, -0, NaN, ""); unions get the same wrapper answered by a
   * per-union interned helper (unit arms falsy; scalar/string arms by
   * value; ref arms always truthy). Anything else (void) cannot be
   * tested. */
  export function ensureBool(L: Lowerer, e: IrExpr, node: ts.Expression): IrExpr {
    // A LITERAL operand: ToBoolean is a compile-time constant, so the test
    // is one — which is what lets the short-circuit and ternary folds
    // downstream drop the branch JS never evaluates. A literal has no
    // effects, so nothing is lost by not testing it at runtime.
    {
      const t = staticTruth(e);
      if (t !== null) return { kind: "boolLit", value: t, type: BOOL, loc: e.loc };
    }
    // An index-signature keyed read tested for truthiness (`if (attrs.id)`
    // — the author's own absent-key branch): JS asks the VALUE, and an
    // absent key is undefined, which is falsy. The read's declared type
    // cannot say that, so the miss used to trap on the way to a ToBoolean
    // that would have answered false. At dyn width the truthy kind test
    // answers it — the same routing the comparisons take
    // (unitTestAtDynWidth, and recordKeyReadAtSlotWidth's contract).
    // The same question one binding later: `const id = attrs.id; if (!id)`.
    // The local holds the read at dyn width, so every REFERENCE to it wears
    // the checker's scalar bridge (maybeNarrow) — and a bridge is exactly
    // what a truthiness test must look through: ToBoolean has an answer for
    // every dyn kind, undefined included, so asking the dyn answers the
    // author's own absent-key branch instead of throwing on the way to it.
    // On a soundly narrowed dyn the two agree by construction.
    {
      const atWidth = L.recordKeyReadAtSlotWidth(e, DYN) ?? narrowBridgeDyn(e);
      if (atWidth) return { kind: "dynTest", test: "truthy", value: atWidth, type: BOOL, loc: e.loc };
    }
    if (e.type.kind === "bool") return e;
    if (e.type.kind === "f64" || e.type.kind === "string") {
      return { kind: "toBool", operand: e, type: BOOL, loc: e.loc };
    }
    if (e.type.kind === "dyn") {
      // ToBoolean over the checked-dynamic tree (`if (pkg)` on a JSON.parse result): every
      // dyn kind has a JS-exact answer — the truthy dynTest reads the kind
      // tag (plus the scalar payload for number/string).
      return { kind: "dynTest", test: "truthy", value: e, type: BOOL, loc: e.loc };
    }
    if (e.type.kind === "jsval") {
      // ToBoolean of an island value — the engine answers (never throws).
      return { kind: "jsOp", op: "truthy", args: [e], type: BOOL, loc: e.loc };
    }
    if (e.type.kind === "union") {
      L.requireTruthyUnion(e.type.unionId, node);
      return { kind: "toBool", operand: e, type: BOOL, loc: e.loc };
    }
    if (REF_TRUTHY_KINDS.has(e.type.kind)) {
      // JS objects are ALWAYS truthy ([] and {} included) — the operand
      // still evaluates (side effects), the test is constant.
      return { kind: "toBool", operand: e, type: BOOL, loc: e.loc };
    }
    // Bare unit values (undefined/null literals, the capability-probe
    // reads that answer them): ToBoolean is constantly false. Units have
    // no effectful producers, so folding the read away loses nothing.
    if (isUnitType(e.type)) {
      return { kind: "boolLit", value: false, type: BOOL, loc: e.loc };
    }
    L.badType(node, L.typeOf(node));
  }

/** Truthiness needs a ToBoolean per arm: dyn/caught arms have none (a
   * dynamic ToBoolean over the checked-dynamic tree / the snapshot box) — fence those
   * unions; every other arm kind is answerable (units false, scalars and
   * strings by value, refs true, jsval by the engine). */
  export function requireTruthyUnion(L: Lowerer, unionId: string, node: ts.Expression): void {
    const def = L.unions.get(unionId);
    if (def && def.arms.every((a) => a.kind !== "dyn" && a.kind !== "caught")) return;
    L.unsupported(
      "SC1090",
      node,
      `union-typed conditions with 'unknown' arms (${NARROW_FIRST})`,
    );
  }

/** Strict equality needs a per-arm comparison: units, scalars, strings,
   * and ref kinds (pointer identity) all have one; dyn/caught arms have no
   * static equality and jsval arms would need the engine's `===` — those
   * unions keep the narrow-first fence. */
  export function eqComparableUnion(L: Lowerer, unionId: string): boolean {
    const def = L.unions.get(unionId);
    return (
      !!def &&
      def.arms.every((a) => a.kind !== "dyn" && a.kind !== "caught" && a.kind !== "jsval")
    );
  }

/** Property access on a string or array receiver: `.length` lowers to the
   * matching intrinsic; a bare method reference (`const f = s.slice` — a
   * function value) is rejected with a specific message. Returns null for
   * other receivers (the generic property-access rejection applies). Both
   * the receiver type AND the ambient-file provenance of the member are
   * verified — the name alone proves nothing. */
  /** `<mapIterCall>.next().value` → the drained array's `.at(0)`. Null for
   * every other property access, so callers just try it first. */
  function lowerIterFirstValue(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (expr.name.text !== "value" || expr.questionDotToken) return null;
    const nextCall = expr.expression;
    if (!ts.isCallExpression(nextCall) || nextCall.arguments.length !== 0) return null;
    const nextAccess = nextCall.expression;
    if (!ts.isPropertyAccessExpression(nextAccess) || nextAccess.name.text !== "next") return null;
    // The receiver must be a Map/Set iterator CALL (never a stored one):
    // its lowering is the drained array.
    const iterCall = nextAccess.expression;
    if (!ts.isCallExpression(iterCall) || !ts.isPropertyAccessExpression(iterCall.expression)) return null;
    const iterName = iterCall.expression.name.text;
    if (iterName !== "entries" && iterName !== "keys" && iterName !== "values") return null;
    const recvKind = L.mapTypeOf(L.typeOf(iterCall.expression.expression))?.kind;
    if (recvKind !== "map" && recvKind !== "set") return null;
    const drained = L.lowerExpr(iterCall);
    if (drained.type.kind !== "array") return null;
    // The result type is built FROM the drained element, not read off the
    // checker at this node: inside a generic method the node's checker
    // type is the same for every monomorphization, so taking it here
    // would hand one instantiation's shape to another. The drained array
    // came from the receiver's own lowered map type, which is already
    // substituted, so `elem | undefined` is instantiation-correct.
    const resultT = L.withUndefinedArmOf(drained.type.elem);
    if (resultT === null || resultT.kind !== "union") return null;
    const loc = locOf(expr);
    const zero: IrExpr = { kind: "numLit", value: 0, type: F64, loc };
    return arrayAtOf(L, drained, zero, drained.type.elem, resultT, expr, loc);
  }

  export function lowerIntrinsicProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (L.chainBlocked(expr)) return null;
    // `m.entries().next().value` — the take-the-first-entry idiom. The
    // iterator is never STORED here, so no iterator object has to exist:
    // entries()/keys()/values() already lower to a drained array of the
    // map's live entries in insertion order, and stepping a FRESH
    // iterator once is exactly that array's first element (or undefined
    // when the map is empty), which is what `.at(0)` answers. A stored
    // iterator, `.done`, or a second `.next()` keeps the fence — those
    // need real iterator state.
    {
      const viaFirst = lowerIterFirstValue(L, expr);
      if (viaFirst) return viaFirst;
    }
    // A never-tainted JS receiver type lowered checked-dynamic
    // (neverTaintedJsType — `cmd.length` on `const cmd = ['pwd', []]`):
    // stand down so the dyn keyed read below the chain answers, instead
    // of an array libCall over a dyn receiver hitting the boundary fence.
    let kind = neverTaintedJsType(L, expr.expression, L.typeOf(expr.expression))
      ? undefined
      : L.mapTypeOf(L.typeOf(expr.expression))?.kind;
    // A checker-`any[]` receiver (the readonly-array Array.isArray quirk)
    // whose VALUE lowers to a real static array (maybeNarrow's isArray
    // bridge): `.length` and friends ride the array path on the lowered
    // value (re-lowering is pure IR construction).
    if (kind === undefined && L.checkerAnyArray(expr.expression)) {
      const probe = L.lowerExpr(expr.expression);
      if (probe.type.kind === "array") kind = "array";
    }
    // The MIRROR of that bridge, inside a MONOMORPHIZED generic body. The
    // checker keeps reporting the DECLARED types there, so a member
    // reached through a type parameter's APPARENT type reads as the
    // CONSTRAINT: `input.schema.parts` under `S extends Schema` is the
    // constraint's `ReadonlyArray<Part>` — an array — while the instance's
    // own parameter, mapped from the RESOLVED signature, is the concrete
    // positional TUPLE. `length` is the one member both spellings answer,
    // and over a tuple its answer is the arity CONSTANT (lowerFieldRead's
    // rule for a tuple record). Fold it here on the LOWERED value, which
    // is the instantiation's truth: emitting the array intrinsic instead
    // hands the validator an array op over a record and ICEs
    // (`arrIntrinsic length on non-array record`) on a program tsc
    // accepts. Every other member keeps its fence — the value IS a record
    // and no array operation is representable over it.
    //
    // Gated on being inside an instantiation (typeParamBindings live), so
    // an ordinary array `.length` never pays the probe.
    if (
      kind === "array" && expr.name.text === "length" &&
      L.typeParamBindings !== null && L.typeParamBindings.size > 0
    ) {
      const probe = L.lowerExpr(expr.expression);
      const shape = probe.type.kind === "record" ? L.shapes.get(probe.type.shapeId) : undefined;
      if (shape?.tuple) {
        // Folding discards the receiver's evaluation, so only a
        // side-effect-free receiver folds — the record path's restriction.
        let root: ts.Expression = expr.expression;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (!ts.isIdentifier(root) && root.kind !== ts.SyntaxKind.ThisKeyword) {
          L.unsupported(
            "SC1090",
            expr,
            "'.length' of a computed tuple expression (the arity is a constant — bind the tuple to a const first)",
          );
        }
        return { kind: "numLit", value: shape.fields.length, type: F64, loc: locOf(expr) };
      }
    }
    if (kind !== "string" && kind !== "array" && kind !== "map" && kind !== "set" && kind !== "f64" && kind !== "regex" && kind !== "url" && kind !== "searchParams" && kind !== "stats" && kind !== "fileHandle" && kind !== "spawnRes" && kind !== "child" && kind !== "bytes" && kind !== "symbol") {
      return null;
    }
    // child receivers also admit the user's own child-shaped interface
    // members (the NgrokChildProcess duck rule — see isChildSurfaceMember).
    // The EMPTY tuple `[]` rides the array REPRESENTATION (types.ts), but
    // its `length` member is the tuple's own synthesized property, not
    // Array.prototype's — provenance alone would refuse it. It reads the
    // runtime length (always 0) through the array intrinsic like any other
    // array; non-empty tuples never reach here (they map to records and
    // fold their arity constant on the record path).
    const tupleLengthOnArray =
      kind === "array" &&
      expr.name.text === "length" &&
      everyArmIsTuple(L, L.checker.getBaseTypeOfLiteralType(L.typeOf(expr.expression)));
    if (kind === "child" ? !isChildSurfaceMember(L, expr) : !tupleLengthOnArray && !L.isStdlibMember(expr)) return null;
    const name = expr.name.text;
    if (kind === "child") {
      const loc = locOf(expr);
      // The lifecycle reads, Node's exact shapes (SEMANTICS.md pins the
      // matrix): pid is `number | undefined` (undefined = spawn failure),
      // exitCode `number | null` (null while running and after a signal
      // death; -errno once a spawn failure settled), killed the
      // sent-a-signal flag. The unions build type-directedly in the
      // backend (the spawnRes.status pattern); a checker-narrowed read
      // extracts through maybeNarrow like any union member.
      if (name === "pid") {
        const receiver = L.lowerExpr(expr.expression);
        const type: IrType = { kind: "union", unionId: L.unions.intern([F64, UNDEFINED_T]) };
        return { kind: "libCall", fn: "child.pid", args: [receiver], type, loc };
      }
      if (name === "exitCode") {
        const receiver = L.lowerExpr(expr.expression);
        const type: IrType = { kind: "union", unionId: L.unions.intern([F64, NULL_T]) };
        return { kind: "libCall", fn: "child.exitCode", args: [receiver], type, loc };
      }
      if (name === "killed") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "libCall", fn: "child.killed", args: [receiver], type: BOOL, loc };
      }
      if (name === "on" || name === "kill" || name === "unref") {
        L.unsupported("SC1090", expr, `child methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `ChildProcess.${name}`,
        expr,
        "on(\"exit\" | \"error\", cb), pid, exitCode, killed, kill(signal?), and unref() are the supported ChildProcess members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "spawnRes") {
      // The spawnSync-result reads. status is the interned `number | null`
      // union (null = signal death or spawn failure); stdout/stderr are
      // the captured utf8 strings — under @types/node WITHOUT the
      // {encoding: "utf8"} options argument the checker types them Buffer,
      // which is re-fenced here (the call site already said so).
      const loc = locOf(expr);
      if (name === "status") {
        // Always the interned `number | null` union; a checker-NARROWED
        // read (`missing.status === null ? ... : ${missing.status}`)
        // bridges through maybeNarrow like any union read.
        const receiver = L.lowerExpr(expr.expression);
        const type: IrType = { kind: "union", unionId: L.unions.intern([F64, NULL_T]) };
        const read: IrExpr = { kind: "libCall", fn: "spawnRes.status", args: [receiver], type, loc };
        return L.maybeNarrow(read, expr);
      }
      if (name === "stdout" || name === "stderr") {
        if (L.mapTypeOf(L.typeOf(expr))?.kind !== "string") {
          L.noLowering(
            `spawnSync's ${name} without the "utf8" encoding`,
            expr,
            'Buffer captures are not representable — call spawnSync(cmd, args, { encoding: "utf8" }) so the outputs are strings',
          );
        }
        const receiver = L.lowerExpr(expr.expression);
        const fn = name === "stdout" ? "spawnRes.stdout" : "spawnRes.stderr";
        return { kind: "libCall", fn, args: [receiver], type: STRING, loc };
      }
      if (name === "error") {
        // Node's spawn-failure carrier: `Error | undefined` — a fresh
        // %Error ("spawnSync <file> ENOENT", `code` stamped) when the
        // spawn itself failed, the undefined arm otherwise. The libCall
        // always carries the interned union (the declared `error?: Error`),
        // and a checker-NARROWED read (`if (r.error) r.error.message`)
        // bridges through maybeNarrow like any union read.
        const receiver = L.lowerExpr(expr.expression);
        const type = L.withUndefinedArmOf({ kind: "object", className: "%Error" });
        if (!type) L.badType(expr, L.typeOf(expr));
        const read: IrExpr = { kind: "libCall", fn: "spawnRes.error", args: [receiver], type, loc };
        return L.maybeNarrow(read, expr);
      }
      L.noLowering(
        `SpawnSyncReturns.${name}`,
        expr,
        "status, stdout, stderr, and error are the supported spawnSync-result members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "fileHandle") {
      if (name === "fd") {
        // Node's filehandle.fd — the owned descriptor, or -1 once closed.
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "libCall", fn: "fh.fd", args: [receiver], type: F64, loc: locOf(expr) };
      }
      if (name === "read" || name === "close") {
        L.unsupported("SC1090", expr, `FileHandle methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `FileHandle.${name}`,
        expr,
        "read(buffer, offset, length, position), close(), and fd are the supported FileHandle members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "stats") {
      if (name === "size") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "libCall", fn: "stats.size", args: [receiver], type: F64, loc: locOf(expr) };
      }
      if (name === "isFile" || name === "isDirectory") {
        L.unsupported("SC1090", expr, `Stats methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `Stats.${name}`,
        expr,
        "isFile(), isDirectory(), and size are the supported Stats members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "symbol") {
      const loc = locOf(expr);
      // `.description`: the checker's `string | undefined` — undefined
      // exactly for the description-less Symbol()/Symbol(undefined) forms
      // (Symbol("") answers the EMPTY STRING arm, like Node). The interned
      // union builds in the backend from the runtime's +1-or-NULL answer
      // (the child.stdout pattern); a checker-narrowed read extracts
      // through maybeNarrow like any union member.
      if (name === "description") {
        const receiver = L.lowerExpr(expr.expression);
        const type: IrType = { kind: "union", unionId: L.unions.intern([STRING, UNDEFINED_T]) };
        return { kind: "libCall", fn: "sym.desc", args: [receiver], type, loc };
      }
      if (name === "toString" || name === "valueOf") {
        L.unsupported("SC1090", expr, `symbol methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `Symbol.prototype.${name}`,
        expr,
        "description and toString() are the supported symbol members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "url") {
      // The supported URL getters. Everything else the lib declares
      // (searchParams, setters-as-reads, ...) fences with the
      // member-qualified name and the supported list. `host` is the WHATWG
      // serialization: lowercased hostname, `:port` appended exactly when
      // a non-default port is present (scr_url_host — Node-exact,
      // opaque-path URLs answer ""); `hostname` is the stored port-less
      // host field verbatim (Node would keep IPv6 brackets here, but the
      // parser rejects IPv6 hosts — documented divergence — so the getter
      // never sees one).
      if (name === "protocol" || name === "pathname" || name === "href" || name === "host" || name === "hostname" || name === "search") {
        const receiver = L.lowerExpr(expr.expression);
        const fn =
          name === "protocol"
            ? "url.protocol"
            : name === "pathname"
              ? "url.pathname"
              : name === "host"
                ? "url.host"
                : name === "hostname"
                  ? "url.hostname"
                  : name === "search"
                    ? "url.search"
                    : "url.href";
        return { kind: "libCall", fn, args: [receiver], type: STRING, loc: locOf(expr) };
      }
      // `u.searchParams`: the LIVE cached view (one identity per URL —
      // mutations through it re-serialize into the URL's query, so href
      // reflects immediately; Node's binding exactly).
      if (name === "searchParams") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "libCall", fn: "url.searchParams", args: [receiver], type: SEARCH_PARAMS_T, loc: locOf(expr) };
      }
      if (name === "toString" || name === "toJSON") {
        L.unsupported("SC1090", expr, `URL methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `URL.${name}`,
        expr,
        "protocol, pathname, href, host, hostname, search, searchParams, and toString() are the supported URL members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "searchParams") {
      const SEARCH_PARAMS_METHODS = new Set(["get", "getAll", "set", "append", "delete", "has", "sort", "toString", "forEach", "keys", "values", "entries"]);
      // The one data property; every method lowers at its CALL
      // (lowerSearchParamsMethodCall) — bare method references fence.
      if (name === "size") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "libCall", fn: "sp.size", args: [receiver], type: F64, loc: locOf(expr) };
      }
      if (SEARCH_PARAMS_METHODS.has(name)) {
        L.unsupported("SC1090", expr, `URLSearchParams methods as values (call '${name}' directly)`);
      }
      L.noLowering(
        `URLSearchParams.${name}`,
        expr,
        "get, getAll, set, append, delete, has, sort, size, toString(), forEach, and for-of iteration are the supported URLSearchParams members",
        L.checker.getSymbolAtLocation(expr.name),
      );
    }
    if (kind === "regex") {
      if (name === "source" || name === "flags") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "regexIntrinsic", method: name, receiver, args: [], type: STRING, loc: locOf(expr) };
      }
      if (name === "test") {
        L.unsupported("SC1090", expr, "regex methods as values (call 'test' directly)");
      }
      return null;
    }
    if (kind === "f64") {
      // The only ambient members on numbers are island-backed methods; a
      // bare reference has no value form regardless of --dynamic.
      if (own(ISLAND_SURFACE.number, name) !== undefined) {
        L.unsupported("SC1090", expr, `number methods as values (call '${name}' directly)`);
      }
      return null;
    }
    if (kind === "bytes") {
      const loc = locOf(expr);
      if (name === "length" || name === "byteLength") {
        const receiver = L.lowerExpr(expr.expression);
        // An island handle behind a typed-array .d.ts surface: the engine
        // property read, exiting at the declared number type (the array
        // .length rule). Chain-handled reads stay jsval.
        if (receiver.type.kind === "jsval") {
          const read: IrExpr = { kind: "jsOp", op: "getProp", name, args: [receiver], type: JSVAL, loc };
          if (expr.questionDotToken) return read;
          return { kind: "jsExit", value: read, type: F64, loc };
        }
        return { kind: "bytesIntrinsic", method: name, receiver, args: [], type: F64, loc };
      }
      if (name === "byteOffset") {
        // 0 for owners (scriptc typed arrays own their whole storage —
        // SEMANTICS.md notes the divergence from Node's Buffer pooling),
        // the view's real offset for a DataView. A runtime read, so the
        // receiver's evaluation is never discarded.
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "bytesIntrinsic", method: "byteOffset", receiver, args: [], type: F64, loc };
      }
      if (name === "buffer") {
        // No ArrayBuffer VALUE exists — `.buffer` compiles only in the
        // one composed position that consumes it, the DataView
        // constructor's first argument (lowerDataViewNew peels it).
        L.unsupported(
          "SC1090",
          expr,
          "'.buffer' outside new DataView(x.buffer, ...) / Buffer.from(x.buffer, ...) " +
            "(no free-standing ArrayBuffer value exists; subarray() answers an aliasing view directly)",
        );
      }
      if (name === "slice" || name === "subarray" || name === "set" || name === "toString") {
        L.unsupported("SC1090", expr, `typed-array methods as values (call '${name}' directly)`);
      }
      return null; // fill, reverse, ... → the SC2020 member fence
    }
    if (kind === "map") {
      if (name === "size") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "mapIntrinsic", method: "size", receiver, args: [], type: F64, loc: locOf(expr) };
      }
      if (MAP_METHODS.has(name) || name === "forEach") {
        L.unsupported("SC1090", expr, `Map methods as values (call '${name}' directly)`);
      }
      return null;
    }
    if (kind === "set") {
      if (name === "size") {
        const receiver = L.lowerExpr(expr.expression);
        return { kind: "setIntrinsic", method: "size", receiver, args: [], type: F64, loc: locOf(expr) };
      }
      if (SET_METHODS.has(name)) {
        L.unsupported("SC1090", expr, `Set methods as values (call '${name}' directly)`);
      }
      return null;
    }
    if (name === "length") {
      const receiver = L.lowerExpr(expr.expression);
      // An island handle behind an array-typed .d.ts surface
      // (`parts().length` on a declared `string[]` return — arrays never
      // exit eagerly, so the value stays jsval): an engine property read,
      // exiting at the declared number type. Chain-handled reads stay
      // jsval (the island chain's body must be a handle).
      if (receiver.type.kind === "jsval") {
        const read: IrExpr = { kind: "jsOp", op: "getProp", name: "length", args: [receiver], type: JSVAL, loc: locOf(expr) };
        if (expr.questionDotToken) return read;
        return { kind: "jsExit", value: read, type: F64, loc: locOf(expr) };
      }
      // A CHECKED-DYNAMIC value behind an array-typed checker spelling
      // (`Object.keys(u).length` — the dyn walk answers a dyn array while
      // tsc spells string[]): the runtime-world dispatch — a dyn keyed
      // read validated into the declared number (a lying length throws
      // the catchable TypeError, the dynCheck stance).
      if (receiver.type.kind === "dyn") {
        const read: IrExpr = {
          kind: "dynKeyGet",
          key: { kind: "strLit", value: "length", type: STRING, loc: locOf(expr) },
          ...(expr.questionDotToken ? { optional: true as const } : {}),
          value: receiver,
          type: DYN,
          loc: locOf(expr),
        };
        if (expr.questionDotToken) return read;
        return { kind: "dynCheck", value: read, type: F64, loc: locOf(expr) };
      }
      return kind === "string"
        ? { kind: "strIntrinsic", method: "length", receiver, args: [], type: F64, loc: locOf(expr) }
        : { kind: "arrIntrinsic", method: "length", receiver, args: [], type: F64, loc: locOf(expr) };
    }
    if (
      kind === "string"
        ? own(STR_METHODS, name) !== undefined || own(ISLAND_SURFACE.string, name) !== undefined
        : ARRAY_METHODS.has(name)
    ) {
      // ...unless the member LIFTS: a string intrinsic whose mapped
      // signature is exactly the one the call form hands the runtime has a
      // real function value — a closure that resolves its receiver from
      // the ambient-receiver window, which is where `f.call(s, ...)` puts
      // it. Everything else keeps the fence below (see
      // stringMethodFnValueOf for what "exactly" excludes).
      if (kind === "string") {
        const lifted = stringMethodFnValueOf(L, expr);
        if (lifted) return lifted;
      }
      L.unsupported("SC1090", expr, `${kind} methods as values (call '${name}' directly)`);
    }
    return null;
  }

/** `[a, b, c]`. The element type comes from the contextual type when tsc
   * has one (`const a: number[] = []`, arguments, nested literals) and from
   * the literal's own inferred type otherwise. A bare `[]` with no context
   * is `never[]` — unmappable, rejected with the component fence (SC2009). `expected` overrides
   * the contextual lookup where the caller knows the slot's array type and
   * tsc's API doesn't surface it (ternary arms under an array context —
   * tsc accepts the arm covariantly, but a tagged element representation
   * must be BUILT as the slot's element type). */
  export function lowerArrayLiteral(L: Lowerer, expr: ts.ArrayLiteralExpression,
    expected?: (IrType & { kind: "array" }) | (IrType & { kind: "record" }),): IrExpr {
    const loc = locOf(expr);
    const ctxType = L.checker.getContextualType(expr);
    const tsType = ctxType ?? L.typeOf(expr);
    let mapped = expected ?? L.mapTypeOf(tsType);
    // A JS literal whose OWN inferred type is never-tainted
    // (neverTaintedJsType — the evolving `const gb = []`, the mixed
    // command tuple `['pwd', []]`) carries no element information: route
    // it to the checked-dynamic tree fallback below rather than letting never's f64
    // representation build a static number array (a later dyn push would
    // throw "expected number at $, got string"; the tuple's union arm
    // would re-tag as number[] and fence). A REAL slot still wins:
    // `expected`, a contextual array/tuple, or a contextual union's
    // single array arm all provide element information first.
    // (The contextual lookup can answer the binding's own tainted
    // inference back — `const cmd = ['pwd', []]` — so the slot test is a
    // taint test on whichever type mapped, not a presence test.)
    const neverTaintedOwnJs =
      expected === undefined && neverTaintedJsType(L, expr, L.typeOf(expr));
    if (expected === undefined && neverTaintedJsType(L, expr, tsType)) mapped = null;
    // A union-typed slot (`const x: string[] | number = [..]`) contextually
    // types the literal as the union; build the literal as its OWN type and
    // let the slot's coercion wrap it into the union. An unknown-typed slot
    // (`JSON.stringify([1, 2])`) likewise: build the literal's own type. An
    // UNMAPPABLE context falls back the same way — a destructuring pattern
    // without annotations contextually types its initializer `[any]`, while
    // the literal's own inferred type is the real tuple.
    if (!mapped || mapped.kind === "union" || mapped.kind === "dyn") {
      const ctxUnion = mapped?.kind === "union" ? mapped : null;
      mapped = L.mapTypeOf(L.typeOf(expr));
      // The never-tainted own type carries no element information here
      // either (the JS story above) — only a contextual union's single
      // array arm below may still supply a static home.
      if (neverTaintedOwnJs) mapped = null;
      // An EMPTY literal in a union slot (`const t: string[] | undefined =
      // []`, the `[]` default argument against `string[] | undefined`) has
      // no useful own type — tsc infers `never[]`, whose f64-element
      // mapping is a representation for the uninhabited, not the slot's
      // arm. When the contextual union has exactly ONE array arm there is
      // no ambiguity: build the literal as that arm and let the slot's
      // coercion wrap it. Two array arms would need tsc's own best-fit
      // choice — none arises in practice; the fence stands.
      if (ctxUnion && expr.elements.length === 0) {
        const def = L.unions.get(ctxUnion.unionId);
        const arrayArms = def?.arms.filter((a) => a.kind === "array") ?? [];
        if (arrayArms.length === 1) mapped = arrayArms[0]!;
      }
      // A NON-EMPTY literal whose own type has no static home (the JS dyn
      // fallback — a null/dyn mapping, or an inference that degraded to a
      // unit-only-element array over non-unit elements) under a union
      // with exactly ONE array-family arm — an array, or an
      // arity-matching tuple (the option-table `default: [{ value: [] }]`
      // shape): build AS that arm, exactly the empty-literal rule above;
      // the slot's coercion wraps it.
      if (ctxUnion && expr.elements.length > 0) {
        // A unit-only-element array (`(null | undefined)[]`) cannot hold
        // non-unit elements — neither as the literal's own mapping nor as
        // a competing union arm.
        const nonUnitElems = expr.elements.some(
          (el) =>
            !ts.isOmittedExpression(el) &&
            el.kind !== ts.SyntaxKind.NullKeyword &&
            !(ts.isIdentifier(el) && el.text === "undefined"),
        );
        const ownUnhelpful =
          mapped === null || mapped.kind === "dyn" ||
          // The checker echoing the context union back as the literal's
          // own type decides nothing either — nor does an island ('any')
          // residue under a STATIC union slot.
          mapped.kind === "union" || mapped.kind === "jsval" ||
          (mapped.kind === "array" && nonUnitElems && L.unitOnlyElem(mapped.elem)) ||
          // An own ARRAY type looks helpful and need not be: it is the type
          // the ELEMENTS infer on their own, and for a recursive slot that
          // is the narrow one-level unfolding each literal spells
          // (`kids: undefined` infers `kids: null | undefined`, and two
          // differently-shaped siblings infer a UNION of their two
          // shapes). The slot's arm is what the elements must become, and
          // contextual typing says so. One array arm means no ambiguity;
          // an identical arm makes the choice moot.
          ((): boolean => {
            if (mapped?.kind !== "array") return false;
            const ownElem = mapped.elem;
            const arrayArms = (L.unions.get(ctxUnion.unionId)?.arms ?? []).filter(
              (a) => a.kind === "array",
            );
            return arrayArms.length === 1 && !typeEquals(arrayArms[0]!.elem, ownElem);
          })();
        if (ownUnhelpful) {
          const def = L.unions.get(ctxUnion.unionId);
          const arms = (def?.arms ?? []).filter(
            (a) =>
              (a.kind === "array" && !(nonUnitElems && L.unitOnlyElem(a.elem))) ||
              (a.kind === "record" &&
                !!L.shapes.get(a.shapeId)?.tuple &&
                L.shapes.get(a.shapeId)!.fields.length === expr.elements.length),
          );
          if (arms.length === 1) mapped = arms[0]!;
        }
      }
    }
    // An EMPTY literal under a CONST ASSERTION whose type queries panicked
    // (tsgo's readonly-[] TupleType conversion — the facade answers `any`,
    // which maps to nothing statically and to an island value under
    // --dynamic): the value is provably the empty tuple; ride the
    // unit-element array, mapType's own `[] as const` rule.
    if (
      (mapped === null || mapped.kind === "jsval") &&
      expr.elements.length === 0 &&
      (tsType.flags & ts.TypeFlags.Any) !== 0 &&
      underConstAssertion(expr)
    ) {
      mapped = arrayOf(unitOnlyUnion(L.unions));
    }
    // A TUPLE-typed slot (`const t: [string, number] = ["a", 1]`): the
    // literal constructs the tuple's record shape — one positional field
    // per element, source order (which IS index order, so evaluation order
    // is JS-exact). tsc has already checked the arity; the recount below
    // backstops `as` smuggling. Spreads have no fixed positions — fenced.
    if (mapped?.kind === "record") {
      const shape = L.shapes.get(mapped.shapeId);
      if (shape?.tuple) {
        const spread = expr.elements.find(ts.isSpreadElement);
        if (spread) {
          L.unsupported(
            "SC1090",
            spread,
            "spread elements in tuple literals (positions must be spelled out)",
          );
        }
        if (expr.elements.length !== shape.fields.length) {
          // tsc padded an UNDER-LENGTH literal against an optional-element
          // tuple context (`options || []` with `options?: [string?,
          // number?]` — the instantiated type spells every position, the
          // literal spells fewer): no fixed shape holds it, but the
          // engine's real arrays do — under --dynamic the literal builds
          // island-native with its ACTUAL elements, length exact. Static
          // builds keep the type fence (badType's dynamic probe tells the
          // --dynamic story).
          if (
            L.dynamic &&
            expr.elements.length < shape.fields.length &&
            expr.elements.every((el) => !ts.isOmittedExpression(el))
          ) {
            return {
              kind: "jsOp",
              op: "arrLit",
              args: expr.elements.map((el) => L.jsvalIn(L.lowerExpr(el), el)),
              type: JSVAL,
              loc,
            };
          }
          L.badType(expr, tsType);
        }
        const byName = new Map(shape.fields.map((f) => [f.name, f.type]));
        const fields = expr.elements.map((el, i) => {
          const fieldType = byName.get(String(i));
          if (!fieldType) L.badType(el, L.typeOf(el));
          return { name: String(i), value: L.lowerExprExpecting(el, fieldType) };
        });
        return { kind: "recordLit", fields, type: mapped, loc };
      }
    }
    if (!mapped || mapped.kind !== "array") {
      // The JS declaration fallback, literal-side: an element type with no
      // static home (a string | string[] mixed command tuple, an evolving
      // []) builds as a dyn ARRAY — one dyn value whose elements each
      // convert through the usual boundary (dynFrom's JSON-safe domain);
      // an element that cannot convert fences per element. length/index
      // reads and dynamic consumers ride the keyed-dyn paths. TS literals
      // take the same build when the slot ITSELF is checked-dynamic — an
      // `unknown[]` annotation or a collapsed `(string | object)[]` maps
      // to DYN wholesale now (mapType's dyn-element array rule), so the
      // literal IS the dyn array.
      if (isJsSourceFile(expr.getSourceFile()) || mapped?.kind === "dyn") {
        const elems = expr.elements.map((el): IrExpr => {
          if (ts.isSpreadElement(el)) {
            L.unsupported("SC1090", el, "spread elements in a dynamic (unknown[]) array literal");
          }
          const v = L.coerceToExpected(L.lowerExpr(el), DYN);
          if (v.type.kind !== "dyn") {
            L.unsupported(
              "SC1101",
              el,
              `holding '${L.fmt(v.type)}' values in a dynamic (unknown[]) array literal`,
            );
          }
          return v;
        });
        return { kind: "dynArrLit", elems, type: DYN, loc };
      }
      L.badType(expr, tsType);
    }
    const type = mapped as IrType & { kind: "array" };
    const spreads: number[] = [];
    const elems = expr.elements.map((el, i) => {
      if (ts.isSpreadElement(el)) {
        // `[...xs, b]`: xs must be an array of the literal's own element
        // type — its elements copy in at construction (a fresh array,
        // JS-exact). Iterables that aren't arrays (strings, Sets, Maps)
        // and mismatched element types stay fenced. A TERNARY source gets
        // the literal's own type as its expected type (the conditional-
        // spread idiom — tsc surfaces no contextual type through spreads,
        // and the arm literals must BUILD as this element type).
        let srcNode: ts.Expression = el.expression;
        while (ts.isParenthesizedExpression(srcNode)) srcNode = srcNode.expression;
        let src = ts.isConditionalExpression(srcNode)
          ? lowerTernary(L, srcNode, type)
          : L.lowerExpr(el.expression);
        // `[...someSet]`: a same-element Set drains into a fresh array in
        // insertion order (setIntrinsic toArray); the spread machinery
        // then copies like any array source.
        if (src.type.kind === "set" && typeEquals(src.type.elem, type.elem)) {
          src = {
            kind: "setIntrinsic",
            method: "toArray",
            receiver: src,
            args: [],
            type: arrayOf(src.type.elem),
            loc: locOf(el),
          };
        }
        // `[...new SymbolIterator]`: a CLASS ITERABLE drains through its
        // own protocol into a fresh element array (classIteratorDrainCall
        // — an infinite iterator loops forever, exactly Node), and the
        // spread machinery copies like any array source.
        if (src.type.kind === "object") {
          const drained = L.classIteratorDrainCall(src, locOf(el), type.elem);
          if (drained) src = drained;
        }
        // `[...s]` on a STRING spreads its code-point characters (the
        // string iterator's walk — astral chars whole) through the same
        // interned helper as Array.from(s); the result rides the array
        // machinery below like any string[] source.
        if (src.type.kind === "string") {
          src = strCharsCall(L, src, locOf(el));
        }
        // `[...typedArray]`: represented typed arrays are dense numeric
        // iterables, so drain their elements into the fresh number[] that
        // the surrounding array literal will copy. In particular this is
        // the Uint8Array-to-Array bridge (`[...u8]`), with element values
        // read rather than backing bytes for the wider typed-array kinds.
        if (src.type.kind === "bytes") {
          src = {
            kind: "bytesIntrinsic",
            method: "toArray",
            receiver: src,
            args: [],
            type: arrayOf(F64),
            loc: locOf(el),
          };
        }
        // A same-family array whose ELEMENT lifts (string[] into a
        // (string | symbol)[] literal — per-element wrap/width copy):
        // the interned width helper reshapes before the spread copies.
        if (src.type.kind === "array" && !typeEquals(src.type, type)) {
          const w = L.widthCoerce(src, type);
          if (w) src = w;
        }
        if (!typeEquals(src.type, type)) {
          L.unsupported(
            "SC1090",
            el,
            `spreading '${L.fmt(src.type)}' into a '${L.fmt(type)}' literal (only a same-element-type array spreads)`,
          );
        }
        spreads.push(i);
        return src;
      }
      // A HOLE (`[,]` — an elision): the slot materializes the undefined
      // arm — reads, length, and JSON answer exactly Node (JSON.stringify
      // prints null for holes AND for undefined elements). Iteration
      // methods do not skip the position the way JS skips holes — the
      // documented sparse-literal divergence.
      if (ts.isOmittedExpression(el)) {
        const hole = type.elem.kind === "union" ? L.wrappedUndefined(type.elem, locOf(el)) : null;
        if (hole) return hole;
        L.unsupported("SC1090", el, "holes in array literals of this element type");
      }
      // An ARRAY-LITERAL element under a UNION element slot whose own type
      // has no lift into the slot builds against the union's single array
      // arm instead (`['pwd', []]` as (string | string[])[] — tsc pushes no
      // contextual type through the unannotated chain, so the empty nested
      // literal types never[], whose f64-element representation re-tags
      // into nothing). One array arm is unambiguous — the union-slot rule's
      // stance; several keep the fence.
      if (type.elem.kind === "union" || type.elem.kind === "array") {
        let x: ts.Expression = el;
        while (ts.isParenthesizedExpression(x)) x = x.expression;
        if (ts.isArrayLiteralExpression(x)) {
          const ownT = L.mapTypeOf(L.checker.getContextualType(x) ?? L.typeOf(x));
          if (ownT === null || L.widthLiftPlan(ownT, type.elem) === null) {
            // An ARRAY-typed slot takes the literal directly; a union slot
            // routes through its single array arm and wraps.
            if (type.elem.kind === "array") {
              return L.lowerArrayLiteral(x, type.elem);
            }
            const def = L.unions.get(type.elem.unionId);
            const arrayArms = def?.arms.filter((a) => a.kind === "array") ?? [];
            if (arrayArms.length === 1) {
              const built = L.lowerArrayLiteral(x, arrayArms[0] as IrType & { kind: "array" });
              return L.coerceInto(el, built, type.elem);
            }
          }
        }
      }
      // Elements flow into the element slot like an assignment: union
      // elements wrap plain arm values (`[1, "a"]` as (number | string)[]),
      // holes reject inside lowerExpr.
      const lowered = L.lowerExprExpecting(el, type.elem);
      if (!typeEquals(lowered.type, type.elem)) L.badType(el, L.typeOf(el));
      return lowered;
    });
    return { kind: "arrayLit", elems, ...(spreads.length > 0 ? { spreads } : {}), type, loc };
  }

/** `{ a: 1, b: "x" }` → recordLit. The record type comes from the
   * contextual type when tsc has one (annotated declarations, arguments,
   * nested literals) and from the literal's own type otherwise — both intern
   * to the same shapeId unless width subtyping is in play (an `as` cast can
   * smuggle a wider/narrower literal past tsc's freshness check), which the
   * exact-shape checks below reject with SC2002. Fields lower IN SOURCE
   * ORDER: JS evaluates property values in source order. */

  /** `{ [KEY]: v }` where KEY is a compile-time-known string or number:
   * the key folds into an ordinary (spelled) property name — the record
   * shape is exactly what tsc computed for the literal (the late-bound
   * name IS the checker's literal type), so the fold is just spelling.
   * PURE key forms only, so skipping the key's evaluation is exact (JS
   * evaluates the key before the value; effectful expressions keep the
   * fence): any side-effect-free expression — identifiers, property
   * chains with no accessor on them (enum members, `other.name` reads),
   * literals, parenthesized/as-wrapped forms, operators over those —
   * whose checker type is ONE string or number literal (or a union whose
   * arms all spell the same name — `E1.x || E2.x` where both are 0).
   * Number keys take JS's canonical spelling (`{ [E.member]: v }` stores
   * "0" — ToPropertyKey), exactly the name tsc late-bound. Templates
   * fold structurally span by span as well (a template of literals whose
   * checker type widened still spells one string). Symbol-typed and
   * runtime-valued keys stay out. */
  function literalComputedKey(L: Lowerer, name: ts.ComputedPropertyName): string | null {
    return foldedStringKeyOf(L, name.expression);
  }

  export function foldedStringKeyOf(L: Lowerer, expr: ts.Expression): string | null {
    if (ts.isParenthesizedExpression(expr)) return foldedStringKeyOf(L, expr.expression);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isTemplateExpression(expr)) {
      // Structural fold first — exact even where the checker widened the
      // template's own type; the general type-directed fold below is the
      // fallback (a template the checker DID type as one literal).
      let out = expr.head.text;
      let folded = true;
      for (const span of expr.templateSpans) {
        const part = foldedStringKeyOf(L, span.expression);
        if (part === null) {
          folded = false;
          break;
        }
        out += part + span.literal.text;
      }
      if (folded) return out;
    }
    // The general fold: a PURE expression whose checker type spells one
    // property name. An as-cast folds by its OWN checker type — that is
    // the name tsc late-bound the property under, so shape and storage
    // stay one name (the standard trust-the-checker bet); a cast that
    // WIDENS to string un-late-binds the property, its type is no literal,
    // and the fence stays.
    if (!pureKeyExpr(L, expr)) return null;
    return literalKeySpellingOf(L.typeOf(expr));
  }

  /** The property-name spelling of a single-literal checker type: string
   * literals directly, number literals in JS's canonical ToString spelling
   * (enum members included — their literal flags carry the value), and
   * unions whose arms all spell the SAME name (`E1.x || E2.x` — two enum
   * literal types, one value). Null for everything else. */
  function literalKeySpellingOf(t: ts.Type): string | null {
    if (t.isStringLiteralType()) return t.value;
    if (t.isNumberLiteralType()) return String(t.value);
    if (t.isUnionType()) {
      let out: string | null = null;
      for (const arm of t.getTypes()) {
        const s = arm.isStringLiteralType() ? arm.value : arm.isNumberLiteralType() ? String(arm.value) : null;
        if (s === null || (out !== null && s !== out)) return null;
        out = s;
      }
      return out;
    }
    return null;
  }

  /** True iff evaluating `expr` can have no observable effect, so a fold
   * may skip it: literals, identifier reads, property chains whose every
   * member is a plain field/enum member (an accessor anywhere on the chain
   * is a call), operators and casts over those. Calls, `new`, assignments,
   * and element accesses stay impure. */
  function pureKeyExpr(L: Lowerer, expr: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) return pureKeyExpr(L, expr.expression);
    if (ts.isAsExpression(expr) || ts.isTypeAssertion(expr)) return pureKeyExpr(L, expr.expression);
    if (ts.isIdentifier(expr)) return true;
    if (ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr)) return true;
    if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword ||
        expr.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isPropertyAccessExpression(expr)) {
      const sym = L.checker.getSymbolAtLocation(expr.name);
      if (sym && sym.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) return false;
      return pureKeyExpr(L, expr.expression);
    }
    if (ts.isPrefixUnaryExpression(expr) &&
        (expr.operator === ts.SyntaxKind.MinusToken || expr.operator === ts.SyntaxKind.PlusToken ||
         expr.operator === ts.SyntaxKind.ExclamationToken || expr.operator === ts.SyntaxKind.TildeToken)) {
      return pureKeyExpr(L, expr.operand);
    }
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      const pureOp =
        op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        (op >= ts.SyntaxKind.LessThanToken && op <= ts.SyntaxKind.CaretToken &&
          op !== ts.SyntaxKind.InstanceOfKeyword && op !== ts.SyntaxKind.InKeyword);
      return pureOp && pureKeyExpr(L, expr.left) && pureKeyExpr(L, expr.right);
    }
    if (ts.isConditionalExpression(expr)) {
      return pureKeyExpr(L, expr.condition) && pureKeyExpr(L, expr.whenTrue) && pureKeyExpr(L, expr.whenFalse);
    }
    if (ts.isTemplateExpression(expr)) return expr.templateSpans.every((s) => pureKeyExpr(L, s.expression));
    return false;
  }

  /** A property's field name: identifier/string-literal keys directly,
   * foldable computed keys through literalComputedKey (the syntax pass
   * fenced everything else). */
  function propNameText(L: Lowerer, name: ts.PropertyName): string {
    if (ts.isComputedPropertyName(name)) {
      const k = literalComputedKey(L, name);
      if (k === null) throw new Error("lowerer bug: unfoldable computed key past the fence");
      return k;
    }
    // Numeric literals name their canonical string key (JS's ToPropertyKey
    // — the same name the checker gives the property symbol).
    if (ts.isNumericLiteral(name)) return String(Number(name.text));
    return (name as ts.Identifier | ts.StringLiteral).text;
  }

/** SCRIPTC_DYNOBJ_METHOD probe: how many object-literal METHODS the dyn
 * object-literal path lowered (each one is a bundled module body on the
 * esbuild `__commonJS` table). Read in the SAME run as the trap count —
 * "nothing changed" and "the branch never ran" are otherwise the same
 * observation. */
let dynObjMethods = 0;

/** `super` inside an object-literal method: the method has a [[HomeObject]]
 * in JS, a dyn object has none, and the compiler's super machinery
 * (lowerSuperCall and friends) assumes a class body — so a body that names
 * it keeps a fence rather than lowering to the wrong receiver. Nested
 * arrows inherit the method's `super`, so the walk has to descend through
 * them. It descends through everything, which OVER-rejects one shape: a
 * class declared inside the method body, whose members' `super` names that
 * class's own base and has nothing to do with the object literal. That is
 * the same over-rejection the sibling `this` walk
 * (rejectThisInObjectMethod) already carries, and it costs a fence on a
 * shape no bundler emits — never a wrong receiver, which is the direction
 * that would matter. */
function rejectSuperInObjectMethod(L: Lowerer, node: ts.Node): void {
  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    L.unsupported("SC1090", node, "references to 'super' in object literal methods");
  }
  ts.forEachChild(node, (child) => rejectSuperInObjectMethod(L, child));
}

/** The dyn JS object literal (a computed key that doesn't fold, or the JS
   * declaration fallback — an unmappable or `any` contextual type):
   * builds a dyn object member-by-member. Keys evaluate before their values,
   * properties in source order — JS's object-literal evaluation exactly.
   * Identifier/string keys are compile-time strings; numeric keys take
   * their canonical number string (`{ 0x10: v }` stores "16" — JS's
   * ToPropertyKey); computed keys evaluate and pass through ToString (the
   * dyn's String() for dyn operands — `{ [field]: v }` where field is a
   * checked-dynamic param). Values convert through the usual dyn boundary
   * (dynFrom's domain, functions box); a value with no dyn representation
   * fences per property.
   *
   * METHODS lower as the closure values they are — `{ "a.js"(e, t) {...} }`
   * is a function under a shorthand name, routed to the SAME lowerLambda
   * the record path (lowerObjectLiteral) and the island path already give
   * the identical node, so nothing new is invented for it. This literal
   * reaches here by TWO roads and the method form belongs to the second:
   * a computed key that doesn't fold (the original idiom — the comment
   * that used to sit here said methods "don't co-occur" with it, which is
   * true), and the JS DECLARATION FALLBACK, where a literal whose
   * contextual type is unmappable or `any` builds as a dyn object with
   * ordinary string-literal keys. esbuild's `__commonJS` module table
   * — `r({ "node_modules/x.js"(e, t) {...} })`, where the helper's
   * parameter is untyped so the argument's contextual type is `any` — is
   * that second road, and its refusal hid one bundled module body per
   * bundled module. `this` and `super` stay fenced: a dyn object is not a
   * receiver the method could bind either to.
   *
   * Spreads and accessors stay fenced (an accessor is not a data
   * property; the dyn object has no getter machinery to define it into). */
  export function lowerDynObjectLiteral(L: Lowerer, expr: ts.ObjectLiteralExpression): IrExpr {
    const loc = locOf(expr);
    const fields: { key: IrExpr; value: IrExpr }[] = [];
    for (const prop of expr.properties) {
      const isMethod = ts.isMethodDeclaration(prop) && prop.body !== undefined;
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop) && !isMethod) {
        L.unsupported(
          "SC1090",
          prop,
          "spreads and accessors in a dyn object literal (methods lower)",
        );
      }
      if (isMethod) {
        dynObjMethods++;
        if (process.env["SCRIPTC_DYNOBJ_METHOD"] !== undefined) {
          const p = ts.getLineAndCharacterOfPosition(prop.getSourceFile(), prop.getStart());
          process.stderr.write(
            `[dynobjmethod] #${dynObjMethods} ${prop.getSourceFile().fileName}:${p.line + 1}\n`,
          );
        }
        // `this` is the receiver — a dyn object models no receiver, and the
        // generic lexical-this walk would silently capture an ENCLOSING
        // method's `this` (the record path's reasoning, verbatim).
        L.rejectThisInObjectMethod(prop.body!);
        // `super` needs a [[HomeObject]] a dyn object has none of; the
        // call-site machinery for it assumes a class body.
        rejectSuperInObjectMethod(L, prop.body!);
      }
      const name = prop.name;
      let key: IrExpr;
      if (ts.isComputedPropertyName(name)) {
        const folded = literalComputedKey(L, name);
        if (folded !== null) {
          key = { kind: "strLit", value: folded, type: STRING, loc: locOf(name) };
        } else {
          let k = L.lowerExpr(name.expression);
          if (k.type.kind === "f64" || k.type.kind === "bool" || k.type.kind === "dyn") {
            k = { kind: "toString", operand: k, type: STRING, loc: locOf(name) };
          }
          if (k.type.kind !== "string") {
            L.unsupported(
              "SC1090",
              name,
              `'${L.fmt(k.type)}'-typed computed property keys (string, number, boolean, and unknown keys stringify)`,
            );
          }
          key = k;
        }
      } else if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        key = { kind: "strLit", value: name.text, type: STRING, loc: locOf(name) };
      } else if (ts.isNumericLiteral(name)) {
        key = { kind: "strLit", value: String(Number(name.text)), type: STRING, loc: locOf(name) };
      } else {
        L.unsupported("SC1090", prop, "non-identifier property names");
      }
      // A METHOD's value node is the method itself (there is no
      // initializer), and it lowers through lowerLambda; everything else
      // reads its initializer or, for shorthand, its own name.
      const valueExpr: ts.Node = ts.isMethodDeclaration(prop)
        ? prop
        : ts.isShorthandPropertyAssignment(prop)
          ? (prop.name as ts.Identifier)
          : prop.initializer;
      const lowerValue = (): IrExpr =>
        ts.isMethodDeclaration(prop) ? L.lowerLambda(prop) : L.lowerExpr(valueExpr as ts.Expression);
      // Lambda values that fail to lower become trap closures (the
      // per-call fence granularity — fenceClosureProbe) so the object
      // still builds; everything else keeps the per-property fence below.
      let raw: IrExpr;
      const propDiagsBefore = L.diags.length;
      try {
        raw = fenceClosureProbe(L, valueExpr, undefined, lowerValue) ?? lowerValue();
      } catch (err) {
        // A PURE member read a JS file cannot lower (a namespace object
        // in an export aggregate): the slot takes a boxed fence closure —
        // the diagnostics defer to the runtime-fence ledger, the object
        // builds, and only USING the member stops the run.
        const pureMember = ts.isIdentifier(valueExpr);
        if (
          !(err instanceof PoisonError) ||
          !pureMember ||
          L.diagSink !== null ||
          L.diags.length <= propDiagsBefore ||
          L.diags.slice(propDiagsBefore).some((d) => d.code === "SC9001")
        ) {
          throw err;
        }
        const captured = L.diags.splice(propDiagsBefore);
        L.runtimeFences.push(...captured);
        const first = captured[0]!;
        const pos = ts.getLineAndCharacterOfPosition(
          L.program.getSourceFile(first.loc.file) ?? expr.getSourceFile(),
          first.loc.start,
        );
        const fnName = `%fn${L.lambdaCounter++}_dynfence`;
        L.liftedFns.push({
          name: fnName,
          params: [],
          returnType: VOID,
          locals: [],
          captures: [],
          body: [
            {
              kind: "runtimeFence",
              code: first.code,
              message: `${first.message} [${first.code} at ${first.loc.file}:${pos.line + 1}]`,
              loc: locOf(prop),
            },
          ],
          loc: locOf(prop),
        });
        raw = { kind: "closure", fnName, captures: [], type: funcOf([], VOID), loc: locOf(prop) };
      }
      let v = L.coerceToExpected(raw, DYN);
      // A function MEMBER of a runtime-keyed object literal is created
      // right here, so its Function.prototype.toString source text is
      // readable off the member node — coerceInto's creation-site walk
      // never runs on this path (it is coerceToExpected, which takes no
      // node). Without it the box would carry no text and `String(o.m)`
      // would refuse where Node prints the method's source.
      if (v.kind === "dynFrom" && v.value.type.kind === "func" && v.fnSrc === undefined) {
        const mSrc = jsFuncValueSourceOf(L, valueExpr);
        if (mSrc !== null) v = { ...v, fnSrc: mSrc };
      }
      if (v.type.kind !== "dyn") {
        const convDiagsBefore = L.diags.length;
        try {
          L.unsupported(
            "SC1101",
            valueExpr,
            `holding '${L.fmt(v.type)}' values in a runtime-keyed (computed-key) object literal`,
          );
        } catch (err) {
          // A member value the checked-dynamic tree cannot hold — a func whose signature
          // cannot box, an island ('any') handle, a record carrying func
          // fields (the export aggregate's typed utilities and npm-handle
          // members): the same call-time fence deferral as an unlowerable
          // member — the slot takes a boxed fence closure; only USING it
          // stops the run. Probe mode and ICEs keep the poison.
          if (
            !(err instanceof PoisonError) ||
            L.diagSink !== null ||
            L.diags.length <= convDiagsBefore ||
            L.diags.slice(convDiagsBefore).some((d) => d.code === "SC9001")
          ) {
            throw err;
          }
          const captured = L.diags.splice(convDiagsBefore);
          L.runtimeFences.push(...captured);
          const first = captured[0]!;
          const pos = ts.getLineAndCharacterOfPosition(
            L.program.getSourceFile(first.loc.file) ?? expr.getSourceFile(),
            first.loc.start,
          );
          const fnName = `%fn${L.lambdaCounter++}_dynfence`;
          L.liftedFns.push({
            name: fnName,
            params: [],
            returnType: VOID,
            locals: [],
            captures: [],
            body: [
              {
                kind: "runtimeFence",
                code: first.code,
                message: `${first.message} [${first.code} at ${first.loc.file}:${pos.line + 1}]`,
                loc: locOf(prop),
              },
            ],
            loc: locOf(prop),
          });
          const fence: IrExpr = { kind: "closure", fnName, captures: [], type: funcOf([], VOID), loc: locOf(prop) };
          v = L.coerceToExpected(fence, DYN);
        }
      }
      fields.push({ key, value: v });
    }
    return { kind: "dynObjLit", fields, type: DYN, loc };
  }

/** Spreading a source whose shape carries accessor slots: Node's copy
 * invokes each getter exactly once in insertion order — even for keys a
 * later contributor overrides — while the field-copy desugar assumes pure
 * reads it may drop or reorder. Getter-call counts would silently diverge,
 * so accessor-carrying sources fence by name. */
function fenceAccessorSpreadSource(L: Lowerer, prop: ts.Node, srcShape: IrRecordShape | undefined): void {
  if (srcShape && shapeHasAccessorSlots(srcShape)) {
    L.unsupported(
      "SC1090",
      prop,
      "object spread of sources carrying get/set accessor properties (Node invokes each getter once during the copy — the field-copy desugar cannot model the calls; bind the reads to consts first)",
    );
  }
}

/** A function-valued property initializer whose EVALUATION is observably
 * nothing — the precondition for replacing it with a trap closure, because
 * the substitution keeps the value's type, identity and `typeof` but throws
 * away whatever the expression would have done on the way to producing it.
 * A syntactic lambda qualifies (creating a closure has no side effects);
 * so does `<this|id>.method.bind(<this|id>)`, the collaborator idiom —
 * binding a METHOD over pure references creates a closure and nothing
 * more. An ACCESSOR is excluded by name: its read IS the side effect, and
 * dropping the call would silently change the program. `as`/`satisfies`/
 * parenthesis laundering is transparent — it is exactly what a caller
 * writes when the declared slot is looser than the member
 * (`client.emit.bind(client) as unknown as Ctx['emit']`) and it evaluates
 * to nothing at runtime.
 *
 * A bare identifier read is pure too, but is deliberately NOT admitted: a
 * JS literal's unlowerable identifier member already has a story one step
 * down (lowerObjectLiteral's pure-member catch NARROWS the field away, so
 * each read meets its own per-site fence), and two answers to one shape
 * would be a silent behavior change to the export-aggregate tables that
 * rule was written for.
 *
 * This is the same purity question the generic-callable branch answers for
 * its own drop (`pureInit`, lowerObjectLiteral); kept separate because that
 * one decides whether to DROP a field with no slot, and does not see
 * through casts. */
function pureFuncValueInit(L: Lowerer, node: ts.Node): boolean {
  let inner: ts.Node = node;
  for (;;) {
    if (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    else if (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) inner = inner.expression;
    else break;
  }
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner) || ts.isMethodDeclaration(inner)) return true;
  if (!ts.isCallExpression(inner) || inner.arguments.length !== 1) return false;
  const callee = inner.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "bind" ||
    !ts.isPropertyAccessExpression(callee.expression)
  ) {
    return false;
  }
  const methodAccess = callee.expression;
  const pureRef = (x: ts.Expression): boolean => x.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(x);
  if (!pureRef(methodAccess.expression) || !pureRef(inner.arguments[0]!)) return false;
  const sym = L.checker.getSymbolAtLocation(methodAccess.name);
  const decls = sym ? L.checker.declarationsOf(sym) : [];
  if (decls.length === 0) return false;
  return !decls.some((d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d));
}

/** The trap-closure fallback for FUNCTION-VALUED object properties: an
 * initializer that fails to lower inside an object literal becomes a
 * closure of the field's exact func type whose body is the runtime fence —
 * the object still BUILDS (commander's `_outputConfiguration` table: the
 * driven writeOut/writeErr entries work; an unloweraable color probe traps
 * only if something CALLS it). The failed initializer's diagnostics move to
 * the runtime-fence inventory, exactly like a fenced statement.
 *
 * WHEN it applies is the deferral rule the whole build already runs on
 * (lowerStmts' `deferFences`): JavaScript sources always — no annotation
 * exists there to change what lowers — and TypeScript under --best-effort,
 * which asks for exactly this trade. WHAT it applies to is the purity rule
 * above: the substitution must not skip work. With a func slot the trap's
 * ABI is the slot's own, so any pure form is admissible; without one the
 * arity has to be read off a syntactic lambda, so only those qualify.
 *
 * Null when the fallback does not apply — the caller lowers normally. ICEs
 * (SC9001) never convert. */
function fenceClosureProbe(
  L: Lowerer,
  node: ts.Node,
  slotType: IrType | undefined,
  attempt: () => IrExpr,
): IrExpr | null {
  if (!isJsSourceFile(node.getSourceFile()) && !L.bestEffort) return null;
  let inner: ts.Node = node;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (slotType !== undefined && slotType.kind !== "func") return null;
  // The trap's ABI: the field's func slot when one exists; otherwise (the
  // dyn-object literal path — the value boxes into dyn) the all-dyn
  // signature of the lambda's own arity, which canBoxFuncIntoDyn always
  // admits. Only a syntactic lambda can answer that second question, which
  // is why a slotless field still requires one; a slotted field takes any
  // pure form (pureFuncValueInit).
  let fieldType: IrType & { kind: "func" };
  if (slotType !== undefined) {
    if (!pureFuncValueInit(L, node)) return null;
    fieldType = slotType;
  } else if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner) || ts.isMethodDeclaration(inner)) {
    fieldType = { kind: "func", params: inner.parameters.map(() => DYN), ret: DYN };
  } else {
    return null;
  }
  const diagsBefore = L.diags.length;
  try {
    return attempt();
  } catch (e) {
    if (!(e instanceof PoisonError)) throw e;
    const captured = L.diags.splice(diagsBefore);
    if (captured.some((d) => d.code === "SC9001")) {
      L.diags.push(...captured);
      throw e;
    }
    L.runtimeFences.push(...captured);
    const first = captured[0];
    const loc = locOf(node);
    if (process.env["SCRIPTC_FENCEFN_WHY"] !== undefined) {
      console.error(`[fencefn] ${loc.file}:${loc.start} ${first?.code ?? "?"} ${first?.message.slice(0, 90) ?? ""}`);
    }
    const params = fieldType.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
    const name = `%fence.fn.${L.liftedFns.length}`;
    L.liftedFns.push({
      name,
      params,
      returnType: fieldType.ret,
      locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: true })),
      body: [
        {
          kind: "runtimeFence",
          code: first?.code ?? "SC1090",
          message: first?.message ?? "this function's body has no static lowering",
          loc,
        },
      ],
      loc,
    });
    return { kind: "closure", fnName: name, captures: [], type: fieldType, loc };
  }
}

/** The union arm an object LITERAL inhabits when its fields must widen
 * PER FIELD into exactly one record arm — the reducer-action pattern
 * (`{ kind: "a", parsed: 1 }` into `{ kind: "a"; parsed: number | null }
 * | { kind: "b" }`). The IR shapes erased the literal types tsc
 * discriminated on, so the probe runs against the contextual union's
 * CHECKER members: every literal field must exist on the member
 * (excess-property freshness — tsc already enforced it), every arm field
 * missing from the literal must be optional-flavored (an undefined-armed
 * union, or a dyn slot — the absent-completion rule), and each present
 * field's LITERAL type must fit the member's field type — literal against
 * literal decides by VALUE (the discriminant), everything else by the
 * widened IR pair under the width-lift relation. Exactly ONE fitting arm
 * answers it; zero or several answer null and the caller keeps its
 * fences. Plain property-assignment/shorthand literals only — spreads,
 * accessors, methods, and unfoldable computed keys keep their own paths. */
function literalUnionArmOf(
  L: Lowerer,
  expr: ts.ObjectLiteralExpression,
  tsType: ts.Type,
  recordArms: (IrType & { kind: "record" })[],
): (IrType & { kind: "record" }) | null {
  if (!tsType.isUnionType()) return null;
  const props: { name: string; node: ts.Expression }[] = [];
  for (const p of expr.properties) {
    if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) {
      props.push({ name: propNameText(L, p.name), node: p.initializer });
    } else if (ts.isShorthandPropertyAssignment(p) && ts.isIdentifier(p.name)) {
      props.push({ name: p.name.text, node: p.name });
    } else {
      return null;
    }
  }
  /** litT fits ftT: unions per arm; literal-vs-literal by value; unit
   * types only into their own unit; otherwise the widened IR pair must be
   * equal or width-liftable. */
  const fitsOne = (litT: ts.Type, ftT: ts.Type): boolean => {
    if (ftT.isUnionType()) return ftT.getTypes().some((a) => fits(litT, a));
    if (ftT.isStringLiteralType()) return litT.isStringLiteralType() && litT.value === ftT.value;
    if (ftT.isNumberLiteralType()) return litT.isNumberLiteralType() && litT.value === ftT.value;
    if (ftT.flags & ts.TypeFlags.BooleanLiteral) {
      return (litT.flags & ts.TypeFlags.BooleanLiteral) !== 0 && L.checker.typeToString(litT) === L.checker.typeToString(ftT);
    }
    if (ftT.flags & ts.TypeFlags.Null) return (litT.flags & ts.TypeFlags.Null) !== 0;
    if (ftT.flags & ts.TypeFlags.Undefined) return (litT.flags & ts.TypeFlags.Undefined) !== 0;
    if (litT.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return false;
    const li = L.mapTypeOf(L.checker.getBaseTypeOfLiteralType(litT));
    const fi = L.mapTypeOf(ftT);
    if (!li || !fi) return false;
    if (typeEquals(li, fi) || L.widthLiftPlan(li, fi) !== null) return true;
    // The source-union decomposition `fits` performs at the top level,
    // ONE CONTAINER IN. `[c ? { code } : {}]` types as `({ code: string } |
    // {})[]` and the arm's field is `readonly Entry[]`; widthLiftPlan
    // recurses into the element, finds a UNION source against a RECORD
    // destination, and has no rung for it — while the value never takes that
    // rung anyway: selecting the arm re-lowers the array literal AT the
    // arm's field type, so each element builds AS `Entry` from its own
    // contextual type. That is the same coercion the NON-union destination
    // one line over already performs, and the property is coerced and
    // re-checked after the selection exactly as before, so a wrong guess
    // here is still a fence and never a wrong answer. `every`, not `some`:
    // an element arm with no home would be a value the chosen arm cannot
    // hold.
    if (li.kind === "array" && fi.kind === "array" && li.elem.kind === "union") {
      const arms = L.unions.get(li.elem.unionId)?.arms;
      const elem = fi.elem;
      return (
        arms !== undefined && arms.length > 0 &&
        arms.every((a) => typeEquals(a, elem) || L.widthLiftPlan(a, elem) !== null)
      );
    }
    return false;
  };
  /** The same test, plus the SOURCE-union decomposition. A property whose
   * CHECKER type is a union fits a field when EVERY arm of it fits — the
   * value is one of those arms at runtime and each has a home, which is
   * the same "widens into any union that contains it" relation the whole
   * probe rests on, read from the source side.
   *
   * `fitsOne` alone answers false for a source union against a NON-union
   * field, because its last step compares the whole union's IR type
   * against the field's. That is the shape an object literal has inside an
   * INSTANTIATED generic body: the checker still reports the SYMBOLIC type
   * for a nested literal — `{ ...v, timestamp: t }` where `v: F<S>` is a
   * conditional over the type parameter distributes into one arm per
   * branch — while the lowering builds the nested literal at the
   * RESOLVED shape. The arm probe was asking the checker's symbolic
   * spelling to equal the resolved one, so a discriminant that names
   * exactly one arm ('operation: "set"') could not select it, the literal
   * fell back to its own inferred type, and the nested literal's resolved
   * record then mismatched that type's symbolic field (SC2003).
   *
   * `every`, not `some`: a source arm with no home would be a value the
   * chosen arm cannot hold. And this only ever ADDS candidates — two
   * fitting arms are still ambiguous and still decline, and every property
   * of the arm this selects is coerced and re-checked exactly as before. */
  function fits(litT: ts.Type, ftT: ts.Type): boolean {
    if (fitsOne(litT, ftT)) return true;
    if (!litT.isUnionType()) return false;
    return litT.getTypes().every((a) => fitsOne(a, ftT));
  }
  const armShapeIds = new Set(recordArms.map((a) => a.shapeId));
  const candidates = new Set<string>();
  for (const member of tsType.getTypes()) {
    const mMapped = L.mapTypeOf(member);
    if (mMapped?.kind !== "record" || !armShapeIds.has(mMapped.shapeId) || candidates.has(mMapped.shapeId)) continue;
    const shape = L.shapes.get(mMapped.shapeId);
    if (!shape || shape.tuple || shape.indexValue) continue;
    // Excess-property freshness: every literal field must exist on the
    // member (tsc rejected the others for a fresh literal).
    if (!props.every((p) => L.checker.getPropertyOfType(member, p.name) !== undefined)) continue;
    // Arm fields the literal leaves unset must be optional-flavored (the
    // absent-completion rule: an undefined-armed union or a dyn slot).
    const names = new Set(props.map((p) => p.name));
    const absentOk = shape.fields.every((f) => {
      if (names.has(f.name)) return true;
      if (f.type.kind === "dyn") return true;
      if (f.type.kind !== "union") return false;
      return L.unions.get(f.type.unionId)?.arms.some((a) => a.kind === "undefinedT") ?? false;
    });
    if (!absentOk) continue;
    const fieldsFit = props.every((p) => {
      const sym = L.checker.getPropertyOfType(member, p.name);
      if (!sym) return false;
      return fits(L.typeOf(p.node), L.checker.getTypeOfSymbol(sym));
    });
    if (fieldsFit) candidates.add(mMapped.shapeId);
  }
  if (candidates.size !== 1) return null;
  const [only] = candidates;
  return recordArms.find((a) => a.shapeId === only) ?? null;
}

export function lowerObjectLiteral(L: Lowerer, expr: ts.ObjectLiteralExpression): IrExpr {
    const loc = locOf(expr);
    // A literal the LOWERING marked as a dyn object (the property-
    // descriptor map of `Object.create(proto, descs)` and the descriptors
    // in it — Lowerer.dynObjectLiterals says why the contextual type is
    // the wrong builder there).
    if (L.dynObjectLiterals.has(expr)) return lowerDynObjectLiteral(L, expr);
    // The RUNTIME-KEYED literal (JS): a computed key that doesn't fold to a
    // compile-time string means the literal's shape is not a compile-time
    // fact — no record shape can hold it. The whole literal builds as a dyn
    // object instead (`{ [field]: criteria, actual: 0, ... }` —
    // test/common's _mustCallInner context), where keys are runtime string
    // values. TypeScript keeps the record world and its fence: this shape
    // only arises in checked-dynamic JS.
    if (
      isJsSourceFile(expr.getSourceFile()) &&
      expr.properties.some(
        (p) => {
          const n = ts.isSpreadAssignment(p) ? undefined : p.name;
          return n !== undefined && ts.isComputedPropertyName(n) && literalComputedKey(L, n) === null;
        },
      )
    ) {
      return lowerDynObjectLiteral(L, expr);
    }
    // Syntax fence FIRST: unsupported member forms get their specific
    // message even when they also make the literal's type unmappable
    // (a getter or a `this`-returning method would otherwise surface as an
    // opaque type fence on the whole literal).
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        // Supported shapes: FULL spreads of known record shapes read as
        // identifiers or other side-effect-free reads, all BEFORE any
        // explicit property (the field-copy desugar reads spread fields
        // first, exactly JS's eager copy order); and CONDITIONAL spreads
        // `...(c ? {k: v} : {})` — the optional-field idiom tsc types as
        // `k?: ...` — which desugar to one conditional field at the
        // spread's own position (any position: they introduce one fresh
        // name, collision-fenced below). Everything else stays fenced.
        const cs = conditionalSpreadOf(prop.expression);
        if (cs === "unsupported" || (cs && cs.props.length !== 1)) {
          L.unsupported(
            "SC1090",
            prop,
            "conditional spreads beyond `...(c ? { field: v } : {})` (exactly one property against an empty arm — spell other shapes as optional fields)",
          );
        }
        // Spread ORDER is fenced in the field-by-field desugar below, not
        // here: the index-signature merge path supports any order (keyed
        // last-write-wins writes), so `{ K: v, ...extra }` into a pure
        // Record shape compiles — the buildServiceEnv pattern.
        continue;
      }
      if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
        // JavaScript CJS-export tables reach reads through the lifted-
        // accessor path (cjsExportAccessorRead) — the literal VALUE
        // narrows to its plain fields below (accessor names are not
        // record storage; SEMANTICS.md documents the enumeration
        // divergence). TypeScript accessors lower into the shape's
        // reserved closure slots (%get:/%set: — see accessorSlotProp);
        // `this` in the body is fenced up front: the closure slot has no
        // receiver (capturing the record under construction would be an
        // RC cycle), and the generic lexical-this walk would silently
        // capture an ENCLOSING method's `this` — the object-method rule.
        if (!isJsSourceFile(expr.getSourceFile())) {
          rejectThisInObjectAccessor(L, prop.body ?? prop);
        }
      }
      // Unfoldable computed keys are NOT fenced here: an index-signature
      // target lowers them as runtime keyed writes (the merge path below);
      // every other target re-fences them after the merge path declined
      // (fenceUnfoldableComputedKeys).
      // Identifier keys, STRING-LITERAL keys (`"content-type": v` —
      // record field names are data, never C identifiers; the mangler
      // encodes what C can't spell), NUMERIC-LITERAL keys in their
      // canonical string spelling (`{ 0: v }` stores "0", `{ 0x10: v }`
      // stores "16" — JS's ToPropertyKey; the checker names the property
      // symbol the same way), and FOLDABLE computed keys (above).
      if (
        !prop.name ||
        !(
          ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ||
          ts.isNumericLiteral(prop.name) || ts.isComputedPropertyName(prop.name)
        )
      ) {
        L.unsupported("SC1090", prop, "non-identifier property names");
      }
      // Shorthand methods are just closure-valued fields — but their `this`
      // is dynamically bound (typed as the literal by tsc, so noImplicitThis
      // lets it through) and records don't model it; the generic
      // lexical-this walk would silently capture an ENCLOSING method's
      // `this`, so any `this` in the body is rejected up front.
      if (ts.isMethodDeclaration(prop)) L.rejectThisInObjectMethod(prop.body ?? prop);
    }

    const ctxType0 = L.checker.getContextualType(expr);
    let tsType = ctxType0 ?? L.typeOf(expr);
    /** The literal is being built at its OWN inferred type rather than at
     * a shape the program declared. It matters for exactly one rule: the
     * declared-shape merge DROPS a spread's runtime keys that name no
     * declared field, which is divergence 68 when a DECLARED type says
     * those keys do not belong, and a silent wrong answer when the shape
     * is just what tsc inferred for this literal (tsc drops a spread
     * source's index signature, so `{ jid, ...groupAttrs }` types as
     * `{ jid: string }` while the value carries every group attribute). */
    /** A checker type the PROGRAM DECLARED: it has a symbol, that symbol
     * has declarations, and none of them is an object literal. An
     * anonymous type inferred FROM a literal fails it. */
    const declaredProvenance = (ty: ts.Type): boolean => {
      const sym = ty.getSymbol();
      if (!sym) return false;
      const decls = L.checker.declarationsOf(sym);
      return decls.length > 0 && !decls.some((d) => ts.isObjectLiteralExpression(d));
    };
    /** Whether the target SHAPE came from a type the program declared,
     * rather than from what tsc inferred for this literal. It decides
     * exactly one rule — see `dropsAreHonest` below. */
    let shapeDeclared = ctxType0 !== undefined && declaredProvenance(tsType);
    // `lit satisfies T` is TYPE-LEVEL only: the expression's checker type —
    // and therefore the shape every downstream consumer sees — is the
    // literal's OWN type (T still contextually types members, so inferred
    // parameter types flow). Building at T would reshape the value tsc
    // says has the literal's type: `{...} satisfies Movable &
    // Record<string, unknown>` must NOT become an index-signature record.
    // Own type wins whenever it maps to a record; an unmappable own type
    // keeps the contextual fallback (a bare-null field whose satisfies
    // target names the wider slot type).
    {
      // The walk skips `as const` too: it is the spelling the idiom
      // almost always takes (`{...} as const satisfies T`), and it leaves
      // the literal's OWN type in place — narrower, never the target's
      // shape — so the reasoning above is unchanged by it.
      let p: ts.Node = expr.parent;
      while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isTypeAssertion(p)) {
        p = p.parent;
      }
      if (ts.isSatisfiesExpression(p)) {
        const own = L.typeOf(expr);
        if (L.mapTypeOf(own)?.kind === "record") tsType = own;
      }
    }
    // An async function's return position types the literal
    // `T | PromiseLike<T>` (the lib's await-unwrapping contract). The
    // PromiseLike arm never maps, and the record the return slot actually
    // holds is exactly the checker's awaited type — strip to it BEFORE the
    // own-type fallback below: the awaited contextual type carries the
    // slot's field types (`lanIp: string | null`), which the literal's own
    // type narrows away (a field written as `lanIp: null` types as bare
    // `null`, which maps to nothing on its own).
    if (tsType.isUnionType() && tsType.getTypes().some((t) => t.getSymbol()?.name === "PromiseLike")) {
      tsType = L.checker.getAwaitedType(tsType) ?? tsType;
    }
    let mapped = L.mapTypeOf(tsType);
    /** The CONTEXTUAL union, when the slot's type mapped to one and the
     * literal therefore had to pick an arm to build as. Kept out here so
     * the refusal below can tell "the slot is a union and no arm fit"
     * apart from "the type has no mapping at all" — two stories the type
     * fence used to tell in one voice. */
    let ctxUnion: (IrType & { kind: "union" }) | null = null;
    // An EMPTY-record context under a NON-empty literal (`Object.keys({
    // ...process.env })` — the lib's `{}`-typed parameters admit every
    // object): `{}` carries no shape information, so the literal builds as
    // its OWN type, exactly the unmappable-context fallback below. An
    // empty LITERAL keeps the context (the shapes agree).
    if (mapped?.kind === "record" && expr.properties.length > 0) {
      const ctxShape = L.shapes.get(mapped.shapeId);
      if (ctxShape && ctxShape.fields.length === 0 && !ctxShape.indexValue && !ctxShape.tuple) {
        mapped = L.mapTypeOf(L.typeOf(expr)) ?? mapped;
        shapeDeclared = false;
      }
    }
    // A literal with a property the contextual TYPE ITSELF lacks — only
    // reachable through type assertions and satisfies (fresh-literal
    // excess-property checks reject the direct spelling): the context
    // cannot hold the value, so the literal builds at its OWN type and the
    // slot's width coercion narrows it (divergence 36's copy stance — the
    // extra fields drop in the copy). The probe is against the CHECKER's
    // contextual type, not the mapped shape: a property the contextual
    // type carries but the shape dropped (settled value/reason,
    // generic-callable members) belongs to the drop paths below, and
    // index-signature contexts keep every key (overflow capture).
    if (mapped?.kind === "record" && expr.properties.length > 0) {
      const ctxShape = L.shapes.get(mapped.shapeId);
      if (ctxShape && !ctxShape.indexValue && !ctxShape.tuple) {
        const names = new Set(ctxShape.fields.map((f) => f.name));
        const ctxHasProp = (name: string): boolean => {
          const members = tsType.isUnionType() ? tsType.getTypes() : [tsType];
          return members.some((m) => L.checker.getPropertyOfType(m, name) !== undefined);
        };
        const extraOf = (text: string): boolean => !names.has(text) && !ctxHasProp(text);
        const extra = expr.properties.some((p) => {
          if (ts.isSpreadAssignment(p) || !p.name) return false;
          if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return extraOf(p.name.text);
          if (ts.isNumericLiteral(p.name)) return extraOf(String(Number(p.name.text)));
          return false; // computed keys keep their existing paths
        });
        if (extra) { mapped = L.mapTypeOf(L.typeOf(expr)) ?? mapped; shapeDeclared = false; }
      }
    }
    // A union-typed slot (`const r: Res = { kind: "ok", ... }`) contextually
    // types the literal as the WHOLE union; build the literal as its own
    // (arm) shape and let the slot's coercion wrap it into the union. An
    // unknown-typed slot (`JSON.stringify({ a: 1 })`) likewise. An
    // UNMAPPABLE context falls back the same way — the literal's own type
    // is the plain record the slot coerces. A CLASS-INSTANCE context
    // (`const p: Point = { x, y }` — tsc's structural view of data
    // classes) falls back too: the literal builds as its own record and
    // the slot's width coercion constructs through the trivial
    // parameter-property constructor (recordToClassPlan), or fences with
    // the record-shape story.
    // A jsval-mapped context reaches here only when lowerExpr's island
    // gate DECLINED it (a project-declared typedef that absorbed to the
    // island through checker-`any` field residue): the literal builds at
    // its own type like every unmappable context.
    if (mapped === null || mapped.kind === "union" || mapped.kind === "dyn" || mapped.kind === "object" || mapped.kind === "jsval") {
      ctxUnion = mapped?.kind === "union" ? mapped : null;
      mapped = L.mapTypeOf(L.typeOf(expr)) ?? mapped;
      shapeDeclared = false;
      // A literal whose own shape re-tags into NO arm of the contextual
      // union, where the union has exactly ONE record arm: build AS that
      // arm — there is no ambiguity (tsc already checked the literal
      // against the union, and the record arm is the only shape it can
      // inhabit), and the arm's field types drive every property's
      // coercion (`{ env: {...spread...}, onCleanup }` against an
      // optional options param — the env value builds by ITS contextual
      // index-signature type and wraps into the arm's `| undefined`
      // field, where the literal's own inferred width would mismatch).
      // Empty literals (`_env = {}` — the fieldless own shape) and
      // literals against PURE index-signature arms (`{ OPENSSL_CONF:
      // candidate }` — keys become overflow entries) are the same rule's
      // simplest cases. The empty-array-in-union rule, record form.
      if (ctxUnion) {
        const def = L.unions.get(ctxUnion.unionId);
        const recordArms = def?.arms.filter((a) => a.kind === "record") ?? [];
        if (recordArms.length === 1) {
          const armShape = L.shapes.get(recordArms[0]!.shapeId);
          if (
            (mapped?.kind !== "record" || mapped.shapeId !== recordArms[0]!.shapeId) &&
            !armShape?.tuple
          ) {
            mapped = recordArms[0]!;
            // The shape is a DECLARED arm of the slot's union, not the
            // literal's own inferred type — the proto `IImageMessage |
            // null | undefined` field shape.
            shapeDeclared = ctxType0 !== undefined;
          }
        } else if (recordArms.length > 1) {
          const ownShapeId = mapped?.kind === "record" ? mapped.shapeId : null;
          // SEVERAL record arms (the reducer-action / discriminated-message
          // pattern): the literal's own inferred shape re-tags into no arm
          // — its field types widened per field (`parsed: 1` against
          // `parsed: number | null`), so the IR-level candidate probe is
          // ambiguous (a narrower arm also admits the literal by dropping
          // fields). The LITERAL types tsc checked carry the discriminant
          // the shapes erased: match the literal's fields against each
          // union member's CHECKER types (literal-vs-literal field pairs
          // decide by value — the `kind: "a"` discriminant), and when
          // exactly ONE member fits, build AS that arm — its field types
          // drive every property's coercion, exactly the single-record-arm
          // rule above. Ambiguous literals keep the SC2003 fence.
          if (ownShapeId === null || !recordArms.some((a) => a.shapeId === ownShapeId)) {
            const arm = literalUnionArmOf(L, expr, tsType, recordArms);
            if (arm) { mapped = arm; shapeDeclared = ctxType0 !== undefined; }
          }
        }
      }
    }
    if (process.env["SCRIPTC_OBJLIT_WHY"] !== undefined) {
      const armInfo = ctxUnion
        ? `ctxUnion=${ctxUnion.unionId} arms=${String(L.unions.get(ctxUnion.unionId)?.arms.length ?? -1)} recArms=${String((L.unions.get(ctxUnion.unionId)?.arms.filter((a) => a.kind === "record") ?? []).length)}`
        : "ctxUnion=none";
      console.error(
        `OBJLIT ${loc.file.split("/").pop()}@${String(loc.start)} ctx0=${ctxType0 === undefined ? "NONE" : L.checker.typeToString(ctxType0).slice(0, 90)}` +
        ` tsType=${L.checker.typeToString(tsType).slice(0, 90)} ${armInfo}` +
        ` mapped=${mapped === null ? "null" : mapped.kind + (mapped.kind === "record" ? "#" + mapped.shapeId : "")}` +
        ` shapeDeclared=${String(shapeDeclared)}` +
        ` fields=${mapped?.kind === "record" ? (L.shapes.get(mapped.shapeId)?.fields ?? []).map((f) => f.name + ":" + L.fmt(f.type).slice(0, 40)).join(" | ") : "-"}`,
      );
    }
    // The CJS EXPORT-TABLE literal in VALUE position (JS): importers reach
    // every member through alias plumbing and accessor lifts — the record
    // VALUE exists for the module's own reads (Object.keys, internal
    // member reads), so it keeps exactly the plain fields whose values
    // lower; accessor entries and members with no value representation
    // (rest-param function types) narrow away. SEMANTICS.md documents the
    // enumeration divergence.
    if (
      isJsSourceFile(expr.getSourceFile()) &&
      (!mapped || expr.properties.some((p) => ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))) &&
      isCjsExportTableLiteral(expr)
    ) {
      const fields: { name: string; value: IrExpr }[] = [];
      for (const prop of expr.properties) {
        if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) continue;
        const propName = ts.isSpreadAssignment(prop) ? undefined : prop.name;
        if (!propName || !(ts.isIdentifier(propName) || ts.isStringLiteral(propName))) continue;
        const name = propName.text;
        let v: IrExpr | null = null;
        if (ts.isShorthandPropertyAssignment(prop)) {
          v = probeLower(L, propName as ts.Identifier);
        } else if (ts.isPropertyAssignment(prop)) {
          v = probeLower(L, prop.initializer);
        }
        if (!v || v.type.kind === "void" || v.type.kind === "caught" || v.type.kind === "jsval") continue;
        if (isUnitType(v.type)) continue;
        fields.push({ name, value: v });
      }
      // Canonical (sorted) field order — the shape registry's invariant;
      // the dropped reads are all pure, so reordering loses nothing.
      fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const shapeId = L.shapes.intern(fields.map((f) => ({ name: f.name, type: f.value.type })));
      return { kind: "recordLit", fields, type: { kind: "record", shapeId }, loc };
    }
    // The JS declaration fallback, literal-side (the checked-dynamic tree-array rule's
    // object form): a literal whose shape has no static home — an
    // unmappable contextual type over unmappable own fields (the
    // PropertyDescriptorMap argument of Object.defineProperties, nested
    // descriptor records with `any` values) — builds as a dyn OBJECT:
    // each field converts through the usual dyn boundary, and dynamic
    // consumers ride the keyed-dyn paths. TypeScript keeps the fence.
    if ((!mapped || mapped.kind === "dyn") && isJsSourceFile(expr.getSourceFile())) {
      return lowerDynObjectLiteral(L, expr);
    }
    // The slot IS a union, its arms map, and no single arm fit — so the
    // literal has a static home and the type fence's "no static
    // representation" would be false about it. What actually blocks the
    // build is the SPREAD: a source union with several record arms leaves
    // the result's arm undecided until run time, and an object literal
    // builds one shape. Name that, in the union-source spread's own voice
    // one level up (the per-field merge below already refuses the same
    // source when the TARGET shape is known); badType keeps every other
    // literal unchanged.
    if ((!mapped || mapped.kind !== "record") && ctxUnion) {
      for (const prop of expr.properties) {
        if (!ts.isSpreadAssignment(prop)) continue;
        if (conditionalSpreadOf(prop.expression)) continue;
        const st = L.mapTypeOf(L.typeOf(prop.expression));
        if (st?.kind !== "union") continue;
        const sdef = L.unions.get(st.unionId);
        const srecs = sdef?.arms.filter((a) => a.kind === "record") ?? [];
        if (srecs.length < 2) continue;
        // The CHECKER's spelling, not the IR's, and capped. Both unions
        // here are whole event families (nine arms of ten fields at
        // zapo's widest), and `fmt` expands every arm structurally: the
        // message would run past the emitter's ~4012-character truncation
        // and land in the census's "suspiciously long prose" bucket,
        // which is the population this project keeps at zero. The
        // declared name is also the more useful half — a reader can look
        // 'WaMexNotificationEvent' up; a 4 000-character structural
        // recitation of it tells them nothing they can act on.
        const name = (t: ts.Type): string => {
          const s = L.checker.typeToString(t);
          return s.length <= 80 ? s : `${s.slice(0, 77)}...`;
        };
        L.unsupported(
          "SC1090",
          prop,
          `object spread of '${name(L.typeOf(prop.expression))}' into the union-typed slot ` +
            `'${name(tsType)}' (the source's arm decides which arm the literal builds, ` +
            `and a literal builds one shape — ${NARROW_FIRST})`,
        );
      }
    }
    if (!mapped || mapped.kind !== "record") L.badType(expr, tsType);
    let type = mapped;
    let shape = L.shapes.get(type.shapeId)!;
    // ACCESSOR properties, JS literals only (TS accessors fill the shape's
    // %get:/%set: closure slots below): no record storage exists for them,
    // so the literal's shape NARROWS to its plain fields (reads resolve
    // through the lifted accessors; Object.keys over the value omits
    // accessor names — the documented divergence).
    if (isJsSourceFile(expr.getSourceFile())) {
      const accessorNames = new Set(
        expr.properties
          .filter((p) => ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))
          .map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : ""))
          .filter((n) => n !== ""),
      );
      if (accessorNames.size > 0) {
        const narrowed = shape.fields.filter((f) => !accessorNames.has(f.name));
        const narrowedId = L.shapes.intern(
          narrowed.map((f) => ({ name: f.name, type: f.type })),
          false,
          shape.indexValue,
        );
        type = { kind: "record", shapeId: narrowedId };
        shape = L.shapes.get(narrowedId)!;
      }
    }
    const fieldTypes = new Map(shape.fields.map((f) => [f.name, f.type]));

    // A PURE index-signature target with spreads — `{ ...process.env }`,
    // `{ ...process.env, ...extraEnv }`, `{ ...env, PATH: p }` (the
    // spawn-env pattern): the field-by-field desugar below cannot
    // enumerate runtime overflow keys, so the literal lowers as ONE
    // interned merge-helper call — contributors apply in literal order
    // with keyed writes (JS last-write-wins), sources and values evaluate
    // once each in source order (the call's argument order). A CONDITIONAL
    // spread `...(c ? { k: v } : {})` contributes its one key as a ternary
    // — cond once, v lazily — and a whole spread SOURCE that may be absent
    // (`{ ...maybe }` over `Record<K, V> | undefined`) contributes the
    // empty record for its nullish arm; targets with declared fields keep
    // the historic desugar below.
    const isRuntimeComputedKey = (p: ts.ObjectLiteralElementLike): boolean =>
      !ts.isSpreadAssignment(p) &&
      p.name !== undefined &&
      ts.isComputedPropertyName(p.name) &&
      literalComputedKey(L, p.name) === null;
    // DECLARED fields ride along too: `{ jid, ...groupAttrs }` typed
    // `{ [k: string]: string; jid: string }` — the attribute-builder
    // shape tsc infers for a literal that spreads a `Record<string, T>`.
    // The keyed-write helper the merge already emits (`sc_rks_*`) is the
    // one that dispatches a declared name onto its struct slot and
    // everything else into the overflow, so a mixed target needs no new
    // runtime and no new write kind — only the merge's own admission and
    // the `overflowOnly` flag flipping off. `lowerIndexMergeHelper`
    // re-checks the shape matrix and answers null where it cannot, which
    // keeps the fence below exactly as it was.
    // A mixed target enters only where the historic desugar CANNOT go —
    // it fences every plain spread into an index-signature shape and
    // every runtime-computed key — so nothing that compiles today is
    // rerouted. A literal whose only spread is CONDITIONAL and whose name
    // is a declared field already lowers below, and keeps doing so.
    const historicFences = (p: ts.ObjectLiteralElementLike): boolean => {
      if (isRuntimeComputedKey(p)) return true;
      if (!ts.isSpreadAssignment(p)) return false;
      const cs = conditionalSpreadOf(p.expression);
      if (!cs) return true; // a plain spread into an index-signature target always fences below
      if (cs === "unsupported" || cs.props.length !== 1) return true;
      // A conditional spread whose key IS a declared field lowers below
      // today (its ternary fills that slot) — leave it there.
      return !shape.fields.some((f) => f.name === cs.props[0]!.name.text);
    };
    const ixMergeAdmits = (): boolean => {
      const iv = shape.indexValue;
      if (!iv) return false;
      if (shape.fields.length === 0) return true;
      if (shape.fields.some((f) => f.name.startsWith("%") || !typeEquals(f.type, iv))) return false;
      return expr.properties.some(historicFences);
    };
    if (
      shape.indexValue &&
      !shape.tuple &&
      ixMergeAdmits() &&
      (expr.properties.some((p) => ts.isSpreadAssignment(p)) || expr.properties.some(isRuntimeComputedKey))
    ) {
      const contributors: IndexMergeContributor[] = [];
      let mergeable = true;
      for (const prop of expr.properties) {
        if (ts.isSpreadAssignment(prop)) {
          const cs = conditionalSpreadOf(prop.expression);
          if (cs === "unsupported" || (cs && cs.props.length !== 1)) {
            L.unsupported(
              "SC1090",
              prop,
              "conditional spreads beyond `...(c ? { field: v } : {})` (exactly one property against an empty arm)",
            );
          }
          if (cs) {
            const iv = shape.indexValue;
            // A slot that already spells "absent" — an undefined-armed
            // union — keeps the historic desugar: the key is WRITTEN
            // holding that arm (divergence 56's explicit-undefined-is-
            // absent stance). A slot with NO undefined of its own — the
            // `Record<string, string>` header/param builders — carries
            // presence in a WIDENED `T | undefined` helper parameter
            // instead, and the helper writes the key only on the present
            // side, so an absent key is genuinely absent (JS-exact, and
            // strictly better than the stance above). `unknown` slots take
            // the dyn tree's own undefined, the same way an omitted
            // optional record field does, and test it with `dynTest`.
            const absent = L.wrappedUndefined(iv, locOf(prop));
            const widened = absent ? null : condPresenceSlot(L, iv);
            const hole = absent ?? (widened ? L.wrappedUndefined(widened, locOf(prop)) : iv.kind === "dyn" ? dynUndefinedExpr(locOf(prop)) : null);
            if (!hole) {
              L.unsupported(
                "SC1090",
                prop,
                `conditional spreads into '${L.fmt(iv)}'-valued index-signature keys (the empty arm needs an undefined arm to hold — write the key in an if statement instead)`,
              );
            }
            const csProp = cs.props[0]!;
            const cond = L.lowerCondition(cs.cond);
            const vNode: ts.Node = ts.isPropertyAssignment(csProp) ? csProp.initializer : csProp;
            let v = L.intoIndexValueSlot(
              ts.isPropertyAssignment(csProp) ? L.lowerExpr(csProp.initializer) : L.lowerShorthandValue(csProp),
              iv,
              vNode,
            );
            if (widened) {
              v = { kind: "unionWrap", unionId: widened.unionId, tag: L.armTag(widened.unionId, iv), value: v, type: widened, loc: locOf(prop) };
            }
            if (process.env.SCRIPTC_CONDSPREAD_WHY) {
              const l = locOf(prop);
              console.error(`CONDSPREAD ${absent ? "armed" : widened ? "widened" : "dyn"} slot=${L.fmt(iv)} ${l.file}@${l.start}`);
            }
            contributors.push({
              // Only the slots that had no encoding until now take the
              // conditional WRITE; the armed slots keep their historic
              // unconditional write of the undefined arm.
              kind: absent ? "field" : "condField",
              name: csProp.name.text,
              value: {
                kind: "ternary",
                cond,
                then: cs.whenTrue ? v : hole,
                else_: cs.whenTrue ? hole : v,
                type: widened ?? iv,
                loc: locOf(prop),
              },
            });
            continue;
          }
          const src = optionalIndexSpreadSource(L, L.lowerExpr(prop.expression), locOf(prop));
          if (src.type.kind !== "record") {
            L.unsupported(
              "SC1090",
              prop,
              `object spread of '${L.fmt(src.type)}' sources into an index-signature shape (only index-signature records merge — ${NARROW_FIRST})`,
            );
          }
          fenceAccessorSpreadSource(L, prop, L.shapes.get(src.type.shapeId));
          contributors.push({ kind: "spread", shapeId: src.type.shapeId, value: src });
          continue;
        }
        if (
          (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
          prop.name &&
          (ts.isIdentifier(prop.name) ||
            ts.isStringLiteral(prop.name) ||
            ts.isNumericLiteral(prop.name) ||
            (ts.isComputedPropertyName(prop.name) && literalComputedKey(L, prop.name) !== null))
        ) {
          const value = ts.isPropertyAssignment(prop)
            ? L.intoIndexValueSlot(L.lowerExpr(prop.initializer), shape.indexValue, prop.initializer)
            : L.intoIndexValueSlot(L.lowerShorthandValue(prop), shape.indexValue, prop);
          contributors.push({ kind: "field", name: propNameText(L, prop.name), value });
          continue;
        }
        // A RUNTIME-keyed property (`{ ...m, ["a" + "b"]: "" }`, `{ [K]:
        // v }` where K is a runtime string): the key evaluates before its
        // value (JS's per-property order — both are helper arguments) and
        // writes through the signature exactly like a spread's keys.
        // Number/boolean/unknown keys stringify (ToPropertyKey).
        if (ts.isPropertyAssignment(prop) && ts.isComputedPropertyName(prop.name)) {
          let k = L.lowerExpr(prop.name.expression);
          if (k.type.kind === "f64" || k.type.kind === "bool" || k.type.kind === "dyn") {
            k = { kind: "toString", operand: k, type: STRING, loc: locOf(prop.name) };
          }
          if (k.type.kind !== "string") {
            L.unsupported(
              "SC1090",
              prop.name,
              `'${L.fmt(k.type)}'-typed computed property keys (string, number, boolean, and unknown keys stringify)`,
            );
          }
          const value = L.intoIndexValueSlot(L.lowerExpr(prop.initializer), shape.indexValue, prop.initializer);
          contributors.push({ kind: "keyedField", key: k, value });
          continue;
        }
        mergeable = false;
        break;
      }
      const helper0 = mergeable ? lowerIndexMergeHelper(L, type.shapeId, contributors, loc) : null;
      // A PURE-signature target keeps its own refusal message (nothing
      // below can lower it either). A MIXED target falls through to the
      // historic desugar instead, so a shape the merge declines meets
      // exactly the diagnostic it met before this path admitted it.
      if (mergeable && helper0 === null && shape.fields.length > 0) {
        // fall through
      } else if (mergeable) {
        const helper = helper0;
        if (helper === null) {
          L.unsupported(
            "SC1090",
            expr,
            `object spread into '${L.fmt(type)}' from these source shapes (spread sources must be index-signature records whose value type is, or lifts into, the target's)`,
          );
        }
        return {
          kind: "call",
          callee: helper,
          args: contributors.flatMap((c) => (c.kind === "keyedField" ? [c.key, c.value] : [c.value])),
          type,
          loc,
        };
      }
    }
    // Unfoldable computed keys outside the index-signature merge path:
    // no record shape can hold a runtime-decided name.
    for (const prop of expr.properties) {
      if (isRuntimeComputedKey(prop)) {
        L.unsupported("SC1090", (prop as ts.PropertyAssignment).name, "computed property keys (compile-time-known keys fold — a pure expression whose checker type is one string or number literal: consts, enum members, quoted keys, templates of those — `{ [MARKER]: v }`; runtime string keys write through an index-signature target; symbol keys stay out)");
      }
    }

    // A DECLARED-fields target built ENTIRELY from index-signature spreads —
    // `{ ...Object.fromEntries(...), ...Object.fromEntries(...) }` typed
    // AppConfig (the defaults-merge idiom over runtime-keyed sources): the
    // field-by-field desugar cannot enumerate runtime keys, so the literal
    // lowers as ONE interned merge-helper call — sources evaluate once each
    // in source order (the call's argument order — computed sources
    // included, no re-read), contributors apply in order with per-key
    // dispatch onto the declared fields (JS last-write-wins). Divergence 68
    // has the runtime rules (validated collisions, extra keys dropped).
    // EXPLICIT properties ride along: `{ ...spread(content), ...uploaded,
    // width: w }` — the media-message builder shape, a runtime-keyed
    // source completed by named fields. They are contributors like any
    // other, applied at their literal position (the helper's argument
    // order IS their evaluation order), so JS's last-write-wins decides a
    // collision either way round. Only names the target DECLARES qualify
    // (a declared shape has no slot for anything else — the historic
    // desugar's shape mismatch keeps that case).
    const declMergeNamed = (p: ts.ObjectLiteralElementLike): string | null => {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return null;
      if (!p.name) return null;
      if (
        !ts.isIdentifier(p.name) &&
        !ts.isStringLiteral(p.name) &&
        !ts.isNumericLiteral(p.name) &&
        !(ts.isComputedPropertyName(p.name) && literalComputedKey(L, p.name) !== null)
      ) {
        return null;
      }
      return propNameText(L, p.name);
    };
    // The declared-shape merge DROPS a runtime key that names no declared
    // field — divergence 68, and honest exactly while the target's type
    // says the value has no other keys. A shape scriptc mapped WITHOUT an
    // index signature whose CHECKER type has one (the inferred literal
    // type of `{ jid, ...groupAttrs }` in a position with no contextual
    // type: tsc writes `{ [x: string]: string; jid: string }`, mapType
    // keeps only `jid`) says the opposite, and dropping there is a silent
    // wrong answer, not a divergence. Keep the fence.
    // The declared-shape merge DROPS a runtime key that names no declared
    // field. That is divergence 68 — honest — exactly when a type the
    // PROGRAM DECLARED says those keys do not belong. When the shape was
    // inferred from an object literal instead (tsc drops a spread source's
    // index signature, so `{ jid, ...groupAttrs }` types as
    // `{ jid: string }` while the value carries every group attribute, and
    // an enclosing literal passes that inferred type down as its own
    // contextual type), dropping is a silent wrong answer and the fence
    // has to stand. The test is the shape's PROVENANCE: a named
    // declaration or a type literal in a declaration, never an object
    // literal expression.
    const dropsAreHonest = shapeDeclared;
    if (process.env.SCRIPTC_SPREADIX_WHY && !shape.tuple) {
      const l = locOf(expr);
      console.error(`SPREADIX ${l.file}:${l.start} declared=${shapeDeclared} idx=${shape.indexValue ? L.fmt(shape.indexValue) : "-"} fields=${shape.fields.map((f) => f.name).join(",").slice(0, 80)}`);
    }
    if (
      !shape.indexValue &&
      !shape.tuple &&
      dropsAreHonest &&
      shape.fields.length > 0 &&
      expr.properties.length > 0 &&
      expr.properties.every((p) =>
        ts.isSpreadAssignment(p)
          ? !conditionalSpreadOf(p.expression)
          : (() => {
              const n = declMergeNamed(p);
              return n !== null && shape.fields.some((f) => f.name === n);
            })(),
      ) &&
      expr.properties.some((p) => {
        if (!ts.isSpreadAssignment(p)) return false;
        const t = L.mapTypeOf(L.typeOf(p.expression));
        return t?.kind === "record" && !!L.shapes.get(t.shapeId)?.indexValue;
      })
    ) {
      return lowerDeclaredSpreadMerge(L, expr, type, shape, loc, declMergeNamed);
    }

    const shapeMismatch = (node: ts.Node): never => {
      const own = L.mapTypeOf(L.typeOf(expr));
      L.pushDiag(
        recordShapeMismatchDiag(
          L.fmt(type),
          own ? L.fmt(own) : L.checker.typeToString(L.typeOf(expr)),
          locOf(node),
          own?.kind === "record"
            ? (L.describeRecordWidthBlocker(own.shapeId, type.shapeId) ?? undefined)
            : undefined,
        ),
      );
      throw new PoisonError();
    };

    // `expl` marks an entry written by an EXPLICIT property (not copied by a
    // spread). Only those carry evaluation a spread's field-by-field copy
    // could drop or step over — spread-contributed entries are reads and
    // pure re-tag helper calls by construction.
    const fields: { name: string; value: IrExpr; overflow?: true; drop?: true; expl?: true }[] = [];
    // Hoisted spread sources, in source order. A COMPUTED source (a call,
    // an await, an indexed read) is re-emitted once per field it
    // contributes, so it must be evaluated exactly ONCE first and the
    // copies must read the slot. See the hoist below for why it is only
    // safe while every earlier contributor is pure.
    const prelude: IrStmt[] = [];
    // Field names introduced by conditional spreads: their ternary carries
    // the spread's whole evaluation (cond once, value lazily), so a LATER
    // contributor overriding one would silently drop that evaluation —
    // collisions fence in both directions.
    const conditionalNames = new Set<string>();
    // Member names DROPPED from the shape (JS deferral — unlowerable pure
    // member reads narrow away; see the catch in the property loop).
    const droppedNames = new Set<string>();
    // A spread copy that OVERWRITES an earlier contributor takes over that
    // name's EXISTING slot, so its read is emitted where the older value
    // sat — ahead of everything the entries between them evaluate. Both
    // moves are unobservable exactly while every EXPLICIT contributor
    // accumulated so far is DROPPABLE (no call, no write, no trap): the
    // older value's evaluation can then vanish, and the copy's read cannot
    // see a different heap than it would at the spread's own position.
    // Spread-copied entries never count — a field read and a pure re-tag
    // call carry nothing to observe, which is the pre-existing
    // `{ ...DEFAULTS, ...overrides }` merge. tsc already rejects the plain
    // form (TS2783, "specified more than once"); what reaches here are
    // OPTIONAL source fields, which it allows.
    const overwriteObservable = (): boolean =>
      fields.some((x) => x.expl === true && !droppableStatic(x.value));
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const cs = conditionalSpreadOf(prop.expression);
        if (cs && cs !== "unsupported") {
          // `...(c ? { k: v } : {})` — ONE conditional field at the
          // spread's own position: cond evaluates exactly once, `v` only
          // when the non-empty arm is taken (ternary arms are lazy), and
          // the empty arm holds the interned undefined arm — exactly the
          // omitted-optional-field representation, which is also why the
          // target field must be optional (tsc types the idiom that way).
          const csProp = cs.props[0]!; // single-prop-checked in the fence pass
          const name = csProp.name.text;
          const fieldType = fieldTypes.get(name);
          if (!fieldType) {
            if (shape.indexValue) {
              L.unsupported(
                "SC1090",
                prop,
                "conditional spreads into index-signature keys (overflow entries model presence — write the key in an if statement instead)",
              );
            }
            throw shapeMismatch(prop);
          }
          // An EARLIER contributor for the same name (`{ jid, ...opts,
          // ...(t ? { privacyTokenNode: t } : {}) }`, where `opts` already
          // carries the key): JS's last-write-wins means the empty arm
          // leaves the EARLIER value standing, so it — not the undefined
          // arm — is what the else branch holds. That is the same
          // present-test merge the union-source spread below builds, under
          // the same order guard: the ternary takes over the earlier
          // entry's slot, so its condition and value evaluate where the
          // older value sat, which is unobservable exactly while every
          // explicit entry accumulated so far is droppable. Only ONE plain
          // entry qualifies — a dropped or duplicated name keeps the fence.
          const prior = fields.findIndex((f) => f.name === name);
          const priorEntry = prior >= 0 ? fields[prior]! : null;
          if (
            priorEntry &&
            (priorEntry.drop === true ||
              fields.filter((f) => f.name === name).length !== 1 ||
              !typeEquals(priorEntry.value.type, fieldType) ||
              overwriteObservable())
          ) {
            if (process.env.SCRIPTC_CONDSPREAD_WHY) {
              console.error(`CONDSPREAD refuse-over-earlier ${name} @${locOf(prop).start}`);
            }
            L.unsupported(
              "SC1090",
              prop,
              `conditional spread of '${name}' over an earlier '${name}' whose evaluation is observable (the empty arm would have to keep that value — give '${name}' one contributor, or move the conditional spread first)`,
            );
          }
          const absent = priorEntry ? priorEntry.value : L.wrappedUndefined(fieldType, locOf(prop));
          if (!absent) {
            L.unsupported(
              "SC1090",
              prop,
              `conditional spreads onto the required field '${name}' (the empty arm leaves it undefined — declare the field optional)`,
            );
          }
          const cond = L.lowerCondition(cs.cond);
          const valueNode = ts.isPropertyAssignment(csProp) ? csProp.initializer : csProp;
          let v = ts.isPropertyAssignment(csProp)
            ? L.lowerExpr(csProp.initializer)
            : L.lowerShorthandValue(csProp);
          v = L.coerceInto(valueNode, v, fieldType);
          if (!typeEquals(v.type, fieldType)) L.badType(valueNode, L.typeOf(valueNode));
          conditionalNames.add(name);
          const merged = {
            name,
            value: {
              kind: "ternary" as const,
              cond,
              then: cs.whenTrue ? v : absent,
              else_: cs.whenTrue ? absent : v,
              type: fieldType,
              loc: locOf(prop),
            },
          };
          if (priorEntry) {
            if (process.env.SCRIPTC_CONDSPREAD_WHY) {
              console.error(`CONDSPREAD over-earlier ${name} @${locOf(prop).start}`);
            }
            fields[prior] = { ...priorEntry, ...merged };
          } else {
            fields.push(merged);
          }
          continue;
        }
        // `{ ...base, ... }` — field-by-field copy of a known record
        // shape. Every source field must land on the target shape with an
        // equal type (a wider source would silently DROP fields JS keeps —
        // the width fence, same as literals). Later contributors override
        // earlier ones (JS last-write-wins; the reads are side-effect-free,
        // so dropping the earlier read is exact). Identifier sources
        // re-read per field (historic path); any OTHER source must be a
        // re-emittable pure read, sharing one lowered node per field.
        // `{ jid, ...opts }` — an explicit property BEFORE the spread.
        // The desugar's one-entry-per-name list APPENDS each copied field,
        // so with no name collision the copies evaluate after the earlier
        // properties, which is exactly JS's order; the two order hazards
        // are handled where they arise, not by an up-front ban:
        //   - a copy that OVERWRITES an earlier name lands in that name's
        //     older slot, ahead of anything written between (the override
        //     guard below);
        //   - hoisting a COMPUTED source into the prelude moves its call
        //     ahead of the earlier properties' reads, which could observe
        //     what the call writes — so the hoist is withheld here and the
        //     computed-source fence takes over.
        // (The index-signature merge path above takes any order.)
        const afterExplicit = expr.properties
          .slice(0, expr.properties.indexOf(prop))
          .some((p) => !ts.isSpreadAssignment(p));
        let srcNode: ts.Expression = prop.expression;
        while (ts.isParenthesizedExpression(srcNode)) srcNode = srcNode.expression;
        let srcLowered = ts.isIdentifier(srcNode) ? null : L.lowerExpr(srcNode);
        if (process.env.SCRIPTC_SPREADORD_WHY && afterExplicit) {
          const l = locOf(prop);
          console.error(
            `SPREADORD after-explicit ${l.file}@${l.start} fields=${fields.length} src=${ts.SyntaxKind[srcNode.kind]} hoistable=${srcLowered === null || pureReemittable(srcLowered)}`,
          );
        }
        // Evaluate a computed source ONCE into a hidden slot, so the
        // per-field copies read the slot instead of re-running it —
        // `{ ...makeBase(node), kind: 'x' }` must call makeBase once.
        //
        // The slot is filled in the PRELUDE, ahead of every field, which
        // moves the source's evaluation ahead of earlier contributors.
        // That is unobservable only while those are pure, so the hoist is
        // allowed exactly until the first impure contributor lands; after
        // that the fence stands, because reordering two effects is a wrong
        // answer, not a missing feature. An earlier explicit PROPERTY
        // withholds it too: its read is pure, but a hoisted call could
        // write what that read observes, and the two would swap.
        //
        // "Ahead of earlier contributors" is only a hazard for a
        // contributor whose VALUE the call could change. A read of an
        // IMMUTABLE local — `{ filePath, ...meter.finalize() }`, zapo's
        // media prepare — cannot be one: nothing a callee does can
        // reassign a `const` binding of the caller, and the read yields
        // the same value on either side of the call. Literals likewise.
        // So the ban is on contributors that are order-DEPENDENT (a field
        // read the call could write, an element read, another call), not
        // on the mere presence of an earlier property.
        const orderIndependent = (e: IrExpr): boolean => {
          if (e.kind === "numLit" || e.kind === "strLit" || e.kind === "boolLit" || e.kind === "bigLit") return true;
          if (e.kind === "unitLit") return true;
          if (e.kind === "unionWrap") return orderIndependent(e.value);
          if (e.kind !== "varRef") return false;
          const local = L.ctx.locals.find((l) => l.id === e.localId);
          // A TDZ const is excluded: reading it before its initializer
          // THROWS, and hoisting would run the source call ahead of that
          // throw — an effect JS never reaches.
          return local !== undefined && !local.mutable && local.tdz !== true;
        };
        const earlierStable = fields.every((f) => f.value === undefined || orderIndependent(f.value));
        if (srcLowered && !pureReemittable(srcLowered) && (!afterExplicit || earlierStable)) {
          // `pureReemittable` is about re-READING a value cheaply and so
          // starts at `varRef`; a LITERAL is not one of its kinds even
          // though nothing is purer. `orderIndependent` covers exactly
          // those, so the two together are the honest test here.
          if (fields.every((f) => pureReemittable(f.value) || orderIndependent(f.value))) {
            const slot = L.declareHiddenLocal("%spread", srcLowered.type);
            prelude.push({ kind: "varDecl", localId: slot.id, init: srcLowered, loc: locOf(srcNode) });
            srcLowered = { kind: "varRef", localId: slot.id, type: srcLowered.type, loc: locOf(srcNode) };
          }
        }
        const srcType = srcLowered ? srcLowered.type : L.mapTypeOf(L.typeOf(srcNode));
        // `...options.installConfig` — a spread of `Partial<X> | undefined`
        // (the optional-options merge idiom `{ ...DEFAULTS, ...overrides }`):
        // JS spreads nothing for the unit arm and copies present keys
        // otherwise. Per target field the desugar builds
        // `present ? extracted : earlier` — present tests the source's
        // record tag AND (optional source fields) the field's own value
        // arm; absent keeps the earlier contributor's value (both reads
        // are pure, so the reorder into the ternary is unobservable).
        if (srcType?.kind === "union") {
          const def = L.unions.get(srcType.unionId);
          const recArms = def?.arms.filter((a) => a.kind === "record") ?? [];
          if (
            !def ||
            recArms.length !== 1 ||
            !def.arms.every((a) => a.kind === "record" || isUnitType(a))
          ) {
            L.unsupported(
              "SC1090",
              prop,
              `object spread of '${L.fmt(srcType)}' sources (only known record shapes spread — ${NARROW_FIRST})`,
            );
          }
          if (srcLowered && !pureReemittable(srcLowered)) {
            L.unsupported(
              "SC1090",
              prop,
              "object spread of computed sources (the field copies re-read the source — bind it to a const first)",
            );
          }
          const recArm = recArms[0]! as IrType & { kind: "record" };
          const recTag = def.arms.indexOf(recArm);
          // A checked-dynamic VALUE under the union-mapped checker type
          // (a JS dyn-holding binding): the present/absent desugar tests
          // union tags a dyn box does not carry — fence honestly instead
          // of the validator's ICE.
          const probedSrc = srcLowered ?? probeLower(L, srcNode);
          if (probedSrc?.type.kind === "dyn") {
            L.unsupported(
              "SC1090",
              prop,
              `object spread of a checked-dynamic '${L.fmt(srcType)}' source (${NARROW_FIRST})`,
            );
          }
          const srcShape = L.shapes.get(recArm.shapeId);
          if (!srcShape) throw new Error(`lowerer bug: spread of unknown shape ${recArm.shapeId}`);
          fenceAccessorSpreadSource(L, prop, srcShape);
          if (srcShape.indexValue || shape.indexValue) {
            L.unsupported(
              "SC1090",
              prop,
              "object spread involving index-signature shapes (overflow keys are runtime state — copy the fields you need explicitly)",
            );
          }
          const laterNames = new Set<string>();
          for (const later of expr.properties.slice(expr.properties.indexOf(prop) + 1)) {
            if (ts.isSpreadAssignment(later)) {
              if (conditionalSpreadOf(later.expression)) continue;
              const lt = L.mapTypeOf(L.typeOf(later.expression));
              if (lt?.kind === "record") {
                for (const lf of L.shapes.get(lt.shapeId)?.fields ?? []) laterNames.add(lf.name);
              }
              continue;
            }
            if (
              later.name &&
              (ts.isIdentifier(later.name) ||
                ts.isStringLiteral(later.name) ||
                ts.isNumericLiteral(later.name) ||
                (ts.isComputedPropertyName(later.name) && literalComputedKey(L, later.name) !== null))
            ) {
              laterNames.add(propNameText(L, later.name));
            }
          }
          const srcRef = (): IrExpr => srcLowered ?? L.lowerExpr(srcNode);
          for (const f of srcShape.fields) {
            if (laterNames.has(f.name)) continue;
            const targetType = fieldTypes.get(f.name);
            // No slot on the target shape: the copy DROPS the field
            // (divergence 36's stance, same as the plain-record spread).
            if (!targetType) continue;
            if (conditionalNames.has(f.name)) {
              L.unsupported(
                "SC1090",
                prop,
                `spread of '${f.name}' over an earlier conditional spread (the desugar keeps one entry per name — restructure so each name has one contributor)`,
              );
            }
            const fRead = (): IrExpr => ({
              kind: "recordGet",
              obj: { kind: "unionNarrow", unionId: srcType.unionId, tag: recTag, value: srcRef(), type: recArm, loc: locOf(prop) },
              shapeId: recArm.shapeId,
              field: f.name,
              type: f.type,
              loc: locOf(prop),
            });
            let cond: IrExpr = { kind: "unionIsTag", unionId: srcType.unionId, tag: recTag, negated: false, value: srcRef(), type: BOOL, loc: locOf(prop) };
            let thenVal: IrExpr;
            if (typeEquals(f.type, targetType)) {
              thenVal = fRead();
            } else if (
              f.type.kind === "union" &&
              L.armTag(f.type.unionId, UNDEFINED_T) >= 0 &&
              typeEquals(L.stripUndefinedArm(f.type), targetType)
            ) {
              // Optional source field into a required target slot: present
              // means the source holds the record AND the field its value
              // arm — the spread-override completion, union-source form.
              const ftUndef = L.armTag(f.type.unionId, UNDEFINED_T);
              cond = {
                kind: "logical",
                op: "&&",
                left: cond,
                right: { kind: "unionIsTag", unionId: f.type.unionId, tag: ftUndef, negated: true, value: fRead(), type: BOOL, loc: locOf(prop) },
                type: BOOL,
                loc: locOf(prop),
              };
              const ftDef = L.unions.get(f.type.unionId);
              if (targetType.kind === "union") {
                const retag = L.unionRetagHelper(f.type.unionId, targetType.unionId, locOf(prop));
                if (!retag) {
                  L.pushDiag(recordShapeMismatchDiag(L.fmt(type), L.fmt(recArm), locOf(prop), `spread field '${f.name}': '${L.fmt(f.type)}' cannot re-tag into '${L.fmt(targetType)}' behind the present-test`));
                  throw new PoisonError();
                }
                thenVal = { kind: "call", callee: retag, args: [fRead()], type: targetType, loc: locOf(prop) };
              } else if (ftDef && ftDef.arms.length === 2 && L.armTag(f.type.unionId, targetType) >= 0) {
                thenVal = { kind: "unionNarrow", unionId: f.type.unionId, tag: L.armTag(f.type.unionId, targetType), value: fRead(), type: targetType, loc: locOf(prop) };
              } else {
                L.pushDiag(recordShapeMismatchDiag(L.fmt(type), L.fmt(recArm), locOf(prop), `spread field '${f.name}': '${L.fmt(f.type)}' cannot narrow into '${L.fmt(targetType)}' behind the present-test`));
                throw new PoisonError();
              }
            } else {
              // The width-lift fallback (arm wrap, re-tag, nested
              // reshape) — the same per-field rule the slot coercion
              // applies. Runs AFTER the optional-completion branch: a
              // present-test has its own semantics a re-tag's stranded
              // undefined trap must not shadow.
              const lift = L.widthLiftPlan(f.type, targetType);
              if (!lift) {
                L.pushDiag(recordShapeMismatchDiag(L.fmt(type), L.fmt(recArm), locOf(prop), `spread field '${f.name}': '${L.fmt(f.type)}' does not lift into '${L.fmt(targetType)}'`));
                throw new PoisonError();
              }
              thenVal = L.applyWidthLift(lift, fRead(), targetType, locOf(prop));
            }
            const at = fields.findIndex((x) => x.name === f.name && !x.drop);
            if (at >= 0 && overwriteObservable()) {
              if (process.env.SCRIPTC_SPREADORD_WHY) {
                console.error(`SPREADORD refuse-overwrite-union ${f.name} @${locOf(prop).start}`);
              }
              L.unsupported(
                "SC1090",
                prop,
                `spread of '${f.name}' over an earlier contributor whose evaluation is observable (the present-test would make it conditional — give '${f.name}' one contributor, or move the spread first)`,
              );
            }
            const elseVal = at >= 0 ? fields[at]!.value : L.wrappedUndefined(targetType, locOf(prop));
            if (!elseVal) {
              L.unsupported(
                "SC1090",
                prop,
                `object spread of '${L.fmt(srcType)}' sources where '${f.name}' has no earlier contributor (the absent arm leaves the required field unset — spread defaults first: { ...defaults, ...overrides })`,
              );
            }
            const merged: IrExpr = { kind: "ternary", cond, then: thenVal, else_: elseVal, type: targetType, loc: locOf(prop) };
            if (at >= 0) fields[at] = { name: f.name, value: merged };
            else fields.push({ name: f.name, value: merged });
          }
          continue;
        }
        if (srcType?.kind !== "record") {
          L.unsupported(
            "SC1090",
            prop,
            `object spread of '${srcType ? L.fmt(srcType) : L.checker.typeToString(L.typeOf(srcNode))}' sources (only known record shapes spread — ${NARROW_FIRST})`,
          );
        }
        if (srcLowered && !pureReemittable(srcLowered)) {
          L.unsupported(
            "SC1090",
            prop,
            "object spread of computed sources (the field copies re-read the source — bind it to a const first)",
          );
        }
        const srcShape = L.shapes.get(srcType.shapeId);
        if (!srcShape) throw new Error(`lowerer bug: spread of unknown shape ${srcType.shapeId}`);
        fenceAccessorSpreadSource(L, prop, srcShape);
        // Index-signature shapes carry runtime-keyed overflow entries the
        // field-by-field desugar cannot enumerate — fenced on either side.
        if (srcShape.indexValue || shape.indexValue) {
          L.unsupported(
            "SC1090",
            prop,
            "object spread involving index-signature shapes (overflow keys are runtime state — copy the fields you need explicitly)",
          );
        }
        // Names a LATER contributor unconditionally defines: copying such a
        // source field is dead under JS last-write-wins (and spread reads
        // are side-effect-free), so it neither lowers nor width-checks —
        // the spread-then-override completion `{ ...config, stateDir }`
        // narrows an optional source field into a required target slot
        // exactly like Node does. Conditional spreads don't count (their
        // empty arm defines nothing) — their own collision fences hold.
        const laterNames = new Set<string>();
        for (const later of expr.properties.slice(expr.properties.indexOf(prop) + 1)) {
          if (ts.isSpreadAssignment(later)) {
            if (conditionalSpreadOf(later.expression)) continue;
            const lt = L.mapTypeOf(L.typeOf(later.expression));
            if (lt?.kind === "record") {
              for (const lf of L.shapes.get(lt.shapeId)?.fields ?? []) laterNames.add(lf.name);
            }
            continue;
          }
          if (
            later.name &&
            (ts.isIdentifier(later.name) ||
              ts.isStringLiteral(later.name) ||
              ts.isNumericLiteral(later.name) ||
              (ts.isComputedPropertyName(later.name) && literalComputedKey(L, later.name) !== null))
          ) {
            laterNames.add(propNameText(L, later.name));
          }
        }
        for (const f of srcShape.fields) {
          if (laterNames.has(f.name)) continue;
          const targetType = fieldTypes.get(f.name);
          // A source field with NO slot on the target shape: the copy
          // DROPS it — a spread of a wider record into a narrower literal
          // is width subtyping in spread clothing, divergence 36's stance
          // (Node's object would keep the key); the read is pure, so
          // skipping evaluates nothing.
          if (!targetType) continue;
          const lift = typeEquals(f.type, targetType)
            ? null
            : L.widthLiftPlan(f.type, targetType);
          if (!typeEquals(f.type, targetType) && !lift) {
            // Print the SOURCE shape, not the literal's own type: the
            // checker's own type already has later overrides applied, so
            // it can render identically to the target while the spread
            // source (the thing that actually mismatches) differs — an
            // invisible difference is a diagnostics bug.
            L.pushDiag(recordShapeMismatchDiag(L.fmt(type), L.fmt(srcType), locOf(prop), `spread field '${f.name}': '${L.fmt(f.type)}' does not lift into '${L.fmt(targetType)}'`));
            throw new PoisonError();
          }
          const obj = srcLowered ?? L.lowerExpr(srcNode);
          // A record-mapped CHECKER type whose VALUE lives in the checked-dynamic tree (a
          // JS file-scope object-literal global): read each field from
          // the checked-dynamic tree (dynKeyGet) and VALIDATE it into the source shape's
          // field type (dynCheck) — the checked-dynamic member-read
          // discipline. A missing key answers the dyn undefined, exactly
          // the undefined-armed optional's absent case; a mismatched
          // runtime value throws the catchable TypeError, never a silent
          // wrong copy. Runtime-ADDED keys drop — width subtyping in
          // spread clothing, divergence 36's stance.
          let value: IrExpr;
          if (obj.type.kind === "dyn") {
            if (!canDynCheckTo(f.type, (id) => L.shapes.get(id), (id) => L.unions.get(id))) {
              L.unsupported(
                "SC1100",
                prop,
                `object spread of a checked-dynamic source whose field '${f.name}' ('${L.fmt(f.type)}') cannot validate out of the checked-dynamic tree (copy the fields explicitly)`,
              );
            }
            value = {
              kind: "dynCheck",
              value: {
                kind: "dynKeyGet",
                key: { kind: "strLit", value: f.name, type: STRING, loc: locOf(prop) },
                value: obj,
                type: DYN,
                loc: locOf(prop),
              },
              type: f.type,
              loc: locOf(prop),
            };
          } else {
            value = {
              kind: "recordGet",
              obj,
              shapeId: srcType.shapeId,
              field: f.name,
              type: f.type,
              loc: locOf(prop),
            };
          }
          // A liftable field widens into the target slot (arm wrap,
          // re-tag, nested reshape) — the same per-field rule the slot
          // coercion applies.
          if (lift) value = L.applyWidthLift(lift, value, targetType, locOf(prop));
          if (conditionalNames.has(f.name)) {
            L.unsupported(
              "SC1090",
              prop,
              `spread of '${f.name}' over an earlier conditional spread (the desugar keeps one entry per name — restructure so each name has one contributor)`,
            );
          }
          const at = fields.findIndex((x) => x.name === f.name);
          if (at >= 0 && overwriteObservable()) {
            if (process.env.SCRIPTC_SPREADORD_WHY) {
              console.error(`SPREADORD refuse-overwrite ${f.name} @${locOf(prop).start}`);
            }
            L.unsupported(
              "SC1090",
              prop,
              `spread of '${f.name}' over an earlier contributor whose evaluation is observable (the desugar keeps one entry per name — give '${f.name}' one contributor, or move the spread first)`,
            );
          }
          if (at >= 0) fields[at] = { name: f.name, value };
          else fields.push({ name: f.name, value });
        }
        continue;
      }
      if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
        // JS accessor entries carry no storage (narrowed away above); TS
        // accessors fill the shape's reserved closure slots — the getter
        // body lowers as an ordinary zero-arg closure invoked per property
        // READ, the setter as a one-arg closure invoked per WRITE
        // (fieldGetExpr/fieldSetStmt dispatch on the slots). Creating the
        // closures is side-effect-free, so their position among the data
        // fields' source-order evaluation is unobservable — exactly JS,
        // where accessor definitions evaluate nothing.
        if (isJsSourceFile(expr.getSourceFile())) continue;
        const name = propNameText(L, prop.name); // key-form-checked above
        const slotName = `${ts.isGetAccessorDeclaration(prop) ? "%get" : "%set"}:${name}`;
        const slotT = fieldTypes.get(slotName);
        if (!slotT || slotT.kind !== "func") {
          // The contextual shape stores a DATA value under this name
          // (`const p: { x: number } = { get x() {...} }` — tsc lets a
          // live accessor satisfy a data member): the slot would freeze
          // one getter answer where Node keeps the accessor live.
          const ft = fieldTypes.get(name);
          if (ft !== undefined) {
            // A getter whose body is a single `return <pure reference>` --
            // the store-bundle idiom `get retry() { return caches.retry }`,
            // where every step is a plain read -- satisfies the data property
            // by MATERIALIZING that reference here. The read is effect-free
            // and yields a stable heap reference: the object it names mutates
            // identically whether reached through the live accessor or the
            // materialized copy, so freezing the REFERENCE into the data slot
            // is unobservable. A computed or effectful getter body keeps the
            // fence (it would freeze a value Node recomputes).
            // The base binding must be one that can never be REASSIGNED.
            // Materializing freezes the reference the getter names, which
            // is unobservable while that reference keeps pointing at the
            // same object -- mutation reaches it either way. It stops
            // being unobservable the moment the BINDING is repointed: a
            // `let store = build()` reassigned by a reset leaves the
            // materialized field on the old object, which the live getter
            // would have stopped returning. That is a silent wrong read,
            // and on a torn-down resource a use-after-free.
            const stableBase = (e: ts.Identifier): boolean => {
              const sym = L.resolveValueSymbol(e);
              const decl = sym ? L.checker.valueDeclarationOf(sym) : undefined;
              return sym !== null && decl !== undefined && bindingNeverReassigned(L, sym, decl);
            };
            const pureRef = (e: ts.Expression): boolean =>
              ts.isIdentifier(e)
                ? stableBase(e)
                : e.kind === ts.SyntaxKind.ThisKeyword
                ? true
                : ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)
                  ? pureRef(e.expression)
                  : false;
            const only =
              ts.isGetAccessorDeclaration(prop) && prop.body?.statements.length === 1
                ? prop.body.statements[0]
                : undefined;
            if (only && ts.isReturnStatement(only) && only.expression && pureRef(only.expression)) {
              const value = L.coerceInto(only.expression, L.lowerExpr(only.expression), ft);
              const at2 = fields.findIndex((x) => x.name === name);
              if (at2 >= 0) fields[at2] = { name, value, expl: true };
              else fields.push({ name, value, expl: true });
              continue;
            }
            L.unsupported(
              "SC1090",
              prop,
              `a get/set accessor satisfying the data property '${name}' of '${L.fmt(type)}' (the record slot stores a plain value — Node would keep the accessor live through this type)`,
            );
          }
          throw shapeMismatch(prop);
        }
        const closure = L.coerceInto(prop, L.lowerLambda(prop), slotT);
        if (!typeEquals(closure.type, slotT)) L.badType(prop, L.typeOf(prop));
        fields.push({ name: slotName, value: closure, expl: true });
        continue;
      }
      const name = propNameText(L, prop.name!); // key-form-checked above
      const fieldType = fieldTypes.get(name);
      // An undeclared name against an index-signature shape is an OVERFLOW
      // entry (tsc typechecked it against the signature's value type);
      // against a plain shape it is the width mismatch it always was —
      // EXCEPT the PromiseSettledResult honest subset's dropped fields
      // (value/reason — SEMANTICS.md 46): those evaluate for effect in
      // their source-order slot and store nothing.
      // A GENERIC-callable member (a generic method `m<T>(x: T) {...}` or a
      // generic arrow/function-expression property): excluded from the
      // record shape (isGenericCallableMemberType — no single closure slot
      // can hold it), so the literal stores nothing for it. Pure
      // function-creating forms skip outright (creating a closure has no
      // side effects; calls resolve statically against this declaration);
      // a computed initializer would need its evaluation kept — fenced.
      if (!fieldType && !ts.isSpreadAssignment(prop)) {
        const memberSym = prop.name && L.checker.getSymbolAtLocation(prop.name);
        const memberT = memberSym ? L.checker.getTypeOfSymbol(memberSym) : undefined;
        if (memberT && isGenericCallableMemberType(memberT, L.checker)) {
          const pureInit = (() => {
            if (ts.isMethodDeclaration(prop)) return true;
            if (ts.isShorthandPropertyAssignment(prop)) return true; // a pure read
            if (!ts.isPropertyAssignment(prop)) return false;
            let init: ts.Expression = prop.initializer;
            while (ts.isParenthesizedExpression(init)) init = init.expression;
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isIdentifier(init)) return true;
            // `<this|id>.method.bind(<this|id>)` — the emitter idiom
            // `this.emit.bind(this)` binding a generic method. Binding a
            // METHOD (never an accessor, whose read would be the side effect
            // the drop must not skip) over pure references creates a closure
            // with no side effects, exactly like the arrow form above, so
            // dropping the unslotted field's evaluation stays unobservable.
            if (ts.isCallExpression(init) && init.arguments.length === 1) {
              const callee = init.expression;
              if (
                ts.isPropertyAccessExpression(callee) &&
                callee.name.text === "bind" &&
                ts.isPropertyAccessExpression(callee.expression)
              ) {
                const methodAccess = callee.expression;
                const pureRef = (x: ts.Expression): boolean =>
                  x.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(x);
                if (pureRef(methodAccess.expression) && pureRef(init.arguments[0]!)) {
                  const sym = L.checker.getSymbolAtLocation(methodAccess.name);
                  const decls = sym ? L.checker.declarationsOf(sym) : [];
                  if (
                    decls.length > 0 &&
                    !decls.some((d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d))
                  ) {
                    return true;
                  }
                }
              }
            }
            return false;
          })();
          if (!pureInit) {
            L.unsupported(
              "SC1090",
              prop,
              `generic-function-valued properties with computed initializers ('${name}' has no record slot — its evaluation would be dropped; bind the function to a top-level declaration instead)`,
            );
          }
          continue;
        }
      }
      if (!fieldType && !shape.indexValue) throw shapeMismatch(prop);

      let value: IrExpr;
      let valueNode: ts.Node = prop;
      const propDiagsBefore = L.diags.length;
      try {
      if (ts.isPropertyAssignment(prop)) {
        valueNode = prop.initializer;
        // ARRAY-LITERAL initializers route through the expected-type
        // lowering: a union field with one array-family arm builds the
        // literal AS that arm (lowerExprExpecting's IR-directed rule —
        // the option-table `default: [{ value: [] }]` shape), where the
        // bare lowering would take the JS dyn fallback and fence.
        let init: ts.Expression = prop.initializer;
        while (ts.isParenthesizedExpression(init)) init = init.expression;
        value =
          fenceClosureProbe(L, prop.initializer, fieldType, () => L.lowerExpr(prop.initializer)) ??
          (fieldType !== undefined && ts.isArrayLiteralExpression(init)
            ? L.lowerExprExpecting(prop.initializer, fieldType)
            : L.lowerExpr(prop.initializer));
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        value = L.lowerShorthandValue(prop);
      } else if (ts.isMethodDeclaration(prop)) {
        value =
          fenceClosureProbe(L, prop, fieldType, () => L.lowerLambda(prop)) ?? L.lowerLambda(prop);
      } else {
        L.unsupported("SC1090", prop, `syntax '${ts.SyntaxKind[(prop as ts.Node).kind]}'`);
      }
      } catch (err) {
        // A member VALUE a JS file cannot lower (a namespace object in an
        // export aggregate — the sharedWithCli `errors` member): the
        // member NARROWS AWAY like a CJS export-table accessor entry —
        // the diagnostics defer to the runtime-fence ledger, the shape
        // drops the field, and each READ of it meets its own per-site
        // fence. Pure member forms only (identifier/shorthand reads);
        // TypeScript, probe mode, and ICEs keep the poison.
        const pureMember =
          ts.isShorthandPropertyAssignment(prop) ||
          (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer));
        if (
          !(err instanceof PoisonError) ||
          !pureMember ||
          !isJsSourceFile(expr.getSourceFile()) ||
          L.diagSink !== null ||
          L.diags.length <= propDiagsBefore ||
          L.diags.slice(propDiagsBefore).some((d) => d.code === "SC9001")
        ) {
          throw err;
        }
        L.runtimeFences.push(...L.diags.splice(propDiagsBefore));
        droppedNames.add(name);
        continue;
      }
      if (!fieldType) {
        // Overflow entry: the value flows into the index signature's value
        // slot — dyn slots take a dyn conversion (dynFrom), typed slots the
        // ordinary coercion path. Later duplicates override (map semantics
        // are last-write-wins already; a duplicate literal key is a tsc
        // error anyway).
        const slotted = L.intoIndexValueSlot(value, shape.indexValue!, valueNode);
        fields.push({ name, value: slotted, overflow: true, expl: true });
        continue;
      }
      // `participantJid: event.rawNode.attrs.participant` into a
      // `participantJid?: string` slot (zapo mailbox.ts:100). The checker
      // types an index-signature read by the signature's VALUE type, so
      // the read is spelled `string` and its miss had nowhere to go — an
      // ABORT, on every ordinary incoming 1:1 message, past the caller's
      // own try/catch. The FIELD can say undefined and keeps saying it:
      // tsc does not narrow an optional property from the literal that
      // initialised it (measured — repro-pt/lab/narrowq2.ts (4)), so the
      // readers were compiled against `string | undefined` and every one
      // of them discriminates. That is the difference from the
      // declaration/assignment/property-write destinations, which tsc
      // DOES narrow and which recordKeyReadAtUndefinedArm is therefore
      // never offered.
      value = L.recordKeyReadAtUndefinedArm(value, fieldType) ?? value;
      value = L.coerceInto(valueNode, value, fieldType); // union-typed fields wrap arm values
      if (!typeEquals(value.type, fieldType)) L.badType(valueNode, L.typeOf(valueNode));
      // An explicit property overrides a spread-copied field: JS
      // last-write-wins. The entry moves to the END so explicit property
      // values keep their source-order evaluation among themselves. A
      // conditional-spread entry cannot be overridden (its ternary IS the
      // spread's evaluation; splicing it out would drop that).
      if (conditionalNames.has(name)) {
        L.unsupported(
          "SC1090",
          prop,
          `'${name}' after a conditional spread of the same name (the desugar keeps one entry per name — restructure so each name has one contributor)`,
        );
      }
      const at = fields.findIndex((x) => x.name === name);
      if (at >= 0) fields.splice(at, 1);
      fields.push({ name, value, expl: true });
    }
    // Optional fields (undefined-armed union slots) may be omitted: the
    // absent field holds the interned undefined arm, exactly like writing
    // `a: undefined` (without exactOptionalPropertyTypes tsc treats the two
    // the same, and only optional fields may be omitted — tsc rejects
    // omission of required fields before lowering, undefined-armed or not).
    // A REQUIRED missing field keeps the shape-mismatch rejection (possible
    // through `as`: the cast smuggles a narrower literal past freshness).
    if (droppedNames.size > 0) {
      const narrowed = shape.fields.filter((f) => !droppedNames.has(f.name));
      const narrowedId = L.shapes.intern(
        narrowed.map((f) => ({ name: f.name, type: f.type })),
        false,
        shape.indexValue,
      );
      type = { kind: "record", shapeId: narrowedId };
      shape = L.shapes.get(narrowedId)!;
    }
    if (fields.filter((f) => !f.overflow).length !== shape.fields.length) {
      const provided = new Set(fields.filter((f) => !f.overflow).map((f) => f.name));
      for (const f of shape.fields) {
        if (provided.has(f.name)) continue;
        // 'unknown' fields complete with the dyn undefined — the absent
        // property reads as undefined in Node, and a dyn slot holds
        // exactly that (the options-record call shape against
        // `{ plugins: unknown, ... }` — a JS caller the checker admits).
        const absent = L.wrappedUndefined(f.type, loc) ?? (f.type.kind === "dyn" ? dynUndefinedExpr(loc) : null);
        if (!absent) throw shapeMismatch(expr); // only optional (undefined-armed) and 'unknown' fields may be omitted
        fields.push({ name: f.name, value: absent });
      }
    }
    const lit: IrExpr = { kind: "recordLit", fields, type, loc };
    return prelude.length === 0 ? lit : { kind: "seqExpr", stmts: prelude, result: lit, type, loc };
  }

/** A conditional spread's carrier property: `name: value` or shorthand,
   * with an identifier/string-literal name. */
  export type CondSpreadProp = (ts.PropertyAssignment | ts.ShorthandPropertyAssignment) & { name: ts.Identifier | ts.StringLiteral };

/** Parses the conditional-spread idiom `...(c ? { k: v, ... } : {})`
   * (either orientation). Returns the condition, the non-empty arm's
   * properties, and which arm carries them; "unsupported" for conditional
   * sources OUTSIDE the idiom (both arms non-empty, computed/method
   * members); null when the spread source isn't a conditional at all.
   * Callers slice their own honest subset (the static record path takes
   * exactly one property; the island literal takes any number; spawn's
   * options walk takes a `detached` boolean literal). */
  export function conditionalSpreadOf(expr: ts.Expression):
    | { cond: ts.Expression; props: CondSpreadProp[]; whenTrue: boolean }
    | "unsupported"
    | null {
    let e: ts.Expression = expr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isConditionalExpression(e)) return null;
    const unwrap = (a: ts.Expression): ts.Expression => {
      let x = a;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return x;
    };
    const whenTrue = unwrap(e.whenTrue);
    const whenFalse = unwrap(e.whenFalse);
    if (!ts.isObjectLiteralExpression(whenTrue) || !ts.isObjectLiteralExpression(whenFalse)) {
      return "unsupported";
    }
    const trueCarries = whenFalse.properties.length === 0 && whenTrue.properties.length > 0;
    const falseCarries = whenTrue.properties.length === 0 && whenFalse.properties.length > 0;
    if (!trueCarries && !falseCarries) return "unsupported"; // both empty is tsc-unreachable; both non-empty has no single desugar
    const carrier = trueCarries ? whenTrue : whenFalse;
    const props: CondSpreadProp[] = [];
    for (const p of carrier.properties) {
      if (
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      ) {
        props.push(p as CondSpreadProp);
      } else {
        return "unsupported";
      }
    }
    return { cond: e.condition, props, whenTrue: trueCarries };
  }

/** `{ ...idx, ...idx2 }` typed a DECLARED shape (no index signature) — the
   * defaults-merge idiom over runtime-keyed sources (`{ ...fromEntries(a),
   * ...fromEntries(b) }` typed AppConfig). Lowers to ONE interned helper
   * call: sources evaluate once each as arguments (source order — computed
   * sources included, JS's evaluate-once), the result starts all-undefined
   * (every target field must be optional — the runtime keys decide
   * presence), and each source's keys apply in JS own-key order with a
   * per-key dispatch onto the declared fields: a matching key writes the
   * field — identity when the source's value slot IS the field type, a
   * validated extraction otherwise (a dyn slot dynChecks; a union slot
   * re-tags arm-by-arm, and a value outside the field's arms throws the
   * catchable TypeError — divergence 34's keyed-write stance, where Node's
   * untyped copy would store the lie) — and a key naming NO declared field
   * is DROPPED (the shape cannot represent it; Node keeps it invisibly —
   * divergence 68). Later contributors overwrite earlier ones
   * (last-write-wins). Sources must be PURE index-signature records. */
  function lowerDeclaredSpreadMerge(L: Lowerer, expr: ts.ObjectLiteralExpression,
    type: IrType & { kind: "record" },
    shape: IrRecordShape,
    loc: SrcLoc,
    namedOf: (p: ts.ObjectLiteralElementLike) => string | null,): IrExpr {
    /** Contributors in LITERAL order — the helper's parameter order, which
     * is also the call's argument-evaluation order, so a computed spread
     * source and an explicit property value evaluate exactly where they
     * are written. */
    type Contrib =
      | { kind: "spread"; value: IrExpr; shapeId: string; iv: IrType }
      | { kind: "fixed"; value: IrExpr; shapeId: string; copies: { from: string; to: string; type: IrType; lift: WidthLift | null }[] }
      | { kind: "field"; name: string; value: IrExpr; fieldType: IrType };
    const fieldTypes = new Map(shape.fields.map((f) => [f.name, f.type] as const));
    const contribs: Contrib[] = [];
    for (const prop of expr.properties) {
      if (!ts.isSpreadAssignment(prop)) {
        // caller-checked: a literal name that the target DECLARES
        const name = namedOf(prop)!;
        const fieldType = shape.fields.find((f) => f.name === name)!.type;
        const valueNode: ts.Node = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
        let value = ts.isPropertyAssignment(prop)
          ? L.lowerExpr(prop.initializer)
          : L.lowerShorthandValue(prop as ts.ShorthandPropertyAssignment);
        value = L.coerceInto(valueNode, value, fieldType);
        if (!typeEquals(value.type, fieldType)) L.badType(valueNode, L.typeOf(valueNode));
        contribs.push({ kind: "field", name, value, fieldType });
        continue;
      }
      const spread = prop;
      const value = L.lowerExpr(spread.expression);
      const srcShape = value.type.kind === "record" ? L.shapes.get(value.type.shapeId) : undefined;
      if (value.type.kind !== "record" || !srcShape || srcShape.tuple) {
        L.unsupported(
          "SC1090",
          prop,
          `object spread of '${L.fmt(value.type)}' into '${L.fmt(type)}' (only PURE index-signature records — Object.fromEntries results, Record<string, T> values — spread into a declared shape)`,
        );
      }
      // A FIXED-shape source alongside a runtime-keyed one — the media
      // builder's `{ ...spread(content), ...uploadedFields, width: w }`,
      // where `uploadedFields` is an ordinary object literal. It copies
      // per DECLARED field at its literal position, exactly as the
      // historic field-by-field desugar does when no runtime-keyed source
      // is in the literal: a name the target does not declare DROPS
      // (divergence 36's width stance), and a name it does declare width-
      // lifts into the slot or keeps the fence.
      if (!srcShape.indexValue) {
        if (srcShape.fields.some((f) => f.name.startsWith("%"))) {
          L.unsupported(
            "SC1090",
            prop,
            `object spread of '${L.fmt(value.type)}' into '${L.fmt(type)}' (only PURE index-signature records — Object.fromEntries results, Record<string, T> values — spread into a declared shape)`,
          );
        }
        fenceAccessorSpreadSource(L, prop, srcShape);
        const copies: { from: string; to: string; type: IrType; lift: WidthLift | null }[] = [];
        for (const ff of srcShape.fields) {
          const targetType = fieldTypes.get(ff.name);
          if (!targetType) continue; // no slot: the copy drops
          const lift = typeEquals(ff.type, targetType) ? null : L.widthLiftPlan(ff.type, targetType);
          if (!typeEquals(ff.type, targetType) && !lift) {
            L.pushDiag(
              recordShapeMismatchDiag(
                L.fmt(type),
                L.fmt(value.type),
                locOf(prop),
                `spread field '${ff.name}': '${L.fmt(ff.type)}' does not lift into '${L.fmt(targetType)}'`,
              ),
            );
            throw new PoisonError();
          }
          copies.push({ from: ff.name, to: ff.name, type: ff.type, lift });
        }
        contribs.push({ kind: "fixed", value, shapeId: value.type.shapeId, copies });
        continue;
      }
      if (srcShape.fields.length > 0) {
        L.unsupported(
          "SC1090",
          prop,
          `object spread of '${L.fmt(value.type)}' into '${L.fmt(type)}' (only PURE index-signature records — Object.fromEntries results, Record<string, T> values — spread into a declared shape)`,
        );
      }
      contribs.push({ kind: "spread", value, shapeId: value.type.shapeId, iv: srcShape.indexValue });
    }
    // A target field is either OPTIONAL — absent keys leave the undefined
    // arm, exactly the unset-optional representation — or written
    // UNCONDITIONALLY by a named property or a fixed-shape source's copy.
    // Only a required field left to the runtime keys has no answer.
    // `unconditional` doubles as the seed table: the record literal that
    // starts the helper needs a value for every declared slot, and a
    // required one takes the first unconditional writer's.
    const unconditional = new Map<string, number>();
    contribs.forEach((c, ci) => {
      if (c.kind === "field") {
        if (!unconditional.has(c.name)) unconditional.set(c.name, ci);
      } else if (c.kind === "fixed") {
        for (const cp of c.copies) if (!unconditional.has(cp.to)) unconditional.set(cp.to, ci);
      }
    });
    for (const f of shape.fields) {
      if (f.type.kind === "union" && L.armTag(f.type.unionId, UNDEFINED_T) >= 0) continue;
      if (unconditional.has(f.name)) continue;
      L.unsupported(
        "SC1090",
        expr,
        `object spread of runtime-keyed sources onto the required field '${f.name}' (the keys decide presence at runtime — declare the field optional or spell it explicitly)`,
      );
    }
    /** Per contributor: the names a STRICTLY LATER contributor writes
     * unconditionally. A runtime key naming one of them is dead under
     * JS's last-write-wins, so the earlier source's dispatch drops it —
     * the historic field-by-field desugar's `laterNames` rule, which this
     * path replaces and therefore has to carry. */
    const laterUnconditional: Set<string>[] = new Array<Set<string>>(contribs.length);
    {
      const acc = new Set<string>();
      for (let i = contribs.length - 1; i >= 0; i--) {
        laterUnconditional[i] = new Set(acc);
        const c = contribs[i]!;
        if (c.kind === "field") acc.add(c.name);
        else if (c.kind === "fixed") for (const cp of c.copies) acc.add(cp.to);
      }
    }
    // Per (source value slot → field) conversion, checked up front so the
    // fence fires at the literal, not inside the interned helper.
    const conv = (iv: IrType, f: { name: string; type: IrType }, v: IrExpr): { value: IrExpr } | { stmts: (write: (value: IrExpr) => IrStmt) => IrStmt[] } => {
      if (typeEquals(iv, f.type)) return { value: v };
      if (iv.kind === "dyn") {
        return { value: { kind: "dynCheck", value: v, type: f.type, loc } };
      }
      if (iv.kind === "union" && f.type.kind === "union") {
        const fUnion = f.type;
        const def = L.unions.get(iv.unionId);
        const fDef = L.unions.get(fUnion.unionId);
        if (def && fDef && def.arms.some((a) => L.armTag(fUnion.unionId, a) >= 0)) {
          // Arm-by-arm validated re-tag, inline in the helper: matching
          // arms map by identity (unit arms re-wrap, value arms narrow and
          // wrap); anything else throws the catchable TypeError.
          return {
            stmts: (write) => {
              const chain = (i: number): IrStmt[] => {
                if (i >= def.arms.length) {
                  return [{
                    kind: "throw",
                    value: {
                      kind: "libCall",
                      fn: "error.new",
                      args: [{ kind: "strLit", value: `expected ${L.fmt(fUnion)} at $.${f.name}`, type: STRING, loc }],
                      type: { kind: "object", className: "%TypeError" },
                      loc,
                    },
                    loc,
                  }];
                }
                const arm = def.arms[i]!;
                const toTag = L.armTag(fUnion.unionId, arm);
                if (toTag < 0) return chain(i + 1);
                const extracted: IrExpr = isUnitType(arm)
                  ? { kind: "unionWrap", unionId: fUnion.unionId, tag: toTag, value: { kind: "unitLit", unit: arm.kind === "undefinedT" ? "undefined" : "null", type: arm, loc }, type: fUnion, loc }
                  : { kind: "unionWrap", unionId: fUnion.unionId, tag: toTag, value: { kind: "unionNarrow", unionId: iv.unionId, tag: i, value: v, type: arm, loc }, type: fUnion, loc };
                return [{
                  kind: "if",
                  cond: { kind: "unionIsTag", unionId: iv.unionId, tag: i, negated: false, value: v, type: BOOL, loc },
                  then: [write(extracted)],
                  else_: chain(i + 1),
                  loc,
                }];
              };
              return chain(0);
            },
          };
        }
      }
      // A union value slot into a NON-union field (`Record<string, boolean
      // | null | string>` keys landing on a `string` slot): the field type
      // is one arm of the slot, so the write is that arm's TAG TEST with
      // the extraction under it — the same shape the arm-by-arm re-tag
      // above builds, one arm wide. Every other arm throws the catchable
      // TypeError rather than storing a lie (divergence 34), exactly as
      // the re-tag's fall-through does.
      if (iv.kind === "union" && !isUnitType(f.type) && f.type.kind !== "dyn") {
        const tag = L.unions.get(iv.unionId) ? L.armTag(iv.unionId, f.type) : -1;
        if (tag >= 0) {
          return {
            stmts: (write) => [{
              kind: "if",
              cond: { kind: "unionIsTag", unionId: iv.unionId, tag, negated: false, value: v, type: BOOL, loc },
              then: [write({ kind: "unionNarrow", unionId: iv.unionId, tag, value: v, type: f.type, loc })],
              else_: [{
                kind: "throw",
                value: {
                  kind: "libCall",
                  fn: "error.new",
                  args: [{ kind: "strLit", value: `expected ${L.fmt(f.type)} at $.${f.name}`, type: STRING, loc }],
                  type: { kind: "object", className: "%TypeError" },
                  loc,
                },
                loc,
              }],
              loc,
            }],
          };
        }
      }
      L.unsupported(
        "SC1090",
        expr,
        `object spread into '${L.fmt(type)}' where the source's '${L.fmt(iv)}' values cannot reach the '${L.fmt(f.type)}' field '${f.name}' (the value slot must be the field type, 'unknown', or a union covering the field's arms)`,
      );
    };
    // The interning key carries the contributor SEQUENCE, not just the
    // source shapes: `{ ...a, x: 1 }` and `{ x: 1, ...a }` are different
    // programs (last-write-wins), and two literals share a helper only
    // when their contributors line up kind-for-kind and name-for-name.
    const key =
      `declmerge:${type.shapeId}:` +
      contribs
        .map((c) => (c.kind === "field" ? `f${c.name}` : `${c.kind === "spread" ? "s" : "x"}${c.shapeId}`))
        .join(",");
    let helper = L.widthHelpers.get(key);
    if (!helper) {
      helper = `%rec.declmerge.${L.widthHelpers.size}`;
      const ref = (localId: string, t: IrType): IrExpr => ({ kind: "varRef", localId, type: t, loc });
      const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
      const outRef = ref("out.0", type);
      const ksT = arrayOf(STRING);
      const locals: IrLocal[] = [{ id: "out.0", name: "out", type, mutable: false }];
      // One parameter per contributor, in literal order. An all-spread
      // literal keeps the historic `s<n>` names, so the C an existing
      // program emits is unchanged to the byte.
      const pnameOf = (ci: number): string =>
        contribs[ci]!.kind === "field" ? `v${ci}` : `s${ci}`;
      const pidOf = (ci: number): string => `${pnameOf(ci)}.0`;
      const params = contribs.map((c, ci) => {
        const t = c.kind === "field" ? c.fieldType : c.value.type;
        locals.push({ id: pidOf(ci), name: pnameOf(ci), type: t, mutable: true });
        return { localId: pidOf(ci), name: pnameOf(ci), type: t };
      });
      // A REQUIRED field is seeded from its first UNCONDITIONAL writer's
      // parameter (the optionality pass above proved one exists); that
      // writer still writes at its own position, so a later spread key can
      // still overwrite it exactly as JS does.
      const seed = (f: { name: string; type: IrType }): IrExpr => {
        const und = L.wrappedUndefined(f.type, loc);
        if (und) return und;
        const ci = unconditional.get(f.name)!;
        const c = contribs[ci]!;
        if (c.kind === "field") return ref(pidOf(ci), f.type);
        if (c.kind !== "fixed") throw new Error("lowerer bug: seed from a runtime-keyed contributor");
        const cp = c.copies.find((x) => x.to === f.name)!;
        const raw: IrExpr = { kind: "recordGet", obj: ref(pidOf(ci), c.value.type), shapeId: c.shapeId, field: cp.from, type: cp.type, loc };
        return cp.lift ? L.applyWidthLift(cp.lift, raw, f.type, loc) : raw;
      };
      const body: IrStmt[] = [
        {
          kind: "varDecl",
          localId: "out.0",
          init: {
            kind: "recordLit",
            fields: shape.fields.map((f) => ({ name: f.name, value: seed(f) })),
            type,
            loc,
          },
          loc,
        },
      ];
      contribs.forEach((c, ci) => {
        if (c.kind === "field") {
          body.push({
            kind: "recordSet",
            obj: outRef,
            shapeId: type.shapeId,
            field: c.name,
            value: ref(pidOf(ci), c.fieldType),
            loc,
          });
          return;
        }
        if (c.kind === "fixed") {
          // Declared-field copies, in the source shape's own field order —
          // the same order and the same width lifts the historic
          // field-by-field desugar applies.
          const fRef = ref(pidOf(ci), c.value.type);
          for (const cp of c.copies) {
            const raw: IrExpr = { kind: "recordGet", obj: fRef, shapeId: c.shapeId, field: cp.from, type: cp.type, loc };
            body.push({
              kind: "recordSet",
              obj: outRef,
              shapeId: type.shapeId,
              field: cp.to,
              value: cp.lift ? L.applyWidthLift(cp.lift, raw, fieldTypes.get(cp.to)!, loc) : raw,
              loc,
            });
          }
          return;
        }
        const s = c;
        const j = ci;
        const sRef = ref(pidOf(ci), s.value.type);
        const kRef = ref(`k${j}.0`, STRING);
        const vRef = ref(`v${j}.0`, s.iv);
        locals.push(
          { id: `ks${j}.0`, name: `ks${j}`, type: ksT, mutable: false },
          { id: `i${j}.0`, name: `i${j}`, type: F64, mutable: true },
          { id: `k${j}.0`, name: `k${j}`, type: STRING, mutable: false },
          { id: `v${j}.0`, name: `v${j}`, type: s.iv, mutable: false },
        );
        // Per-key dispatch: if (k === "a") { write a } else if ... else drop.
        // A field a LATER contributor writes unconditionally is DEAD here
        // — JS's last-write-wins overwrites it, and a spread's read is
        // pure, so the branch drops exactly as a key the target does not
        // declare does. This is the historic desugar's `laterNames` rule,
        // and it is the difference between compiling `{ …, ...indexArgs,
        // ...base }` and fencing on a `base` field whose type no runtime
        // key of `indexArgs` could ever have reached.
        const dispatch = shape.fields.filter((f) => !laterUnconditional[ci]!.has(f.name)).reduceRight<IrStmt[]>((rest, f) => {
          const write = (value: IrExpr): IrStmt => ({ kind: "recordSet", obj: outRef, shapeId: type.shapeId, field: f.name, value, loc });
          const cv = conv(s.iv, f, vRef);
          const thenBody = "value" in cv ? [write(cv.value)] : cv.stmts(write);
          return [{
            kind: "if",
            cond: { kind: "strEq", negated: false, left: kRef, right: { kind: "strLit", value: f.name, type: STRING, loc }, type: BOOL, loc },
            then: thenBody,
            else_: rest.length > 0 ? rest : null,
            loc,
          }];
        }, []);
        body.push(
          { kind: "varDecl", localId: `ks${j}.0`, init: { kind: "recordOvfKeys", obj: sRef, shapeId: s.shapeId, type: ksT, loc }, loc },
          {
            kind: "for",
            init: { kind: "varDecl", localId: `i${j}.0`, init: num(0), loc },
            cond: { kind: "bin", op: "<", left: ref(`i${j}.0`, F64), right: { kind: "arrIntrinsic", method: "length", receiver: ref(`ks${j}.0`, ksT), args: [], type: F64, loc }, type: BOOL, loc },
            update: { kind: "assign", localId: `i${j}.0`, value: { kind: "bin", op: "+", left: ref(`i${j}.0`, F64), right: num(1), type: F64, loc }, loc },
            body: [
              { kind: "varDecl", localId: `k${j}.0`, init: { kind: "arrayGet", arr: ref(`ks${j}.0`, ksT), index: ref(`i${j}.0`, F64), type: STRING, loc }, loc },
              { kind: "varDecl", localId: `v${j}.0`, init: { kind: "recordKeyGet", obj: sRef, shapeId: s.shapeId, key: kRef, overflowOnly: true, type: s.iv, loc }, loc },
              ...dispatch,
            ],
            loc,
          },
        );
      });
      body.push({ kind: "return", value: outRef, loc });
      L.liftedFns.push({
        name: helper,
        params,
        returnType: type,
        locals,
        body,
        loc,
      });
      // Registered only after a fence-free build: a conv() fence mid-build
      // must not leave a phantom helper behind for the next literal.
      L.widthHelpers.set(key, helper);
    }
    return {
      kind: "call",
      callee: helper,
      args: contribs.map((c) => c.value),
      type,
      loc,
    };
  }

/** The value of a shorthand property (`{ x }`): the binding `x` refers to.
   * The property name's own symbol is the PROPERTY, so resolution goes
   * through getShorthandAssignmentValueSymbol. */
  export function lowerShorthandValue(L: Lowerer, prop: ts.ShorthandPropertyAssignment): IrExpr {
    // 7 types the shorthand's name as PropertyName; it is always an
    // Identifier (the grammar allows nothing else in shorthand position).
    const propName = prop.name as ts.Identifier;
    const loc = locOf(propName);
    const symbol = L.checker.getShorthandAssignmentValueSymbol(prop);
    if (symbol) {
      if (L.ctx.selfSymbol === symbol) {
        return { kind: "selfRef", type: L.ctx.selfType!, loc };
      }
      const local = L.resolveKey(symbol, propName);
      if (local) {
        // A CATCH BINDING reads through caughtRead here exactly as it does
        // through the identifier path: the exception snapshot is not a
        // value any slot can take raw, so every read of one narrows
        // (caughtNarrow), converts (caughtToDyn), or fences. Resolving the
        // local and handing the raw `caught` on made `{ error }` and
        // `{ error: error }` — the same binding into the same slot —
        // compile to different answers, the shorthand fencing where the
        // longhand converted.
        if (local.type.kind === "caught") return L.caughtRead(propName, local, loc);
        return L.maybeNarrow({ kind: "varRef", localId: local.id, type: local.type, loc }, propName);
      }
      const resolved = symbol.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(symbol) : symbol;
      L.flushDeferred(resolved);
      const g = L.globalsBySymbol.get(resolved);
      if (g) {
        return L.maybeNarrow({ kind: "varRef", localId: g.id, type: g.type, loc }, propName);
      }
      const sig = L.fnSigsBySymbol.get(resolved);
      const decl = L.checker.declarationsOf(resolved)[0];
      if (
        sig && decl && ts.isFunctionDeclaration(decl) &&
        (ts.isSourceFile(decl.parent) || L.nsBlocks.get(decl.parent) === "flattened")
      ) {
        L.noteEdge(sig.name);
        const funcType: IrType = {
          kind: "func",
          params: sig.params.filter((p) => p.mode !== "dynRest").map((p) => p.type),
          ret: sig.returnType,
          ...(sig.params.some((p) => p.mode === "dynRest") ? { rest: true as const } : {}),
        };
        L.requireExactArityValue(prop, propName, sig.params, funcType);
        return { kind: "closure", fnName: sig.name, captures: [], type: funcType, loc };
      }
      if (L.genericFnsBySymbol.has(resolved)) {
        L.unsupported(
          "SC1090",
          prop,
          `generic functions as values (call '${propName.text}' directly)`,
        );
      }
    }
    L.rejectUnresolvedSymbol(
      symbol ? (symbol.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(symbol) : symbol) : null,
      propName.text,
      prop,
      `the reference to '${propName.text}' (a binding form with no lowering)`,
    );
  }

/** A node whose body gets its OWN `this`, so a `this` inside it is not the
 * enclosing object-literal method's. Arrows are deliberately absent: they
 * inherit, which is why the walk keeps descending into them. */
function resetsThis(n: ts.Node): boolean {
  const k = n.kind;
  return (
    k === ts.SyntaxKind.FunctionDeclaration ||
    k === ts.SyntaxKind.FunctionExpression ||
    k === ts.SyntaxKind.ClassDeclaration ||
    k === ts.SyntaxKind.ClassExpression ||
    k === ts.SyntaxKind.MethodDeclaration ||
    k === ts.SyntaxKind.GetAccessor ||
    k === ts.SyntaxKind.SetAccessor ||
    k === ts.SyntaxKind.Constructor ||
    k === ts.SyntaxKind.ClassStaticBlockDeclaration
  );
}

/** Rejects any `this` inside an object-literal method body — including in
   * nested arrows, which inherit the method's `this`.
   *
   * A nested function declaration/expression, class, method or accessor
   * does NOT inherit it: its `this` is its own, and the compiler already
   * has a lowering for that one (lowerExpr's ThisKeyword arm — `dyn.this`,
   * the ambient receiver, in a JS source file; SC1080 in TypeScript). The
   * walk used to descend into them anyway, on the stated ground that
   * "their bare `this` is already a tsc error under noImplicitThis" — true
   * of TypeScript and FALSE of the provenance JS this rule exists for,
   * where checkJs defers the diagnostic and the fence takes the whole
   * enclosing body with it. Measured on zapo's shipped
   * `spec/proto/index.js`: nine of the nineteen esbuild `__commonJS`
   * module-table bodies refuse here, ZERO of the nine has a `this` that is
   * lexically the method's (every one is inside protobufjs's own
   * `function Writer() { this.len = 0 }`), and those nine are 27 519 of
   * the 34 111 bytes of protobufjs the bundle carries.
   *
   * The stop is taken only when NO frame on the lowering stack carries a
   * `this` local (L.peekThis()). Where one does, the old whole-body walk
   * stands: resolveThis() would reach past the function boundary and
   * answer with the ENCLOSING binding — a class method's receiver, or the
   * stream the shim bound for `new Readable({ read() {...} })` — and a
   * wrong receiver is worse than a fence.
   *
   * Half of a rule: a `this` let through here is only correct because a
   * method call on a dyn receiver binds that receiver (lower-calls'
   * dynInvoke fallback). Loosening this walk without that one turns a
   * located refusal into a silent wrong value. */
  export function rejectThisInObjectMethod(L: Lowerer, node: ts.Node): void {
    rejectThisInObjectMethodIn(L, node, L.peekThis() === null);
  }

function rejectThisInObjectMethodIn(L: Lowerer, node: ts.Node, mayStop: boolean): void {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      L.unsupported("SC1090", node, "references to 'this' in object literal methods");
    }
    ts.forEachChild(node, (child) => {
      if (mayStop && resetsThis(child)) {
        if (process.env["SCRIPTC_THISWALK_WHY"] !== undefined) {
          const sf = child.getSourceFile();
          const p = ts.getLineAndCharacterOfPosition(sf, child.getStart(sf));
          process.stderr.write(`[thiswalk] stop ${ts.SyntaxKind[child.kind]} ${sf.fileName}:${p.line + 1}\n`);
        }
        return;
      }
      rejectThisInObjectMethodIn(L, child, mayStop);
    });
  }

/** The accessor twin of rejectThisInObjectMethod: a get/set accessor body
   * referencing `this` (`get x() { return this._x }`). The accessor lowers
   * as a closure stored IN the record — passing the record as a receiver
   * would capture the value under construction (an RC cycle), and the
   * generic lexical-this walk would silently bind an ENCLOSING method's
   * `this`; the fence names the fix (capture a binding instead). */
  export function rejectThisInObjectAccessor(L: Lowerer, node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      L.unsupported(
        "SC1090",
        node,
        "references to 'this' in object literal get/set accessors (the accessor lowers as a captured closure with no receiver — read a captured binding instead)",
      );
    }
    ts.forEachChild(node, (child) => rejectThisInObjectAccessor(L, child));
  }

/** `a[i]` reads. Only f64 indices into array receivers are modeled; JS
   * string-key element access (`a["length"]`) and string indexing (`s[0]`
   * typechecks against the lib's index signature; use .charAt) stay out. */
  export function lowerElementAccess(L: Lowerer, expr: ts.ElementAccessExpression): IrExpr {
    // `a?.[i]`: the guard lowers as an optional-chain step around the
    // plain element read below.
    if (expr.questionDotToken && !L.chainHandled.has(expr)) {
      return L.lowerOptionalChain(expr);
    }
    // `a?.b[i]` — the tail of a chain whose token sits deeper: the whole
    // tail short-circuits with the guard.
    if (!expr.questionDotToken && chainTailClaimed(L, expr)) {
      return L.lowerOptionalChain(expr);
    }
    // Enum accesses in element clothing — `E["A"]` forward reads and
    // `E[0]` reverse-mapping reads — fold to constants (lower-enums.ts),
    // claimed before any receiver-kind dispatch can see the enum object.
    {
      const en = lowerEnumAccess(L, expr);
      if (en) return en;
    }
    // `globalThis[<expr>]` — the dynamic global probe (the harness's
    // conditional-globals sweep): a compiled binary's globals are
    // compile-time bindings, not runtime properties, and none of the
    // probed web-platform objects exist here — the honest answer is
    // undefined for every dynamic name (SEMANTICS.md documents the
    // divergence: statically-known globals are not reachable this way;
    // the PROPERTY spelling answers the identity token instead — see
    // lowerPropertyAccess's globalThis rule).
    if (!expr.questionDotToken && stdlibGlobalNameOf(L, expr.expression) === "globalThis") {
      return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: locOf(expr) };
    }
    // `req.headers["x-name"]` — the computed twin of `req.headers.host`
    // (the server spoke owns both; the envGet precedent).
    {
      const header = L.lowerHttpHeadersElement(expr);
      if (header) return L.maybeNarrow(header, expr);
    }
    // `process.env[expr]` — the computed twin of `process.env.NAME`; both
    // lower to the ONE process.envGet intrinsic. The read narrows like any
    // union-typed expression when the checker narrowed this occurrence.
    if (L.isProcessEnv(expr.expression)) {
      const key = L.lowerExpr(expr.argumentExpression);
      if (key.type.kind !== "string") {
        L.unsupported(
          "SC1090",
          expr.argumentExpression,
          "indexing process.env with non-string keys",
        );
      }
      const get: IrExpr = {
        kind: "libCall",
        fn: "process.envGet",
        args: [key],
        type: L.envValueType(),
        loc: locOf(expr),
      };
      return L.maybeNarrow(get, expr);
    }
    // Expando function members in element clothing (`foo[strMem]`,
    // `foo[_private]` where foo is a module-level function/callable const
    // and the key folds or is a unique-symbol const): the member's module
    // global — the dotted read's twin (lower-expando.ts).
    {
      const ex = expandoMemberRead(L, expr);
      if (ex) return L.maybeNarrow(ex, expr);
    }
    // Symbol-keyed property READS (`this[kLimit]`): when the key is a
    // statically-resolvable unique-symbol const declared as a field of the
    // receiver's class (uniqueSymbolKeyOf — the countdown.js idiom), the
    // read IS an ordinary field read of the hidden slot. Every other
    // symbol key stays fenced: record shapes, runtime-identity keys
    // (symbol parameters, Symbol.for consts), and keys no class declares
    // — the layouts are compile-time field lists.
    if (L.mapTypeOf(L.typeOf(expr.argumentExpression))?.kind === "symbol") {
      const target = symbolFieldTarget(L, expr);
      if (target) return L.maybeNarrow(L.fieldGetExpr(target, locOf(expr), expr), expr);
      L.unsupported(
        "SC1090",
        expr,
        "symbol-keyed property access outside class fields keyed by a module-level `const k = Symbol('desc')` (static shapes have no symbol-keyed storage)",
      );
    }
    // A never-tainted JS receiver type (neverTaintedJsType — `cmd[1]` on
    // `const cmd = ['pwd', []]`, whose binding lowered checked-dynamic)
    // dispatches as unmapped so the dyn-receiver branch below reads
    // through the checked-dynamic tree instead of dynChecking into never's f64 residue.
    const receiverIr = neverTaintedJsType(L, expr.expression, L.typeOf(expr.expression))
      ? null
      : L.mapTypeOf(L.typeOf(expr.expression));
    if (receiverIr?.kind === "jsval") {
      // Dispatch follows the RUNTIME world (383(d)): a checker-'any'
      // receiver whose value LOWERED checked-dynamic (`bag.list[0]` where
      // bag.list is a routed keyed read off a wrapped island value) takes
      // the dyn keyed read below — the routed JSVAL arm reads the real
      // engine element; a jsval-lowered receiver keeps the island read.
      const recv = L.lowerExpr(expr.expression);
      if (recv.type.kind !== "dyn") return islandElementRead(L, expr, recv);
      const rawKey = L.lowerExpr(expr.argumentExpression);
      const key: IrExpr | null =
        rawKey.type.kind === "string"
          ? rawKey
          : rawKey.type.kind === "f64"
            ? { kind: "toString", operand: rawKey, type: STRING, loc: rawKey.loc }
            : null;
      if (key) {
        const opt = chainGuardedByQuestionDot(expr.expression);
        return L.maybeNarrow(
          { kind: "dynKeyGet", key, ...(opt ? { optional: true as const } : {}), value: recv, type: DYN, loc: locOf(expr) },
          expr,
        );
      }
    }
    // Typed-array element read `b[i]` — like arrayGet with a scalar
    // result; any invalid index traps (the array discipline; JS would
    // read undefined — divergence 4's policy).
    if (receiverIr?.kind === "bytes") {
      const recv = L.lowerExpr(expr.expression);
      // A typed-array .d.ts surface whose VALUE is an island handle
      // (`data()[0]` on a declared Uint8Array return — call results only
      // exit primitives eagerly): the engine element read, exiting at the
      // declared number type.
      if (recv.type.kind === "jsval") return islandElementRead(L, expr, recv);
      const index = checkedJsNumber(L, expr.argumentExpression, L.lowerExpr(expr.argumentExpression));
      if (index === null) {
        L.unsupported("SC1090", expr.argumentExpression, "indexing with non-number keys");
      }
      return { kind: "bytesIntrinsic", method: "get", receiver: recv, args: [index], type: F64, loc: locOf(expr) };
    }
    // Tuple element read `t[0]`: a positional-field read of the tuple's
    // record shape — LITERAL indices only (the checker's per-index types
    // are what make the read honest; a dynamic index over a heterogeneous
    // shape has no single element type). Narrows like any field read.
    if (receiverIr?.kind === "record") {
      const shape = L.shapes.get(receiverIr.shapeId);
      if (shape?.tuple) {
        const obj = L.lowerExpr(expr.expression);
        // A tuple-typed .d.ts surface whose VALUE is an island handle
        // (`pair()[0]` on a declared `[number, string]` return — the
        // anonymous tuple type has no npm symbol, so the checker maps it
        // structurally while the call result stays an engine array): the
        // read rides engine ops, exiting at the declared per-index type
        // like the array path.
        if (obj.type.kind === "jsval") return islandElementRead(L, expr, obj);
        // A tuple-typed receiver whose VALUE is a static ARRAY: the
        // uniform-tuple bindings the promise combinators produce (their
        // lowering builds a real array, and with one shared element type
        // the two describe the same value). Dispatch follows the value —
        // the jsval rule above, one world over — so the read rides the
        // ordinary array path instead of asking a record for a field the
        // value has no slot for.
        if (obj.type.kind === "array") {
          const index = L.lowerExpr(expr.argumentExpression);
          if (index.type.kind === "f64") {
            return L.maybeNarrow(
              { kind: "arrayGet", arr: obj, index, type: obj.type.elem, loc: locOf(expr) },
              expr,
            );
          }
        }
        const idx = tupleLiteralIndex(expr.argumentExpression);
        if (idx === null) {
          L.unsupported(
            "SC1090",
            expr.argumentExpression,
            "tuple indexing with a non-literal index (tuples are fixed-shape — use t[0], t[1], ...)",
          );
        }
        const fieldType = shape.fields.find((f) => f.name === String(idx))?.type;
        if (fieldType === undefined) L.badType(expr, L.typeOf(expr)); // OOB smuggled past tsc
        const get: IrExpr = {
          kind: "recordGet",
          obj,
          shapeId: receiverIr.shapeId,
          field: String(idx),
          type: fieldType,
          loc: locOf(expr),
        };
        return L.maybeNarrow(get, expr);
      }
      if (shape && !shape.tuple) {
        // A record-typed .d.ts surface whose VALUE is an island handle
        // (`headers()["x-id"]` on a declared `Record<string, string>`
        // return — the stdlib alias maps structurally while the call
        // result stays an engine object): the read rides engine ops with
        // the declared-value exit, never a recordKeyGet over a jsval.
        const obj = L.lowerExpr(expr.expression);
        if (obj.type.kind === "jsval") return islandElementRead(L, expr, obj);
        return L.lowerRecordKeyRead(expr, receiverIr.shapeId, shape);
      }
    }
    // `pkg["k"]` / `scripts[name]` / `scopeMatch[1]` on a dyn receiver (a
    // JSON.parse result): the dyn keyed read, exactly the dot form.
    // NUMBER-typed indices convert through ToString first — JS property
    // keys are strings, and the canonical number text answers array
    // indices in the helper (fractions, negatives, and NaN read as
    // absent keys, exactly JS). An UNMAPPABLE checker type takes the
    // same path when the receiver LOWERS dyn
    // (`pkg.workspaces.packages["0"]` — the lowering world types the
    // unknown-rooted chain `any`); a non-dyn lowering falls through to
    // the fences below (re-lowering is pure IR construction).
    if (receiverIr?.kind === "dyn" || receiverIr === null) {
      const obj = L.lowerExpr(expr.expression);
      if (obj.type.kind === "dyn") {
        const rawKey = L.lowerExpr(expr.argumentExpression);
        // Number, bool, and DYN keys stringify (ToPropertyKey) — the
        // dyn-keyed read `catchWarning[warning.name]` where the property
        // chain itself lowered dyn.
        const key: IrExpr | null =
          rawKey.type.kind === "string"
            ? rawKey
            : rawKey.type.kind === "f64" || rawKey.type.kind === "bool" || rawKey.type.kind === "dyn"
              ? { kind: "toString", operand: rawKey, type: STRING, loc: rawKey.loc }
              : null;
        if (key) {
          const opt = chainGuardedByQuestionDot(expr.expression);
          return L.maybeNarrow(
            { kind: "dynKeyGet", key, ...(opt ? { optional: true as const } : {}), value: obj, type: DYN, loc: locOf(expr) },
            expr,
          );
        }
      }
      // A checker-`any` receiver that LOWERS to a static ARRAY
      // (`pm.split("@")[0]` — the dyn-receiver string machinery answers
      // string[]): the element read rides the ordinary array path on the
      // lowered value (invalid indices trap, divergence 4's policy).
      if (obj.type.kind === "array") {
        const index = L.lowerExpr(expr.argumentExpression);
        if (index.type.kind === "f64") {
          return L.maybeNarrow(
            { kind: "arrayGet", arr: obj, index, type: obj.type.elem, loc: locOf(expr) },
            expr,
          );
        }
      }
    }
    // `env[key]` on a UNION of record shapes (`ProcessEnv | Record<string,
    // string>` — the env-bag parameter pattern): the per-arm keyed read,
    // joined exactly like the dot form (lowerUnionProperty's keyed path).
    if (receiverIr?.kind === "union") {
      const value = L.lowerExpr(expr.expression);
      if (value.type.kind === "union") {
        const key = L.lowerExpr(expr.argumentExpression);
        if (key.type.kind === "string") {
          const lit = ts.isStringLiteral(expr.argumentExpression)
            ? expr.argumentExpression.text
            : null;
          const keyed = lowerUnionKeyedRead(L, expr, value.type.unionId, value, key, lit);
          if (keyed) return L.maybeNarrow(keyed, expr);
        }
        // `u?.split(":")[0]` — a NUMBER index over an undefined-armed
        // array union: the array arm answers its element (invalid indices
        // trap — divergence 4's policy), unit arms answer undefined (the
        // chain's short-circuit value). Every non-unit arm must be the
        // same array type.
        if (key.type.kind === "f64") {
          const def = L.unions.get(value.type.unionId);
          const arrArms = def?.arms.filter((a) => a.kind === "array") ?? [];
          if (
            def &&
            arrArms.length > 0 &&
            def.arms.every((a) => a.kind === "array" || isUnitType(a)) &&
            arrArms.every((a) => typeEquals(a, arrArms[0]!))
          ) {
            const elem = (arrArms[0] as IrType & { kind: "array" }).elem;
            const hasUnit = def.arms.some(isUnitType);
            const t = !hasUnit
              ? elem
              : elem.kind === "union"
                ? L.withUndefinedArmOf(elem)
                : L.withUndefinedArm(elem);
            if (t) {
              return L.maybeNarrow(
                { kind: "unionKeyGet", unionId: value.type.unionId, key, value, type: t, loc: locOf(expr) },
                expr,
              );
            }
          }
        }
      }
    }
    if (receiverIr?.kind !== "array") {
      if (receiverIr?.kind === "string") {
        // `s[i]` with a number index reads a UTF-16 code unit — charAt's
        // exact job (the UTF-16-exact runtime). Without
        // noUncheckedIndexedAccess the checker types the read `string`,
        // and charAt's "" is the only string-typed answer for an
        // out-of-range or fractional index where JS reads `undefined` —
        // SEMANTICS.md documents the divergence; in-range integer reads
        // (the loop pattern) are JS-exact. Under noUncheckedIndexedAccess
        // the read types `string | undefined`, which charAt cannot honor —
        // fenced.
        const index = L.lowerExpr(expr.argumentExpression);
        if (index.type.kind === "f64" && L.mapTypeOf(L.typeOf(expr))?.kind === "string") {
          const recv = L.lowerExpr(expr.expression);
          return { kind: "strIntrinsic", method: "charAt", receiver: recv, args: [index], type: STRING, loc: locOf(expr) };
        }
        L.unsupported(
          "SC1090",
          expr,
          "string indexing with this index/result shape (a number index typed 'string' lowers to charAt; " +
            "use .charAt(i) under noUncheckedIndexedAccess)",
        );
      }
      L.unsupported("SC1090", expr, "element access on non-array values");
    }
    let arr = L.lowerExpr(expr.expression);
    // The checker sees an array but the VALUE is an island handle (an
    // array-typed .d.ts surface: `parts()[0]` on a declared `string[]`
    // return, `issue.path[0]` on a declared member — arrays never exit
    // eagerly, so the call/member read stays jsval): the read rides
    // engine ops with the declared-element exit, never a static arrayGet
    // over a jsval (the validator ICE).
    if (arr.type.kind === "jsval") return islandElementRead(L, expr, arr);
    // The checker sees an array but the VALUE lowered checked-dynamic (a
    // jsdoc-typed default export from a .js module — signature 14): the
    // read rides the dynCheck boundary when the array shape is one the checked-dynamic tree
    // can validate, and fences by name when it is not — an arrayGet over a
    // dyn receiver is never emitted (the validator ICE).
    if (arr.type.kind === "dyn") {
      if (isJsonSafeType(receiverIr, (id) => L.shapes.get(id), (id) => L.unions.get(id))) {
        arr = { kind: "dynCheck", value: arr, type: receiverIr, loc: locOf(expr) };
      } else {
        L.unsupported(
          "SC1090",
          expr,
          `element access on checked-dynamic values with '${L.fmt(receiverIr)}' elements`,
        );
      }
    }
    const index = checkedJsNumber(L, expr.argumentExpression, L.lowerExpr(expr.argumentExpression));
    if (index === null) {
      L.unsupported("SC1090", expr.argumentExpression, "indexing with non-number keys");
    }
    // The LOWERED receiver's element type wins over the checker's when
    // both are arrays: a spoke result can be more precise than the
    // declared surface (emitter.listeners() answers the event's tuple
    // signature where the .d.ts says Function[], which would flatten the
    // element to a zero-parameter closure).
    const elemT = arr.type.kind === "array" ? arr.type.elem : receiverIr.elem;
    // --npm-static package files: the OOB-SAFE read (elem | undefined)
    // for the LAST-ELEMENT idiom — indexing a fresh slice() result
    // (commander's `registeredArguments.slice(-1)[0]` probe), where the
    // trap divergence would fire on working Node code and the fresh
    // array's read can only be a probe. General indexed reads keep the
    // documented trap (their results feed writes and member reads whose
    // lowerings need the plain element).
    if (
      arr.type.kind === "array" &&
      arr.kind === "arrIntrinsic" &&
      arr.method === "slice" &&
      npmStaticPackageOfPath(expr.getSourceFile().fileName) !== null
    ) {
      const safe = lowerNpmStaticSafeIndexRead(L, arr as IrExpr & { type: { kind: "array" } }, index, locOf(expr));
      if (safe) return safe;
    }
    // A union-element read narrows like an identifier when the checker has
    // narrowed THIS occurrence (`if (a[0] !== undefined) use(a[0])` — tsc
    // narrows literal-index element accesses).
    return L.maybeNarrow(
      { kind: "arrayGet", arr, index, type: elemT, loc: locOf(expr) },
      expr,
    );
  }

/** `o[k]` where the RECEIVER is an island value — a jsval-mapped checker
   * type, or an array/tuple-typed .d.ts surface whose lowered value is a
   * handle. The key marshals in (any JS key kind — the engine does its
   * own ToPropertyKey) and the result stays island, EXCEPT when the
   * checker declares the element a primitive (`parts()[0]` on a declared
   * `string[]`): those exit eagerly to the static type, exactly the
   * island property-read rule (trust-but-verify — a lying declaration
   * throws the catchable TypeError; tsc puts the `| undefined` of a
   * short-circuiting chain on the OUTERMOST expression, so chain tails
   * never map primitive here). Chain-handled reads (`v?.[0]`) stay jsval
   * — the chain's unit path is the engine's undefined. */
  function islandElementRead(L: Lowerer, expr: ts.ElementAccessExpression, obj: IrExpr): IrExpr {
    const loc = locOf(expr);
    const key = L.jsvalIn(L.lowerExpr(expr.argumentExpression), expr.argumentExpression);
    const read: IrExpr = { kind: "jsOp", op: "getIdx", args: [obj, key], type: JSVAL, loc };
    if (!expr.questionDotToken) {
      const declared = L.mapTypeOf(L.typeOf(expr));
      if (
        declared &&
        (declared.kind === "f64" || declared.kind === "bool" || declared.kind === "string" ||
          (declared.kind === "bytes" && declared.elem === "u8"))
      ) {
        return { kind: "jsExit", value: read, type: declared, loc };
      }
    }
    return read;
  }

/** `r[k]` over a (non-tuple) record shape. A LITERAL key naming a declared
   * field is the bracket spelling of field access (the ONLY spelling tsc
   * permits for signature-declared fields under
   * noPropertyAccessFromIndexSignature) — an ordinary recordGet. Everything
   * else is a runtime-keyed read (recordKeyGet): declared fields answer
   * first via an emitted string-switch, index-signature shapes fall through
   * to the overflow map. The result type is the CHECKER's for the access —
   * the index signature's value type (dyn for `unknown`), or its
   * undefined-armed union under noUncheckedIndexedAccess. Every declared
   * field must be able to SURFACE as that type (equal, an arm of it, or —
   * for dyn results — JSON-safe for the dyn conversion); shapes mixing in
   * fields outside that stay fenced. Declared-only shapes support reads
   * whose key type proves membership (tsc's keyof check): all fields must
   * share the result type, and a smuggled miss traps. */
  /** `r[k]` where k's checker type is a UNION of string literals, each
   * naming a declared field of a signature-free shape whose field types
   * DIFFER (the provider-registry shape — `backend[kind]` with kind typed
   * 'stores' | 'caches'): the access's checker type is the union of the
   * named fields' types, and the read lowers to an interned equality-
   * dispatch helper `(record, key) -> union` — one string test per named
   * field, each arm the plain field read wrapped into its union arm, and
   * a trailing throw for a key smuggled past the proof (the stranded
   * stance). Null when the shape doesn't hold: a non-literal-union key, a
   * name with no declared field, or a field type the result union has no
   * arm for. */
  function literalUnionKeyDispatch(
    L: Lowerer,
    expr: ts.ElementAccessExpression,
    obj: IrExpr,
    shapeId: string,
    shape: IrRecordShape,
    key: IrExpr,
    keyNode: ts.Expression,
    loc: SrcLoc,
  ): IrExpr | null {
    if (shape.indexValue !== undefined || shape.tuple) return null;
    const keyT = L.typeOf(keyNode);
    const parts = keyT.isUnionType() ? keyT.getTypes() : [keyT];
    if (parts.length < 2) return null;
    const names: string[] = [];
    for (const p of parts) {
      if (!p.isStringLiteralType()) return null;
      if (!names.includes(p.value)) names.push(p.value);
    }
    if (names.length < 2) return null;
    const fields = names.map((n) => shape.fields.find((f) => f.name === n));
    if (fields.some((f) => f === undefined)) return null;
    const resultT = L.mapTypeOf(L.typeOf(expr));
    if (resultT === null || resultT.kind !== "union") return null;
    const tags = fields.map((f) => L.armTag(resultT.unionId, f!.type));
    if (tags.some((t) => t < 0)) return null;
    const helperKey = `keydisp:${shapeId}:${resultT.unionId}:${names.join(",")}`;
    let name = L.retagHelpers.get(helperKey);
    if (!name) {
      name = `%rec.keydisp.${L.retagHelpers.size}`;
      L.retagHelpers.set(helperKey, name);
      const objT: IrType = { kind: "record", shapeId };
      const oRef: IrExpr = { kind: "varRef", localId: "o.0", type: objT, loc };
      const kRef: IrExpr = { kind: "varRef", localId: "k.0", type: STRING, loc };
      const body: IrStmt[] = names.map((n, i) => ({
        kind: "if",
        cond: {
          kind: "strEq",
          negated: false,
          left: kRef,
          right: { kind: "strLit", value: n, type: STRING, loc },
          type: BOOL,
          loc,
        },
        then: [
          {
            kind: "return",
            value: {
              kind: "unionWrap",
              unionId: resultT.unionId,
              tag: tags[i]!,
              value: { kind: "recordGet", obj: oRef, shapeId, field: n, type: fields[i]!.type, loc },
              type: resultT,
              loc,
            },
            loc,
          },
        ],
        else_: null,
        loc,
      }));
      body.push({
        kind: "throw",
        value: {
          kind: "libCall",
          fn: "error.new",
          args: [
            {
              kind: "strLit",
              value: `a keyed read proven to '${names.join("' | '")}' received a different key (a value narrowed or asserted past the key's type still held it)`,
              type: STRING,
              loc,
            },
          ],
          type: { kind: "object", className: "%TypeError" },
          loc,
        },
        loc,
      });
      L.liftedFns.push({
        name,
        params: [
          { localId: "o.0", name: "o", type: objT },
          { localId: "k.0", name: "k", type: STRING },
        ],
        returnType: resultT,
        locals: [
          { id: "o.0", name: "o", type: objT, mutable: false },
          { id: "k.0", name: "k", type: STRING, mutable: false },
        ],
        body,
        loc,
      });
    }
    return { kind: "call", callee: name, args: [obj, key], type: resultT, loc };
  }

  export function lowerRecordKeyRead(L: Lowerer, expr: ts.ElementAccessExpression, shapeId: string, shape: IrRecordShape,): IrExpr {
    const loc = locOf(expr);
    const keyNode = expr.argumentExpression;
    // Literal declared keys are plain field reads (narrowing included).
    // NUMERIC literals are their canonical string spelling — JS object keys
    // ARE strings (`r[1]` reads `r["1"]`), so `b[1]` hits a declared field
    // named "1" (a mapped type over a numeric enum) exactly like `b["1"]`.
    // A key IDENTIFIER whose type proves one literal (a literal-typed
    // const, a keyof-constrained type parameter bound to a literal inside
    // a generic instance) is the same static read — identifier evaluation
    // is pure, so skipping it matches JS exactly.
    const litKey = recordKeyLiteralText(keyNode) ?? recordKeyTypeLiteralText(L, keyNode);
    // The receiver lowers FIRST (both branches below read it, and JS
    // evaluates the receiver before the key).
    const obj = L.lowerExpr(expr.expression);
    // A record-mapped CHECKER type over a VALUE living in the checked-dynamic tree (a JS
    // file-scope object-literal global): the checked-dynamic keyed read —
    // dynKeyGet against the runtime keys (a missing key answers the checked-dynamic tree
    // undefined, exactly JS); consumers validate (dynCheck) where a
    // static type is required, the member-read discipline.
    if (obj.type.kind === "dyn") {
      let dk =
        litKey !== null
          ? ({ kind: "strLit", value: litKey, type: STRING, loc: locOf(keyNode) } satisfies IrExpr)
          : L.lowerExpr(keyNode);
      // Number AND checked-dynamic keys ride the JS-exact formatter —
      // property keys ARE strings (o[k] is o[String(k)] in JS), and a dyn
      // key (agent.sockets[agent.getName(...)]) stringifies the same way.
      if (dk.type.kind === "f64" || dk.type.kind === "dyn") dk = L.ensureString(dk, keyNode);
      if (dk.type.kind !== "string") {
        L.unsupported("SC1090", keyNode, "indexing records with non-string or non-number keys");
      }
      return L.maybeNarrow({ kind: "dynKeyGet", key: dk, value: obj, type: DYN, loc }, expr);
    }
    // The receiver's CHECKER shape and the shape its VALUE lowered disagree:
    // an assertion retyped the value without reshaping it. Two idioms reach
    // here — `union as unknown as T` (`backend[kind]` with two differently-
    // shaped fields, the value a union of arms) and `x as Record<string,
    // unknown>` (a concrete record read for arbitrary runtime keys, the
    // `Object.keys(o)` iteration). Neither has one static record shape to
    // key off. When the value can cross into the checked-dynamic tree, read
    // the key there (a missing key answers undefined, exactly JS — and the
    // `unknown` value type is what the cast promised); otherwise fence (a JS
    // source or --best-effort defers to a runtime trap, so a path that never
    // runs still compiles). A value that already IS this shape falls through
    // to the ordinary reads below.
    if (obj.type.kind !== "record" || obj.type.shapeId !== shapeId) {
      if (L.dynConvertible(obj.type)) {
        let dk =
          litKey !== null
            ? ({ kind: "strLit", value: litKey, type: STRING, loc: locOf(keyNode) } satisfies IrExpr)
            : L.lowerExpr(keyNode);
        if (dk.type.kind === "f64" || dk.type.kind === "dyn") dk = L.ensureString(dk, keyNode);
        if (dk.type.kind !== "string") {
          L.unsupported("SC1090", keyNode, "indexing records with non-string or non-number keys");
        }
        return L.maybeNarrow(
          { kind: "dynKeyGet", key: dk, value: { kind: "dynFrom", value: obj, type: DYN, loc }, type: DYN, loc },
          expr,
        );
      }
      L.unsupported(
        "SC1090",
        expr,
        "computed keyed reads through a receiver whose value shape differs from its asserted type (a '… as T' cast retypes but does not reshape the value — index a single concrete record, or read the field on each arm)",
      );
    }
    if (litKey !== null) {
      const field = shape.fields.find((f) => f.name === litKey);
      if (field) {
        const get: IrExpr = {
          kind: "recordGet",
          obj,
          shapeId,
          field: field.name,
          type: field.type,
          loc,
        };
        return L.maybeNarrow(get, expr);
      }
    }
    let key =
      litKey !== null
        ? ({ kind: "strLit", value: litKey, type: STRING, loc: locOf(keyNode) } satisfies IrExpr)
        : L.lowerExpr(keyNode);
    // Runtime NUMBER keys ride the JS-exact formatter (o[n] is o[String(n)]
    // in JS — the number-keyed-signature access path).
    if (key.type.kind === "f64") key = L.ensureString(key, keyNode);
    if (key.type.kind !== "string") {
      L.unsupported("SC1090", keyNode, "indexing records with non-string or non-number keys");
    }
    // The DECLARED result type of the access — the index signature's value
    // type (armed with undefined under noUncheckedIndexedAccess), or the
    // declared fields' one common type on signature-free shapes (tsc's
    // keyof check proved membership; a smuggled miss traps). The checker
    // may have NARROWED this occurrence (assignment CFA on literal keys) —
    // maybeNarrow bridges to the narrowed arm exactly like a field read.
    let declared: IrType | null = null;
    if (shape.indexValue) {
      declared = shape.indexValue;
      if (L.program.getCompilerOptions().noUncheckedIndexedAccess) {
        declared = L.withUndefinedArmOf(declared);
        if (!declared) L.badType(expr, L.typeOf(expr));
      }
    } else if (
      shape.fields.length > 0 &&
      shape.fields.every((f) => typeEquals(f.type, shape.fields[0]!.type))
    ) {
      declared = shape.fields[0]!.type;
    }
    if (!declared) {
      // A key whose CHECKER type is a union of string LITERALS, each
      // naming a declared field (`backend[kind]` with kind typed
      // 'stores' | 'caches' — the provider-registry shape): tsc's keyof
      // check proved membership and typed the ACCESS as the union of
      // exactly those fields' types. The read lowers as an equality
      // DISPATCH through an interned helper — one string test per named
      // field, each arm the plain field read wrapped into its union arm;
      // a smuggled miss (a lying assertion holding some other string)
      // throws the proven-impossible TypeError, the stranded stance.
      const dispatched = literalUnionKeyDispatch(L, expr, obj, shapeId, shape, key, keyNode, loc);
      if (dispatched !== null) return L.maybeNarrow(dispatched, expr);
      L.unsupported(
        "SC1090",
        expr,
        `dynamic keyed reads of '${L.fmt({ kind: "record", shapeId })}' (the declared fields have no one common type)`,
      );
    }
    // A LITERAL key naming no declared field can only hit the overflow:
    // the declared-field surfacing constraint doesn't apply.
    const overflowOnly = litKey !== null && !!shape.indexValue;
    if (!recordKeyResultOk(L, overflowOnly ? { ...shape, fields: [] } : shape, declared)) {
      L.unsupported(
        "SC1090",
        expr,
        `dynamic keyed reads of '${L.fmt({ kind: "record", shapeId })}' as '${L.fmt(declared)}' (every declared field must be readable at that type)`,
      );
    }
    return L.maybeNarrow(
      { kind: "recordKeyGet", obj, shapeId, key, ...(overflowOnly ? { overflowOnly: true as const } : {}), type: declared, loc },
      expr,
    );
  }

  /** The compile-time string spelling of a record key literal: a string
   * literal's text, or a NON-NEGATIVE numeric literal's canonical JS
   * spelling (`1` → "1", `1e21` → "1e+21" — String(Number(text)), which is
   * exactly the key JS derives; negative/computed keys stay runtime
   * expressions and canonicalize through ensureString instead). Null for
   * everything else. */
  export function recordKeyLiteralText(node: ts.Expression): string | null {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return String(Number(node.text));
    return null;
  }

  /** The compile-time key an IDENTIFIER's TYPE proves: a key variable whose
   * (narrowed) type is one string/number literal — `const k: "a" = …; o[k]`,
   * and the generic-body form where k's type is a keyof-constrained
   * parameter bound to a literal (`pick(o, "a")`'s instance reads `o[k]`
   * with K = "a", resolved through typeParamTsBindings). Identifier reads
   * are pure, so the static field read may skip evaluating the key exactly
   * like a syntactic literal. Null anywhere the type keeps more than one
   * key. */
  export function recordKeyTypeLiteralText(L: Lowerer, node: ts.Expression): string | null {
    if (!ts.isIdentifier(node)) return null;
    let t: ts.Type = L.typeOf(node);
    if (t.flags & ts.TypeFlags.TypeParameter) {
      const bound = L.typeParamTsResolver(t);
      if (!bound) return null;
      t = bound;
    }
    if (t.isStringLiteralType()) return t.value;
    if (t.isNumberLiteralType()) {
      const n = t.value;
      return Number.isFinite(n) && n >= 0 ? String(n) : null;
    }
    return null;
  }

  /** Can every value a dynamic key can reach (declared fields + the
   * overflow) surface as the read's result type? dyn results need
   * dyn-convertible fields (JSON-safe, with the undefined arm allowed at
   * the top — an optional field's undefined becomes the undefined dyn
   * value, exactly what the missing-key path produces); typed results need
   * each field to be the type itself or one of its arms, and the overflow
   * value to be the type or wrappable into it. */
  export function recordKeyResultOk(L: Lowerer, shape: IrRecordShape, type: IrType): boolean {
    const surfaces = (t: IrType): boolean =>
      typeEquals(t, type) ||
      (type.kind === "union" && L.armTag(type.unionId, t) >= 0) ||
      (type.kind === "dyn" && L.dynConvertible(t));
    if (!shape.fields.every((f) => surfaces(f.type))) return false;
    if (shape.indexValue) {
      // A dyn RESULT over a non-dyn overflow: the hit converts through the
      // same toDyn walker a declared field's hit takes (`surfaces`), so the
      // rule is the walker's domain, not `indexValue.kind === "dyn"`. It
      // used to be the narrower spelling because the emitters had no arm
      // for it; they do now (recordKeyGetHelper's dyn overflow surface).
      if (!surfaces(shape.indexValue)) return false;
    }
    return true;
  }

/** The literal index of a tuple access, or null when the expression isn't
   * a non-negative integer literal (parentheses tolerated — tsc's own
   * literal-index typing accepts them). */
  function tupleLiteralIndex(node: ts.Expression): number | null {
    let e: ts.Expression = node;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isNumericLiteral(e)) return null;
    const n = Number(e.text);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

/** `a[i] = v` in statement position → arraySet (element writes, like local
   * assignment, produce no value in our subset). */
  export function lowerElementWrite(L: Lowerer, expr: ts.BinaryExpression): IrStmt {
    const target = expr.left as ts.ElementAccessExpression;
    // `process.env[key] = v` — the computed twin of the dotted env write:
    // setenv(3), string keys and string values only.
    if (L.isProcessEnv(target.expression) && !target.questionDotToken) {
      const loc = locOf(expr);
      const key = L.lowerExpr(target.argumentExpression);
      if (key.type.kind !== "string") {
        L.unsupported("SC1090", target.argumentExpression, "indexing process.env with non-string keys");
      }
      const value = L.lowerExpr(expr.right);
      if (value.type.kind !== "string") {
        L.unsupported(
          "SC1090",
          expr.right,
          `assigning '${L.fmt(value.type)}' values to process.env (env values are strings — convert first: \`\${v}\`)`,
        );
      }
      return {
        kind: "exprStmt",
        expr: { kind: "libCall", fn: "process.envSet", args: [key, value], type: VOID, loc },
        loc,
      };
    }
    // Symbol-keyed property WRITES (`this[kLimit] = v`): the read path's
    // twin — a statically-resolvable unique-symbol key declared on the
    // receiver's class writes the hidden field slot; everything else keeps
    // the fence (static shapes have no symbol-keyed storage).
    if (L.mapTypeOf(L.typeOf(target.argumentExpression))?.kind === "symbol") {
      const fieldT = symbolFieldTarget(L, target);
      if (fieldT) {
        const value = L.lowerExprExpecting(expr.right, fieldT.fieldType);
        return L.fieldSetStmt(fieldT, value, locOf(expr), target);
      }
      L.unsupported(
        "SC1090",
        target,
        "symbol-keyed property writes outside class fields keyed by a module-level `const k = Symbol('desc')` (static shapes have no symbol-keyed storage)",
      );
    }
    let receiverIr = L.mapTypeOf(L.typeOf(target.expression));
    // Dispatch follows the RUNTIME world here too. A receiver the checker
    // spells `any[]` has no mapped type, but its VALUE can still be a real
    // static array: an unannotated `const a = new Array(n)` whose element
    // type came off the counting-loop proof (newArrayFillElemType) is
    // exactly that — lowerVarDecl's checkerAnyArray rule gave the binding
    // the initializer's array type, and only this read of the CHECKER's
    // type still says `any[]`. Without this the very writes that PROVED
    // the element type fenced as "assignment to non-array elements", one
    // statement below the declaration they typed. Probe-lowered (the dyn
    // arm below is the same pattern), so a receiver that is not an array
    // keeps every fence it had.
    if (receiverIr === null && L.checkerAnyArray(target.expression)) {
      const probe = probeLower(L, target.expression);
      if (probe !== null && probe.type.kind === "array") receiverIr = probe.type;
    }
    if (receiverIr?.kind === "jsval") {
      const obj = L.lowerExpr(target.expression);
      // Dispatch follows the RUNTIME world (383(d)): a checker-'any'
      // receiver whose value LOWERED checked-dynamic takes the dyn keyed
      // write — the routed JSVAL arm lands it on the real engine object.
      if (obj.type.kind === "dyn") {
        const loc = locOf(expr);
        const rawKey = L.lowerExpr(target.argumentExpression);
        const key: IrExpr =
          rawKey.type.kind === "f64" || rawKey.type.kind === "bool" || rawKey.type.kind === "dyn"
            ? { kind: "toString", operand: rawKey, type: STRING, loc: rawKey.loc }
            : rawKey;
        if (key.type.kind !== "string") {
          L.unsupported("SC1090", target.argumentExpression, `'${L.fmt(key.type)}'-typed keys in keyed writes through 'unknown' values`);
        }
        const value = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
        if (value.type.kind !== "dyn") {
          L.unsupported("SC1100", expr.right, `assigning '${L.fmt(value.type)}' values through 'unknown' receivers`);
        }
        return {
          kind: "exprStmt",
          expr: { kind: "libCall", fn: "dyn.keySet", args: [obj, key, value], type: VOID, loc },
          loc,
        };
      }
      const key = L.jsvalIn(L.lowerExpr(target.argumentExpression), target.argumentExpression);
      const value = L.jsvalIn(L.lowerExpr(expr.right), expr.right);
      const loc = locOf(expr);
      return { kind: "exprStmt", expr: { kind: "jsOp", op: "setIdx", args: [obj, key, value], type: VOID, loc }, loc };
    }
    // A checked-dynamic receiver TYPE (`unknown[]` and the collapsed
    // `(string | object)[]` map to DYN wholesale now): the dyn keyed
    // write — dyn.keySet. Number keys canonicalize through the JS-exact
    // formatter; ARR receivers take canonical index keys as element
    // set/extend (undefined-hole padding, JS's length growth exactly),
    // OBJ receivers set the member, and the runtime throws Node's
    // TypeErrors on every other kind. Values convert into the checked-dynamic tree;
    // unconvertible ones fence per site (the dynFrom stance).
    if (receiverIr?.kind === "dyn") {
      const obj = L.lowerExpr(target.expression);
      if (obj.type.kind === "dyn") {
        const loc = locOf(expr);
        let key = L.lowerExpr(target.argumentExpression);
        if (key.type.kind === "f64") key = L.ensureString(key, target.argumentExpression);
        if (key.type.kind !== "string") {
          L.unsupported("SC1090", target.argumentExpression, "indexing with non-string or non-number keys");
        }
        const value = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
        if (value.type.kind !== "dyn") {
          L.unsupported(
            "SC1101",
            expr.right,
            `storing '${L.fmt(value.type)}' values in a checked-dynamic array (the value cannot convert into the checked-dynamic tree)`,
          );
        }
        return { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [obj, key, value], type: VOID, loc }, loc };
      }
    }
    // Typed-array element write `b[i] = v` — bytesSet: the value is an f64
    // the runtime coerces JS-exactly; invalid indices trap (no appends —
    // typed arrays are fixed-length; JS would ignore the write).
    if (receiverIr?.kind === "bytes") {
      const recv = L.lowerExpr(target.expression);
      // The write twin: a typed-array .d.ts surface whose VALUE is a
      // handle takes the engine keyed write.
      if (recv.type.kind === "jsval") {
        const key = L.jsvalIn(L.lowerExpr(target.argumentExpression), target.argumentExpression);
        const value = L.jsvalIn(L.lowerExpr(expr.right), expr.right);
        const loc = locOf(expr);
        return { kind: "exprStmt", expr: { kind: "jsOp", op: "setIdx", args: [recv, key, value], type: VOID, loc }, loc };
      }
      const index = checkedJsNumber(L, target.argumentExpression, L.lowerExpr(target.argumentExpression));
      if (index === null) {
        L.unsupported("SC1090", target.argumentExpression, "indexing with non-number keys");
      }
      const value = L.lowerExprExpecting(expr.right, F64);
      return { kind: "bytesSet", arr: recv, index, value, loc: locOf(expr) };
    }
    // Tuple element write `t[0] = v`: a positional-field write (recordSet)
    // — literal indices only, like the read.
    if (receiverIr?.kind === "record") {
      const shape = L.shapes.get(receiverIr.shapeId);
      // A record/tuple-typed .d.ts surface whose VALUE is an island
      // handle: the engine keyed write (the read dispatch's twin), never
      // a recordSet/recordKeySet over a jsval.
      if (shape) {
        const obj = L.lowerExpr(target.expression);
        if (obj.type.kind === "jsval") {
          const key = L.jsvalIn(L.lowerExpr(target.argumentExpression), target.argumentExpression);
          const value = L.jsvalIn(L.lowerExpr(expr.right), expr.right);
          const loc = locOf(expr);
          return { kind: "exprStmt", expr: { kind: "jsOp", op: "setIdx", args: [obj, key, value], type: VOID, loc }, loc };
        }
        // A record-mapped CHECKER type over a VALUE living in the checked-dynamic tree (a
        // JS file-scope object-literal global): the checked-dynamic keyed
        // write — dyn.keySet (later writes win, insertion order; Node's
        // TypeErrors on non-object receivers), the value converting into
        // the checked-dynamic tree. Literal and runtime keys alike: the checked-dynamic tree's key set is
        // open, so no declared-field collision analysis applies.
        if (obj.type.kind === "dyn") {
          const loc = locOf(expr);
          const litKey = recordKeyLiteralText(target.argumentExpression);
          let key: IrExpr =
            litKey !== null
              ? { kind: "strLit", value: litKey, type: STRING, loc: locOf(target.argumentExpression) }
              : L.lowerExpr(target.argumentExpression);
          // Number AND checked-dynamic keys ride the JS-exact formatter,
          // exactly as the READ of the same receiver already does
          // (dynKeyGet's arm above): property keys ARE strings, so
          // `o[k] = v` is `o[String(k)] = v`. The write arm handled only
          // f64, so a runtime dyn key refused where the read of the very
          // same expression lowered — protobufjs's `util.oneOfGetter`
          // builds its field map with `fieldMap[fieldNames[i]] = 1` and
          // then READS it back with `fieldMap[keys[i]]`, one dyn key
          // each, and only the write was a trap.
          if (key.type.kind === "f64" || key.type.kind === "dyn") key = L.ensureString(key, target.argumentExpression);
          if (key.type.kind !== "string") {
            L.unsupported("SC1090", target.argumentExpression, "indexing records with non-string or non-number keys");
          }
          const value = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
          if (value.type.kind !== "dyn") {
            L.unsupported(
              "SC1101",
              expr.right,
              `storing '${L.fmt(value.type)}' values in a checked-dynamic object (the value cannot convert into the checked-dynamic tree)`,
            );
          }
          return { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [obj, key, value], type: VOID, loc }, loc };
        }
      }
      if (shape?.tuple) {
        const idx = tupleLiteralIndex(target.argumentExpression);
        if (idx === null) {
          L.unsupported(
            "SC1090",
            target.argumentExpression,
            "tuple indexing with a non-literal index (tuples are fixed-shape — use t[0], t[1], ...)",
          );
        }
        const fieldType = shape.fields.find((f) => f.name === String(idx))?.type;
        if (fieldType === undefined) L.badType(target, L.typeOf(target));
        const obj = L.lowerExpr(target.expression);
        const value = L.lowerExprExpecting(expr.right, fieldType);
        return {
          kind: "recordSet",
          obj,
          shapeId: receiverIr.shapeId,
          field: String(idx),
          value,
          loc: locOf(expr),
        };
      }
      // Dynamic keyed write `r[k] = v` — index-signature shapes only (a
      // declared-only shape's writable key set is closed; spell the field).
      // A LITERAL declared key is the bracket spelling of a field write.
      // Values flow into the index-value slot (dyn slots convert, typed
      // slots coerce); declared-key collisions at runtime validate against
      // the field's type through the emitted helper (a mismatch throws the
      // catchable TypeError — SEMANTICS.md).
      if (shape && !shape.tuple) {
        // Literal keys — string literals AND numeric literals in their
        // canonical string spelling (`b[1] = v` writes field/key "1", JS's
        // own key derivation) — name declared fields directly. A key
        // IDENTIFIER whose TYPE proves one literal (a literal-typed const,
        // a keyof-constrained type parameter bound to a literal inside a
        // generic instance — `set(o, "a", v)`'s body writing `o[k] = v`)
        // is the same static field write.
        const litKey = recordKeyLiteralText(target.argumentExpression) ??
          recordKeyTypeLiteralText(L, target.argumentExpression);
        if (litKey !== null) {
          const field = shape.fields.find((f) => f.name === litKey);
          if (field) {
            const obj = L.lowerExpr(target.expression);
            const value = L.lowerExprExpecting(expr.right, field.type);
            return { kind: "recordSet", obj, shapeId: receiverIr.shapeId, field: litKey, value, loc: locOf(expr) };
          }
        }
        if (!shape.indexValue) {
          // A SIGNATURE-FREE shape whose declared fields share ONE type
          // writes through the same per-shape dispatch (the mockable-clock
          // module shape: `mocked[functionality] = implementation` over a
          // table of same-signature closures). A key naming no declared
          // field throws the catchable TypeError — JS would ADD the
          // property, which a monomorphic struct cannot (the SEMANTICS.md
          // keyed-write-miss divergence). Mixed-type and accessor-carrying
          // shapes keep the fence.
          const common =
            shape.fields.length > 0 &&
            !shapeHasAccessorSlots(shape) &&
            shape.fields.every((f) => typeEquals(f.type, shape.fields[0]!.type))
              ? shape.fields[0]!.type
              : null;
          if (!common) {
            L.unsupported(
              "SC1090",
              target,
              "dynamic keyed writes to records without an index signature (declared fields of ONE shared type dispatch by key — spell the field name otherwise)",
            );
          }
          const obj = L.lowerExpr(target.expression);
          let key: IrExpr =
            litKey !== null
              ? { kind: "strLit", value: litKey, type: STRING, loc: locOf(target.argumentExpression) }
              : L.lowerExpr(target.argumentExpression);
          // Runtime number/boolean/dyn keys stringify — ToPropertyKey,
          // exactly the index-signature path's rule.
          if (key.type.kind === "f64") key = L.ensureString(key, target.argumentExpression);
          if (key.type.kind === "bool" || key.type.kind === "dyn") {
            key = { kind: "toString", operand: key, type: STRING, loc: locOf(target.argumentExpression) };
          }
          if (key.type.kind !== "string") {
            L.unsupported("SC1090", target.argumentExpression, "indexing records with non-string or non-number keys");
          }
          const value = L.coerceInto(expr.right, L.lowerExpr(expr.right), common);
          if (!typeEquals(value.type, common)) L.badType(expr.right, L.typeOf(expr.right));
          return { kind: "recordKeySet", obj, shapeId: receiverIr.shapeId, key, value, loc: locOf(expr) };
        }
        // A LITERAL key naming no declared field is a pure overflow insert
        // — no collision to validate. Runtime keys must be able to collide
        // with every declared field: dyn slots validate through the
        // dynCheck walker (fields must be dyn-convertible — the same
        // convertibility the read needs); typed slots write through
        // directly, so every field must BE the index-value type.
        const overflowOnly = litKey !== null;
        const writable =
          overflowOnly ||
          (shape.indexValue.kind === "dyn"
            ? shape.fields.every((f) => L.dynConvertible(f.type))
            : shape.fields.every((f) => typeEquals(f.type, shape.indexValue!)));
        if (!writable) {
          L.unsupported(
            "SC1090",
            target,
            `dynamic keyed writes to '${L.fmt(receiverIr)}' (a declared field's type cannot take the index signature's value at runtime)`,
          );
        }
        const obj = L.lowerExpr(target.expression);
        let key =
          litKey !== null
            ? ({ kind: "strLit", value: litKey, type: STRING, loc: locOf(target.argumentExpression) } satisfies IrExpr)
            : L.lowerExpr(target.argumentExpression);
        // Runtime NUMBER keys canonicalize through the JS-exact formatter
        // (o[n] = v writes o[String(n)] — the number-keyed-signature path).
        if (key.type.kind === "f64") key = L.ensureString(key, target.argumentExpression);
        if (key.type.kind !== "string") {
          L.unsupported("SC1090", target.argumentExpression, "indexing records with non-string or non-number keys");
        }
        const value = L.intoIndexValueSlot(L.lowerExpr(expr.right), shape.indexValue, expr.right);
        return {
          kind: "recordKeySet",
          obj,
          shapeId: receiverIr.shapeId,
          key,
          value,
          ...(overflowOnly ? { overflowOnly: true as const } : {}),
          loc: locOf(expr),
        };
      }
    }
    // Keyed write `d[k] = v` on a CHECKED-DYNAMIC receiver (a JS `any`
    // dictionary — the Object.create(null) memo-table idiom writes
    // `result[key] = value`): dyn.keySet, exactly the record-mapped dyn
    // arm above — later writes win in insertion order, number keys
    // canonicalize through the JS-exact formatter (ToPropertyKey's string
    // side), index keys on dyn arrays set/extend elements, and non-object
    // receivers throw Node's TypeErrors at runtime. An UNMAPPED checker
    // type (static `any` — mapTypeOf answers null without --dynamic)
    // probes the receiver's own lowered world: a dyn value takes the same
    // write, anything else falls through to the fences.
    if (receiverIr?.kind === "dyn" || receiverIr === null) {
      const obj = receiverIr !== null ? L.lowerExpr(target.expression) : probeLower(L, target.expression);
      if (obj !== null && obj.type.kind === "dyn") {
        const loc = locOf(expr);
        const litKey = recordKeyLiteralText(target.argumentExpression);
        let key: IrExpr =
          litKey !== null
            ? { kind: "strLit", value: litKey, type: STRING, loc: locOf(target.argumentExpression) }
            : L.lowerExpr(target.argumentExpression);
        if (key.type.kind === "f64") key = L.ensureString(key, target.argumentExpression);
        if (key.type.kind === "bool" || key.type.kind === "dyn") {
          key = { kind: "toString", operand: key, type: STRING, loc: locOf(target.argumentExpression) };
        }
        if (key.type.kind !== "string") {
          L.unsupported("SC1090", target.argumentExpression, "indexing checked-dynamic values with non-string or non-number keys");
        }
        const value = L.coerceToExpected(L.lowerExpr(expr.right), DYN);
        if (value.type.kind !== "dyn") {
          L.unsupported(
            "SC1101",
            expr.right,
            `storing '${L.fmt(value.type)}' values in a checked-dynamic object (the value cannot convert into the checked-dynamic tree)`,
          );
        }
        return { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [obj, key, value], type: VOID, loc }, loc };
      }
    }
    if (receiverIr?.kind !== "array") {
      L.unsupported("SC1090", target, "assignment to non-array elements");
    }
    const arr = L.lowerExpr(target.expression);
    // The write twin of the island element read: an array-typed .d.ts
    // surface whose VALUE is a handle takes the engine keyed write, never
    // a static arraySet over a jsval.
    if (arr.type.kind === "jsval") {
      const key = L.jsvalIn(L.lowerExpr(target.argumentExpression), target.argumentExpression);
      const value = L.jsvalIn(L.lowerExpr(expr.right), expr.right);
      const loc = locOf(expr);
      return { kind: "exprStmt", expr: { kind: "jsOp", op: "setIdx", args: [arr, key, value], type: VOID, loc }, loc };
    }
    const index = checkedJsNumber(L, target.argumentExpression, L.lowerExpr(target.argumentExpression));
    if (index === null) {
      L.unsupported("SC1090", target.argumentExpression, "indexing with non-number keys");
    }
    // The TOMBSTONE write, `a[i] = null as unknown as T` — the GC-drop
    // idiom (read the item, clear the slot so the array stops retaining
    // it). The value would otherwise reach Lowerer.strandedUnitTrap and
    // become the catchable throw, because there is no unit VALUE of type
    // T; but the SLOT has an absent value and always has (arrayNewLen
    // fills n of them, `a.length = n` grows more), so the write stores
    // that and scr_arr_get_ref refuses the slot on READ instead. The
    // element-type test is strandedUnitTrap's own refusal set, narrowed to
    // the refcounted kinds: a scalar slot has no absent value that is not
    // a lie, and dyn/jsval/union slots carry a real null or undefined
    // VALUE, so those keep the ordinary coercion.
    const elemT = receiverIr.elem;
    if (
      isRefCounted(elemT) && elemT.kind !== "union" && elemT.kind !== "dyn" &&
      elemT.kind !== "jsval" && !isUnitType(elemT) && tombstoneSource(expr.right)
    ) {
      return { kind: "arrayClear", arr, index, loc: locOf(expr) };
    }
    // The value flows into the element slot like an assignment: union
    // elements wrap plain arm values.
    const value = L.lowerExprExpecting(expr.right, receiverIr.elem);
    if (!typeEquals(value.type, receiverIr.elem)) {
      L.badType(expr.right, L.typeOf(expr.right));
    }
    return { kind: "arraySet", arr, index, value, loc: locOf(expr) };
  }

/** Is this right-hand side a bare `null` / `undefined` wearing the
 * assertions that got it past the checker — `null!`, `null as unknown as
 * T`, parentheses, `satisfies`? Only those: a unit LITERAL is pure, so
 * declining to evaluate it (arrayClear has no value operand) cannot lose
 * an effect. `void expr` is deliberately NOT here — its operand runs.
 * The `undefined` spelling is the bare name, the one this tree already uses
 * everywhere it has to recognise the value in source. */
function tombstoneSource(node: ts.Expression): boolean {
  let n: ts.Node = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(n) || ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) || ts.isTypeAssertion(n) ||
      ts.isSatisfiesExpression(n)
    ) {
      n = n.expression;
      continue;
    }
    return n.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(n) && n.text === "undefined");
  }
}

/** The `+` operand conversion. Identical to ensureString except over an
 * UNTYPED operand, where ECMAScript's `+` is ToPrimitive with the DEFAULT
 * hint — `valueOf` before `toString` — and String()/`${}` are the STRING
 * hint, the other way round. Measured on Node v25.9.0:
 * `"" + {valueOf:()=>42, toString:()=>"TS"}` is "42" and `String(...)` of
 * the same object is "TS". */
export function ensureStringForPlus(L: Lowerer, e: IrExpr, node: ts.Node): IrExpr {
  if (e.type.kind === "dyn") {
    return { kind: "toString", operand: e, hint: "default", type: STRING, loc: e.loc };
  }
  // `attrs.id + '!'` — the concat's ToPrimitive is TOTAL over dyn kinds
  // (undefined included: JS says "undefined"), so it is a destination that
  // can say what an absent index-signature key answers. Same routing as
  // ensureBool's truthiness test; the DEFAULT hint is the concat's own.
  {
    const atWidth = stringConvAtDynWidth(L, e);
    if (atWidth) return { kind: "toString", operand: atWidth, hint: "default", type: STRING, loc: e.loc };
  }
  return ensureString(L, e, node);
}

/** A width with NO IDENTITY: an immutable scalar, or a union whose every
 * arm is one. It is what lets a keyed read widen into a dyn destination
 * without a `dynFrom` DEEP COPY severing aliasing the program has today
 * (estado-recordkey r07) — strings, numbers and booleans have nothing to
 * sever, and neither does a union of them. `Record<string, string |
 * boolean>` is the shape zapo's app-state index args actually have.
 *
 * Unit arms are NOT admitted. A union that can already say undefined
 * answers an absent key itself (recordKeyReadAtSlotWidth declines it one
 * level up), and a `null` arm would leave the widening's own answer
 * ambiguous against a stored null. */
export function isImmutablePrimitiveWidth(L: Lowerer, t: IrType): boolean {
  if (t.kind === "string" || t.kind === "f64" || t.kind === "bool") return true;
  if (t.kind !== "union") return false;
  const def = L.unions.get(t.unionId);
  return (
    def !== undefined &&
    def.arms.length > 0 &&
    def.arms.every((a) => a.kind === "string" || a.kind === "f64" || a.kind === "bool")
  );
}

/** The dyn behind a string conversion's operand when the conversion is the
 * destination that can say undefined: an index-signature keyed read whose
 * declared width cannot (recordKeyReadAtSlotWidth), or a reference to a
 * local that already holds such a read at dyn width (narrowBridgeDyn).
 *
 * ToString is TOTAL over the dyn kinds — the runtime dispatch is Node's
 * String() exactly, undefined included — so a conversion never has to
 * refuse the way a typed slot does. `String(args[k])` and `` `${args[k]}` ``
 * printed `undefined` in Node and TRAPPED here, on the union-valued
 * signatures where the binding rule could not reach them either. */
function stringConvAtDynWidth(L: Lowerer, e: IrExpr): IrExpr | null {
  return L.recordKeyReadAtSlotWidth(e, DYN) ?? narrowBridgeDyn(e);
}

export function ensureString(L: Lowerer, e: IrExpr, node: ts.Node): IrExpr {
    {
      const atWidth = stringConvAtDynWidth(L, e);
      if (atWidth) return { kind: "toString", operand: atWidth, type: STRING, loc: e.loc };
    }
    if (e.type.kind === "string") return e;
    if (e.type.kind === "dyn") {
      // String(u) / `${u}`: a runtime dispatch over the dyn kind — Node's
      // String() exactly (undefined/null texts, JS number formatting,
      // strings verbatim, arrays via join, objects as "[object Object]").
      return { kind: "toString", operand: e, type: STRING, loc: e.loc };
    }
    if (e.type.kind === "jsval") {
      // String(v) in the engine — JS-exact (and Node-exact in templates).
      return { kind: "jsOp", op: "toStr", args: [e], type: STRING, loc: e.loc };
    }
    if (e.type.kind === "object") {
      // String(err) / `${err}` over the Error hierarchy: Error.prototype
      // .toString — the ONE runtime implementation (overriding it is
      // fenced), "name: message" with the empty-side elisions, exactly
      // Node's String(err), which carries no stack either.
      for (let c = L.classes.get(e.type.className) ?? null; c; c = c.base) {
        if (c.builtinError) {
          return { kind: "libCall", fn: "error.toString", args: [L.upcastTo(e, "%Error")], type: STRING, loc: e.loc };
        }
      }
    }
    if (e.type.kind === "union") {
      // `${u}` — the arm's ToString via a per-union interned helper
      // (sc_us_*), Node-exact per arm kind: unit arms are the known texts
      // "undefined"/"null", string arms pass through, f64/bool arms use the
      // JS-exact formatters. Ref arms (records, arrays, ...) stay fenced:
      // JS would print "[object Object]" and friends — narrow first.
      const def = L.unions.get(e.type.unionId);
      // A plain data RECORD arm is decidable and it is the arm the union
      // form was missing: JS prints Object.prototype.toString's constant
      // for it, and the LONE-record rule at the bottom of this function
      // already returns exactly that, under exactly this test — not a
      // tuple (which prints its elements) and no `toString` FIELD (which
      // would shadow the prototype's and have to be called). Applying the
      // same test per arm keeps the two spellings answering alike:
      // `${rec}` and `${num | rec}` after the arm dispatch.
      //
      // Array, class and every other ref arm stay fenced.
      const recordArmStringable = (a: IrType): boolean => {
        if (a.kind !== "record") return false;
        const shape = L.shapes.get(a.shapeId);
        return shape !== undefined && !shape.tuple && !shape.fields.some((f) => f.name === "toString");
      };
      const stringable = def?.arms.every(
        (a) =>
          a.kind === "undefinedT" || a.kind === "nullT" ||
          a.kind === "string" || a.kind === "f64" || a.kind === "bool" ||
          recordArmStringable(a),
      );
      if (stringable) {
        return { kind: "toString", operand: e, type: STRING, loc: e.loc };
      }
      L.unsupported(
        "SC1090",
        node,
        `string conversions of unions with object arms (${NARROW_FIRST})`,
      );
    }
    if (e.type.kind === "symbol") {
      // JS splits here: `${sym}` and concatenation THROW a TypeError,
      // String(sym) answers "Symbol(desc)". One shared lowering cannot
      // honor both — fence with the sanctioned spelling instead of
      // guessing the context.
      L.unsupported(
        "SC1090",
        node,
        "string conversions of symbol values (template literals throw in JS — call .toString() explicitly)",
      );
    }
    if (isUnitType(e.type)) {
      // `${undefined}` / "" + null: Node prints "undefined"/"null", but
      // these only arise spelled literally — reject rather than special-case.
      L.unsupported(
        "SC1090",
        node,
        `string conversions of '${e.type.kind === "undefinedT" ? "undefined" : "null"}' values`,
      );
    }
    if (e.type.kind === "array") {
      // `${[1,2,3]}` / String(arr): Array.prototype.toString IS join(",")
      // — the SAME intrinsic the .join() lowering emits, fenced to the
      // same element kinds (f64/string/bool, unions of those with unit
      // arms printing empty). Nested arrays would need JS's recursive
      // dispatch — the join fence already tells that story.
      const elem = e.type.elem;
      const joinableUnion =
        elem.kind === "union" &&
        (L.unions
          .get(elem.unionId)
          ?.arms.every(
            (a) => a.kind === "f64" || a.kind === "string" || a.kind === "bool" || isUnitType(a),
          ) ??
          false);
      if (elem.kind === "f64" || elem.kind === "string" || elem.kind === "bool" || joinableUnion) {
        const sep: IrExpr = { kind: "strLit", value: ",", type: STRING, loc: e.loc };
        return { kind: "arrIntrinsic", method: "join", receiver: e, args: [sep], type: STRING, loc: e.loc };
      }
    }
    if (e.type.kind === "record") {
      // `${obj}` / String(obj): a plain data record has no toString of its
      // own (a func-typed `toString` FIELD would shadow the prototype's —
      // JS would call it, so that shape keeps the fence), and a TUPLE
      // prints its elements like an array (not lowered — fenced) — every
      // other record is Object.prototype.toString's constant.
      const shape = L.shapes.get(e.type.shapeId);
      if (shape && !shape.tuple && !shape.fields.some((f) => f.name === "toString")) {
        return { kind: "toString", operand: e, type: STRING, loc: e.loc };
      }
    }
    if (e.type.kind !== "f64" && e.type.kind !== "bool") L.badType(node, L.typeOf(node));
    return { kind: "toString", operand: e, type: STRING, loc: e.loc };
  }

/** `new String(x)` (stdlib provenance, ≤1 argument) in a ToString
   * position: the wrapper's only distinguishers are typeof and identity —
   * neither is observable where the value immediately stringifies — so the
   * span lowers as the argument's own ToString (`new String()` is "").
   * Every other position keeps the wrapper-object constructor fence. */
  function stringWrapperToString(L: Lowerer, node: ts.Expression): IrExpr | null {
    let e = node;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isNewExpression(e) || !ts.isIdentifier(e.expression)) return null;
    const symbol = L.resolveValueSymbol(e.expression);
    if (symbol?.name !== "String" || !L.isStdlibSymbol(symbol)) return null;
    const args = e.arguments ?? [];
    if (args.length > 1 || args.some(ts.isSpreadElement)) return null;
    if (args.length === 0) return { kind: "strLit", value: "", type: STRING, loc: locOf(e) };
    return L.caughtToString(args[0]!) ?? L.ensureString(L.lowerExpr(args[0]!), args[0]!);
  }

export function lowerTemplate(L: Lowerer, expr: ts.TemplateExpression): IrExpr {
    const loc = locOf(expr);
    const pieces: IrExpr[] = [];
    if (expr.head.text !== "") {
      pieces.push({ kind: "strLit", value: expr.head.text, type: STRING, loc });
    }
    for (const span of expr.templateSpans) {
      pieces.push(
        stringWrapperToString(L, span.expression) ??
          L.caughtToString(span.expression) ??
          L.ensureString(L.lowerExpr(span.expression), span.expression),
      );
      if (span.literal.text !== "") {
        pieces.push({ kind: "strLit", value: span.literal.text, type: STRING, loc: locOf(span.literal) });
      }
    }
    if (pieces.length === 0) return { kind: "strLit", value: "", type: STRING, loc };
    return pieces.reduce((acc, p) => ({ kind: "strConcat", left: acc, right: p, type: STRING, loc }));
  }

/** `x as T`. Non-dyn inner values keep today's pure-erasure semantics.
   * A dyn ('unknown') inner value makes this THE dynamic boundary:
   * - `as unknown` (dyn → dyn) stays erasure;
   * - dyn → a JSON-representable target type T compiles to `dynCheck`, a
   *   runtime validation that builds the typed value or THROWS a catchable
   *   TypeError-flavored error (JS `as` never checks — the headline
   *   documented divergence: a lying cast throws instead of corrupting
   *   memory);
   * - dyn → anything else (closures, class instances, void) is rejected:
   *   those types cannot be found inside a JSON dyn. */
  /** `e as T` and the old-style assertion `<T>e` — one node shape (both
   * carry `.type` and `.expression`), one lowering. */
  export function lowerAsExpression(L: Lowerer, expr: ts.AsExpression | ts.TypeAssertion): IrExpr {
    // `[] as const` — tsgo panics computing the expression's `readonly []`
    // type (the facade's fence answers `any`), but the syntax pins the
    // value exactly: the empty tuple, ridden as the unit-element array
    // (mapType's empty-tuple rule). Lower it directly; enclosing slots
    // coerce like any other empty-array source.
    if (
      ts.isAsExpression(expr) &&
      isConstAssertionTypeNode(expr.type) &&
      ts.isArrayLiteralExpression(expr.expression) &&
      expr.expression.elements.length === 0
    ) {
      return { kind: "arrayLit", elems: [], type: arrayOf(unitOnlyUnion(L.unions)), loc: locOf(expr) };
    }
    // `e as C` on a CATCH BINDING (`(err as Error).message`): the checked
    // extraction — an instanceof match extracts the payload, anything else
    // throws the catchable TypeError (dynCheck's trust-but-verify stance,
    // extended to exception payloads). Intercepts BEFORE lowerExpr — the
    // raw read would hit caughtRead's narrowness fence.
    const caughtLocal = L.caughtLocalOf(expr.expression);
    if (caughtLocal) {
      const loc = locOf(expr);
      const targetTs = L.checker.getTypeFromTypeNode(expr.type);
      const target = L.mapTypeOf(targetTs);
      if (target?.kind === "object") {
        const info = L.classes.get(target.className);
        if (info && L.inHierarchy(info)) {
          return {
            kind: "caughtCheck",
            value: { kind: "varRef", localId: caughtLocal.id, type: CAUGHT, loc },
            className: target.className,
            type: target,
            loc,
          };
        }
      }
      // Narrowed reads (`err instanceof Error` proven) still pass below;
      // other targets keep the narrowness fence with the checked-cast fix.
      // In a JS FILE the AsExpression is tsgo's spelling of a JSDoc cast
      // (`/** @type {T} */ (e)` — JS has no `as`); 5.9.3 parsed that as a
      // plain parenthesized read, which lowered caught→dyn and met the
      // target through the ordinary checked-cast coercion — so the dyn
      // bridge stays open here exactly for that shape.
      const narrowed = L.mapTypeOf(L.typeOf(expr.expression));
      const bridged =
        narrowed &&
        (narrowed.kind === "f64" || narrowed.kind === "bool" || narrowed.kind === "string" ||
          narrowed.kind === "object" ||
          (narrowed.kind === "dyn" && isJsSourceFile(expr.getSourceFile())));
      if (!bridged) L.unsupported("SC1063", expr);
    }
    const inner = L.lowerExpr(expr.expression);
    if (inner.type.kind !== "dyn" && inner.type.kind !== "jsval") {
      // A STATIC value cast `as any` is the explicit island entrance.
      const targetTs0 = L.checker.getTypeFromTypeNode(expr.type);
      if (targetTs0.flags & ts.TypeFlags.Any && L.dynamic) {
        return L.jsvalIn(inner, expr.expression);
      }
      // `u as Arm` on a UNION value is `u!`'s spelling with a named arm
      // (`req.headers[h] as string`): the CHECKED single-arm extraction —
      // the asserted arm's payload comes out, any other arm throws the
      // catchable TypeError (divergence 38's lying-assertion stance; an
      // erasure would just move the failure to the next typed slot as an
      // opaque union-mismatch fence). Sub-union targets and same-type
      // casts keep the historic erasure.
      if (inner.type.kind === "union") {
        const target = L.mapTypeOf(targetTs0);
        if (target && target.kind !== "union" && !typeEquals(target, inner.type)) {
          const helper = L.narrowedArmHelper(inner.type.unionId, target, locOf(expr));
          if (helper) {
            return { kind: "call", callee: helper, args: [inner], type: target, loc: locOf(expr) };
          }
        }
      }
      // `o as Derived` on a class INSTANCE is the union case one block up,
      // one layer down: the CHECKED downcast — checkedDowncastBridge, the
      // very same instanceof-gated %class.narrow helper maybeNarrow builds
      // for a narrowing tsc proved — the asserted class comes out, any
      // other class throws the catchable TypeError.
      //
      // Erasure could not stand here. The cast kept the BASE type, so a
      // consumer that coerces fenced with SC1090 (`const r = q as R`) while
      // a consumer that does NOT — a member-access RECEIVER, `(q as R).r`,
      // which resolves the field against the checker's type — handed the
      // emitter a base-typed pointer for a derived field offset, and the IR
      // validator reported that as SC9001 'fieldGet receiver: expected
      // object:R, got object:Q'. One spelling of one cast, an ICE on one
      // side of it and a fence on the other; the bridge is what both
      // positions were missing, and it is the same reinterpret the base
      // instance cannot survive unchecked (a base struct is SHORTER than
      // the subclass's, so the read leaves the allocation).
      // The WIDENING spelling of the same cast (`(r as Q).q`, r: R) is the
      // implicit upcast coerceToExpected performs for the same pair — the
      // prefix-layout pointer reinterpret, no copy and no check, because
      // an R IS a Q. It ICEd identically and for the identical reason:
      // erasure left an R-typed receiver where the field resolved against
      // Q. Read through the same subclass predicate coerceToExpected reads,
      // duplex widening included, so `(pt as Writable)` and a Writable slot
      // cannot disagree about a PassThrough.
      // `res as Readable` — the CAST spelling of the slot. Erasure leaves
      // an httpReq where every consumer downstream resolves against
      // %Readable, so the cast has to perform the same conversion the slot
      // performs (httpReqIsReadableIn, one predicate). The sweep found
      // this: `pipeline(res as Readable, dst, cb)` fenced while
      // `const b: Readable = res; pipeline(b, dst, cb)` compiled, which is
      // the duplex block's "two positions, one rule" lesson in the one
      // position that block did not have to touch.
      if (inner.type.kind === "httpReq") {
        const target = L.mapTypeOf(targetTs0);
        if (target !== null && httpReqIsReadableIn(inner.type, target)) return L.httpBodyStream(inner);
      }
      // `b as (T & { readonly destroy?: () => Promise<void> })` — the CAST
      // spelling of the slot, and the fifth member of this function's
      // family. mapTypeOf maps the intersection to a record with the MERGED
      // fields, and every OTHER position that meets that record already
      // reshapes into it: an annotated const and a declared parameter both
      // run coerceToExpected -> widthCoerce, which copies the shared fields
      // and completes the ones the operand's shape does not carry to their
      // undefined arm (recordWidthPlan's absent rule). The cast position
      // alone had no conversion, so erasure left the OPERAND's record where
      // the read resolved against the ASSERTED one and the last-resort fence
      // answered "reading 'destroy' from a value of type
      // 'WithDestroyLifecycle<WaIdentityStore>'" — a refusal standing beside
      // two spellings of the same conversion that answer.
      //
      // WIDENING ONLY, and deliberately. Every field of the operand's shape
      // must exist on the asserted one and the asserted one must add at
      // least one: precisely the pair erasure cannot serve. A NARROWING cast
      // (`wide as Narrow`) keeps erasure — a copy there would DROP fields and
      // change what a mutation through the result reaches, and nothing about
      // it fences today. Index-signature shapes on either side keep erasure
      // too: the overflow CAPTURE is widthCoerce's other arm, with its own
      // runtime validation, and this position is not asking for it. Tuples
      // never widen (TS permits no other tuple width).
      //
      // A pair widthCoerce DECLINES keeps the existing fence exactly — an
      // added field with no undefined arm is a required member the operand
      // cannot supply — so this can only turn a refusal into the answer the
      // slot already gives.
      if (inner.type.kind === "record") {
        const target = L.mapTypeOf(targetTs0);
        if (target !== null && target.kind === "record" && target.shapeId !== inner.type.shapeId) {
          const from = L.shapes.get(inner.type.shapeId);
          const to = L.shapes.get(target.shapeId);
          if (
            from !== undefined &&
            to !== undefined &&
            from.tuple === undefined &&
            to.tuple === undefined &&
            from.indexValue === undefined &&
            to.indexValue === undefined &&
            from.fields.every((f) => to.fields.some((t) => t.name === f.name)) &&
            to.fields.some((t) => !from.fields.some((f) => f.name === t.name))
          ) {
            const widened = L.widthCoerce(inner, target);
            if (process.env["SCRIPTC_ASWIDE_WHY"] !== undefined) {
              const added = to.fields.filter((t) => !from.fields.some((f) => f.name === t.name)).map((t) => t.name);
              const at = locOf(expr);
              console.error(
                `[aswide] ${at.file}@${at.start} ${inner.type.shapeId}->${target.shapeId} ` +
                  `adds=[${added.join(",")}] coerced=${widened !== null}`,
              );
            }
            if (widened !== null) return widened;
          }
        }
      }
      if (inner.type.kind === "object") {
        const target = L.mapTypeOf(targetTs0);
        if (target !== null && target.kind === "object" && target.className !== inner.type.className) {
          if (L.isSubclassOf(target.className, inner.type.className)) {
            const bridged = checkedDowncastBridge(L, inner, target, locOf(expr));
            if (bridged !== inner) return bridged;
          } else if (
            L.isSubclassOf(inner.type.className, target.className) ||
            streamDuplexWidensToWritable(inner.type.className, target.className, (a, b) => L.isSubclassOf(a, b))
          ) {
            return L.upcastTo(inner, target.className);
          }
        }
      }
      return inner; // erasure, unchanged
    }
    if (inner.type.kind === "jsval") {
      // The island exit. `as any` on an island value is erasure; a static
      // target compiles to a VALIDATED extraction (strict primitives; the
      // JSON round-trip + dynCheck walker for composites) that throws a
      // catchable TypeError on mismatch — same trust-but-verify rule as
      // the dyn boundary. Targets with no extraction are rejected.
      const targetTs = L.checker.getTypeFromTypeNode(expr.type);
      if (targetTs.flags & ts.TypeFlags.Any) return inner;
      const target = L.mapTypeOf(targetTs);
      if (!target) L.badType(expr.type, targetTs);
      if (!L.boundarySafe(target)) {
        L.unsupported(
          "SC1090",
          expr,
          `a checked cast of 'any' to '${L.fmt(target)}' ` +
            `(an 'any' value can only be validated against JSON-representable types: ` +
            `number, string, boolean, records, arrays, and unions of those)`,
        );
      }
      return { kind: "jsExit", value: inner, type: target, loc: locOf(expr) };
    }
    const targetTs = L.checker.getTypeFromTypeNode(expr.type);
    const target = L.mapTypeOf(targetTs);
    if (!target) L.badType(expr.type, targetTs);
    if (target.kind === "dyn") return inner; // `as unknown`: erasure
    if (target.kind === "void" || !L.jsonSafe(target)) {
      // Bare undefined-armed targets pass when every OTHER arm is
      // JSON-safe: the checked-dynamic tree holds a first-class undefined value now
      // (index-signature overflow reads produce it for missing keys), and
      // the undefined arm matches exactly it — `p[key] as string |
      // undefined` is the missing-key idiom. Parsed JSON still never
      // contains undefined, so casts over parse results keep failing on
      // non-string values with the usual path-annotated TypeError.
      if (
        target.kind === "union" &&
        canDynCheckTo(target, (id) => L.shapes.get(id), (id) => L.unions.get(id))
      ) {
        return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
      }
      // Uint8Array targets: the checked-dynamic tree carries a bytes kind now (converted
      // stdin chunks) — the extraction validates the kind and copies out.
      if (target.kind === "bytes" && target.elem === "u8") {
        return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
      }
      // FUNCTION targets (`u as (x: number) => number` — the checked-
      // dynamic function boundary): kind check, then exact unwrap or the
      // per-target adapter shim. NON-adaptable signatures (a construct-
      // signature interface whose return record carries function fields —
      // the RawWebSocketConstructor shape) cast too, with EXACT-UNWRAP-
      // ONLY semantics: the only dyn value that can honestly fill such a
      // slot is one boxed FROM the slot's own type, so an identical boxed
      // signature unwraps by identity and every other function value
      // throws the path-annotated TypeError (trust-but-verify — the
      // emitters skip the adapter branch for these targets).
      if (target.kind === "func") {
        return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
      }
      // Runtime HANDLE targets (`u as IncomingMessage` — a boxed handle
      // coming back out of an untyped wrapper): a tag-checked reference
      // unwrap, identity preserved (DYN_HANDLE_KINDS).
      if (DYN_HANDLE_KINDS.has(target.kind)) {
        return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
      }
      // An all-`unknown`-fields record target (`err as { code?: unknown }`
      // — the errno-probing idiom): there is nothing to validate (every
      // field is unknown, exactly what the dyn value already answers) and
      // nothing to build — the cast is pure typing, so it ERASES and the
      // reads ride the dyn keyed read.
      if (target.kind === "record") {
        const shape = L.shapes.get(target.shapeId);
        if (
          shape &&
          !shape.tuple &&
          shape.fields.every((f) => f.type.kind === "dyn") &&
          (!shape.indexValue || shape.indexValue.kind === "dyn")
        ) {
          return inner;
        }
      }
      // A composite that is not JSON-safe only because a CHECKABLE
      // non-JSON leaf sits inside it (a Uint8Array field). The walker
      // emits a check per type and calls the per-field one for each
      // field, and that leaf is one it already knows standing alone.
      if (canDynCheckTo(target, (id) => L.shapes.get(id), (id) => L.unions.get(id))) {
        return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
      }
      L.unsupported(
        "SC1090",
        expr,
        `a checked cast of 'unknown' to '${target.kind === "void" ? "void" : L.fmt(target)}' ` +
          `(a dynamic value can only be validated against JSON-representable types: ` +
          `number, string, boolean, records, arrays, and unions of those)`,
      );
    }
    return { kind: "dynCheck", value: inner, type: target, loc: locOf(expr) };
  }

export function lowerPrefixUnary(L: Lowerer, expr: ts.PrefixUnaryExpression): IrExpr {
    const loc = locOf(expr);
    switch (expr.operator) {
      case ts.SyntaxKind.MinusToken: {
        const operand = L.lowerExpr(expr.operand);
        if (operand.type.kind === "bigint") {
          return { kind: "libCall", fn: "big.neg", args: [operand], type: BIGINT, loc };
        }
        if (operand.type.kind === "jsval") {
          return { kind: "jsOp", op: "neg", args: [operand], type: JSVAL, loc };
        }
        // Unary `-` is ToNumber then negate — no string arm, no
        // ToPrimitive branch past the primitives — so an untyped JS
        // operand runs the real conversion (`-'3'` is -3, `-undefined` is
        // NaN) instead of refusing.
        if (operand.type.kind === "dyn" && isJsSourceFile(expr.getSourceFile())) {
          tonumWhy(expr, "unary-minus");
          const n: IrExpr = { kind: "libCall", fn: "dyn.toNumber", args: [operand], type: F64, loc };
          return { kind: "unary", op: "-", operand: n, type: F64, loc };
        }
        if (operand.type.kind !== "f64") L.unsupported("SC1043", expr);
        if (operand.kind === "numLit") return { ...operand, value: -operand.value, loc };
        return { kind: "unary", op: "-", operand, type: F64, loc };
      }
      case ts.SyntaxKind.PlusToken: {
        const operand = L.lowerExpr(expr.operand);
        // Unary + is ToNumber; on an already-number operand it's identity,
        // and a STRING operand runs the runtime's ECMA-exact StringToNumber
        // (num.fromString — Number(aString)'s lowering, scr_string.c).
        if (operand.type.kind === "jsval") {
          return { kind: "jsOp", op: "plus", args: [operand], type: JSVAL, loc };
        }
        if (operand.type.kind === "string") {
          return { kind: "libCall", fn: "num.fromString", args: [operand], type: F64, loc };
        }
        // Unary `+` over an untyped JS operand IS ToNumber, spelled.
        if (operand.type.kind === "dyn" && isJsSourceFile(expr.getSourceFile())) {
          tonumWhy(expr, "unary-plus");
          return { kind: "libCall", fn: "dyn.toNumber", args: [operand], type: F64, loc };
        }
        if (operand.type.kind !== "f64") L.unsupported("SC1043", expr);
        return operand;
      }
      case ts.SyntaxKind.ExclamationToken: {
        // `!x` is ToBoolean-then-negate: f64/string operands go through toBool.
        const operand = L.ensureBool(L.lowerExpr(expr.operand), expr.operand);
        return { kind: "unary", op: "!", operand, type: BOOL, loc };
      }
      case ts.SyntaxKind.TildeToken: {
        // `~x`: ToInt32, complement, back to f64 (JS-exact, incl. NaN → -1).
        const operand = L.lowerExpr(expr.operand);
        // `~x` on a bigint is -x-1 over the infinite representation.
        if (operand.type.kind === "bigint") {
          return { kind: "libCall", fn: "big.not", args: [operand], type: BIGINT, loc };
        }
        // `~x` on an untyped JS operand: ToInt32 is ToNumber then the
        // truncating wrap the f64 node already performs, so the dyn form
        // is the same node with the operand converted (`~'3'` is -4,
        // `~undefined` is -1) — the unary twin of the bitwise six.
        if (operand.type.kind === "dyn" && isJsSourceFile(expr.getSourceFile())) {
          tonumWhy(expr, "unary-tilde");
          const n: IrExpr = { kind: "libCall", fn: "dyn.toNumber", args: [operand], type: F64, loc };
          return { kind: "unary", op: "~", operand: n, type: F64, loc };
        }
        if (operand.type.kind !== "f64") L.unsupported("SC1043", expr);
        return { kind: "unary", op: "~", operand, type: F64, loc };
      }
      case ts.SyntaxKind.PlusPlusToken:
      case ts.SyntaxKind.MinusMinusToken:
        // `++x` / `--x` in expression position: yields the NEW value.
        return lowerIncDec(L, expr, true);
    }
    L.unsupported("SC1090", expr, `syntax '${ts.SyntaxKind[expr.kind]}'`);
  }

/** `x++`/`x--`/`++x`/`--x` in EXPRESSION position — the incDec node:
   * read, write ±1, yield old (postfix) or new (prefix) value. Receivers
   * are f64 LOCALS or module globals (captured/boxed included — the
   * backend reads/writes through the box); record fields and array
   * elements keep the fence in value position (statement-position `obj.f++`
   * still desugars through the compound-field path). */
  export function lowerIncDec(
    L: Lowerer,
    expr: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    prefix: boolean,
  ): IrExpr {
    const loc = locOf(expr);
    const op = expr.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-";
    if (!ts.isIdentifier(expr.operand)) {
      // CLASS-FIELD receivers (`if (--this.limit === 0)` — countdown.js's
      // dec(); `--this[kLimit]` — its symbol-keyed spelling): a single-
      // evaluation read-modify-write over the instance, yielding old/new
      // like the local form. f64 fields are JS-exact; CHECKED-DYNAMIC
      // fields (implicit-any ctor assignments in JS) take the dyn
      // arithmetic stance — the number validates out (dynCheck's
      // catchable TypeError, never a silent ToNumber; SEMANTICS.md),
      // computes, and boxes back. Array elements, record fields, and
      // accessor-backed names keep the fence.
      if (
        (ts.isPropertyAccessExpression(expr.operand) || ts.isElementAccessExpression(expr.operand)) &&
        !expr.operand.questionDotToken
      ) {
        const target = ts.isPropertyAccessExpression(expr.operand)
          ? L.fieldTarget(expr.operand)
          : symbolFieldTarget(L, expr.operand);
        if (
          target?.container === "class" &&
          !RUNTIME_ERROR_CLASSES.has(target.className) &&
          (target.fieldType.kind === "f64" ||
            (target.fieldType.kind === "dyn" && isJsSourceFile(expr.getSourceFile())))
        ) {
          return {
            kind: "fieldIncDec",
            op,
            prefix,
            obj: target.obj,
            className: target.className,
            field: target.field,
            fieldDyn: target.fieldType.kind === "dyn",
            type: F64,
            loc,
          };
        }
        // Every OTHER field spelling the compound path can WRITE — record
        // fields, checked-dynamic fields and checked-dynamic receivers,
        // accessor-backed names — is the same read-modify-write that
        // `obj.f += 1` performs as a statement. The only thing statement
        // position never had to answer is the yielded value, and
        // `buf[this.pos++]` — the byte reader every generated protobuf
        // decoder is built from — is exactly that and nothing more.
        //
        // The admitted shapes are EXACTLY the ones statement position
        // dispatches to lowerFieldCompound (lower-stmts' `obj.f++`
        // desugar): a dotted access through an identifier or `this`, and
        // the symbol-keyed element spelling of a declared class field.
        // Anything wider would trade this fence for one of the compound
        // path's own — the same count with a worse message.
        const recv = expr.operand.expression;
        if (
          (ts.isIdentifier(recv) || recv.kind === ts.SyntaxKind.ThisKeyword) &&
          (ts.isPropertyAccessExpression(expr.operand) || symbolFieldInfo(L, expr.operand) !== null)
        ) {
          return lowerFieldIncDecValue(L, expr.operand, op, prefix, expr, loc);
        }
      }
      // Array/typed-array ELEMENTS and computed receivers keep the fence:
      // the element compound is a statement-only bargain (it re-lowers
      // both receiver and index, which is only unobservable for a bare
      // identifier and a repeatable index), and value position has its
      // own reading of what an element slot's coercion yields.
      L.unsupported(
        "SC1045",
        expr,
        "increment/decrement of array elements or computed receivers in expression position",
      );
    }
    const target = L.resolveWritable(expr.operand);
    if (!target) {
      L.rejectUnresolved(expr.operand, `increment/decrement of '${expr.operand.text}' (not a writable local or module global)`);
    }
    // A CHECKED-DYNAMIC binding (`t++` over a minified codec's untyped
    // cursor — by far the commonest spelling behind this fence): `x++` is
    // ToNumber, ±1, store, yield. The ToNumber is the operator's OWN
    // conversion, the same one the binary operators run on a dyn operand,
    // and it is where the two spellings had drifted: `t = t + 1` already
    // converted while `t++` refused. What JS yields is the CONVERTED old
    // value, not the old cell — `x = '5'; x++` is 5 and leaves 6 — so the
    // number is what the temp holds and what the expression answers.
    if (target.type.kind === "dyn" && isJsSourceFile(expr.getSourceFile())) {
      tonumWhy(expr, prefix ? "prefix-incdec" : "postfix-incdec");
      const oldTmp = L.declareHiddenLocal("%incOld", F64);
      const newTmp = L.declareHiddenLocal("%incNew", F64);
      const oldRef = (): IrExpr => ({ kind: "varRef", localId: oldTmp.id, type: F64, loc });
      const newRef = (): IrExpr => ({ kind: "varRef", localId: newTmp.id, type: F64, loc });
      const cur: IrExpr = {
        kind: "libCall", fn: "dyn.toNumber",
        args: [{ kind: "varRef", localId: target.id, type: DYN, loc: locOf(expr.operand) }],
        type: F64, loc,
      };
      return {
        kind: "seqExpr",
        stmts: [
          { kind: "varDecl", localId: oldTmp.id, init: cur, loc },
          {
            kind: "varDecl", localId: newTmp.id,
            init: { kind: "bin", op, left: oldRef(), right: { kind: "numLit", value: 1, type: F64, loc }, type: F64, loc },
            loc,
          },
          { kind: "assign", localId: target.id, value: { kind: "dynFrom", value: newRef(), type: DYN, loc }, loc },
        ],
        result: prefix ? newRef() : oldRef(),
        type: F64,
        loc,
      };
    }
    if (target.type.kind !== "f64") L.unsupported("SC1043", expr);
    return { kind: "incDec", op, prefix, localId: target.id, type: F64, loc };
  }

/** Whether a lowered statement can live inside a seqExpr — the
 * validator's straight-line set (writes and effect expressions only; the
 * C emission point is mid-expression, so no control flow, no jumps).
 * Blocks check their bodies recursively. */
function seqExprSafeStmt(s: IrStmt): boolean {
  switch (s.kind) {
    case "varDecl":
    case "assign":
    case "exprStmt":
    case "fieldSet":
    case "recordSet":
    case "recordKeySet":
    // The overflow-map delete `delete r[k]` performs — a straight-line
    // write like recordKeySet, and value-position delete needs it here.
    case "recordKeyDelete":
    case "arraySet":
    case "bytesSet":
      return true;
    case "block":
      return s.body.every(seqExprSafeStmt);
    default:
      return false;
  }
}

/** The SCRIPTC_TONUM_WHY probe: one line per site where a JS operator over
 * an untyped operand now runs its real ToNumber/ToPrimitive conversion
 * instead of a checked cast to number. Read in the SAME run as the result
 * it is meant to explain — a branch that never fires produces a
 * byte-identical artifact and no honest claim can be made about it. */
export function tonumWhy(node: ts.Node, what: string): void {
  if (!process.env["SCRIPTC_TONUM_WHY"]) return;
  const sf = node.getSourceFile();
  const pos = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf));
  console.error(`[tonum] ${what} ${sf.fileName}:${pos.line + 1}:${pos.character + 1}`);
}

/** The SCRIPTC_VALPOS_WHY probe: one line per assignment in VALUE
 * position that this file either CLAIMS (an arm's tag) or refuses (the
 * "fence" tag), with the target's own text. A minified bundle is one
 * line, so file:line says nothing there — the text is the only way a run
 * can report which spellings moved and which are still refused. */
export function valPosWhy(node: ts.Node, what: string): void {
  if (process.env["SCRIPTC_VALPOS_WHY"] === undefined) return;
  const sf = node.getSourceFile();
  const pos = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf));
  const text = node.getText().replace(/\s+/g, " ").slice(0, 90);
  process.stderr.write(`VALPOS ${what} ${sf.fileName}:${pos.line + 1}:${pos.character + 1} ${text}\n`);
}

/** A position that must hold a NUMBER and has no ToNumber of its own: an
 * element-access index, an `a.slice(i)` argument, a numeric switch
 * discriminant. `+` over untyped JS operands answers a dyn (its result
 * kind is a runtime property — either side a string makes it
 * concatenation), so `a[i + 1]` and `a.slice(i + 1)` now arrive here with
 * a dyn where the sum used to be an f64 built from two checked operands.
 * These positions settle it the same way the operand check used to: a
 * CHECKED cast, exactly as loud as before and in the same place.
 *
 * ToNumber would be WRONG here and that is the whole distinction — `a[true]`
 * is the property "true" in JS, not element 1, and `a.slice('2')` is not
 * `a.slice(2)`'s spec path either. Conversion belongs to the operators
 * that specify one; a slot that specifies none keeps the validated exit.
 * Null when there is no numeric home and the caller should fence. */
export function checkedJsNumber(L: Lowerer, node: ts.Node, value: IrExpr): IrExpr | null {
  if (value.type.kind === "f64") return value;
  if (value.type.kind === "dyn" && isJsSourceFile(node.getSourceFile())) {
    return { kind: "dynCheck", value, type: F64, loc: value.loc };
  }
  return null;
}

/** The RHS of a VALUE-position member assignment, in a shape a hidden
 * local can hold.
 *
 * A BARE unit has no standalone representation here — locals and results
 * may not carry one (validate.ts refuses; the emitters call it a bug) —
 * so it rides the unit-only union, the same slot `const x = null` and
 * `await null` take. Everything else is itself, with its own type, so
 * the consumer still sees exactly what the checker typed.
 *
 * The shape that asks is a CHAIN: `h.a = h.b = null`, which protobufjs's
 * `util._configure` writes in its no-Buffer arm. The inner assignment is
 * in value position, its value is `null`, and the outer one wants a temp
 * to hold it. */
function setValRhs(L: Lowerer, value: IrExpr): IrExpr {
  return isUnitType(value.type) ? L.coerceToExpected(value, unitOnlyUnion(L.unions)) : value;
}

export function lowerBinary(L: Lowerer, expr: ts.BinaryExpression): IrExpr {
    const loc = locOf(expr);
    const op = expr.operatorToken.kind;

    if (op === ts.SyntaxKind.EqualsToken || (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment)) {
      // `x = e` in EXPRESSION position (`while ((idx = s.indexOf("\n")) !== -1)`,
      // `f(x = v)`): evaluate e once, write the binding, yield the assigned
      // value — JS evaluation order. Variable targets only (locals and module
      // globals, captured/boxed included); the RHS coerces into the binding's
      // type exactly like statement position, and the expression's value is
      // the coerced binding-typed value (representation change only — never
      // observably different from JS's raw-RHS yield). Compound operators,
      // property/element targets, and destructuring targets stay fenced.
      if (op === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expr.left)) {
        const target = L.resolveWritable(expr.left);
        if (!target) {
          L.rejectUnresolved(expr.left, `assignment to '${expr.left.text}' (not a writable local or module global)`);
        }
        const value = L.lowerExprExpecting(expr.right, target.type);
        return { kind: "assignExpr", localId: target.id, value, type: target.type, loc };
      }
      // `events.defaultMaxListeners = v` — the module-property write
      // Node validates (validateNumber(n, 'defaultMaxListeners', 0)):
      // the value crosses into the checked-dynamic tree and the runtime ladder throws
      // ERR_INVALID_ARG_TYPE / ERR_OUT_OF_RANGE with Node's exact slot
      // name; valid numbers apply. The expression's value is the RHS
      // (JS's assignment yield).
      if (
        op === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expr.left) &&
        !expr.left.questionDotToken &&
        expr.left.name.text === "defaultMaxListeners"
      ) {
        const bi = L.builtinMemberOf(expr.left);
        if (bi && bi.module === "events" && bi.member === "defaultMaxListeners") {
          const rhs = L.lowerExpr(expr.right);
          if (rhs.type.kind === "dyn" || rhs.kind === "unitLit" || L.dynConvertible(rhs.type)) {
            const valTmp = L.declareHiddenLocal("%setVal", rhs.type);
            const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: rhs.type, loc });
            const dynVal: IrExpr =
              rhs.type.kind === "dyn" ? valRef() : { kind: "dynFrom", value: valRef(), type: DYN, loc };
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: valTmp.id, init: rhs, loc },
                {
                  kind: "exprStmt",
                  expr: {
                    kind: "libCall",
                    fn: "emitter.setDefaultMaxChk",
                    args: [dynVal, { kind: "strLit", value: "defaultMaxListeners", type: STRING, loc }],
                    type: VOID,
                    loc,
                  },
                  loc,
                },
              ],
              result: valRef(),
              type: rhs.type,
              loc,
            };
          }
        }
      }
      // Member targets whose storage IS a module global — namespace
      // members (`N.x`) and expando function members (`Foo.baz`): the
      // same assignExpr, since the "member" is a variable.
      if (
        op === ts.SyntaxKind.EqualsToken &&
        (ts.isPropertyAccessExpression(expr.left) || ts.isElementAccessExpression(expr.left)) &&
        !(ts.isPropertyAccessExpression(expr.left) && expr.left.questionDotToken)
      ) {
        const target =
          expandoWritableTarget(L, expr.left) ??
          (ts.isPropertyAccessExpression(expr.left) ? nsWritableTarget(L, expr.left) : null);
        if (target) {
          const value = L.lowerExprExpecting(expr.right, target.type);
          return { kind: "assignExpr", localId: target.id, value, type: target.type, loc };
        }
        // `h.k = v` on an ISLAND receiver in VALUE position: the engine
        // property write (setProp throws the engine's TypeErrors on
        // nullish receivers, bridged catchably), the RHS value threaded
        // through as the expression's value.
        if (ts.isPropertyAccessExpression(expr.left) && !expr.left.questionDotToken && L.isIslandExpr(expr.left.expression)) {
          const recv = L.lowerExpr(expr.left.expression);
          const recvTmp = L.declareHiddenLocal("%setRecv", recv.type);
          const rhsVal = setValRhs(L, L.lowerExpr(expr.right));
          const valTmp = L.declareHiddenLocal("%setVal", rhsVal.type);
          const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: rhsVal.type, loc });
          return {
            kind: "seqExpr",
            stmts: [
              { kind: "varDecl", localId: recvTmp.id, init: recv, loc },
              { kind: "varDecl", localId: valTmp.id, init: rhsVal, loc },
              {
                kind: "exprStmt",
                expr: {
                  kind: "jsOp",
                  op: "setProp",
                  name: expr.left.name.text,
                  args: [{ kind: "varRef", localId: recvTmp.id, type: recv.type, loc }, L.jsvalIn(valRef(), expr.right)],
                  type: VOID,
                  loc,
                },
                loc,
              },
            ],
            result: valRef(),
            type: rhsVal.type,
            loc,
          };
        }
        // `h.k = v` on a CHECKED-DYNAMIC receiver in VALUE position
        // (`var _ = module.exports = foo`): receiver first, then RHS
        // (JS's reference-before-value order), the keyed write, and the
        // RHS value is the expression's value — its OWN type, so the
        // consumer sees exactly what the checker typed.
        if (ts.isPropertyAccessExpression(expr.left) && !expr.left.questionDotToken) {
          const recv = probeLower(L, expr.left.expression);
          if (recv && recv.type.kind === "dyn") {
            const recvTmp = L.declareHiddenLocal("%setRecv", DYN);
            const rhsVal = setValRhs(L, L.lowerExpr(expr.right));
            const valTmp = L.declareHiddenLocal("%setVal", rhsVal.type);
            const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: rhsVal.type, loc });
            const stored = L.coerceToExpected(valRef(), DYN);
            if (stored.type.kind !== "dyn") {
              L.unsupported("SC1101", expr.right, `assigning '${L.fmt(rhsVal.type)}' values into a checked-dynamic member`);
            }
            const key: IrExpr = { kind: "strLit", value: expr.left.name.text, type: STRING, loc: locOf(expr.left.name) };
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: recvTmp.id, init: recv, loc },
                { kind: "varDecl", localId: valTmp.id, init: rhsVal, loc },
                {
                  kind: "exprStmt",
                  expr: { kind: "libCall", fn: "dyn.keySet", args: [{ kind: "varRef", localId: recvTmp.id, type: DYN, loc }, key, stored], type: VOID, loc },
                  loc,
                },
              ],
              result: valRef(),
              type: rhsVal.type,
              loc,
            };
          }
        }
        // `h[k] = v` on a CHECKED-DYNAMIC receiver in VALUE position —
        // the ELEMENT-ACCESS twin of the property arm above, missing for
        // no reason but that nothing had asked. protobufjs's enum-table
        // factory is the asking: `t[e[0] = "E2EE"] = 0` is a keyed write
        // whose KEY is itself a keyed write, so the same store arrives in
        // value position and in statement position, and a rule that
        // claims only one of them leaves the other's read looking at a
        // table nothing wrote.
        //
        // Same order as the property arm and as the statement path (the
        // receiver reference, then the KEY — JS evaluates the whole
        // member reference before the RHS — then the RHS, then the
        // write), same conversion into the checked-dynamic tree, and the
        // expression's value is the RHS with its OWN type. Number and
        // boolean keys stringify: ToPropertyKey, exactly the statement
        // path's rule. Every other receiver kind keeps the fence below —
        // an array element's write in value position needs the element
        // slot's coercion to answer what JS yields, which is a different
        // question from this one.
        if (ts.isElementAccessExpression(expr.left) && expr.left.questionDotToken === undefined) {
          const recv = probeLower(L, expr.left.expression);
          if (recv && recv.type.kind === "dyn") {
            const recvTmp = L.declareHiddenLocal("%setRecv", DYN);
            const keyNode = expr.left.argumentExpression;
            const litKey = recordKeyLiteralText(keyNode);
            let key: IrExpr =
              litKey !== null
                ? { kind: "strLit", value: litKey, type: STRING, loc: locOf(keyNode) }
                : L.lowerExpr(keyNode);
            if (key.type.kind === "f64") key = L.ensureString(key, keyNode);
            if (key.type.kind === "bool" || key.type.kind === "dyn") {
              key = { kind: "toString", operand: key, type: STRING, loc: locOf(keyNode) };
            }
            if (key.type.kind !== "string") {
              L.unsupported("SC1090", keyNode, "indexing checked-dynamic values with non-string or non-number keys");
            }
            const keyTmp = L.declareHiddenLocal("%setKey", STRING);
            const rhsVal = setValRhs(L, L.lowerExpr(expr.right));
            const valTmp = L.declareHiddenLocal("%setVal", rhsVal.type);
            const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: rhsVal.type, loc });
            const stored = L.coerceToExpected(valRef(), DYN);
            if (stored.type.kind !== "dyn") {
              L.unsupported("SC1101", expr.right, `assigning '${L.fmt(rhsVal.type)}' values into a checked-dynamic member`);
            }
            valPosWhy(expr.left, "elem-dyn");
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: recvTmp.id, init: recv, loc },
                { kind: "varDecl", localId: keyTmp.id, init: key, loc },
                { kind: "varDecl", localId: valTmp.id, init: rhsVal, loc },
                {
                  kind: "exprStmt",
                  expr: {
                    kind: "libCall",
                    fn: "dyn.keySet",
                    args: [
                      { kind: "varRef", localId: recvTmp.id, type: DYN, loc },
                      { kind: "varRef", localId: keyTmp.id, type: STRING, loc },
                      stored,
                    ],
                    type: VOID,
                    loc,
                  },
                  loc,
                },
              ],
              result: valRef(),
              type: rhsVal.type,
              loc,
            };
          }
        }
        // `o.f = v` on a CLASS-INSTANCE or RECORD receiver in VALUE
        // position — the CHAINED write `a.len = o.head = 0`, whose INNER
        // assignment is an expression. Nothing about the write differs
        // from statement position; only its value was missing. So this is
        // the statement machinery's own target resolution and its own
        // write (fieldTarget / fieldSetStmt) under a seqExpr, in JS's
        // evaluation order — the target reference first, then the RHS,
        // then the write — with the assigned value as the expression's
        // value. That value is the FIELD-typed one, the same
        // representation-only yield the `x = e` variable form above
        // documents: a plain data slot has no setter to observe the
        // difference.
        //
        // ACCESSOR containers stay fenced. Their write is a setter CALL,
        // and a call is a control transfer the seqExpr straight-line
        // contract (seqExprSafeStmt) does not admit; a setter can also
        // return something other than what it was handed, so the yielded
        // value would be a second question. Checked-dynamic receivers are
        // the branch above.
        if (ts.isPropertyAccessExpression(expr.left) && !expr.left.questionDotToken) {
          const ft = L.fieldTarget(expr.left);
          if (
            ft !== null &&
            (ft.container === "class" || ft.container === "record" || ft.container === "recordOvf") &&
            ft.obj.type.kind !== "dyn"
          ) {
            const recvT = ft.obj.type;
            const recvTmp = L.declareHiddenLocal("%setRecv", recvT);
            const value = L.lowerExprExpecting(expr.right, ft.fieldType);
            const valTmp = L.declareHiddenLocal("%setVal", ft.fieldType);
            const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: ft.fieldType, loc });
            const write = L.fieldSetStmt(
              { ...ft, obj: { kind: "varRef", localId: recvTmp.id, type: recvT, loc } },
              valRef(),
              loc,
              expr.left,
            );
            // SCRIPTC_CHAINASSIGN_WHY probe: every site this branch claims,
            // with its container and field type — so one run says which
            // sites moved from the fence to a lowering, and whether any of
            // them is a container this rule did not mean to take.
            if (process.env["SCRIPTC_CHAINASSIGN_WHY"] !== undefined) {
              process.stderr.write(
                `CHAINASSIGN ${ft.container} ${expr.left.name.text}:${L.fmt(ft.fieldType)} ` +
                  `${loc.file}:${expr.getSourceFile().getLineAndCharacterOfPosition(expr.getStart()).line + 1}\n`,
              );
            }
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: recvTmp.id, init: ft.obj, loc },
                { kind: "varDecl", localId: valTmp.id, init: value, loc },
                write,
              ],
              result: valRef(),
              type: ft.fieldType,
              loc,
            };
          }
        }
        // `Codec.TAG = v` in VALUE position on a FUNCTION-typed JS
        // receiver — the statement arm's twin, and needed for the same
        // reason the checked-dynamic arm above has one: a minifier writes
        // `x = (a.k = v, …)`, so the same write arrives in both positions
        // and a rule that claims only one of them leaves the other's read
        // looking at a table nothing wrote. Same box, same shared skip
        // list, same order (receiver reference, then RHS, then the write),
        // and the expression's value is the RHS with its OWN type.
        if (
          ts.isPropertyAccessExpression(expr.left) && !expr.left.questionDotToken &&
          fnOwnRoutableKey(expr.left.name.text) &&
          expr.left.name.text !== "name" && expr.left.name.text !== "length"
        ) {
          const boxed = fnOwnPropBox(L, expr.left.expression, locOf(expr.left.expression));
          if (boxed) {
            const recvTmp = L.declareHiddenLocal("%setRecv", DYN);
            const rhsVal = setValRhs(L, L.lowerExpr(expr.right));
            const valTmp = L.declareHiddenLocal("%setVal", rhsVal.type);
            const valRef = (): IrExpr => ({ kind: "varRef", localId: valTmp.id, type: rhsVal.type, loc });
            const stored = L.coerceToExpected(valRef(), DYN);
            if (stored.type.kind !== "dyn") {
              L.unsupported(
                "SC1101",
                expr.right,
                `assigning '${L.fmt(rhsVal.type)}' values onto a function value's own properties`,
              );
            }
            const key: IrExpr = { kind: "strLit", value: expr.left.name.text, type: STRING, loc: locOf(expr.left.name) };
            fnOwnCounters.write++;
            fnOwnWhy("writeval", expr.left, expr.left.name.text);
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: recvTmp.id, init: boxed, loc },
                { kind: "varDecl", localId: valTmp.id, init: rhsVal, loc },
                {
                  kind: "exprStmt",
                  expr: { kind: "libCall", fn: "dyn.keySet", args: [{ kind: "varRef", localId: recvTmp.id, type: DYN, loc }, key, stored], type: VOID, loc },
                  loc,
                },
              ],
              result: valRef(),
              type: rhsVal.type,
              loc,
            };
          }
        }
      }
      // Destructuring assignment in VALUE position (`(() => [i] = [i+1])()`,
      // `({} = {x} = a)`, `var d = ([] = src)`): the statement machinery's
      // parts under a seqExpr — the expression's value is the RHS value
      // (JS's GetValue of the right reference), which is exactly the
      // parts' hidden temp.
      if (
        op === ts.SyntaxKind.EqualsToken &&
        (ts.isObjectLiteralExpression(expr.left) || ts.isArrayLiteralExpression(expr.left))
      ) {
        const parts = L.lowerDestructuringAssignParts(expr.left, expr.right, loc);
        return { kind: "seqExpr", stmts: parts.stmts, result: parts.value, type: parts.value.type, loc };
      }
      // COMPOUND assignment in VALUE position — `switch (c >>>= 3)` and
      // `readU32(this.buf, this.pos += 4)` (a generated protobuf codec's
      // tag dispatch and its fixed-width reader), `(e |= 0) < 0`, and the
      // comma-operand accumulators every minifier writes. The third
      // member of the value-position assignment family, after the
      // property write and the element write: the statement path already
      // knows how to combine and store each of these targets, and all
      // value position adds is that the computed value is KEPT instead of
      // dropped — which is what compoundCombine separates out. The
      // combine runs once, the target is written once, and the yielded
      // value is the operation's own (JS's, not the slot's).
      //
      // Not here: element targets over arrays and typed arrays (the
      // statement path's double-evaluation bargain needs its own reading
      // in value position), and the LOGICAL assignments `&&=`/`||=`/`??=`,
      // whose whole point is that the store is CONDITIONAL — statement
      // position refuses two of the three and models the third only over
      // a variable, and a value-position rule that always assigned would
      // be a silent wrong answer through an accessor.
      if (
        op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        op === ts.SyntaxKind.BarBarEqualsToken ||
        op === ts.SyntaxKind.QuestionQuestionEqualsToken
      ) {
        L.unsupported(
          "SC1090",
          expr,
          "logical assignment (&&=, ||=, ??=) as an expression (the store is conditional and the value is one of two operands: write the if out)",
        );
      }
      {
        const compound = COMPOUND_ASSIGN_OPS[op];
        if (compound !== undefined) {
          // A VARIABLE target: a local, a module global, a namespace
          // member or an expando function member — the last two are
          // "members" whose storage IS a variable, exactly as the `=`
          // arm above reads them.
          let varTarget: { id: string; type: IrType } | null = null;
          if (ts.isIdentifier(expr.left)) {
            varTarget = L.resolveWritable(expr.left);
            if (!varTarget) {
              L.rejectUnresolved(expr.left, `assignment to '${expr.left.text}' (not a writable local or module global)`);
            }
          } else if (ts.isPropertyAccessExpression(expr.left) && !expr.left.questionDotToken) {
            varTarget = expandoWritableTarget(L, expr.left) ?? nsWritableTarget(L, expr.left);
          }
          if (varTarget) {
            const read: IrExpr = { kind: "varRef", localId: varTarget.id, type: varTarget.type, loc: locOf(expr.left) };
            const rhs = L.lowerExpr(expr.right);
            const combined = compoundCombine(L, compound, read, rhs, varTarget.type, expr, expr.left, expr.right, loc);
            if (!combined) L.unsupported("SC1043", expr);
            const type = combined.natural.type;
            const tmp = L.declareHiddenLocal("%cmpVal", type);
            const ref = (): IrExpr => ({ kind: "varRef", localId: tmp.id, type, loc });
            valPosWhy(expr.left, "compound-var");
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: tmp.id, init: combined.natural, loc },
                { kind: "assign", localId: varTarget.id, value: combined.toSlot(ref()), loc },
              ],
              result: ref(),
              type,
              loc,
            };
          }
          // A FIELD target — the same receivers statement position
          // admits (an identifier or `this`, because the write re-lowers
          // the receiver), including the checked-dynamic keyed form.
          if (
            ts.isPropertyAccessExpression(expr.left) ||
            (ts.isElementAccessExpression(expr.left) && symbolFieldInfo(L, expr.left))
          ) {
            valPosWhy(expr.left, "compound-field");
            return lowerFieldCompoundValue(L, expr.left, compound, expr.right, loc);
          }
        }
      }
      valPosWhy(expr.left, "fence");
      L.unsupported(
        "SC1090",
        expr,
        op === ts.SyntaxKind.EqualsToken
          ? "assignment to non-variables as an expression (only `x = e` over a variable yields a value; write property/destructuring assignments as statements)"
          : "compound assignment as an expression (supported: a variable, a namespace or expando member, and a field of an identifier or `this` receiver; write other targets as statements, or spell out `x = x op e`)",
      );
    }
    if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
      const nullTest = lowerLooseNullCompare(L, expr, loc);
      if (nullTest) return nullTest;
      // SAME-KIND loose equality IS strict equality (the spec's ==
      // dispatches to === when both operands share a type): `typeof v ==
      // 'object'`, `n != 0`, `flag == true` all lower exactly. Mixed
      // kinds (where == coerces) keep the fence.
      {
        const negated = op === ts.SyntaxKind.ExclamationEqualsToken;
        const left = L.lowerExpr(expr.left);
        const right = L.lowerExpr(expr.right);
        if (left.type.kind === "string" && right.type.kind === "string") {
          return strEqExpr(negated, left, right, loc);
        }
        if (
          (left.type.kind === "f64" && right.type.kind === "f64") ||
          (left.type.kind === "bool" && right.type.kind === "bool")
        ) {
          return { kind: "bin", op: negated ? "!==" : "===", left, right, type: BOOL, loc };
        }
      }
      L.unsupported("SC1040", expr);
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      // JS value semantics: `a && b` is `toBool(a) ? b : a` — the result is
      // an operand value, so both operands must share one IR kind (which is
      // also what tsc's type says, modulo literal-union collapsing that
      // mapType already handles). Mixed kinds (`n && s`) stay rejected.
      let left = L.lowerExpr(expr.left);
      // A left operand that already DECIDED at compile time: JavaScript
      // does not evaluate the right one, so neither does this — the dead
      // operand is not lowered AT ALL, which is the whole point. A
      // vendored bundle's environment sniff (`"undefined" != typeof window
      // && window`) reaches its dead half with a value the compiler has no
      // representation for, and lowering it costs a fence for code no run
      // ever enters. The `&& X` there is not "X we cannot compile" — it is
      // a branch the program provably never takes.
      //
      // A literal decides and carries no effects, so dropping the read
      // loses nothing (the ternary's boolLit fold makes the same argument
      // for the same reason). The result is the operand JS's own rule
      // names: `a && b` is `a` when a is falsy and `b` otherwise, `a || b`
      // is `a` when a is truthy and `b` otherwise.
      {
        const decided = staticTruth(left);
        if (decided !== null) {
          const isAnd = op === ts.SyntaxKind.AmpersandAmpersandToken;
          return decided === isAnd ? L.lowerExpr(expr.right) : left;
        }
      }
      let right = L.lowerExpr(expr.right);
      // A LITERAL-unit left operand (a compile-time undefined/null — the
      // capability-probe members: `process.features.inspector ||
      // !flag.startsWith('--inspect')` reads undefined in a compiled
      // binary): statically falsy, so the operator folds JS-exactly —
      // `unit || X` IS X, `unit && X` IS the unit (X's side effects never
      // run in JS either; the lowered right is simply dropped). Literal
      // units only — computed unit-typed values keep the fences below.
      // (The staticTruth fold above already claims the unit-literal case;
      // this arm stays as the backstop for a unit that arrives through a
      // path staticTruth declines.)
      if (left.kind === "unitLit") {
        return op === ts.SyntaxKind.BarBarToken ? right : left;
      }
      // `attrs.id || "D"`, `id && use(id)` — a widened keyed read (or the
      // local holding one) as a logical OPERAND. The operator's result IS
      // an operand value, and the operand JS yields here can be the
      // absent key's undefined: `||` yields the left only when it is
      // truthy, `&&` only when it is falsy, so validating the left into
      // the checker's scalar is a check on the very path JS does not take.
      // The dyn arm below is JS value semantics exactly (ToBoolean over
      // the kind, result dyn) — consumers validate where they always did.
      {
        const l = L.recordKeyReadAtSlotWidth(left, DYN) ?? narrowBridgeDyn(left);
        const r = L.recordKeyReadAtSlotWidth(right, DYN) ?? narrowBridgeDyn(right);
        if (l !== null) left = l;
        if (r !== null) right = r;
      }
      if (left.type.kind === "dyn" || right.type.kind === "dyn") {
        // A checked-dynamic operand (`fn.name || '<anonymous>'` —
        // test/common's _mustCallInner): both sides live in the checked-dynamic tree and
        // the deciding test is ToBoolean over the dyn kind
        // (scr_dyn_truthy) — JS value semantics exactly, result dyn. The
        // non-dyn side converts through the usual boundary; a value with
        // no dyn representation keeps the fence.
        const l = L.coerceToExpected(left, DYN);
        const r = L.coerceToExpected(right, DYN);
        if (l.type.kind !== "dyn" || r.type.kind !== "dyn") {
          L.unsupported("SC1100", expr, "logical operators on 'unknown' values");
        }
        return {
          kind: "logical",
          op: op === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
          left: l,
          right: r,
          type: DYN, loc,
        };
      }
      if (left.type.kind === "jsval" || right.type.kind === "jsval") {
        return {
          kind: "logical",
          op: op === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
          left: L.jsvalIn(left, expr.left),
          right: L.jsvalIn(right, expr.right),
          type: JSVAL, loc,
        };
      }
      if (left.type.kind === "union" || right.type.kind === "union") {
        // JS value semantics over a union: the deciding test is the ARM
        // value's ToBoolean (a per-union helper), and the result is the
        // deciding operand. Supported when the checker's type of the whole
        // expression maps to ONE union both operands coerce into (same
        // union passes through; a plain arm wraps — `u || undefined`).
        // Everything else (`u && flag`, whose value would need a wider
        // re-tagged union) stays fenced — in CONDITION position those
        // shapes lower through lowerCondition's bool descent instead.
        const target = L.mapTypeOf(L.typeOf(expr));
        if (target?.kind === "union") {
          // `||` whose left does NOT fit the result union: the checker built
          // that result by DROPPING the left's falsy arms (`process.env.X ||
          // null` is `string | null`, `|| 3000` is `string | number` — the
          // `undefined` is gone from both), so coercing the left eagerly, as
          // the shared shape below does, retags an arm the test is about to
          // rule out and throws where Node yields the default. Single-eval
          // instead: test the left in its OWN union and retag only on the
          // truthy side, where the dropped arms are unreachable.
          //
          // `&&` is the exact MIRROR, not the eager shape: there the FALSY
          // left is the result, so the checker built the target by dropping
          // the left's TRUTHY arms (`comms && comms.state()` over `Comms |
          // null` is `boolean | null` — the `Comms` arm is gone), and
          // coercing the left eagerly asks for a home the target does not
          // have. Same single-eval, retag on the falsy side. The arms with
          // no home are the ones a JS object always answers true for
          // (REF_TRUTHY_KINDS), so they may TRAP in the helper for the
          // reason unit arms may on the `||` side: the truthiness test has
          // already ruled them out. Arms that can be falsy by VALUE (bool,
          // f64, string) still have to map honestly — `"" && x` really can
          // yield the left.
          if (left.type.kind === "union" && !typeEquals(left.type, target)) {
            const and = op === ts.SyntaxKind.AmpersandAmpersandToken;
            // The PLAIN retag — every arm of the left with a home of its
            // own. `||` takes the lazy shape whenever it exists (the arms it
            // drops are units, which the helper may already trap). `&&` only
            // needs it when the eager coercion has NOWHERE to put a truthy
            // arm, so gate on the plain retag DECLINING: an `&&` that
            // compiles today keeps the lowering it has. Interning is by
            // (from, to, stranded), so the probe costs nothing — the eager
            // path below asks for the very same helper.
            const plain = L.unionRetagHelper(left.type.unionId, target.unionId, loc);
            const leftDef = and && plain === null ? L.unions.get(left.type.unionId) : undefined;
            const unreachable = leftDef
              ? new Set(leftDef.arms.flatMap((a, i) => (REF_TRUTHY_KINDS.has(a.kind) ? [i] : [])))
              : undefined;
            const retag = and
              ? (unreachable !== undefined && unreachable.size > 0
                  ? L.unionRetagHelper(left.type.unionId, target.unionId, loc, unreachable)
                  : null)
              : plain;
            if (process.env.SCRIPTC_ANDLEFT_WHY && and) {
              console.error(
                `ANDLEFT ${L.fmt(left.type)} -> ${L.fmt(target)} plain=${plain ?? "NONE"} truthyArms=[${[...(unreachable ?? [])].join(",")}] retag=${retag ?? "NONE"} at ${loc.file}:${loc.start}`,
              );
            }
            if (retag) {
              L.requireTruthyUnion(left.type.unionId, expr);
              return {
                kind: "orDefault",
                left,
                right: L.coerceInto(expr.right, right, target),
                retag,
                ...(and ? { negated: true as const } : {}),
                type: target,
                loc,
              };
            }
          }
          L.requireTruthyUnion(target.unionId, expr);
          return {
            kind: "logical",
            op: op === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
            left: L.coerceInto(expr.left, left, target),
            right: L.coerceInto(expr.right, right, target),
            type: target, loc,
          };
        }
        // `u || d` NARROWED by the default: the checker types the result
        // as u's single non-unit arm (`marker() || "default"`) — evaluate
        // u once, truthy extracts the arm, falsy takes d lazily (the
        // orDefault node, nullish's truthiness sibling). An UNMAPPABLE
        // checker result takes the same rule (`options.runner ||
        // defaultRunner` — tsc's union of two structurally-compatible
        // function types has no representation, while the left's one
        // non-unit arm is the only representable answer): the default
        // must coerce into the arm or fence on its own.
        if (
          op === ts.SyntaxKind.BarBarToken &&
          left.type.kind === "union"
        ) {
          const def = L.unions.get(left.type.unionId);
          const rest = def ? def.arms.filter((a) => !isUnitType(a)) : [];
          const funcArmDefault =
            rest[0]?.kind === "func" && (target === null || target.kind === "func");
          if (rest.length === 1 && ((target !== null && typeEquals(target, rest[0]!)) || funcArmDefault)) {
            L.requireTruthyUnion(left.type.unionId, expr);
            const dflt = L.lowerExprExpecting(expr.right, rest[0]!);
            return { kind: "orDefault", left, right: dflt, type: rest[0]!, loc };
          }
        }
        L.unsupported(
          "SC1090",
          expr,
          `logical operators on union-typed values outside conditions (${NARROW_FIRST})`,
        );
      }
      const kind = left.type.kind;
      if (
        kind !== right.type.kind ||
        (kind !== "f64" && kind !== "string" && kind !== "bool")
      ) {
        // Mixed PLAIN operands (`value || null`, `flag || undefined`,
        // `s || 0`): JS value semantics still compile when the checker
        // types the RESULT as one union both operands coerce into — the
        // same lift the union-operand path above takes, arriving here
        // with two plain arm values instead.
        const target = L.mapTypeOf(L.typeOf(expr));
        if (target?.kind === "union") {
          L.requireTruthyUnion(target.unionId, expr);
          return {
            kind: "logical",
            op: op === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
            left: L.coerceInto(expr.left, left, target),
            right: L.coerceInto(expr.right, right, target),
            type: target, loc,
          };
        }
        L.unsupported("SC1042", expr);
      }
      return {
        kind: "logical",
        op: op === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
        left, right, type: left.type, loc,
      };
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      return L.lowerNullishCoalesce(expr, loc);
    }
    if (op === ts.SyntaxKind.CommaToken) {
      // The statement loop may already have emitted this comma's LEFT operand
      // as its own statement (hoistedSeqEffects — the granularity rule's
      // sequence-assignment split, lower-stmts.ts). The effect happened, at
      // exactly this point in the statement sequence; lowering it again here
      // would run it TWICE, so the expression's value is just the right
      // operand's.
      if (L.hoistedSeqEffects.has(expr)) return L.lowerExpr(expr.right);
      // Comma expression in VALUE position (`r = ({} = a, [] = a)` — the
      // conformance corpus's paired-destructuring idiom): the left operand
      // runs for EFFECT exactly as its statement lowering (JS discards its
      // value), the right operand is the expression's value — a seqExpr.
      // The validator restricts seqExpr statements to straight-line writes
      // (the C emission point is mid-expression), so a left operand whose
      // statement lowering needs real control flow keeps a pointed fence
      // instead of tripping the validator downstream.
      const effect = L.lowerExprStatement(expr.left);
      if (!seqExprSafeStmt(effect)) {
        L.unsupported(
          "SC1090",
          expr.left,
          "comma expressions whose left operand needs control flow (run it as its own statement first)",
        );
      }
      const result = L.lowerExpr(expr.right);
      return { kind: "seqExpr", stmts: [effect], result, type: result.type, loc };
    }
    if (op === ts.SyntaxKind.InstanceOfKeyword) return L.lowerInstanceOf(expr, loc);
    if (op === ts.SyntaxKind.InKeyword) {
      return lowerInExpression(L, expr, loc);
    }
    // `typeof e === "string"` on a catch binding or an `unknown` value: a
    // runtime kind test — intercepted BEFORE the operands lower (a raw
    // read of the binding is the narrowness fence, and bare `typeof e`
    // has no lowering).
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const test =
        lowerErrorCodeTypeofTest(L, expr, loc) ??
        L.lowerCaughtTypeofTest(expr, loc) ??
        lowerDynTypeofTest(L, expr, loc) ??
        lowerUnionTypeofTest(L, expr, loc) ??
        // Also intercepted BEFORE the operands lower: a bare `.constructor`
        // read has no value form (no constructor objects exist here), so
        // the comparison has to be seen whole.
        lowerBytesCtorTest(L, expr, loc);
      if (test) return test;
    }

    let left = L.lowerExpr(expr.left);
    let right = L.lowerExpr(expr.right);
    // A widened keyed read (or the local holding one) in a STRICT
    // comparison: strict equality never coerces, so every dyn kind has an
    // answer and an absent key's undefined simply is not the other side —
    // the same reasoning that already routes `=== undefined` here, one
    // literal wider. Without this the bridge validates a value the
    // comparison was about to answer `false` for.
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const l = L.recordKeyReadAtSlotWidth(left, DYN) ?? narrowBridgeDyn(left);
      const r = L.recordKeyReadAtSlotWidth(right, DYN) ?? narrowBridgeDyn(right);
      if (l !== null) left = l;
      if (r !== null) right = r;
    }
    if (left.type.kind === "dyn" || right.type.kind === "dyn") {
      // The narrowing unit comparisons ARE answerable on unknown: `v ===
      // undefined` / `v !== null` test the dyn node's kind directly, and
      // tsc's control flow narrows the branches (reads then bridge through
      // maybeNarrow's validated extraction).
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const negated = op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
        const unit = left.kind === "unitLit" ? left : right.kind === "unitLit" ? right : null;
        const other = unit === left ? right : left;
        if (unit && other.type.kind === "dyn") {
          return {
            kind: "dynTest",
            test: unit.unit,
            ...(negated ? { negated: true as const } : {}),
            value: other,
            type: BOOL,
            loc,
          };
        }
        // dyn vs SCALAR strict equality (`value !== ""`, `u === 5` — the
        // normalizePricing filter): a guarded kind test + payload compare,
        // JS-exact (strict equality never coerces; a non-matching dyn kind
        // answers false). dyn vs dyn keeps the fence below.
        const dynSide = left.type.kind === "dyn" ? left : right;
        const scalarSide = dynSide === left ? right : left;
        if (
          dynSide.type.kind === "dyn" &&
          (scalarSide.type.kind === "f64" || scalarSide.type.kind === "string" || scalarSide.type.kind === "bool" ||
            // dyn vs dyn (`context.actual !== context.exact` —
            // test/common's exit accounting): the runtime's whole-dyn
            // strict equality — scalars by value, units by kind,
            // reference kinds by node identity (scr_dyn_strict_eq).
            scalarSide.type.kind === "dyn")
        ) {
          return {
            kind: "dynScalarEq",
            left,
            right,
            ...(negated ? { negated: true as const } : {}),
            type: BOOL,
            loc,
          };
        }
      }
      // JS `any`-origin operands (the checked-dynamic declaration story):
      // each operator runs its OWN specified conversion on the dyn side —
      // ToNumber for arithmetic and the bitwise six, ToPrimitive plus the
      // string test for `+` and for ordering — instead of a checked cast
      // to number. The cast was a guess everywhere except when the value
      // already WAS a number: `'3' - 1`, `x | 0` over an unset field,
      // `undefined + 1`, `'a' + 'b'` and `'a' < 'b'` are each fully
      // specified, none of them is a number context, and every one of
      // them threw. tsc rejects these forms on real `unknown`, so only
      // any-typed JS reaches this.
      // The REFERENCE kinds keep the loud throw: their ToPrimitive calls
      // a user valueOf/toString the dyn model holds no prototype chain
      // for, so answering there would be the silent wrong value this
      // whole tier exists to avoid (see dyn.toNumber in nodes.ts).
      if (isJsSourceFile(expr.getSourceFile())) {
        const toNum = (e: IrExpr, why: string): IrExpr => {
          if (e.type.kind !== "dyn") return e;
          tonumWhy(expr, why);
          return { kind: "libCall", fn: "dyn.toNumber", args: [e], type: F64, loc: e.loc };
        };
        const asDyn = (e: IrExpr): IrExpr =>
          e.type.kind === "dyn" ? e : { kind: "dynFrom", value: e, type: DYN, loc: e.loc };
        const other = left.type.kind === "dyn" ? right : left;
        // A BIGINT on the other side settles the operator completely, and
        // it is the one case on this path where the dyn side is NOT a
        // number context. JS refuses to mix: `5n >> 2` throws
        // "Cannot mix BigInt and other types", so an expression that runs
        // at all has a bigint on BOTH sides. The bigint arm further down
        // already states that ("tsc has already proved BOTH sides are
        // bigint wherever one is") — it just could not see it here,
        // because an untyped JS operand arrives as a dyn and the static
        // proof is the checker's, not this value's.
        //
        // The checked cast IS that proof, made at runtime: a bigint
        // unwraps (+1) and anything else throws, which is the same
        // outcome JS gives and the same one the ToNumber path below
        // could not give — that path would answer a NUMBER for
        // `e >> 32n`, silently, which is why this rule has to come
        // before it. zapo's site is `long`'s fromBigInt:
        // `BigInt.asIntN(32, e >> BigInt(32))`.
        //
        // Narrowed IN PLACE so the shared bigint arm below emits the
        // call: restating its table here would be a second copy of the
        // operator map, which is the recurring root cause in this tier.
        if (other.type.kind === "bigint") {
          const asBig = (e: IrExpr): IrExpr =>
            e.type.kind === "dyn" ? { kind: "dynCheck", value: e, type: BIGINT, loc: e.loc } : e;
          const bb = bigintBinary(asBig(left), asBig(right));
          // An operator the bigint table does not carry keeps every fence
          // it had: the narrowing is only applied when it produces an
          // answer, so nothing is silently reinterpreted on the way to a
          // refusal.
          if (bb) return bb;
        }
        const NUM_BIN: Partial<Record<ts.SyntaxKind, "-" | "*" | "/" | "%" | "**">> = {
          [ts.SyntaxKind.MinusToken]: "-",
          [ts.SyntaxKind.AsteriskToken]: "*",
          [ts.SyntaxKind.SlashToken]: "/",
          [ts.SyntaxKind.PercentToken]: "%",
          [ts.SyntaxKind.AsteriskAsteriskToken]: "**",
        };
        const NUM_CMP: Partial<Record<ts.SyntaxKind, "<" | "<=" | ">" | ">=">> = {
          [ts.SyntaxKind.LessThanToken]: "<",
          [ts.SyntaxKind.LessThanEqualsToken]: "<=",
          [ts.SyntaxKind.GreaterThanToken]: ">",
          [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
        };
        // The BITWISE six on a dyn operand. Same table, and the one row
        // where the number context is not a guess at all: `&`, `|`, `^`,
        // `<<`, `>>`, `>>>` are ToInt32/ToUint32 in the spec — there is no
        // ToPrimitive string arm and the result is always a number. What
        // ToInt32 does NOT do is refuse a non-number: it is ToNumber and
        // then a truncating wrap, so `'3' | 0` is 3 and `undefined | 0`
        // is 0. The static f64 case below already lowers these JS-exact
        // (scr_bit_*: NaN/±Infinity → 0, truncate, wrap mod 2^32, shift
        // counts masked to 5 bits), so the dyn form is the SAME node with
        // the operands checked — which is what the untyped varint / zigzag
        // / 64-bit-split core of a generated protobuf runtime is written
        // in, and the only reason it needed an engine.
        const BIT_BIN: Partial<Record<ts.SyntaxKind, "&" | "|" | "^" | "<<" | ">>" | ">>>">> = {
          [ts.SyntaxKind.AmpersandToken]: "&",
          [ts.SyntaxKind.BarToken]: "|",
          [ts.SyntaxKind.CaretToken]: "^",
          [ts.SyntaxKind.LessThanLessThanToken]: "<<",
          [ts.SyntaxKind.GreaterThanGreaterThanToken]: ">>",
          [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]: ">>>",
        };
        const arith = NUM_BIN[op];
        const cmp = NUM_CMP[op];
        const bit = BIT_BIN[op];
        const otherNumeric = other.type.kind === "f64" || other.type.kind === "dyn";
        if ((arith || bit) && otherNumeric) {
          const l = toNum(left, arith ? "arith" : "bitwise");
          const r = toNum(right, arith ? "arith" : "bitwise");
          if (arith) return { kind: "bin", op: arith, left: l, right: r, type: F64, loc };
          return { kind: "bin", op: bit!, left: l, right: r, type: F64, loc };
        }
        if (cmp && otherNumeric) {
          // Abstract relational comparison. With a STATIC number on the
          // other side the two ToPrimitive results can never BOTH be
          // strings, so the string arm is unreachable and ToNumber on the
          // dyn side is the entire algorithm. dyn vs dyn cannot be decided
          // here — `'a' < 'b'` is a string comparison and `'10' < 9` is a
          // numeric one — so the runtime makes the test.
          if (left.type.kind === "dyn" && right.type.kind === "dyn") {
            tonumWhy(expr, "relational");
            const fn: IrLibFn =
              cmp === "<" ? "dyn.lt" : cmp === "<=" ? "dyn.le" : cmp === ">" ? "dyn.gt" : "dyn.ge";
            return { kind: "libCall", fn, args: [left, right], type: BOOL, loc };
          }
          return { kind: "bin", op: cmp, left: toNum(left, "relational"), right: toNum(right, "relational"), type: BOOL, loc };
        }
        // `+` is the operator that is NOT a number context: after
        // ToPrimitive, EITHER side being a string makes the whole thing
        // concatenation. Only a statically STRING other side settles that
        // at compile time; a number or a dyn on the other side leaves the
        // result KIND a runtime property, so the node's type is dyn and
        // scr_dyn_add makes the test.
        if (op === ts.SyntaxKind.PlusToken) {
          if (other.type.kind === "f64" || other.type.kind === "dyn") {
            tonumWhy(expr, "add");
            return { kind: "libCall", fn: "dyn.add", args: [asDyn(left), asDyn(right)], type: DYN, loc };
          }
          if (other.type.kind === "string") {
            // String-context `+`: JS's answer is ToPrimitive with the
            // DEFAULT hint and then ToString — numbers format, arrays
            // join, an object's own `valueOf` runs BEFORE its `toString`
            // (the opposite of String(v)) — never a checked cast:
            // `'status ' + res.statusCode` concatenates like Node.
            const strOf = (e: IrExpr): IrExpr =>
              e.type.kind === "dyn" ? ensureStringForPlus(L, e, expr) : e;
            return { kind: "strConcat", left: strOf(left), right: strOf(right), type: STRING, loc };
          }
        }
      }
      // `any`-origin operands (tsc rejects these operator forms on real
      // `unknown`, so in a checker-clean TS program only `any` reaches
      // here): JS's full coercion semantics (ToPrimitive, NaN, string +)
      // live in the engine — the dynamic-family fence, so the island
      // retry lifts the site. Genuine unknown keeps the SC1100 story.
      if (
        (left.type.kind === "dyn" && L.anyOrigin(expr.left)) ||
        (right.type.kind === "dyn" && L.anyOrigin(expr.right))
      ) {
        L.anyOpFence(`the '${ts.tokenToString(op) ?? ts.SyntaxKind[op]}' operator`, expr);
      }
      // tsc allows ===/!== on unknown (arithmetic/comparisons it rejects
      // itself); a dynamic equality would need a dyn walk — validate first.
      L.unsupported("SC1100", expr, "operators on 'unknown' values");
    }
    // Operators over 'any' execute in the island with JS-exact semantics
    // (ToPrimitive, NaN, string +): both operands marshal in, the engine
    // computes. Comparisons come back as static bools; arithmetic stays
    // an island value ('1 as any + "x"' is a string over there).
    if (left.type.kind === "jsval" || right.type.kind === "jsval") {
      const JS_BIN: Partial<Record<ts.SyntaxKind, IrJsOp>> = {
        [ts.SyntaxKind.PlusToken]: "add",
        [ts.SyntaxKind.MinusToken]: "sub",
        [ts.SyntaxKind.AsteriskToken]: "mul",
        [ts.SyntaxKind.SlashToken]: "div",
        [ts.SyntaxKind.PercentToken]: "mod",
        [ts.SyntaxKind.AsteriskAsteriskToken]: "pow",
        [ts.SyntaxKind.LessThanToken]: "lt",
        [ts.SyntaxKind.LessThanEqualsToken]: "le",
        [ts.SyntaxKind.GreaterThanToken]: "gt",
        [ts.SyntaxKind.GreaterThanEqualsToken]: "ge",
        [ts.SyntaxKind.EqualsEqualsEqualsToken]: "eq",
        [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "neq",
      };
      const jop = JS_BIN[op];
      if (jop === undefined) {
        L.unsupported("SC1090", expr, `operator '${ts.tokenToString(op) ?? ts.SyntaxKind[op]}' on 'any' values`);
      }
      const type = jsOpResultKind(jop) === "bool" ? BOOL : JSVAL;
      return {
        kind: "jsOp", op: jop,
        args: [L.jsvalIn(left, expr.left), L.jsvalIn(right, expr.right)],
        type, loc,
      };
    }
    // BIGINT operands: JS refuses to mix bigint with number in arithmetic,
    // so tsc has already proved BOTH sides are bigint wherever one is — no
    // coercion can be needed, and every operator maps to one runtime call.
    if (left.type.kind === "bigint" && right.type.kind === "bigint") {
      const bb = bigintBinary(left, right);
      if (bb) return bb;
    }
    /* The operator table for two bigint operands, in ONE place because it
     * has TWO callers: the arm above, where the checker proved both sides
     * static, and the JS-source dyn rule further up, where an untyped
     * operand is narrowed with a checked cast and the proof is made at
     * runtime instead. A second copy of an eleven-operator map is the
     * duplication this tier keeps paying for. Declared as a hoisted
     * function so the earlier caller can reach it. */
    function bigintBinary(l: IrExpr, r: IrExpr): IrExpr | null {
      const left = l;
      const right = r;
      const arith: Partial<Record<ts.SyntaxKind, IrLibFn>> = {
        [ts.SyntaxKind.PlusToken]: "big.add",
        [ts.SyntaxKind.MinusToken]: "big.sub",
        [ts.SyntaxKind.AsteriskToken]: "big.mul",
        [ts.SyntaxKind.SlashToken]: "big.div",
        [ts.SyntaxKind.PercentToken]: "big.rem",
        [ts.SyntaxKind.AsteriskAsteriskToken]: "big.pow",
        [ts.SyntaxKind.LessThanLessThanToken]: "big.shl",
        [ts.SyntaxKind.GreaterThanGreaterThanToken]: "big.shr",
        [ts.SyntaxKind.AmpersandToken]: "big.and",
        [ts.SyntaxKind.BarToken]: "big.or",
        [ts.SyntaxKind.CaretToken]: "big.xor",
      };
      const fn = arith[op];
      if (fn) return { kind: "libCall", fn, args: [left, right], type: BIGINT, loc };
      const rel: Partial<Record<ts.SyntaxKind, IrNumBinOp>> = {
        [ts.SyntaxKind.LessThanToken]: "<",
        [ts.SyntaxKind.GreaterThanToken]: ">",
        [ts.SyntaxKind.LessThanEqualsToken]: "<=",
        [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
      };
      const cmp = rel[op];
      if (cmp) {
        return {
          kind: "bin",
          op: cmp,
          left: { kind: "libCall", fn: "big.cmp", args: [left, right], type: F64, loc },
          right: { kind: "numLit", value: 0, type: F64, loc },
          type: BOOL,
          loc,
        };
      }
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const eq: IrExpr = { kind: "libCall", fn: "big.eq", args: [left, right], type: BOOL, loc };
        const negated = op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
        return negated ? { kind: "unary", op: "!", operand: eq, type: BOOL, loc } : eq;
      }
      return null;
    }
    const bothNum = left.type.kind === "f64" && right.type.kind === "f64";
    const bothStr = left.type.kind === "string" && right.type.kind === "string";

    switch (op) {
      case ts.SyntaxKind.PlusToken:
        if (bothNum) return { kind: "bin", op: "+", left, right, type: F64, loc };
        if (left.type.kind === "string" || right.type.kind === "string") {
          return {
            kind: "strConcat",
            left: ensureStringForPlus(L, left, expr.left),
            right: ensureStringForPlus(L, right, expr.right),
            type: STRING, loc,
          };
        }
        L.unsupported("SC1043", expr);
        break;
      case ts.SyntaxKind.MinusToken:
      case ts.SyntaxKind.AsteriskToken:
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.PercentToken:
      case ts.SyntaxKind.AsteriskAsteriskToken: {
        if (!bothNum) L.unsupported("SC1043", expr);
        const binOp = op === ts.SyntaxKind.MinusToken ? "-"
          : op === ts.SyntaxKind.AsteriskToken ? "*"
          : op === ts.SyntaxKind.SlashToken ? "/"
          : op === ts.SyntaxKind.PercentToken ? "%" : "**";
        return { kind: "bin", op: binOp, left, right, type: F64, loc };
      }
      // The bitwise six, JS-exact: operands through ToInt32/ToUint32
      // (NaN/±Infinity → 0, truncate, wrap mod 2^32), the operation in
      // 32-bit space (shift counts masked to 5 bits), the result back to
      // f64 — `>>>` as Uint32, the rest as Int32 (runtime scr_bit_*).
      case ts.SyntaxKind.AmpersandToken:
      case ts.SyntaxKind.BarToken:
      case ts.SyntaxKind.CaretToken:
      case ts.SyntaxKind.LessThanLessThanToken:
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: {
        if (!bothNum) L.unsupported("SC1043", expr);
        const bitOp = op === ts.SyntaxKind.AmpersandToken ? "&"
          : op === ts.SyntaxKind.BarToken ? "|"
          : op === ts.SyntaxKind.CaretToken ? "^"
          : op === ts.SyntaxKind.LessThanLessThanToken ? "<<"
          : op === ts.SyntaxKind.GreaterThanGreaterThanToken ? ">>" : ">>>";
        return { kind: "bin", op: bitOp, left, right, type: F64, loc };
      }
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
        const negated = op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
        if (bothNum) return { kind: "bin", op: negated ? "!==" : "===", left, right, type: BOOL, loc };
        if (bothStr) return strEqExpr(negated, left, right, loc);
        // bool === bool: a plain value compare (the config-drift checks'
        // `desired.lanMode !== actual.lanMode` shape).
        if (left.type.kind === "bool" && right.type.kind === "bool") {
          return { kind: "bin", op: negated ? "!==" : "===", left, right, type: BOOL, loc };
        }
        const unitTest = L.lowerUnitComparison(left, right, negated, loc);
        if (unitTest) return unitTest;
        if (left.type.kind === "union" || right.type.kind === "union") {
          // JS strict equality of the ARM values, per union tag (a
          // per-union helper): equal tags compare payloads (f64 ==, string
          // bytes, bool ==, ref-arm POINTER identity), different tags are
          // never equal. Two shapes lower: same union on both sides, and
          // union vs plain arm value (`u === "text"` where the checker
          // didn't narrow) — the plain side wraps into the union, which
          // preserves payload identity. Different unions (tsc admits
          // partially-overlapping ones) still need narrowing first.
          const ut = left.type.kind === "union" ? left.type : (right.type as IrType & { kind: "union" });
          const bothUnion = left.type.kind === "union" && right.type.kind === "union";
          const sameUnion = bothUnion && typeEquals(left.type, right.type);
          // "the plain side wraps into the union, which preserves payload
          // identity" is true exactly while the wrap IS a wrap, and the
          // one word that comment got wrong cost a WhatsApp client its
          // dedup eviction. Two ways the plain side keeps its identity:
          //
          //  - it IS an arm of the union. unionWrap is then a tag and the
          //    payload pointer travels unchanged.
          //  - it is a PROMISE whose payload converts into the union's one
          //    promise arm. coerceToExpected inserts a converting adapter
          //    there, and an adapter returns a fresh promise -- but the
          //    adapter is MEMOISED on its source, so the same source
          //    reaches the slot as the same object every time, which is
          //    what JavaScript's identity-preserving assignment means
          //    here. promiseArmFor mirrors the one path coerceToExpected
          //    would take (one promise arm, payload adaptable) rather than
          //    guessing; if it declines, the value does not reach the
          //    union at all and the fence below is still the right answer.
          //
          // Anything else is a conversion whose result is a DIFFERENT
          // object, and
          //
          //     m.set("k", p); m.get("k") === p
          //
          // answering FALSE where Node answers true -- silently -- is
          // exactly what a dedup map that never evicts is made of. A
          // comparison that cannot be answered by identity is not answered
          // at all: it falls through to the narrow-first fence below.
          const plainT = left.type.kind === "union" ? right.type : left.type;
          const plainSideWraps =
            bothUnion ||
            L.armTag(ut.unionId, plainT) >= 0 ||
            L.promiseArmFor(plainT, ut) !== null;
          if ((sameUnion || !bothUnion) && plainSideWraps && L.eqComparableUnion(ut.unionId)) {
            return {
              kind: "unionEq",
              unionId: ut.unionId,
              negated,
              sameValue: false,
              left: L.coerceInto(expr.left, left, ut),
              right: L.coerceInto(expr.right, right, ut),
              type: BOOL,
              loc,
            };
          }
          L.unsupported(
            "SC1090",
            expr,
            `comparisons of union-typed values (${NARROW_FIRST})`,
          );
        }
        // Arrays, maps, functions, class instances and records compare by
        // reference identity (pointer compare) — JS-exact object equality.
        // Hierarchy-related classes compare after widening the derived side
        // (same pointer either way — prefix layout).
        let idLeft = left;
        let idRight = right;
        if (left.type.kind === "object" && right.type.kind === "object") {
          if (L.isSubclassOf(left.type.className, right.type.className)) {
            idLeft = L.upcastTo(left, right.type.className);
          } else if (L.isSubclassOf(right.type.className, left.type.className)) {
            idRight = L.upcastTo(right, left.type.className);
          }
        }
        // Two function values compare by identity whatever their STATIC
        // signatures (tsc admits the comparison when one side is
        // assignable to the other — a tuple-typed listeners() element
        // against a prefix-declared handler): the pointer answers it.
        if (idLeft.type.kind === "func" && idRight.type.kind === "func") {
          return { kind: "bin", op: negated ? "!==" : "===", left: idLeft, right: idRight, type: BOOL, loc };
        }
        // Two CLASS values compare by identity whatever their static
        // classes — one immortal object per class, one pointer compare
        // (the function-identity rule verbatim; `X === D` through a
        // base-typed slot answers exactly JS).
        if (idLeft.type.kind === "classval" && idRight.type.kind === "classval") {
          return { kind: "bin", op: negated ? "!==" : "===", left: idLeft, right: idRight, type: BOOL, loc };
        }
        if (
          (idLeft.type.kind === "array" ||
            idLeft.type.kind === "map" ||
            idLeft.type.kind === "set" ||
            idLeft.type.kind === "object" ||
            idLeft.type.kind === "record" ||
            // Symbols ARE identity: `Symbol('a') === Symbol('a')` is false,
            // a symbol equals exactly itself, and Symbol.for's interned
            // values compare equal across call sites — all one pointer
            // compare, JS's spec without approximation.
            idLeft.type.kind === "symbol" ||
            // Typed arrays / Buffers ARE objects to ===: pointer identity
            // (buf === buf.swap16() — the in-place mutators return this).
            idLeft.type.kind === "bytes" ||
            idLeft.type.kind === "promise") &&
          typeEquals(idLeft.type, idRight.type)
        ) {
          return { kind: "bin", op: negated ? "!==" : "===", left: idLeft, right: idRight, type: BOOL, loc };
        }
        // Runtime HANDLES are objects to === too: one handle per socket/
        // request/response, so pointer identity IS JS's object equality
        // (`c.pause() === c` — Node's chaining assertions). */
        // REGEX is in that set for CONVERSION (it boxes by reference like
        // the rest) but not for identity: the emitter interns one static
        // per (pattern, flags) pair, so two distinct `/x/` literals are
        // ONE pointer here and two objects in JS. Pointer identity would
        // answer true where Node answers false — measured, not assumed —
        // so the comparison keeps the SC1043 fence it has always had
        // rather than trading a build error for a wrong boolean.
        if (
          idLeft.type.kind !== "regex" &&
          DYN_HANDLE_KINDS.has(idLeft.type.kind) &&
          typeEquals(idLeft.type, idRight.type)
        ) {
          return { kind: "bin", op: negated ? "!==" : "===", left: idLeft, right: idRight, type: BOOL, loc };
        }
        L.unsupported("SC1043", expr);
        break;
      }
      case ts.SyntaxKind.LessThanToken:
      case ts.SyntaxKind.LessThanEqualsToken:
      case ts.SyntaxKind.GreaterThanToken:
      case ts.SyntaxKind.GreaterThanEqualsToken: {
        const cmpOp = op === ts.SyntaxKind.LessThanToken ? "<"
          : op === ts.SyntaxKind.LessThanEqualsToken ? "<="
          : op === ts.SyntaxKind.GreaterThanToken ? ">" : ">=";
        if (bothNum) return { kind: "bin", op: cmpOp, left, right, type: BOOL, loc };
        if (bothStr) return { kind: "strCmp", op: cmpOp, left, right, type: BOOL, loc };
        L.unsupported("SC1043", expr);
        break;
      }
      default:
        break;
    }
    L.unsupported("SC1090", expr, `operator '${ts.tokenToString(op) ?? ts.SyntaxKind[op]}'`);
  }

/** `typeof e === "lit"` / `typeof e !== "lit"` where e is a catch
   * binding: the runtime kind test over the snapshot's tag. Only the
   * primitive literals narrow ("string"/"number"/"boolean" — exactly what
   * the exception cell can distinguish); "object"/"function"/"undefined"
   * cannot be answered from the payload kinds (a thrown array and a thrown
   * record are both refs) and get the instanceof hint. Null when neither
   * side is a typeof over a catch binding (not this pattern). */
/** The %Error-rooted object type inside a checker type, or null: the
   * direct mapping when it IS one, else the first mappable %Error-rooted
   * constituent of an intersection (`Error & Record<"code", unknown>` —
   * what `err instanceof Error && "code" in err` narrows a catch binding
   * to; the refinement parts are type-level decoration, the VALUE is the
   * error object). */
  function errorRootedObjectOf(L: Lowerer, t: ts.Type): IrType | null {
    const rooted = (m: IrType | null): m is IrType & { kind: "object" } => {
      if (m?.kind !== "object") return false;
      let info = L.classes.get(m.className) ?? null;
      while (info && info.base) info = info.base;
      return info?.def.name === "%Error";
    };
    const direct = L.mapTypeOf(t);
    if (rooted(direct)) return direct;
    if (t.isIntersectionType()) {
      for (const part of t.getTypes()) {
        const m = L.mapTypeOf(part);
        if (rooted(m)) return m;
      }
    }
    return null;
  }

/** `typeof e.code === "string"` / `"undefined"` (and the `!==` forms)
   * where e — through parens and as-casts — is a catch binding or a value
   * of %Error-rooted type: the runtime error's code slot is a string
   * exactly when present, so the typeof test IS the presence test (the
   * isErrnoException predicate's third conjunct,
   * `typeof (err as Record<string, unknown>).code === "string"`). The
   * as-cast changes the expression's TYPE, never the value — peeled like
   * lowerProcessStreamProperty's receiver match. Null for every other
   * shape, so the sibling typeof lowerings keep trying. */
  function lowerErrorCodeTypeofTest(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (!ts.isTypeOfExpression(a)) continue;
      let prop: ts.Expression = a.expression;
      while (ts.isParenthesizedExpression(prop)) prop = prop.expression;
      if (!ts.isPropertyAccessExpression(prop) || prop.questionDotToken) continue;
      if (prop.name.text !== "code") continue;
      let recv: ts.Expression = prop.expression;
      while (ts.isParenthesizedExpression(recv) || ts.isAsExpression(recv) || ts.isTypeAssertion(recv)) recv = recv.expression;
      const errT = errorRootedObjectOf(L, L.typeOf(recv));
      if (!errT) continue;
      const caught = L.caughtLocalOf(recv);
      let receiver: IrExpr;
      if (caught) {
        // The checker proved the Error narrowing (errT above), so the
        // trusted extraction is sound — caughtRead itself would fence on
        // the intersection spelling.
        receiver = {
          kind: "caughtNarrow",
          value: { kind: "varRef", localId: caught.id, type: CAUGHT, loc },
          type: errT,
          loc,
        };
      } else {
        receiver = L.lowerExpr(recv);
        if (receiver.type.kind !== "object") continue;
      }
      if (!ts.isStringLiteral(b)) continue;
      if (b.text !== "string" && b.text !== "undefined") continue;
      const codeType = L.envValueType();
      if (codeType.kind !== "union") throw new Error("lowerer bug: error code type is not a union");
      const undefTag = L.armTag(codeType.unionId, UNDEFINED_T);
      const read: IrExpr = { kind: "libCall", fn: "error.code", args: [receiver], type: codeType, loc };
      // typeof === "string" ⇔ the code slot is present (NOT the undefined
      // arm); === "undefined" ⇔ absent. `!==` flips either.
      const isNotUndef = b.text === "string" ? !negated : negated;
      return {
        kind: "unionIsTag",
        unionId: codeType.unionId,
        tag: undefTag,
        ...(isNotUndef ? { negated: true as const } : {}),
        value: read,
        type: BOOL,
        loc,
      };
    }
    return null;
  }

  export function lowerCaughtTypeofTest(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (!ts.isTypeOfExpression(a)) continue;
      const local = L.caughtLocalOf(a.expression);
      if (!local) continue;
      if (!ts.isStringLiteral(b)) {
        L.unsupported(
          "SC1090",
          expr,
          "'typeof' catch-binding tests against non-literal strings",
        );
      }
      if (b.text === "string" || b.text === "number" || b.text === "boolean") {
        return {
          kind: "caughtTest",
          value: { kind: "varRef", localId: local.id, type: CAUGHT, loc },
          test: b.text,
          ...(negated ? { negated: true } : {}),
          type: BOOL,
          loc,
        };
      }
      L.unsupported(
        "SC1090",
        b,
        `'typeof' catch-binding tests against "${b.text}" (only "string"/"number"/"boolean" ` +
          `narrow a catch binding; use 'instanceof' for objects)`,
      );
    }
    return null;
  }

/** The static `typeof` answer for a union ARM's IR type, or null when the
   * arm has no fixed answer. Unit arms are known (`typeof undefined` is
   * "undefined", `typeof null` is "object" — JS's oldest wart, preserved
   * exactly); every ref kind is a JS object ("object"), func arms would be
   * "function" (unions never carry them — defensive), and the jsval/dyn/
   * caught/void/union kinds cannot appear as arms. */
  function typeofAnswer(arm: IrType): string | null {
    switch (arm.kind) {
      case "f64": return "number";
      case "string": return "string";
      case "bool": return "boolean";
      case "undefinedT": return "undefined";
      case "func": return "function";
      case "symbol": return "symbol";
      case "nullT":
      case "array": case "map": case "set": case "regex": case "bytes":
      case "url": case "searchParams": case "stats": case "spawnRes": case "child":
      case "fileHandle":
      case "netServer": case "netSocket": case "httpReq": case "httpRes":
      case "httpClientReq": case "secureCtx": case "fsWatcher":
      case "childStream": case "procStream":
      case "object": case "record": case "promise":
        return "object";
      default:
        return null;
    }
  }

/** ALIASED-TYPEOF narrowing (npm-static JS): the narrows a condition
   * PROVES about typeof-aliased operands when it evaluates to `polarity` —
   * ms's `var type = typeof val; if (type === 'string' && val.length > 0)`
   * shape, which tsc narrows only for CONST aliases. The walk follows the
   * checker's own condition structure: parens, `!`, `&&` under true, `||`
   * under false, and ===/!== leaves against string literals. A leaf
   * qualifies when the alias is a never-reassigned var/let/const local
   * initialized `typeof <param>`, the operand is a never-written
   * identifier PARAMETER of a function containing the test (so `typeof
   * val` is a post-entry constant and the alias can never be stale — the
   * condition itself still lowers as the plain string comparison), the
   * operand's type maps to a union whose arms all have static typeof
   * answers, and EXACTLY ONE arm answers the literal. The result feeds
   * L.narrowingAliases: branch-scoped typeOf overrides, bridged by
   * maybeNarrow's ordinary unionNarrow. */
  export function aliasTypeofNarrows(L: Lowerer, cond: ts.Expression, polarity: boolean): { sym: ts.Symbol; tsArm: ts.Type }[] {
    const out: { sym: ts.Symbol; tsArm: ts.Type }[] = [];
    const strip = (e: ts.Expression): ts.Expression => {
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      return e;
    };
    const walk = (e0: ts.Expression, pol: boolean): void => {
      const e = strip(e0);
      if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
        walk(e.operand, !pol);
        return;
      }
      if (!ts.isBinaryExpression(e)) return;
      const k = e.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken && pol) {
        walk(e.left, true);
        walk(e.right, true);
        return;
      }
      if (k === ts.SyntaxKind.BarBarToken && !pol) {
        walk(e.left, false);
        walk(e.right, false);
        return;
      }
      const positive =
        (k === ts.SyntaxKind.EqualsEqualsEqualsToken && pol) ||
        (k === ts.SyntaxKind.ExclamationEqualsEqualsToken && !pol);
      if (!positive) return;
      const leaf = aliasTypeofArmOf(L, e, strip);
      if (leaf) out.push(leaf);
    };
    if (implicitMonoFile(cond.getSourceFile())) walk(cond, polarity);
    return out;
  }

/** One ===/!== leaf of aliasTypeofNarrows — the qualification battery. */
  function aliasTypeofArmOf(L: Lowerer, e: ts.BinaryExpression,
    strip: (x: ts.Expression) => ts.Expression,): { sym: ts.Symbol; tsArm: ts.Type } | null {
    for (const [a0, b] of [
      [e.left, e.right],
      [e.right, e.left],
    ] as const) {
      if (!ts.isStringLiteral(b)) continue;
      const a = strip(a0);
      if (!ts.isIdentifier(a)) continue;
      const aliasSym = L.resolveValueSymbol(a);
      const aliasDecl = aliasSym ? L.checker.valueDeclarationOf(aliasSym) : undefined;
      if (!aliasSym || !aliasDecl || !ts.isVariableDeclaration(aliasDecl) || aliasDecl.initializer === undefined) continue;
      const init = strip(aliasDecl.initializer);
      if (!ts.isTypeOfExpression(init)) continue;
      const opnd = strip(init.expression);
      if (!ts.isIdentifier(opnd)) continue;
      if (!bindingNeverReassigned(L, aliasSym, aliasDecl)) continue;
      const valSym = L.resolveValueSymbol(opnd);
      const valDecl = valSym ? L.checker.valueDeclarationOf(valSym) : undefined;
      if (!valSym || !valDecl) continue;
      // v1: identifier PARAMETERS only — initialized at function entry,
      // before any alias can capture their typeof.
      if (!ts.isParameter(valDecl) || !ts.isIdentifier(valDecl.name)) continue;
      if (!bindingNeverReassigned(L, valSym, valDecl)) continue;
      const fn = valDecl.parent;
      if (!(e.pos >= fn.pos && e.end <= fn.end)) continue;
      const valT = L.typeOf(opnd); // override-aware: implicit bindings compose
      const mapped = L.mapTypeOf(valT);
      if (mapped?.kind !== "union") continue;
      const def = L.unions.get(mapped.unionId);
      const answers = def?.arms.map(typeofAnswer);
      if (!def || !answers || !answers.every((s): s is string => s !== null)) continue;
      const tags = answers.flatMap((s, i) => (s === b.text ? [i] : []));
      if (tags.length !== 1) continue;
      const arm = def.arms[tags[0]!]!;
      // The checker-side arm: the union part whose (widened) mapping IS
      // the proven IR arm — what typeOf answers inside the branch.
      const parts = valT.isUnionType() ? valT.getTypes() : [valT];
      const tsArm = parts.find((p) => {
        const m = L.mapTypeOf(L.checker.getBaseTypeOfLiteralType(p));
        return m !== null && typeEquals(m, arm);
      });
      if (!tsArm) continue;
      return { sym: valSym, tsArm: L.checker.getBaseTypeOfLiteralType(tsArm) };
    }
    return null;
  }

/** `x.constructor === Uint8Array` / `=== Buffer` (and the `!==` forms) on
   * a bytes<u8> operand — a RUNTIME flavor read, never a fold.
   *
   * The seductive analogy is backwards, and measuring it is what put this
   * rule here rather than a boolLit. `x instanceof Uint8Array` folds from
   * the static type EXACTLY because a Buffer *is* instanceof Uint8Array:
   * the test joins the two spellings, so one representation answers both.
   * `.constructor` is the one question that SEPARATES them, which is
   * precisely the distinction one representation erased. Folding it from
   * the checker's type answers TRUE for every Buffer that arrives through
   * a Uint8Array-typed slot — and on the QR path nearly every caller does
   * exactly that (`createHash().digest()`, `createHmac().digest()`,
   * `diffieHellman()` all hand Node a Buffer into a `Uint8Array`
   * parameter). Content and aliasing agreed there; identity did not, and
   * an identity-only divergence is still a wrong value, produced silently
   * inside the funnel every crypto result passes through.
   *
   * So the answer comes from the VALUE: bytes.isBuffer reads the flavor
   * its producer stamped. A value whose producer never classified it
   * REFUSES at this read instead of guessing (nodes.ts, bytes.isBuffer).
   *
   * u8 ONLY, and only against these two names. Every other elem names
   * exactly one constructor, so `u32.constructor === Uint32Array` is a
   * static question — a fold with no measured demand, and this site has
   * already shown what an unmeasured fold costs. It keeps the fence. */
  function lowerBytesCtorTest(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (!ts.isPropertyAccessExpression(a) || a.name.text !== "constructor" || a.questionDotToken) continue;
      if (!ts.isIdentifier(b)) continue;
      const rSym = L.resolveValueSymbol(b);
      if (!rSym || !L.isStdlibSymbol(rSym)) continue;
      const wantBuffer = rSym.name === "Buffer" ? true : rSym.name === "Uint8Array" ? false : null;
      if (wantBuffer === null) continue;
      // The CHECKER's type decides only whether this rule applies at all
      // — never what the answer is. A receiver it cannot call bytes<u8>
      // keeps the stdlib-member fence, so this can turn a fence into a
      // lowering and can never re-answer one.
      const recvIr = L.mapTypeOf(L.typeOf(a.expression));
      if (recvIr?.kind !== "bytes" || recvIr.elem !== "u8") continue;
      const value = L.lowerExpr(a.expression);
      if (value.type.kind !== "bytes" || value.type.elem !== "u8") continue;
      // The refusal an UNCLASSIFIED value raises names this READ, so the
      // unstamped producer is findable from the message. Deliberately NOT
      // the `[SCxxxx at ...]` bracket form: that spelling is a compile
      // fence's, it is what every trap count greps for, and this is a
      // runtime condition, not a refused lowering.
      const line = a.expression.getSourceFile().getLineAndCharacterOfPosition(a.expression.getStart()).line + 1;
      const why: IrExpr = {
        kind: "strLit",
        value: `${rSym.name} at ${loc.file}:${line}`,
        type: STRING,
        loc,
      };
      const isBuf: IrExpr = { kind: "libCall", fn: "bytes.isBuffer", args: [value, why], type: BOOL, loc };
      // `=== Uint8Array` is the NEGATION of Buffer-ness, `=== Buffer` is
      // Buffer-ness itself; `!==` flips whichever it was.
      return wantBuffer === negated
        ? { kind: "unary", op: "!", operand: isBuf, type: BOOL, loc }
        : isBuf;
    }
    return null;
  }

/** `typeof v === "lit"` / `typeof v !== "lit"` where v is UNION-typed: the
   * arms whose static typeof answer equals the literal form a tag set, and
   * the test is a runtime tag test — one `unionIsTag` for a single matching
   * arm (the operand embeds once, so even effectful operands compose), a
   * short-circuit chain for several (pure reads only — the operand rides
   * every test, exactly the `== null` composition rule). When every arm
   * answers the same way the comparison is statically decided and folds to
   * a bool literal — dropping only a side-effect-free read, the same
   * trust-the-checker bet as lowerUnitComparison. tsc's control-flow
   * narrowing then types the branches, and reads bridge through
   * maybeNarrow's unionNarrow as usual. Null when neither side is a typeof
   * over a union-typed operand or the literal side isn't a literal (the
   * bare-typeof value form then composes with strEq for pure operands). */
  export function lowerUnionTypeofTest(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (!ts.isTypeOfExpression(a)) continue;
      if (L.mapTypeOf(L.typeOf(a.expression))?.kind !== "union") continue;
      if (!ts.isStringLiteral(b)) continue; // bare-typeof + strEq handles pure operands
      const value = L.lowerExpr(a.expression);
      if (value.type.kind !== "union") continue; // defensive: an already-narrowed use
      const unionId = value.type.unionId;
      const def = L.unions.get(unionId);
      const answers = def?.arms.map(typeofAnswer);
      if (!def || !answers || !answers.every((s): s is string => s !== null)) continue;
      const tags = answers.flatMap((s, i) => (s === b.text ? [i] : []));
      if (tags.length === 0 || tags.length === def.arms.length) {
        if (!pureReemittable(value)) {
          L.unsupported(
            "SC1090",
            expr,
            "statically-decided 'typeof' tests over effectful operands (bind the value to a const first)",
          );
        }
        return { kind: "boolLit", value: (tags.length !== 0) !== negated, type: BOOL, loc };
      }
      const isTag = (tag: number): IrExpr => ({
        kind: "unionIsTag", unionId, tag, negated, value, type: BOOL, loc,
      });
      if (tags.length === 1) return isTag(tags[0]!);
      if (!pureReemittable(value)) {
        L.unsupported(
          "SC1090",
          expr,
          "'typeof' tests matching several union arms over operands that aren't plain reads (bind the value to a const first)",
        );
      }
      // Tag-in-set as a short-circuit chain (De Morgan for `!==`).
      let acc = isTag(tags[0]!);
      for (const t of tags.slice(1)) {
        acc = { kind: "logical", op: negated ? "&&" : "||", left: acc, right: isTag(t), type: BOOL, loc };
      }
      return acc;
    }
    return null;
  }

/** `typeof v === "lit"` / `typeof v !== "lit"` where v is `unknown`-typed
   * (dyn): the runtime kind test over the dyn node's tag. Only the kinds a
   * later read can bridge narrow ("string"/"number"/"boolean") plus
   * "undefined" (no payload to read); "object"/"function" tests keep the
   * fence — an object-narrowed `unknown` read has no lowering anyway (a
   * checked cast `v as T` is the supported extraction). Null when neither
   * side is a typeof over a dyn-typed operand (not this pattern). */
  export function lowerDynTypeofTest(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    const negated = expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (!ts.isTypeOfExpression(a)) continue;
      const declared = L.mapTypeOf(L.typeOf(a.expression));
      let value: IrExpr;
      if (declared?.kind === "dyn") {
        value = L.lowerExpr(a.expression);
        if (value.type.kind !== "dyn") continue; // defensive: an already-narrowed use
      } else if (L.caughtLocalOf(a.expression)) {
        continue; // the caught lowering's territory (it ran first and declined)
      } else {
        // `typeof (value as T).field === "string"` — the raw-object
        // validation idiom (routes.ts's isValidRoute): the `as` is erasure
        // in JS, so the READ is the dyn KEYED read of the un-cast value —
        // a missing key answers undefined and the guard goes false,
        // Node-exact — never the checked cast (validating T here would
        // throw on exactly the values the guard exists to reject).
        const unparen = (e: ts.Expression): ts.Expression => {
          while (ts.isParenthesizedExpression(e)) e = e.expression;
          return e;
        };
        let keyed: IrExpr | null = null;
        const pn = unparen(a.expression);
        if (ts.isPropertyAccessExpression(pn) && !pn.questionDotToken && ts.isIdentifier(pn.name)) {
          const recv = unparen(pn.expression);
          if (ts.isAsExpression(recv) || ts.isTypeAssertion(recv)) {
            const inner = unparen(recv.expression);
            const obj = probeLower(L, inner);
            if (obj?.type.kind === "dyn") {
              keyed = {
                kind: "dynKeyGet",
                key: { kind: "strLit", value: pn.name.text, type: STRING, loc },
                value: obj,
                type: DYN,
                loc,
              };
            }
          }
        }
        if (keyed) {
          value = keyed;
        } else {
          // A narrowing residue of `unknown`: a `!== undefined` (or truthy)
          // guard ahead of the typeof test spells the operand `{}`/`{} |
          // null` — no useful static mapping, but the READ is still the dyn
          // value (`if (obj.name !== undefined) { if (typeof obj.name !==
          // "string") ... }`, the validateConfig idiom). Probe the lowering
          // and claim exactly the dyn results; anything else keeps its
          // sibling lowerings and fences untouched.
          const probed = probeLower(L, a.expression);
          if (probed?.type.kind !== "dyn") continue;
          value = probed;
        }
      }
      if (!ts.isStringLiteral(b)) {
        L.unsupported(
          "SC1090",
          expr,
          "'typeof' tests on 'unknown' values against non-literal strings",
        );
      }
      if (b.text === "string" || b.text === "number" || b.text === "boolean" || b.text === "undefined") {
        return {
          kind: "dynTest",
          test: b.text,
          ...(negated ? { negated: true as const } : {}),
          value,
          type: BOOL,
          loc,
        };
      }
      // `typeof v === "object"`: the dyn answers exactly (object, array,
      // bytes, and null kinds — JS's oldest wart preserved). tsc narrows
      // the branch to `object | null`; reads past the narrow take the
      // checked-cast path per site.
      if (b.text === "object") {
        return {
          kind: "dynTest",
          test: "object",
          ...(negated ? { negated: true as const } : {}),
          value,
          type: BOOL,
          loc,
        };
      }
      // `typeof v === "function"`: a REAL runtime test since the checked-dynamic tree's
      // function kind exists (boxed closures — the mustCall guard
      // `if (typeof fn !== 'function') throw` answers honestly).
      if (b.text === "function") {
        return {
          kind: "dynTest",
          test: "function",
          ...(negated ? { negated: true as const } : {}),
          value,
          type: BOOL,
          loc,
        };
      }
      // `typeof v === "bigint"`: a REAL runtime test since SCR_DYN_BIG
      // exists. It used to fold to the constant `false` beside "symbol",
      // on the premise — true when it was written — that no conversion
      // into 'unknown' could produce a bigint.
      //
      // That premise going stale is not a missed optimisation, it is a
      // SILENT WRONG ANSWER, and at the worst possible site: protobufjs's
      // `long` dispatches on exactly this test —
      //
      //     Long.fromValue = (v, u) => typeof v === "bigint"
      //                                  ? Long.fromBigInt(v, u) : ...
      //
      // — so a folded `false` sends a real bigint down the NUMBER branch
      // and decodes it wrong, quietly. The fold is also self-concealing:
      // the reachable arm still compiles, so the program gets greener
      // while getting less correct, and the bare `typeof v` value form a
      // line away kept answering "bigint" the whole time. Two spellings
      // of one question, two answers.
      if (b.text === "bigint") {
        return {
          kind: "dynTest",
          test: "bigint",
          ...(negated ? { negated: true as const } : {}),
          value,
          type: BOOL,
          loc,
        };
      }
      // "symbol" keeps the fold, and keeps it on the ORIGINAL argument:
      // the checked-dynamic tree still has no symbol kind, so no
      // conversion into 'unknown' can produce one and the answer really
      // is a constant. The capability probes this settles then FOLD their
      // impossible arm (lowerTernary), which is what lets the reachable
      // arm compile statically.
      if (b.text === "symbol") {
        return { kind: "boolLit", value: negated, type: BOOL, loc };
      }
      L.unsupported(
        "SC1090",
        b,
        `'typeof' tests against "${b.text}" on 'unknown' values (only "string"/"number"/` +
          `"boolean"/"undefined"/"object" narrow; use a checked cast — 'v as T' — to extract)`,
      );
    }
    return null;
  }

/** `exports.<name>` in a JS module whose `module.exports =` REPLACED the
   * export object, with no `exports.<name> =` attachment anywhere in the
   * file: the read observes the ORIGINAL (empty-here) exports object, so
   * the honest value is undefined (Node's object identity exactly; tsc's
   * CJS model types the read off the replacement — identity-blind). Null
   * everywhere else: no replacement, a real attachment of this name, a
   * shadowing binding named `exports`, or write position. */
  export function lowerReplacedExportsRead(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (expr.questionDotToken) return null;
    const recv = expr.expression;
    if (!ts.isIdentifier(recv) || recv.text !== "exports") return null;
    const sf = expr.getSourceFile();
    if (!isJsSourceFile(sf) || isNodeEsmFile(sf)) return null;
    if (L.peekLocal(recv) || L.globalOf(recv)) return null; // a user binding shadows
    // Write position is the export-assignment machinery's territory.
    if (ts.isBinaryExpression(expr.parent) && expr.parent.left === expr &&
        expr.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return null;
    }
    let replaced = false;
    for (const stmt of sf.statements) {
      const cjs = cjsExportAssignmentOf(stmt);
      if (!cjs) continue;
      if (cjs.kind === "table" && cjsExportDiscardReason(stmt) === null) replaced = true;
      if (cjs.kind === "member" && ts.isIdentifier(cjs.name) && cjs.name.text === expr.name.text) {
        return null; // a real attachment of this name exists somewhere
      }
    }
    if (!replaced) return null;
    return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: locOf(expr) };
  }

/** A read that resolves to a CJS export-table ACCESSOR property
   * (`module.exports = { get path() {...}, set path(v) {...} }`): the
   * getter lifts as a module-level function (module globals need no
   * captures) — interned per declaration so every read site calls ONE
   * function — and the read IS the call, Node's per-read evaluation
   * exactly. Null when the identifier doesn't resolve to such a property
   * (or it has no getter: a setter-only read answers undefined in Node —
   * rare enough to keep fenced). */
  export function cjsExportAccessorRead(L: Lowerer, ident: ts.Identifier): IrExpr | null {
    const symbol = L.resolveValueSymbol(ident);
    const getter = symbol ? L.checker.declarationsOf(symbol).find(ts.isGetAccessorDeclaration) : undefined;
    if (!getter) return null;
    if (!ts.isObjectLiteralExpression(getter.parent) || !isCjsExportTableLiteral(getter.parent)) {
      return null;
    }
    return cjsAccessorCall(L, getter, locOf(ident));
  }

/** The interned lifted-getter call both accessor-read paths share. */
  function cjsAccessorCall(L: Lowerer, getter: ts.GetAccessorDeclaration, loc: SrcLoc): IrExpr | null {
    let fn = L.cjsAccessorFns.get(getter);
    if (!fn) {
      const closure = L.lowerLambda(getter);
      if (closure.kind !== "closure" || closure.type.kind !== "func") return null; // defensive
      fn = { fnName: closure.fnName, type: closure.type };
      L.cjsAccessorFns.set(getter, fn);
    }
    // Lifted functions carry the closure ABI (an env parameter, even
    // capture-free) — the read calls through a zero-capture closure value,
    // the interned identity every lifted lambda uses.
    const closureVal: IrExpr = { kind: "closure", fnName: fn.fnName, captures: [], type: fn.type, loc };
    return { kind: "callValue", callee: closureVal, args: [], type: fn.type.ret, loc };
  }

/** `this.<name>` INSIDE a CJS export-table accessor (test/common's
   * `get localhostIPv4() { if (this.inFreeBSDJail) ... }`): Node binds the
   * getter's receiver to module.exports, so the read is the SIBLING table
   * property — a sibling GETTER's lifted call (per-read evaluation, like
   * any accessor read). Only arrows inherit the binding (a nested function
   * expression's `this` is its own). Null everywhere else — non-getter
   * siblings and absent names keep their per-site fences (none of the
   * probed suite shapes read them). */
  export function lowerCjsExportTableThisMember(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (expr.expression.kind !== ts.SyntaxKind.ThisKeyword || expr.questionDotToken) return null;
    if (!isJsSourceFile(expr.getSourceFile())) return null;
    // The enclosing accessor, crossing only arrow boundaries (arrows
    // inherit `this`; any other function form rebinds it).
    let n: ts.Node = expr.parent;
    while (n !== undefined && !ts.isGetAccessorDeclaration(n) && !ts.isSetAccessorDeclaration(n)) {
      if (ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return null;
      if (ts.isSourceFile(n)) return null;
      n = n.parent;
    }
    if (n === undefined || !ts.isObjectLiteralExpression(n.parent) || !isCjsExportTableLiteral(n.parent)) {
      return null;
    }
    const sibling = n.parent.properties.find(
      (p): p is ts.GetAccessorDeclaration =>
        ts.isGetAccessorDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === expr.name.text,
    );
    if (!sibling) return null;
    return cjsAccessorCall(L, sibling, locOf(expr));
  }

/** Lowers an expression, converting a fence (PoisonError) into a null
   * DECLINE — the probing dispatch for shapes where only the lowered
   * value's type can say whether a lowering applies. unsupported() pushes
   * its diagnostic BEFORE throwing, so the probe runs behind a diagnostic
   * sink: a declined probe's diagnostics vanish (the sibling lowerings
   * own the site), a successful probe's flush through afterwards. */
  export function probeLower(L: Lowerer, node: ts.Expression): IrExpr | null {
    const saved = L.diagSink;
    const captured: typeof L.diags = [];
    L.diagSink = captured;
    let result: IrExpr | null;
    try {
      result = L.lowerExpr(node);
    } catch (e) {
      if (e instanceof PoisonError) {
        L.diagSink = saved;
        return null;
      }
      L.diagSink = saved;
      throw e;
    }
    L.diagSink = saved;
    for (const d of captured) L.pushDiag(d);
    return result;
  }

/** A read of a catch binding — the caught analog of maybeNarrow. Where
   * tsc's control-flow narrowing has proven a supported test (`instanceof`
   * over a hierarchy class, `typeof` over a primitive), the read bridges
   * with a kind-unchecked `caughtNarrow` extraction (trust-the-checker,
   * exactly like unionNarrow). Every OTHER read is the narrowness fence:
   * the binding's payload is a typed exception snapshot, not a dyn, so
   * un-narrowed uses have nothing sound to lower to. */
  export function caughtRead(L: Lowerer, node: ts.Identifier, local: IrLocal, loc: SrcLoc): IrExpr {
    const ref: IrExpr = { kind: "varRef", localId: local.id, type: CAUGHT, loc };
    const narrowed = L.mapTypeOf(L.typeOf(node));
    if (
      narrowed &&
      (narrowed.kind === "f64" || narrowed.kind === "bool" || narrowed.kind === "string")
    ) {
      return { kind: "caughtNarrow", value: ref, type: narrowed, loc };
    }
    if (narrowed?.kind === "object") {
      const info = L.classes.get(narrowed.className);
      if (info && L.inHierarchy(info)) {
        return { kind: "caughtNarrow", value: ref, type: narrowed, loc };
      }
    }
    // An UN-narrowed use — the occurrence still types `unknown` — converts
    // to a dyn value (`options.onError?.(error)` — the caught snapshot
    // flowing into an unknown slot): the typed→unknown deep-copy stance
    // extended to exception payloads. Error payloads keep their
    // observability (instanceof Error / .message / String() — the checked-dynamic tree's
    // error encoding); other object payloads are type-erased at runtime and
    // convert to the "[object Object]" approximation — SEMANTICS.md 67.
    // `any` is the same un-narrowed use wearing the other spelling, and it
    // is the one the REJECTION handlers wear: the lib types
    // `.catch(onrejected)` as `(reason: any) => …`, so the payload of
    // `p.catch((e) => report(e))` arrives as `any` where the payload of
    // `try { … } catch (e)` arrives as `unknown`. Neither has been
    // narrowed, and the conversion is the same one, so refusing the second
    // spelling only refuses the rejection half of the same idiom.
    if (narrowed?.kind === "dyn" || (L.typeOf(node).flags & ts.TypeFlags.Any) !== 0) {
      return { kind: "caughtToDyn", value: ref, type: DYN, loc };
    }
    L.unsupported("SC1063", node);
  }

/** `String(e)` / `${e}` where e is a catch binding: JS's String() over
   * the exception snapshot (scr_caught_to_string) — the one un-narrowed
   * read with a sound rendering for every payload kind. Intercepts BEFORE
   * lowerExpr like the other caught lowerings (caughtRead would fence).
   * Null when the expression isn't a catch binding. */
  export function caughtToString(L: Lowerer, node: ts.Expression): IrExpr | null {
    const local = L.caughtLocalOf(node);
    if (!local) return null;
    const loc = locOf(node);
    return {
      kind: "toString",
      operand: { kind: "varRef", localId: local.id, type: CAUGHT, loc },
      type: STRING,
      loc,
    };
  }

/** The catch-binding local an expression names, or null. The dedicated
   * lowerings (instanceof, typeof tests, rethrow) intercept on this BEFORE
   * lowering the operand — a raw lowerExpr of the identifier would hit
   * caughtRead's fence. */
  export function caughtLocalOf(L: Lowerer, node: ts.Expression): IrLocal | null {
    if (!ts.isIdentifier(node)) return null;
    const local = L.resolveLocal(node);
    return local?.type.kind === "caught" ? local : null;
  }

/** `x instanceof C` for a program-declared class C. When x's static
   * class and C are both in extends-hierarchies the test is dynamic — the
   * O(1) preorder-interval check against the vtable (`instanceOf` node).
   * Everything else is decided by the static class graph alone and folds
   * to the honest constant: `x instanceof C` is always true when x's
   * static class IS C or descends from it, and always false when the
   * classes are unrelated (a standalone class has no other relatives).
   * Folding is limited to side-effect-free operands — dropping a computed
   * operand would skip its effects, so those are rejected instead. */
  export function lowerInstanceOf(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr {
    // `x instanceof net.Socket` over a union with a netSocket arm — the
    // h2 compat 'connect' narrowing (lower-server.ts): a union tag test.
    const sockTest = lowerSocketInstanceOf(L, expr, loc);
    if (sockTest !== null) return sockTest;
    // An ISLAND class as the RHS (`v instanceof Boom` on a package-
    // exported class — the safeParse-style error narrowing): the spec's
    // InstanceofOperator runs in the engine (Symbol.hasInstance included;
    // a non-object RHS throws the engine's own TypeError, catchably).
    // The LHS marshals in — island handles pass through, static
    // primitives answer false exactly like the spec's non-object rule,
    // and unmarshalable statics (class instances, catch bindings — the
    // payload is a name/message snapshot, never the engine object) keep
    // jsvalIn's honest fences.
    if (L.isIslandExpr(expr.right) && !L.caughtLocalOf(expr.left)) {
      const left = L.jsvalIn(L.lowerExpr(expr.left), expr.left);
      const right = L.lowerExpr(expr.right);
      return { kind: "jsOp", op: "instanceOf", args: [left, right], type: BOOL, loc };
    }
    const rhsSymbol = ts.isIdentifier(expr.right) ? L.resolveValueSymbol(expr.right) : null;
    // `x instanceof events.EventEmitter` — the namespace-member spelling
    // resolves to the same ambient class as the named import.
    const rhsMemberSymbol = (() => {
      if (!ts.isPropertyAccessExpression(expr.right) || !ts.isIdentifier(expr.right.name)) return null;
      const sym = L.checker.getSymbolAtLocation(expr.right.name);
      return sym && sym.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(sym) : (sym ?? null);
    })();
    // `x instanceof N.C` — the USER-namespace-qualified spelling: the
    // member resolves to the registered program class, with the
    // source-order guard (an init-position test above the class's block
    // would read an uninitialized member in Node).
    const rhsNsClass = (() => {
      if (!ts.isPropertyAccessExpression(expr.right)) return undefined;
      const nsMember = nsMemberIdentOf(L, expr.right);
      if (!nsMember) return undefined;
      const memberSym = L.checker.getSymbolAtLocation(nsMember);
      if (memberSym) fenceEarlyNsMemberRef(L, expr.right, memberSym);
      const classSym = L.resolveValueSymbol(nsMember);
      const nsInfo = classSym ? L.classBySymbol.get(classSym) : undefined;
      // Qualified spellings of a rebindable decorated class (import=
      // alias chains) must not fold against the declaration — the
      // decoration result decides at runtime.
      return nsInfo?.classDecorators?.valueGlobalId !== undefined ? undefined : nsInfo;
    })();
    // A rebindable decorated name as the RHS: the runtime target is the
    // decoration result — fall to the class-VALUE path below, whose
    // instanceOfValue reads the interval off the bound class object.
    const directRhs = rhsSymbol ? L.classBySymbol.get(rhsSymbol) : undefined;
    const target =
      (directRhs?.classDecorators?.valueGlobalId !== undefined ? undefined : directRhs) ??
      rhsNsClass ??
      L.builtinErrorInfoOf(rhsSymbol) ??
      L.builtinEmitterInfoOf(rhsSymbol) ??
      L.builtinEmitterInfoOf(rhsMemberSymbol) ??
      L.builtinStreamInfoOf(rhsSymbol) ??
      L.builtinStreamInfoOf(rhsMemberSymbol) ??
      undefined;
    if (!target) {
      // `u instanceof Uint8Array` on an `unknown` value: the checked-dynamic tree carries a
      // bytes kind — one runtime tag test, and tsc's narrowing types the
      // true branch (reads bridge through maybeNarrow's validated
      // extraction, like the typeof tests). Node's Buffer IS a Uint8Array
      // subclass and rides the same bytes kind, so both worlds answer true
      // for Buffer payloads — Node-exact (the bytes kind's other
      // divergences are SEMANTICS.md 45). Catch bindings stay out (their
      // payload is a typed snapshot, not a dyn).
      if (
        ts.isIdentifier(expr.right) &&
        L.isStdlibGlobal(expr.right, "Uint8Array") &&
        !L.caughtLocalOf(expr.left)
      ) {
        const left = L.lowerExpr(expr.left);
        if (left.type.kind === "dyn") {
          return { kind: "dynTest", test: "bytes", value: left, type: BOOL, loc };
        }
      }
      // `u instanceof ArrayBuffer` on an `unknown` value: the SIBLING of
      // the Uint8Array test above, and it has to be written HERE or the
      // line above answers for both.
      //
      // The checked-dynamic tree does carry the flavor: `bytes<buf>` boxes
      // into SCR_DYN_ARRBUF, its own kind, exactly so an ArrayBuffer
      // cannot match a Uint8Array arm (DYN_BYTES_KINDS, and dynMatch's
      // note calls that split "the sharpest hazard in the whole change").
      // So the test is one kind compare, the same shape as `"bytes"`, and
      // tsc's narrowing types the true branch — reads bridge through
      // maybeNarrow's validated extraction (scr_dyn_arrbuf_unbox), which
      // hands back the SAME payload so a view taken after the narrow
      // still aliases the buffer.
      //
      // The idiom this unblocks is the one every WebSocket message
      // handler writes:
      //
      //     if (data instanceof Uint8Array) return data
      //     if (data instanceof ArrayBuffer) return toBytesView(data)
      //
      // over a `data: unknown`. While this arm was missing, the refusal
      // landed on the SECOND line and the first line decided the dispatch
      // alone — and it is not a refusal a program ever reaches, because
      // control only arrives there when the Uint8Array test said false.
      if (
        ts.isIdentifier(expr.right) &&
        L.isStdlibGlobal(expr.right, "ArrayBuffer") &&
        !L.caughtLocalOf(expr.left)
      ) {
        const left = L.lowerExpr(expr.left);
        if (left.type.kind === "dyn") {
          return { kind: "dynTest", test: "arraybuffer", value: left, type: BOOL, loc };
        }
      }
      // `x instanceof RegExp` over a union with a regex arm (the
      // skip-utility `string | RegExp` dispatch): a union tag test — the
      // socket-narrowing shape; the checker types the branches and
      // maybeNarrow bridges the reads. A plain regex-typed LHS folds
      // true; the fold keeps the operand-purity rule of the class folds
      // (identifier reads only).
      if (
        ts.isIdentifier(expr.right) &&
        L.isStdlibGlobal(expr.right, "RegExp") &&
        !L.caughtLocalOf(expr.left)
      ) {
        const left = L.lowerExpr(expr.left);
        if (left.type.kind === "union") {
          const def = L.unions.get(left.type.unionId);
          const tag = def ? def.arms.findIndex((a) => a.kind === "regex") : -1;
          if (tag >= 0) {
            return { kind: "unionIsTag", unionId: left.type.unionId, tag, negated: false, value: left, type: BOOL, loc };
          }
        }
        if (left.type.kind === "regex" && left.kind === "varRef" && ts.isIdentifier(expr.left)) {
          return { kind: "boolLit", value: true, type: BOOL, loc };
        }
      }
      // `x instanceof X` where X is a class VALUE (a classval-typed
      // binding): the target is DYNAMIC — a hierarchy target reads its
      // interval from the class object at runtime (instanceOfValue); a
      // STANDALONE target class has exactly one possible runtime value
      // (itself — no descendants can flow into the slot), so the answer
      // folds statically exactly like the named-target folds below.
      const rhsClassval = L.mapTypeOf(L.typeOf(expr.right));
      if (rhsClassval?.kind === "classval" && !L.caughtLocalOf(expr.left)) {
        const targetInfo = L.classes.get(rhsClassval.className);
        if (!targetInfo) {
          // The type world names a class the lowering never registered
          // (a fenced class expression, a deferred declaration): flush
          // its diagnostics and poison the test site, never an ICE.
          L.flushDeferredClass(rhsClassval.className);
          L.unsupported(
            "SC1090",
            expr,
            "'instanceof' against a class value whose class has no lowering (the class declaration itself was rejected — see its own diagnostic)",
          );
        }
        const left = L.lowerExpr(expr.left);
        if (left.type.kind !== "object") {
          L.unsupported(
            "SC1090",
            expr,
            "'instanceof' on values other than class instances (narrow union-typed values first)",
          );
        }
        const lhsInfo = L.classes.get(left.type.className);
        if (!lhsInfo) throw new Error(`lowerer bug: unknown class ${left.type.className}`);
        if (L.inHierarchy(targetInfo) && L.inHierarchy(lhsInfo)) {
          const classValue = L.lowerExpr(expr.right);
          if (classValue.type.kind !== "classval") L.badType(expr.right, L.typeOf(expr.right));
          return { kind: "instanceOfValue", value: left, classValue, type: BOOL, loc };
        }
        // A standalone side: the answer is static (the target slot can
        // only hold the named class; a standalone operand's runtime class
        // IS its static class). Folding discards the operands' evaluation,
        // so only side-effect-free shapes fold — the named-target rule.
        const value =
          left.type.className === targetInfo.def.name ||
          L.isSubclassOf(left.type.className, targetInfo.def.name);
        if (left.kind === "varRef" && (ts.isIdentifier(expr.right) || expr.right.kind === ts.SyntaxKind.ThisKeyword)) {
          return { kind: "boolLit", value, type: BOOL, loc };
        }
        L.unsupported(
          "SC1090",
          expr,
          "statically-decided 'instanceof' on computed operands (bind the values to variables first)",
        );
      }
      // `x instanceof Uint8Array` / `instanceof ArrayBuffer` -- the test
      // that DISCRIMINATES a `string | ArrayBuffer | Uint8Array` slot, and
      // the reason those map to distinct bytes flavors in the first place.
      //
      // The runtime answer is the union TAG: each flavor is its own arm, so
      // the test is which arm the value carries. A non-union operand
      // decides statically -- its type IS the answer -- and folds only for
      // an operand whose evaluation can be dropped, the same rule the
      // class-target fold uses.
      {
        const rSym = ts.isIdentifier(expr.right) ? L.resolveValueSymbol(expr.right) : null;
        const want =
          rSym && L.isStdlibSymbol(rSym)
            ? rSym.name === "ArrayBuffer"
              ? ("buf" as const)
              : own(BYTES_CTORS, rSym.name)
            : undefined;
        if (want !== undefined) {
          const left = L.lowerExpr(expr.left);
          if (left.type.kind === "union") {
            const def = L.unions.get(left.type.unionId);
            const tag = (def?.arms ?? []).findIndex(
              (a) => a.kind === "bytes" && a.elem === want,
            );
            if (tag >= 0) {
              return {
                kind: "unionIsTag",
                unionId: left.type.unionId,
                tag,
                negated: false,
                value: left,
                type: BOOL,
                loc,
              };
            }
            // No such arm: the checker already knows the answer is false,
            // and the operand still has to evaluate.
            L.unsupported(
              "SC1090",
              expr,
              `'instanceof ${rSym!.name}' on a union with no ${rSym!.name} arm (the answer is constantly false — drop the test)`,
            );
          }
          // A NARROWED operand is the checker's arm bridge over the read,
          // not a bare varRef -- `data instanceof ArrayBuffer` after the
          // other arms are ruled out is exactly that. Both are pure reads,
          // so folding drops no evaluation. Folding also drops the
          // bridge's tag CHECK, which is sound here for the same reason
          // the fold is: the bridge's arm is the one the constant answers
          // for, so a value that would fail the check is a value whose
          // enclosing narrowing already misread it.
          const pureRead =
            left.kind === "varRef" ||
            (left.kind === "unionNarrow" && left.value.kind === "varRef") ||
            narrowBridgeArm(left)?.kind === "varRef";
          if (left.type.kind === "bytes" && pureRead) {
            return { kind: "boolLit", value: left.type.elem === want, type: BOOL, loc };
          }
          L.unsupported(
            "SC1090",
            expr,
            `'instanceof ${rSym!.name}' on this operand (supported: a union carrying the flavor as an arm, or a bound value of a bytes type — an 'unknown' operand needs a runtime flavor test the checked-dynamic tree does not carry yet: it tags bytes as one kind, and only Uint8Array reads that tag)`,
          );
        }
      }
      // `x instanceof String` / `Number` / `Boolean` — the BOXED WRAPPER
      // test, and the answer is a constant because the constructor that
      // would make it true has no lowering.
      //
      // `new String(…)`, `new Number(…)` and `new Boolean(…)` are refused
      // by name in lower-classes ("boxed wrapper objects have no lowering
      // — use the string primitive"), everywhere except a ToString span
      // where the wrapper immediately collapses to its primitive. So no
      // wrapper OBJECT exists anywhere in a compiled program, and for
      // every value a compiled program CAN produce — primitive, record,
      // class instance, dyn — Node answers false too. That is what makes
      // this Node-exact rather than a widening: the constant is licensed
      // by the constructor fence, and if that fence ever lifts, this arm
      // has to lift with it.
      //
      // The idiom this unblocks is protobufjs's `util.isString`:
      // `typeof e === "string" || e instanceof String`, which the Writer
      // evaluates for EVERY bytes field it encodes — the first thing
      // zapo's noise handshake reaches once the codec is bound.
      //
      // Folding drops the operand's evaluation, so it is restricted to a
      // pure read, the same rule the class-target and bytes-flavor folds
      // above use. A catch binding stays out: its payload is a typed
      // snapshot handled below.
      if (
        ts.isIdentifier(expr.right) &&
        (L.isStdlibGlobal(expr.right, "String") ||
          L.isStdlibGlobal(expr.right, "Number") ||
          L.isStdlibGlobal(expr.right, "Boolean")) &&
        !L.caughtLocalOf(expr.left)
      ) {
        const wrapper = expr.right.text;
        const left = L.lowerExpr(expr.left);
        const pureRead =
          left.kind === "varRef" ||
          (left.kind === "unionNarrow" && left.value.kind === "varRef") ||
          narrowBridgeArm(left)?.kind === "varRef";
        if (pureRead) return { kind: "boolLit", value: false, type: BOOL, loc };
        L.unsupported(
          "SC1090",
          expr,
          `'instanceof ${wrapper}' on a computed operand (bind it to a variable first — no boxed ${wrapper} object can exist, because 'new ${wrapper}(…)' has no lowering, so the answer is constantly false; the operand still has to evaluate)`,
        );
      }
      // `x instanceof Klass` where Klass is a plain FUNCTION value in a
      // JavaScript file — the completion of the pre-class constructor
      // idiom: `new Klass()` links the instance to `Klass.prototype`, and
      // this is the operator that reads that link back. The runtime walks
      // the left operand's [[Prototype]] chain looking for the SAME
      // object `Klass.prototype` answers (JS's OrdinaryHasInstance is
      // pointer identity on the prototype object, not a name or a shape
      // match), so it answers false — never throws — for every dyn value
      // that was not constructed here, which is Node's answer too.
      //
      // JavaScript only and last, like the `new` arm it completes: every
      // typed instanceof above already claimed its shape, so this can
      // only turn a refusal into a lowering.
      if (isJsSourceFile(expr.getSourceFile())) {
        // The two spellings the `new` arm takes: a receiver that already
        // lowers dyn (an expando-typed module binding) is the box; a
        // func-typed one goes through the shared per-use box.
        const probedCtor = probeLower(L, expr.right);
        const ctorBox =
          probedCtor !== null && probedCtor.type.kind === "dyn"
            ? probedCtor
            : fnOwnPropBox(L, expr.right, loc);
        if (ctorBox) {
          const value = L.lowerExprExpecting(expr.left, DYN);
          if (value.type.kind === "dyn") {
            return {
              kind: "libCall",
              fn: "dyn.instanceOf",
              args: [value, ctorBox],
              type: BOOL,
              loc,
            };
          }
        }
      }
      L.unsupported(
        "SC1090",
        expr.right,
        "'instanceof' right-hand sides other than classes declared in the program",
      );
    }
    // A catch binding on the left: the runtime test against the class's
    // preorder interval (false for non-hierarchy-object payloads). tsc's
    // narrowing then types the branches; reads bridge through caughtRead.
    const caughtLocal = L.caughtLocalOf(expr.left);
    if (caughtLocal) {
      if (!L.inHierarchy(target)) {
        L.unsupported(
          "SC1090",
          expr,
          `'instanceof' on a catch binding against the standalone class '${target.def.name}' ` +
            `(only classes in extends hierarchies carry the vtable the payload test needs)`,
        );
      }
      return {
        kind: "caughtTest",
        value: { kind: "varRef", localId: caughtLocal.id, type: CAUGHT, loc },
        test: "instanceof",
        className: target.def.name,
        type: BOOL,
        loc,
      };
    }
    const left = L.lowerExpr(expr.left);
    // `u instanceof Error` on an `unknown` value: the checked-dynamic tree's error encoding
    // (the shape caughtToDyn builds for Error payloads — the reserved
    // "%error" marker) answers the test, so a caught Error passed through
    // an unknown slot narrows like Node (`error instanceof Error ?
    // error.message : String(error)` — the LAN-monitor handler). ROOT
    // only: the marker cannot honestly answer subclass prototype chains
    // (name strings are user-writable), so `u instanceof TypeError` keeps
    // the fence. Reads past the narrow bridge through maybeNarrow's
    // validated %Error extraction. SEMANTICS.md 67.
    if (left.type.kind === "dyn" && target.def.name === "%Error") {
      return { kind: "dynTest", test: "error", value: left, type: BOOL, loc };
    }
    // `u instanceof TypeError` (and the other BUILTIN error classes) on a
    // dyn value: the from_error cache holds the checked-dynamic tree↔error identity edge,
    // so the runtime resolves the encoding back to its error and asks the
    // vtable's stamped interval — exact for every error that crossed the
    // boundary (a hand-built {%error} literal answers false: subclass
    // identity is unknowable there). User subclasses keep the fence.
    if (left.type.kind === "dyn" && RUNTIME_ERROR_CLASSES.has(target.def.name)) {
      const rec = RUNTIME_ERROR_CLASSES.get(target.def.name)!;
      return {
        kind: "libCall",
        fn: "dyn.errInstanceof",
        args: [left, { kind: "numLit", value: rec.kind, type: F64, loc }],
        type: BOOL,
        loc,
      };
    }
    if (left.type.kind === "dyn") {
      L.unsupported(
        "SC1090",
        expr,
        `'instanceof ${target.def.name.replace(/^%/, "")}' on 'unknown' values (only the Error classes answer — test 'instanceof Error' and read '.name')`,
      );
    }
    if (left.type.kind !== "object") {
      L.unsupported(
        "SC1090",
        expr,
        "'instanceof' on values other than class instances (narrow union-typed values first)",
      );
    }
    const lhsInfo = L.classes.get(left.type.className);
    if (!lhsInfo) throw new Error(`lowerer bug: unknown class ${left.type.className}`);
    if (L.inHierarchy(lhsInfo) && L.inHierarchy(target)) {
      // The plain interval test everywhere except `instanceof
      // Writable`, where Node's own Symbol.hasInstance also admits the
      // Duplex subtree — main answers `false` for `new PassThrough()
      // instanceof Writable`, which Node calls true. See
      // streamInstanceOfExpr.
      return streamInstanceOfExpr(L, left, target.def.name, loc);
    }
    const value =
      left.type.className === target.def.name ||
      L.isSubclassOf(left.type.className, target.def.name);
    if (left.kind === "varRef") {
      return { kind: "boolLit", value, type: BOOL, loc };
    }
    L.unsupported(
      "SC1090",
      expr,
      "statically-decided 'instanceof' on computed operands (bind the value to a variable first)",
    );
  }

/** `#name in obj` — the ergonomic brand check. In this closed world a
   * brand is held by exactly the instances of the declaring class
   * (subclasses included — construction always runs the declaring class's
   * own initializers), so the test IS `obj instanceof <declaring class>`:
   * statically decided when the receiver's class sits at/below the
   * declarer (true) or in a disjoint subtree (false) — both folds under
   * the instanceof purity rule — and a runtime interval test when the
   * declarer sits strictly BELOW the receiver's static class (the
   * narrowing use; tsc types the true branch at the class, and reads
   * bridge through maybeNarrow's downcast exactly like instanceof). tsc
   * confines the spelling to the declaring class's body and rejects
   * primitive/unknown receivers, so Node's in-operator TypeError is
   * unreachable in compilable programs. Timing residue: JS installs
   * brands DURING construction, so a check reachable from a base
   * constructor can observe false mid-construction where this answers
   * true (SEMANTICS.md). */
  function lowerPrivateIn(L: Lowerer, expr: ts.BinaryExpression, priv: ts.PrivateIdentifier, loc: SrcLoc): IrExpr {
    const pname = priv.text;
    // The declaring class: the nearest enclosing class declaring the name
    // (JS scoping — an inner class's spelling shadows an outer one's).
    let classDecl: ts.ClassLikeDeclaration | null = null;
    let staticBrand = false;
    for (let n: ts.Node | undefined = priv.parent; n; n = n.parent) {
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
        const owner = n.members.find((m) => {
          const name = (m as { name?: ts.PropertyName }).name;
          return name !== undefined && ts.isPrivateIdentifier(name) && name.text === pname;
        });
        if (owner) {
          classDecl = n;
          staticBrand =
            ts.canHaveModifiers(owner) &&
            ts.getModifiers(owner)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) === true;
          break;
        }
      }
    }
    // tsc rejects the spelling outside a declaring class body; defensive.
    if (!classDecl) L.unsupported("SC1090", expr, `'${pname} in …' outside a class declaring '${pname}'`);
    if (staticBrand) {
      L.unsupported(
        "SC1090",
        expr,
        `'${pname} in …' brand checks for private STATICS (JS brands the declaring class OBJECT, not instances — compare against the class value directly)`,
      );
    }
    const info =
      L.currentClass?.decl === classDecl
        ? L.currentClass
        : (() => {
            const sym = classDecl.name ? L.checker.getSymbolAtLocation(classDecl.name) : undefined;
            return sym ? L.classBySymbol.get(sym) : undefined;
          })();
    if (!info) {
      L.unsupported(
        "SC1090",
        expr,
        `'${pname} in …' where the declaring class has no lowering (see the class declaration's own diagnostic)`,
      );
    }
    // A GENERIC family: JS has ONE runtime class and ONE brand for every
    // instantiation, while these layouts mint one class per instantiation
    // — a cross-instantiation check would answer false where Node says
    // true, so the family fences rather than silently splitting the brand.
    if (info.generic || info.genericInstance) {
      L.unsupported(
        "SC1090",
        expr,
        `'${pname} in …' inside a generic class (JS shares one brand across every instantiation; these layouts mint one class per instantiation)`,
      );
    }
    const recv = L.lowerExpr(expr.right);
    const declName = info.def.name;
    // A UNION of class instances (`o: Counter | Helper` — the
    // discriminating use): every object arm answers membership STATICALLY
    // (at/below the declarer → true, disjoint subtree → false), so the
    // whole test collapses to runtime TAG tests — the record-shape 'in'
    // discrimination, brand form. An arm ABOVE the declarer answers per
    // VALUE (its slot can hold branded and unbranded instances), and
    // non-object arms have no brand story — both fence.
    if (recv.type.kind === "union") {
      const unionId = recv.type.unionId;
      const arms = L.unions.get(unionId)?.arms ?? [];
      const answers: { tag: number; has: boolean }[] = [];
      let staticAnswers = arms.length > 0;
      for (const arm of arms) {
        const tag = L.armTag(unionId, arm);
        if (tag < 0 || arm.kind !== "object" || L.isSubclassOf(declName, arm.className)) {
          staticAnswers = false;
          break;
        }
        answers.push({ tag, has: arm.className === declName || L.isSubclassOf(arm.className, declName) });
      }
      if (staticAnswers) {
        const pureRecv = recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet";
        const isTag = (tag: number, negated: boolean): IrExpr => ({
          kind: "unionIsTag",
          unionId,
          tag,
          negated,
          value: recv,
          type: BOOL,
          loc,
        });
        const trues = answers.filter((a) => a.has);
        if (trues.length === answers.length || trues.length === 0) {
          const ans = trues.length !== 0;
          if (pureRecv) return { kind: "boolLit", value: ans, type: BOOL, loc };
          // Constant either way, receiver still evaluates once: one tag
          // test whose branches agree (the record-'in' rule verbatim).
          return {
            kind: "ternary",
            cond: isTag(answers[0]!.tag, false),
            then: { kind: "boolLit", value: ans, type: BOOL, loc },
            else_: { kind: "boolLit", value: ans, type: BOOL, loc },
            type: BOOL,
            loc,
          };
        }
        if (trues.length === 1) return isTag(trues[0]!.tag, false);
        const falses = answers.filter((a) => !a.has);
        if (falses.length === 1) return isTag(falses[0]!.tag, true);
        if (pureRecv) {
          let out: IrExpr = isTag(trues[0]!.tag, false);
          for (const t of trues.slice(1)) {
            out = { kind: "logical", op: "||", left: out, right: isTag(t.tag, false), type: BOOL, loc };
          }
          return out;
        }
        L.unsupported(
          "SC1090",
          expr,
          `statically-decided '${pname} in …' on computed receivers (bind the value to a variable first)`,
        );
      }
    }
    if (recv.type.kind !== "object") {
      L.unsupported(
        "SC1090",
        expr,
        `'${pname} in …' on '${L.fmt(recv.type)}' receivers (only class-instance receivers — and unions of classes below or beside the declarer — have a static brand answer; narrow first)`,
      );
    }
    const lhsName = recv.type.className;
    const lhsInfo = L.classes.get(lhsName);
    if (!lhsInfo) throw new Error(`lowerer bug: unknown class ${lhsName}`);
    if (L.isSubclassOf(declName, lhsName)) {
      // The narrowing direction: the declarer strictly below the
      // receiver's static class — a strict subclass relation puts both in
      // a hierarchy, so the vtable interval test always exists.
      return { kind: "instanceOf", value: recv, className: declName, type: BOOL, loc };
    }
    const value = lhsName === declName || L.isSubclassOf(lhsName, declName);
    if (recv.kind === "varRef") return { kind: "boolLit", value, type: BOOL, loc };
    L.unsupported(
      "SC1090",
      expr,
      `statically-decided '${pname} in …' on computed operands (bind the value to a variable first)`,
    );
  }

/** `"key" in v` — the key-presence test. Three lowered receivers:
   * process.env (getenv(3) presence — Node-exact, an empty value still
   * counts as present), and monomorphic record shapes, where the answer is
   * type-directed: a declared non-optional field is a compile-time `true`,
   * a missing field (no index signature) a compile-time `false` — both
   * folds limited to side-effect-free receivers, the lowerInstanceOf rule —
   * and an OPTIONAL field (undefined-armed union) is a runtime tag test on
   * the slot: present iff the arm is not undefined. That last case is the
   * representation's honest answer — a field explicitly assigned
   * `undefined` reads as absent (`"a" in {a: undefined}` is true in JS,
   * false here; SEMANTICS.md 55). UNION receivers (the `in`-narrowing
   * idiom over multiple shapes) answer the same three ways PER ARM, under
   * that arm's own tag test, plus a fourth for a unit arm the checker
   * narrowed away — Node's TypeError. An arm with no per-arm answer at
   * all (a tuple, an index signature, a primitive, a class instance) keeps
   * the fence for the whole test, as do dyn/unknown receivers. Keys are
   * literal strings — a computed key over a shape would need the runtime
   * key table. */
/** `Object.getOwnPropertyNames(Object.prototype)` — measured on Node
   * v25.9.0, not recalled. `in` walks the PROTOTYPE CHAIN, so every
   * object-rooted value answers true for all twelve, and the cheap
   * "a compiled class has a closed member set" closure is measurably
   * WRONG on `toString`, `hasOwnProperty` and `constructor` — at
   * zapo's `install.ts:108`, the one line written to catch exactly the
   * collision a plugin naming itself `toString` would cause. */
  const OBJECT_PROTOTYPE_NAMES: ReadonlySet<string> = new Set([
    "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty",
    "__lookupGetter__", "__lookupSetter__", "isPrototypeOf",
    "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString",
  ]);

/** Every name a compiled class INSTANCE answers `in` for — its declared
   * instance members (own and inherited, fields, methods and accessor
   * slots), the EventEmitter API when the chain roots at the runtime
   * emitter, and Object.prototype's twelve — or null when the set is NOT
   * closed and the honest answer is the fence.
   *
   * What makes the set closed is not "a class is a class": it is that
   * every construct which could ADD a member to an instance at run time
   * is itself refused. tsc rejects `o[k] = v` on a class without an
   * index signature, and the one construct that bypasses tsc —
   * `Object.defineProperty(o, k, …)` with a string key — has no
   * lowering (zapo's own `install.ts:114`, six lines below the `in`
   * this closure serves, is exactly that refusal). Only the unique-
   * SYMBOL data-descriptor form is modeled, and its slot is `%`-named,
   * so no string key can ever reach it.
   *
   * Not closed, and why: a chain rooted in a RUNTIME builtin other than
   * the emitter (%Error, %DOMException, the stream classes) reaches a
   * prototype whose members the object model does not carry — `stack`
   * on an Error is the standing example, and answering `false` for it
   * would be a lie rather than a fence. Statics are excluded: Node
   * answers `false` for them on an instance. */
  function classInMemberNames(L: Lowerer, className: string): Set<string> | null {
    const leaf = L.classes.get(className);
    if (!leaf) return null;
    // The receiver's STATIC class must be its RUNTIME class. `in` reads the
    // real object's chain, so a `Base`-typed binding holding a `Derived`
    // answers `true` for Derived's members and this set would say false —
    // a silent wrong answer, not a fence. A class with no subclass in the
    // compiled hierarchy cannot be holding one: the hierarchy is fixed at
    // compile time (the same fact class decorators lean on), so a LEAF is
    // exact. Anything with a subclass keeps the fence.
    if (leaf.subclasses.length > 0) return null;
    const names = new Set<string>();
    // Instance FIELDS — leaf.fields already carries the inherited ones.
    // `%get:x` / `%set:x` are accessor slots (own properties to `in`;
    // Node answers true without invoking the getter); every other
    // `%`-prefixed name is compiler-internal storage (a unique-symbol
    // slot, an error's `%code`) that no STRING key can name.
    for (const name of leaf.fields.keys()) {
      if (name.startsWith("%get:") || name.startsWith("%set:")) {
        const member = name.slice(5);
        if (!member.startsWith("#")) names.add(member);
        continue;
      }
      if (name.startsWith("%") || name.startsWith("#")) continue;
      names.add(name);
    }
    // METHODS are own-per-class, so the base chain is walked.
    for (let info: ClassInfo | null = leaf; info; info = info.base) {
      if (info.builtinEmitter) {
        for (const m of EMITTER_API_MEMBERS) names.add(m);
        continue;
      }
      if (info.def.runtime) return null;
      for (const name of info.methods.keys()) {
        const member = name.startsWith("get:") || name.startsWith("set:") ? name.slice(4) : name;
        if (member.startsWith("#") || member.startsWith("%")) continue;
        names.add(member);
      }
    }
    for (const n of OBJECT_PROTOTYPE_NAMES) names.add(n);
    return names;
  }

/** The interned per-class key-presence helper the RUNTIME-key `in` calls:
   * `%cls.haskey.<n>(k)` — a string-equality chain over the closed member
   * set. The answer depends on the KEY alone (unlike a record's, no
   * optional slot decides per value), so the receiver is not a parameter;
   * the call site still evaluates it, because JS does. */
  function classHasKeyHelper(L: Lowerer, className: string, members: ReadonlySet<string>, loc: SrcLoc): string {
    const hkey = `clshaskey:${className}`;
    const existing = L.widthHelpers.get(hkey);
    if (existing) return existing;
    const helper = `%cls.haskey.${L.widthHelpers.size}`;
    L.widthHelpers.set(hkey, helper);
    const k: IrExpr = { kind: "varRef", localId: "k.0", type: STRING, loc };
    const body: IrStmt[] = [];
    for (const name of members) {
      body.push({
        kind: "if",
        cond: { kind: "strEq", negated: false, left: k, right: { kind: "strLit", value: name, type: STRING, loc }, type: BOOL, loc },
        then: [{ kind: "return", value: { kind: "boolLit", value: true, type: BOOL, loc }, loc }],
        else_: null,
        loc,
      });
    }
    body.push({ kind: "return", value: { kind: "boolLit", value: false, type: BOOL, loc }, loc });
    L.liftedFns.push({
      name: helper,
      params: [{ localId: "k.0", name: "k", type: STRING }],
      returnType: BOOL,
      locals: [{ id: "k.0", name: "k", type: STRING, mutable: true }],
      body,
      loc,
    });
    return helper;
  }

  export function lowerInExpression(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr {
    // `#name in obj` — the ergonomic brand check (ES2022) — resolves
    // before any string-key machinery: the left operand is a private
    // NAME, not a value.
    if (ts.isPrivateIdentifier(expr.left)) {
      return lowerPrivateIn(L, expr, expr.left, loc);
    }
    // Compile-time-known STRING keys fold — literals, and the same
    // const/enum-literal and template folding computed property keys get
    // (foldedStringKeyOf); runtime-valued keys keep the fence.
    // NUMERIC literal keys answer on ARRAY receivers: dense arrays hold
    // exactly the indices [0, length), so `3 in xs` is a length test (and
    // a negative/fractional literal is a constant miss — the receiver
    // still evaluates once through its own length read).
    {
      let kNode = expr.left;
      while (ts.isParenthesizedExpression(kNode)) kNode = kNode.expression;
      if (ts.isNumericLiteral(kNode) && L.mapTypeOf(L.typeOf(expr.right))?.kind === "array") {
        const recvArr = L.lowerExpr(expr.right);
        if (recvArr.type.kind === "array") {
          const len: IrExpr = { kind: "arrIntrinsic", method: "length", receiver: recvArr, args: [], type: F64, loc };
          const n = Number(kNode.text);
          if (Number.isInteger(n) && n >= 0) {
            return { kind: "bin", op: "<", left: { kind: "numLit", value: n, type: F64, loc }, right: len, type: BOOL, loc };
          }
          return { kind: "bin", op: "<", left: len, right: { kind: "numLit", value: 0, type: F64, loc }, type: BOOL, loc };
        }
      }
    }
    const key = foldedStringKeyOf(L, expr.left);
    if (key === null) {
      // A RUNTIME string key over an INDEX-SIGNATURE record receiver (the
      // `names.filter((k) => k in config)` idiom): the interned key-
      // presence helper — declared fields answer statically per name
      // (optional slots per value: the undefined arm reads absent, stance
      // 55), then the overflow map's live keys. Other receivers keep the
      // fence: fixed shapes want the literal folds above, and there is no
      // runtime key table to ask.
      const rIn = lowerRuntimeKeyIn(L, expr, loc);
      if (rIn) return rIn;
      // A runtime key over a CHECKED-DYNAMIC receiver (`name in
      // agent.sockets` — both sides computed; the checker may type the
      // receiver as a Dict while the VALUE lives in the checked-dynamic tree, so the
      // LOWERED type decides): the dyn presence answer, with the key
      // stringified like every property key (o[k] is o[String(k)] in JS;
      // `in` shares the coercion).
      {
        const probed = probeLower(L, expr.right);
        if (probed?.type.kind === "dyn") {
          let k = L.lowerExpr(expr.left); // JS order: the key evaluates first
          if (k.type.kind === "f64" || k.type.kind === "string" || k.type.kind === "dyn") {
            k = L.ensureString(k, expr.left);
            const recvD = L.lowerExpr(expr.right);
            if (recvD.type.kind === "dyn") {
              return { kind: "libCall", fn: "dyn.hasKey", args: [recvD, k], type: BOOL, loc };
            }
          }
        }
      }
      // A runtime key over a compiled CLASS INSTANCE (`exposeAs in
      // client` — zapo's reserved-member collision check): the closed
      // member set answers per NAME, so the test is a string-equality
      // chain over the key. Object.prototype's twelve are IN that set,
      // which is the whole difference between this and the cheap
      // closure that would have let a plugin named `toString` through
      // the very guard written to stop it.
      {
        const probed = probeLower(L, expr.right);
        if (probed?.type.kind === "object" && L.mapTypeOf(L.typeOf(expr.left))?.kind === "string") {
          const members = classInMemberNames(L, probed.type.className);
          if (members) {
            const helper = classHasKeyHelper(L, probed.type.className, members, loc);
            // JS evaluates the key, then the receiver — and the receiver
            // is evaluated even though the answer does not read it.
            const keyIr = L.lowerExprExpecting(expr.left, STRING);
            const kTmp = L.declareHiddenLocal("%inKey", STRING);
            const recvIr = L.lowerExpr(expr.right);
            const rTmp = L.declareHiddenLocal("%inRecv", recvIr.type);
            return {
              kind: "seqExpr",
              stmts: [
                { kind: "varDecl", localId: kTmp.id, init: keyIr, loc },
                { kind: "varDecl", localId: rTmp.id, init: recvIr, loc },
              ],
              result: { kind: "call", callee: helper, args: [{ kind: "varRef", localId: kTmp.id, type: STRING, loc }], type: BOOL, loc },
              type: BOOL,
              loc,
            };
          }
        }
        // SCRIPTC_IN_RECV=1 — what the runtime-key fence is actually
        // looking at: the LOWERED receiver kind (the checker's type is
        // what the message quotes, and the two disagree at the sites
        // that matter).
        if (process.env.SCRIPTC_IN_RECV) {
          const line = ts.getLineAndCharacterOfPosition(expr.getSourceFile(), loc.start).line + 1;
          const cls = probed?.type.kind === "object" ? probed.type.className : "-";
          console.error(`INRECV ${loc.file}:${line} recvLowered=${probed?.type.kind ?? "?"} class=${cls} keyType=${L.mapTypeOf(L.typeOf(expr.left))?.kind ?? "?"}`);
        }
      }
      L.unsupported(
        "SC1090",
        expr.left,
        "'in' with computed (non-literal) keys (a const whose type is one string literal folds; a string-typed key answers over index-signature record receivers)",
      );
    }
    // A receiver re-read (the static folds below) is safe for plain reads
    // AND for side-effect-free expressions (an object literal of literals
    // — the `"a" in { a: true }` shape).
    const pureRecvNode = sideEffectFreeOptionValue(expr.right);
    if (L.isProcessEnv(expr.right)) {
      // `"NO_COLOR" in process.env`: presence via the one envGet intrinsic —
      // getenv(3) returning non-NULL is Node's `in` on process.env exactly.
      const envType = L.envValueType();
      if (envType.kind !== "union") throw new Error("lowerer bug: env value type is not a union");
      const undefTag = L.armTag(envType.unionId, UNDEFINED_T);
      const read: IrExpr = {
        kind: "libCall",
        fn: "process.envGet",
        args: [{ kind: "strLit", value: key, type: STRING, loc }],
        type: envType,
        loc,
      };
      return { kind: "unionIsTag", unionId: envType.unionId, tag: undefTag, negated: true, value: read, type: BOOL, loc };
    }
    const recv = L.lowerExpr(expr.right);
    // Error-rooted receivers (builtin or user subclass — the isErrnoException
    // predicate's `err instanceof Error && "code" in err` shape): `code`
    // answers from the runtime error's code slot (stamped by fs/system/
    // event/spawn errors, absent on plain constructions — exactly Node's
    // own-property answer), and the always-declared members fold true.
    // Everything else fences: the runtime object carries no other dynamic
    // properties to ask (`stack` would be a lie — Node has one, we don't).
    if (recv.type.kind === "object") {
      // %DOMException first: `'cause' in e` answers the options form's
      // own-property record (the runtime slot), and code/name/message are
      // always present.
      if (recv.type.className === "%DOMException") {
        if (key === "cause") {
          return { kind: "libCall", fn: "error.domHasCause", args: [recv], type: BOOL, loc };
        }
        if ((key === "code" || key === "message" || key === "name") &&
          (recv.kind === "varRef" || recv.kind === "caughtNarrow")) {
          return { kind: "boolLit", value: true, type: BOOL, loc };
        }
      }
      let info = L.classes.get(recv.type.className) ?? null;
      while (info && info.base) info = info.base;
      if (info?.def.name === "%Error") {
        if (key === "code") {
          const codeType = L.envValueType();
          if (codeType.kind !== "union") throw new Error("lowerer bug: error code type is not a union");
          const undefTag = L.armTag(codeType.unionId, UNDEFINED_T);
          const read: IrExpr = { kind: "libCall", fn: "error.code", args: [recv], type: codeType, loc };
          return { kind: "unionIsTag", unionId: codeType.unionId, tag: undefTag, negated: true, value: read, type: BOOL, loc };
        }
        if ((key === "message" || key === "name") && (recv.kind === "varRef" || recv.kind === "caughtNarrow")) {
          return { kind: "boolLit", value: true, type: BOOL, loc };
        }
        L.unsupported(
          "SC1090",
          expr,
          `'in' with the key '${key}' on Error receivers (code answers from the error's code slot; message and name are always present)`,
        );
      }
      // A LITERAL key over a compiled class instance: the same closed
      // member set the runtime key walks, decided at compile time. The
      // %Error and %DOMException arms above answered first and
      // classInMemberNames declines those roots, so this cannot
      // shadow them.
      {
        const members = classInMemberNames(L, recv.type.className);
        if (members) {
          if (recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode) {
            return { kind: "boolLit", value: members.has(key), type: BOOL, loc };
          }
          L.unsupported("SC1090", expr, "statically-decided 'in' on computed receivers (bind the value to a variable first)");
        }
      }
    }
    // A dyn receiver (`"portless" in pkg` after the `typeof pkg ===
    // "object"` guard): own-member presence on the checked-dynamic tree — tsc admits `in`
    // only on object-typed operands, so unit receivers are unreachable.
    if (recv.type.kind === "dyn") {
      return { kind: "dynHasKey", key, value: recv, type: BOOL, loc };
    }
    // `"k" in u` over a UNION whose arms are FIXED record shapes: every
    // arm answers membership PER ARM, so the whole test collapses to
    // runtime TAG tests — tsc's own narrowing then types the branches
    // (the discriminating-`in` idiom). Three answers exist per arm: a
    // declared non-optional field (or an accessor slot) is always
    // present and an undeclared name never is — those decide
    // STATICALLY; an OPTIONAL (undefined-armed) slot decides per VALUE,
    // off the tag-checked narrow; and a UNIT arm is not a membership
    // answer at all — Node throws a TypeError for `in` on
    // undefined/null. Tuple and index-signature arms have no per-arm
    // answer and keep the fence below.
    if (recv.type.kind === "union") {
      const unionId = recv.type.unionId;
      const arms = L.unions.get(unionId)?.arms ?? [];
      /** One arm's answer: `has` decides it statically, `slot` is an
       * optional field's (undefined-armed) type to read off the narrowed
       * arm, `unit` is the throwing arm. Exactly one of the three is
       * live per entry. */
      type InArmAnswer = { tag: number; has: boolean; slot: IrType | null; unit: "undefined" | "null" | null; prim: boolean; arm: IrType };
      const answers: InArmAnswer[] = [];
      let armWise = arms.length > 0;
      let staticAnswers = arms.length > 0;
      for (const arm of arms) {
        const tag = L.armTag(unionId, arm);
        if (tag < 0) {
          armWise = false;
          staticAnswers = false;
          break;
        }
        // A UNIT arm: `'k' in undefined` / `'k' in null` throws in Node.
        // tsc rejects such an operand outright, so a unit arm reaching
        // here is one the CHECKER narrowed away while the LOWERED union
        // type still carries it (maybeNarrow only collapses a use the
        // checker types as a SINGLE arm, never a sub-union). Giving the
        // arm Node's own TypeError is that arm's honest answer and costs
        // no trust in the narrowing: the term stands on its own tag test.
        if (isUnitType(arm)) {
          answers.push({ tag, has: false, slot: null, unit: arm.kind === "undefinedT" ? "undefined" : "null", prim: false, arm });
          staticAnswers = false;
          continue;
        }
        // A PRIMITIVE arm — string, number, boolean — is the unit arm's
        // case one step out: `'k' in "abc"` throws in Node for exactly the
        // reason `'k' in undefined` does (RequireObjectCoercible is not
        // what `in` asks for; `in` asks for an OBJECT, and a primitive
        // never is one). tsc rejects such an operand outright, so a
        // primitive arm reaching here is one the CHECKER narrowed away
        // while the LOWERED union still carries it — the same provenance
        // as a unit arm, and the same discipline: the term stands on its
        // own tag test and claims nothing about the arms beside it.
        //
        // The ONE thing that is not the unit arm's shape: Node's message
        // interpolates the VALUE (`... to search for 'k' in abc`), not a
        // literal word, so the term reads the narrowed value at run time
        // and String()s it. That is why prim carries no text here.
        if (arm.kind === "string" || arm.kind === "f64" || arm.kind === "bool") {
          answers.push({ tag, has: false, slot: null, unit: null, prim: true, arm });
          staticAnswers = false;
          continue;
        }
        const shape = arm.kind === "record" ? L.shapes.get(arm.shapeId) : undefined;
        if (!shape || shape.tuple || shape.indexValue) {
          armWise = false;
          staticAnswers = false;
          break;
        }
        const f = shape.fields.find((x) => x.name === key);
        if (f && f.type.kind === "union" && L.armTag(f.type.unionId, UNDEFINED_T) >= 0) {
          answers.push({ tag, has: false, slot: f.type, unit: null, prim: false, arm });
          staticAnswers = false; // an optional slot: presence is per-value
          continue;
        }
        // Accessor properties are own properties to `in` (Node answers
        // true without invoking the getter) — either slot present makes
        // the name a member.
        const acc = shape.fields.some((x) => x.name === `%get:${key}` || x.name === `%set:${key}`);
        answers.push({ tag, has: f !== undefined || acc, slot: null, unit: null, prim: false, arm });
      }
      // SCRIPTC_IN_WHY=1 — the `in` census probe: for every UNION
      // receiver reaching the decision, the site, the key, whether every
      // arm answered, and the per-arm verdict. An arm the classifier
      // could not take at all leaves the list SHORT of `arms.length`,
      // and the kind that stopped it is the next one in arm order.
      if (process.env.SCRIPTC_IN_WHY) {
        const line = ts.getLineAndCharacterOfPosition(expr.getSourceFile(), loc.start).line + 1;
        const verdicts = answers.map((a) => (a.unit !== null ? `throw:${a.unit}` : a.prim ? `throw:${a.arm.kind}` : a.slot !== null ? "perValue" : a.has ? "yes" : "no"));
        const stopper = answers.length < arms.length ? arms[answers.length]!.kind : "-";
        console.error(`INWHY ${loc.file}:${line} key='${key}' arms=${arms.length} taken=${answers.length} stopped-at=${stopper} static=${staticAnswers} armwise=${armWise} recv=${recv.kind} [${verdicts.join(",")}]`);
      }
      if (staticAnswers) {
        const pureRecv = recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode;
        const isTag = (tag: number, negated: boolean): IrExpr => ({
          kind: "unionIsTag",
          unionId,
          tag,
          negated,
          value: recv,
          type: BOOL,
          loc,
        });
        const trues = answers.filter((a) => a.has);
        if (trues.length === answers.length || trues.length === 0) {
          // Constant either way — but JS still EVALUATES the operand (it
          // may throw: an ambient-const read is a ReferenceError). Pure
          // reads fold; anything else rides one tag test whose branches
          // agree, evaluating the receiver exactly once.
          const ans = trues.length !== 0;
          if (pureRecv) return { kind: "boolLit", value: ans, type: BOOL, loc };
          return {
            kind: "ternary",
            cond: isTag(answers[0]!.tag, false),
            then: { kind: "boolLit", value: ans, type: BOOL, loc },
            else_: { kind: "boolLit", value: ans, type: BOOL, loc },
            type: BOOL,
            loc,
          };
        }
        // One deciding arm (either polarity): a single tag test, receiver
        // evaluated once — no purity requirement.
        if (trues.length === 1) return isTag(trues[0]!.tag, false);
        const falses = answers.filter((a) => !a.has);
        if (falses.length === 1) return isTag(falses[0]!.tag, true);
        // Several arms on each side: the OR chain re-reads the receiver,
        // so only side-effect-free reads qualify.
        if (pureRecv) {
          let out: IrExpr = isTag(trues[0]!.tag, false);
          for (const t of trues.slice(1)) {
            out = { kind: "logical", op: "||", left: out, right: isTag(t.tag, false), type: BOOL, loc };
          }
          return out;
        }
        L.unsupported("SC1090", expr, "statically-decided 'in' on computed receivers (bind the value to a variable first)");
      }
      // MIXED arms — an optional slot, or a unit arm the checker narrowed
      // away — answer per arm, so the test becomes one GUARDED TERM per
      // arm, OR'd together. Each term is `isTag(arm) ? <that arm's
      // answer> : false`, so no term claims anything about a value
      // carrying a different tag and the chain assumes no
      // exhaustiveness: an arm that cannot hold the key contributes
      // nothing at all, an arm that always holds it contributes its bare
      // tag test, an optional slot contributes the slot's undefined test
      // read off the TAG-CHECKED narrow (stance 55 again: a field
      // explicitly assigned undefined reads as absent), and a unit arm
      // contributes Node's TypeError. Every term re-reads the receiver,
      // so only side-effect-free receivers qualify — the OR-chain rule
      // above. An impure one falls through to the fence it met before.
      if (armWise) {
        const pureRecv = recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode;
        if (pureRecv) {
          const isTag = (tag: number): IrExpr => ({ kind: "unionIsTag", unionId, tag, negated: false, value: recv, type: BOOL, loc });
          const falseLit = (): IrExpr => ({ kind: "boolLit", value: false, type: BOOL, loc });
          const terms: IrExpr[] = [];
          for (const a of answers) {
            if (a.unit !== null) {
              terms.push({
                kind: "ternary",
                cond: isTag(a.tag),
                then: nodeThrowExpr(1, "", `Cannot use 'in' operator to search for '${key}' in ${a.unit}`, BOOL, loc),
                else_: falseLit(),
                type: BOOL,
                loc,
              });
              continue;
            }
            if (a.prim) {
              // Node's own TypeError, with the VALUE interpolated: the
              // narrowed arm read off the tag-checked narrow, String()d
              // by the same conversion `${v}` uses (JS number formatting
              // included — `1e+21`, `NaN`, `-0` as "0"). The message is
              // therefore a runtime string, which error.nodeThrow takes:
              // its args are TYPE-checked (F64, STRING, STRING), never
              // required to be literals.
              const narrowed: IrExpr = { kind: "unionNarrow", unionId, tag: a.tag, value: recv, type: a.arm, loc };
              const msg: IrExpr = {
                kind: "strConcat",
                left: { kind: "strLit", value: `Cannot use 'in' operator to search for '${key}' in `, type: STRING, loc },
                right: L.ensureString(narrowed, expr.right),
                type: STRING,
                loc,
              };
              terms.push({
                kind: "ternary",
                cond: isTag(a.tag),
                then: {
                  kind: "libCall",
                  fn: "error.nodeThrow",
                  args: [
                    { kind: "numLit", value: 1, type: F64, loc },
                    { kind: "strLit", value: "", type: STRING, loc },
                    msg,
                  ],
                  type: BOOL,
                  loc,
                },
                else_: falseLit(),
                type: BOOL,
                loc,
              });
              continue;
            }
            if (a.slot !== null) {
              if (a.arm.kind !== "record" || a.slot.kind !== "union") throw new Error("lowerer bug: 'in' per-value arm is not a record with a union slot");
              const narrowed: IrExpr = { kind: "unionNarrow", unionId, tag: a.tag, value: recv, type: a.arm, loc };
              const read: IrExpr = { kind: "recordGet", obj: narrowed, shapeId: a.arm.shapeId, field: key, type: a.slot, loc };
              terms.push({
                kind: "ternary",
                cond: isTag(a.tag),
                then: { kind: "unionIsTag", unionId: a.slot.unionId, tag: L.armTag(a.slot.unionId, UNDEFINED_T), negated: true, value: read, type: BOOL, loc },
                else_: falseLit(),
                type: BOOL,
                loc,
              });
              continue;
            }
            if (a.has) terms.push(isTag(a.tag));
          }
          let out: IrExpr = terms[0] ?? falseLit();
          for (const t of terms.slice(1)) {
            out = { kind: "logical", op: "||", left: out, right: t, type: BOOL, loc };
          }
          return out;
        }
      }
    }
    if (recv.type.kind !== "record") {
      L.unsupported(
        "SC1090",
        expr,
        `'in' on '${L.fmt(recv.type)}' receivers (only process.env, Error instances, record-typed values, and unions of fixed record shapes answer; ${NARROW_FIRST})`,
      );
    }
    const shape = L.shapes.get(recv.type.shapeId);
    if (!shape) throw new Error(`lowerer bug: unknown shape ${recv.type.shapeId}`);
    const field = shape.fields.find((f) => f.name === key);
    if (field) {
      if (field.type.kind === "union" && L.armTag(field.type.unionId, UNDEFINED_T) >= 0) {
        // Optional slot: the key is present iff the arm is not undefined.
        const read: IrExpr = { kind: "recordGet", obj: recv, shapeId: recv.type.shapeId, field: key, type: field.type, loc };
        return { kind: "unionIsTag", unionId: field.type.unionId, tag: L.armTag(field.type.unionId, UNDEFINED_T), negated: true, value: read, type: BOOL, loc };
      }
      // A declared non-optional field always exists on every value of the
      // shape — statically true, but folding may only drop a
      // side-effect-free receiver read.
      if (recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode) {
        return { kind: "boolLit", value: true, type: BOOL, loc };
      }
      L.unsupported("SC1090", expr, "statically-decided 'in' on computed receivers (bind the value to a variable first)");
    }
    // Accessor properties answer `in` as own members (Node: true, getter
    // NOT invoked) — statically true under the same purity discipline as
    // declared non-optional fields.
    if (shape.fields.some((f) => f.name === `%get:${key}` || f.name === `%set:${key}`)) {
      if (recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode) {
        return { kind: "boolLit", value: true, type: BOOL, loc };
      }
      L.unsupported("SC1090", expr, "statically-decided 'in' on computed receivers (bind the value to a variable first)");
    }
    if (shape.indexValue) {
      // A LITERAL key over an index-signature shape is the same question
      // the RUNTIME key already answers — `"k" in m` and `k in m` differ
      // only in where the string comes from — so it takes the same
      // interned presence helper (lowerRuntimeKeyIn). It used to fence,
      // and the hint sent the author to `!== undefined`, which on exactly
      // these reads was a constant fold: the advice compiled to `true`.
      const lIn = lowerRuntimeKeyIn(L, expr, loc);
      if (lIn) return lIn;
      L.unsupported("SC1090", expr, "'in' over index-signature keys (read the key and test '!== undefined' instead)");
    }
    if (recv.kind === "varRef" || recv.kind === "recordGet" || recv.kind === "fieldGet" || pureRecvNode) {
      return { kind: "boolLit", value: false, type: BOOL, loc };
    }
    L.unsupported("SC1090", expr, "statically-decided 'in' on computed receivers (bind the value to a variable first)");
  }

/** The runtime-key `in` (see lowerInExpression): `k in r` where k is a
   * runtime string and r an index-signature record — an interned
   * `%rec.haskey.<n>(k, r)` walks the declared names (a string-equality
   * chain: non-optional fields and accessor slots answer true, optional
   * slots answer their per-value tag test) and then the overflow map's
   * live keys. Null when the pair is outside that shape (the caller keeps
   * its fence). */
  function lowerRuntimeKeyIn(L: Lowerer, expr: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
    if (L.mapTypeOf(L.typeOf(expr.left))?.kind !== "string") return null;
    const recvT = L.mapTypeOf(L.typeOf(expr.right));
    if (recvT?.kind !== "record") return null;
    const shape = L.shapes.get(recvT.shapeId);
    if (!shape?.indexValue || shape.tuple) return null;
    const keyIr = L.lowerExprExpecting(expr.left, STRING);
    const recv = L.lowerExprExpecting(expr.right, recvT);
    const hkey = `haskey:${recvT.shapeId}`;
    let helper = L.widthHelpers.get(hkey);
    if (!helper) {
      helper = `%rec.haskey.${L.widthHelpers.size}`;
      L.widthHelpers.set(hkey, helper);
      const recT: IrType = { kind: "record", shapeId: recvT.shapeId };
      const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
      const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
      const k = ref("k.0", STRING);
      const r = ref("r.0", recT);
      const body: IrStmt[] = [];
      const ret = (value: IrExpr): IrStmt => ({ kind: "return", value, loc });
      for (const f of shape.fields) {
        const accessor = f.name.startsWith("%get:") || f.name.startsWith("%set:");
        if (f.name.startsWith("%") && !accessor) continue;
        const name = accessor ? f.name.slice(5) : f.name;
        const eq: IrExpr = { kind: "strEq", negated: false, left: k, right: { kind: "strLit", value: name, type: STRING, loc }, type: BOOL, loc };
        const utag = !accessor && f.type.kind === "union" ? L.armTag(f.type.unionId, UNDEFINED_T) : -1;
        const answer: IrExpr =
          utag >= 0 && f.type.kind === "union"
            ? {
                kind: "unionIsTag",
                unionId: f.type.unionId,
                tag: utag,
                negated: true,
                value: { kind: "recordGet", obj: r, shapeId: recvT.shapeId, field: f.name, type: f.type, loc },
                type: BOOL,
                loc,
              }
            : { kind: "boolLit", value: true, type: BOOL, loc };
        body.push({ kind: "if", cond: eq, then: [ret(answer)], else_: null, loc });
      }
      const ksT = arrayOf(STRING);
      body.push(
        { kind: "varDecl", localId: "ks.0", init: { kind: "recordOvfKeys", obj: r, shapeId: recvT.shapeId, type: ksT, loc }, loc },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0), loc },
          cond: {
            kind: "bin",
            op: "<",
            left: ref("i.0", F64),
            right: { kind: "arrIntrinsic", method: "length", receiver: ref("ks.0", ksT), args: [], type: F64, loc },
            type: BOOL,
            loc,
          },
          update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: ref("i.0", F64), right: num(1), type: F64, loc }, loc },
          body: [
            {
              kind: "if",
              cond: { kind: "strEq", negated: false, left: k, right: { kind: "arrayGet", arr: ref("ks.0", ksT), index: ref("i.0", F64), type: STRING, loc }, type: BOOL, loc },
              then: [ret({ kind: "boolLit", value: true, type: BOOL, loc })],
              else_: null,
              loc,
            },
          ],
          loc,
        },
        ret({ kind: "boolLit", value: false, type: BOOL, loc }),
      );
      L.liftedFns.push({
        name: helper,
        params: [
          { localId: "k.0", name: "k", type: STRING },
          { localId: "r.0", name: "r", type: recT },
        ],
        returnType: BOOL,
        locals: [
          { id: "k.0", name: "k", type: STRING, mutable: true },
          { id: "r.0", name: "r", type: recT, mutable: true },
          { id: "ks.0", name: "ks", type: ksT, mutable: false },
          { id: "i.0", name: "i", type: F64, mutable: true },
        ],
        body,
        loc,
      });
    }
    return { kind: "call", callee: helper, args: [keyIr, recv], type: BOOL, loc };
  }

/** A regex literal `/ab+c/gi` → regexLit (interned per (pattern, flags)
   * by the backend). The TS parser has already syntax-checked the literal;
   * what remains here is the flag-alphabet fence (d and v are
   * declared-valid TS flags outside this slice). Named capture groups
   * `(?<name>...)` and `\k<name>` backreferences compile — libregexp
   * executes them natively, replace templates resolve `$<name>` at
   * runtime, and `.groups` reads desugar at their access sites
   * (matchResultNamedGroupsOf). The engine validates the pattern itself
   * lazily at first use (SEMANTICS.md documents the divergence from
   * Node's parse-time SyntaxError). */
  export function lowerRegexLiteral(L: Lowerer, expr: ts.RegularExpressionLiteral): IrExpr {
    const text = expr.text;
    const lastSlash = text.lastIndexOf("/");
    const pattern = text.slice(1, lastSlash);
    const flags = text.slice(lastSlash + 1);
    for (const f of flags) {
      if (!"gimsuvy".includes(f)) {
        L.unsupported(
          "SC1120",
          expr,
          f === "d"
            ? "the regex 'd' flag (match indices)"
            : `the regex '${f}' flag`,
        );
      }
    }
    // The flag string is OBSERVABLE — `re.flags`, `console.log(re)`, the
    // dynamic `String(re)`, and the engine's invalid-pattern SyntaxError
    // all quote it — and JS reports it in GETTER order (dgimsuvy), never
    // the order it was written: node answers `/x/ysmig`.flags with
    // "gimsy" and inspects the literal as /x/gimsy. Normalising HERE is
    // what makes lower-assert's regexFlagsGetterOrder comment true, fixes
    // every consumer at once without any of them knowing, and interns
    // /a/gy and /a/yg to the one static they always were. The filter runs
    // over the FULL getter alphabet, not the supported one, so a flag the
    // fence above rejected still reaches the IR validator instead of
    // being silently dropped out of an already-erroring program.
    const ordered = [..."dgimsuvy"].filter((f) => flags.includes(f)).join("");
    return { kind: "regexLit", pattern, flags: ordered, type: REGEX, loc: locOf(expr) };
  }

/** The pattern's named capture groups, in source order: each `(?<name>`
   * with its 1-based capture index (numbered and named groups share the
   * numbering — the index IS the match slice's element position). Null
   * when the scan can't answer confidently (an unterminated construct, a
   * `\u`-escaped group name) — callers fence rather than guess. Duplicate
   * names (ES2025 — valid across alternatives) appear once per
   * declaration; consumers pick the participating occurrence. The scan
   * only needs to track escapes, character classes, and `(` kinds; tsc
   * has already syntax-checked the literal, so a malformed pattern here
   * answers null and the engine's lazy compile reports it. */
  export function namedCaptureGroupsOfPattern(pattern: string): { name: string; index: number }[] | null {
    const groups: { name: string; index: number }[] = [];
    let captureIndex = 0;
    let inClass = false;
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (inClass) {
        if (c === "]") inClass = false;
        i++;
        continue;
      }
      if (c === "[") {
        inClass = true;
        i++;
        continue;
      }
      if (c !== "(") {
        i++;
        continue;
      }
      if (pattern[i + 1] !== "?") {
        captureIndex++;
        i++;
        continue;
      }
      // (?<name> captures; (?<= and (?<! are lookbehinds; every other
      // (?… form — (?:, (?=, (?!, modifier groups (?i: — is non-capturing.
      if (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
        const gt = pattern.indexOf(">", i + 3);
        if (gt < 0) return null;
        const name = pattern.slice(i + 3, gt);
        if (name.includes("\\")) return null; // \u-escaped names: bytecode spells them decoded
        captureIndex++;
        groups.push({ name, index: captureIndex });
        i = gt + 1;
        continue;
      }
      i += 2;
    }
    return groups;
  }

/** Which capture groups PARTICIPATE in every successful match of a
   * pattern — the question a function replacement value has to answer
   * before a group's value can be typed `string`.
   *
   * Node hands a replacer `undefined` for a group that did not
   * participate, and `""` for one that participated on an empty span:
   * two distinguishable states. Divergence 51 collapses them for
   * `match`/`matchAll`/`exec` and for `$1` template substitution, where
   * the value's type is the compiler's to choose. A replacer's parameter
   * type is the AUTHOR's, so the honest answer is to admit the `string`
   * spelling only where the group provably always participates — and
   * fence otherwise, rather than inherit the divergence into a fifth
   * surface (see lowerRegexReplaceFnCall).
   *
   * The scan is the same skeleton namedCaptureGroupsOfPattern uses
   * (escapes, character classes, `(` kinds) with a level stack on top.
   * A group is skipped by a successful match only if some construct
   * ENCLOSING it could be skipped, so group k participates always iff
   *   - its own level is not quantified with a zero minimum, and
   *   - no STRICT ANCESTOR level carries an alternation (a sibling
   *     branch would route around it) or a zero-minimum quantifier, and
   *   - no enclosing level is a lookaround (a negative one never
   *     participates; a positive one is refused conservatively).
   * An alternation inside the group's OWN level is harmless — some
   * branch of it matched, so the group did.
   *
   * Null when the scan cannot answer confidently (an unterminated
   * construct, a `\u`-escaped group name, or a `{`-quantifier this scan
   * declines to parse) — callers fence rather than guess. */
  export function captureParticipationOfPattern(
    pattern: string,
  ): { captureCount: number; always: Map<number, boolean> } | null {
    type Level = { look: boolean; hasAlt: boolean; minZero: boolean; parent: number };
    const levels: Level[] = [{ look: false, hasAlt: false, minZero: false, parent: -1 }];
    const stack: number[] = [0];
    const groupLevel = new Map<number, number>();
    let captureIndex = 0;
    let inClass = false;
    let i = 0;
    const openLevel = (look: boolean): void => {
      levels.push({ look, hasAlt: false, minZero: false, parent: stack[stack.length - 1]! });
      stack.push(levels.length - 1);
    };
    while (i < pattern.length) {
      const c = pattern[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (inClass) {
        if (c === "]") inClass = false;
        i++;
        continue;
      }
      if (c === "[") {
        inClass = true;
        i++;
        continue;
      }
      if (c === "|") {
        levels[stack[stack.length - 1]!]!.hasAlt = true;
        i++;
        continue;
      }
      if (c === ")") {
        if (stack.length === 1) return null; // unbalanced; tsc syntax-checked the literal
        const id = stack.pop()!;
        const q = pattern[i + 1];
        if (q === "{") return null; // a `{n,m}` form this scan will not parse
        if (q === "?" || q === "*") {
          levels[id]!.minZero = true;
          i += 2;
        } else if (q === "+") {
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (c !== "(") {
        i++;
        continue;
      }
      if (pattern[i + 1] !== "?") {
        captureIndex++;
        openLevel(false);
        groupLevel.set(captureIndex, stack[stack.length - 1]!);
        i++;
        continue;
      }
      // (?<name> captures; (?= (?! (?<= (?<! are lookarounds; every other
      // (?… form — (?:, modifier groups (?i: — is a plain non-capturing level.
      const c2 = pattern[i + 2];
      const c3 = pattern[i + 3];
      if (c2 === "<" && c3 !== "=" && c3 !== "!") {
        const gt = pattern.indexOf(">", i + 3);
        if (gt < 0) return null;
        if (pattern.slice(i + 3, gt).includes("\\")) return null; // \u-escaped name
        captureIndex++;
        openLevel(false);
        groupLevel.set(captureIndex, stack[stack.length - 1]!);
        i = gt + 1;
        continue;
      }
      openLevel(c2 === "=" || c2 === "!" || (c2 === "<" && (c3 === "=" || c3 === "!")));
      i += 2;
    }
    if (stack.length !== 1) return null;
    const always = new Map<number, boolean>();
    for (const [gi, lid] of groupLevel) {
      let ok = !levels[lid]!.minZero && !levels[lid]!.look;
      for (let p = levels[lid]!.parent; p >= 0 && ok; p = levels[p]!.parent) {
        const lv = levels[p]!;
        if (lv.hasAlt || lv.minZero || lv.look) ok = false;
      }
      always.set(gi, ok);
    }
    return { captureCount: captureIndex, always };
  }

/** The statically-known regex literal TEXT — pattern AND flags — behind
   * an expression: a regex literal, a const local initialized with one,
   * or `new RegExp("...", "gi")` over string literals. Flags matter to
   * the function-replacer desugar (a non-global `.replace` stops after
   * one match), so this is staticRegexPatternOf's stricter sibling: it
   * declines the `new RegExp(pattern)` spellings whose flags argument is
   * not a literal, where the pattern alone would have been enough. */
  export function staticRegexTextOf(L: Lowerer, e: ts.Expression): { pattern: string; flags: string } | null {
    let expr = e;
    for (;;) {
      if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) {
        expr = expr.expression;
        continue;
      }
      break;
    }
    if (ts.isRegularExpressionLiteral(expr)) {
      const text = expr.text;
      const lastSlash = text.lastIndexOf("/");
      return { pattern: text.slice(1, lastSlash), flags: text.slice(lastSlash + 1) };
    }
    if (
      ts.isNewExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "RegExp" &&
      L.isStdlibGlobal(expr.expression, "RegExp") &&
      expr.arguments !== undefined &&
      expr.arguments.length >= 1 &&
      expr.arguments.length <= 2 &&
      (ts.isStringLiteral(expr.arguments[0]!) || ts.isNoSubstitutionTemplateLiteral(expr.arguments[0]!))
    ) {
      const pattern = (expr.arguments[0] as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral).text;
      const fa = expr.arguments[1];
      if (fa === undefined) return { pattern, flags: "" };
      if (!ts.isStringLiteral(fa) && !ts.isNoSubstitutionTemplateLiteral(fa)) return null;
      return { pattern, flags: (fa as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral).text };
    }
    if (ts.isIdentifier(expr)) {
      const init = constInitializerOf(L, expr);
      if (init !== null) return staticRegexTextOf(L, init);
    }
    return null;
  }

/** The statically-known regex PATTERN behind an expression: a regex
   * literal, a const local initialized with one (the crypto.js
   * `const regexp = /(?<m>\d+)/` shape), or `new RegExp("...")` over a
   * string literal (the cooked text IS the pattern). Null when the regex
   * only exists at runtime — .groups consumers fence there. */
  export function staticRegexPatternOf(L: Lowerer, e: ts.Expression): string | null {
    let expr = e;
    for (;;) {
      if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) {
        expr = expr.expression;
        continue;
      }
      break;
    }
    if (ts.isRegularExpressionLiteral(expr)) {
      const text = expr.text;
      return text.slice(1, text.lastIndexOf("/"));
    }
    if (
      ts.isNewExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "RegExp" &&
      L.isStdlibGlobal(expr.expression, "RegExp") &&
      expr.arguments !== undefined &&
      expr.arguments.length >= 1 &&
      (ts.isStringLiteral(expr.arguments[0]!) || ts.isNoSubstitutionTemplateLiteral(expr.arguments[0]!))
    ) {
      return (expr.arguments[0] as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral).text;
    }
    if (ts.isIdentifier(expr)) {
      const init = constInitializerOf(L, expr);
      if (init !== null) return staticRegexPatternOf(L, init);
    }
    return null;
  }

/** The initializer behind a CONST identifier binding (a plain
   * VariableDeclaration under a const list) — the one-hop provenance step
   * the regex traces walk. Null for let/var (reassignable), params,
   * destructured bindings, and unresolvable names. */
  function constInitializerOf(L: Lowerer, ident: ts.Identifier): ts.Expression | null {
    const sym = L.resolveValueSymbol(ident);
    const decl = sym ? L.checker.valueDeclarationOf(sym) : undefined;
    if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return null;
    if (!ts.isVariableDeclarationList(decl.parent) || (decl.parent.flags & ts.NodeFlags.Const) === 0) return null;
    return decl.initializer;
  }

/** The named-group table of the regex that PRODUCED a match-result
   * expression — the `.groups` desugar's provenance question. Traces
   * (through parens, `!`, and const bindings):
   *   - `re.exec(s)` / `s.match(re)`   → re's static pattern
   *   - a matchAll ROW: `rows[i]`, the for-of binding over a direct
   *     `s.matchAll(re)` or a stored const drain → re's static pattern
   * Answers null when the producing regex isn't statically known (the
   * caller keeps its fence), or the groups list (possibly empty — a
   * traced regex WITHOUT named groups is the Node-undefined case). */
  export function matchResultNamedGroupsOf(L: Lowerer, e: ts.Expression): { name: string; index: number }[] | null {
    const reExpr = matchProducerRegexOf(L, e);
    if (reExpr === null) return null;
    const pattern = staticRegexPatternOf(L, reExpr);
    if (pattern === null) return null;
    return namedCaptureGroupsOfPattern(pattern);
  }

/** The regex EXPRESSION whose match produced `e` (see
   * matchResultNamedGroupsOf for the traced shapes). */
  function matchProducerRegexOf(L: Lowerer, e: ts.Expression): ts.Expression | null {
    let expr = e;
    for (;;) {
      if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) {
        expr = expr.expression;
        continue;
      }
      break;
    }
    // The direct producers: re.exec(s) / s.match(re) — the receiver's
    // mapped type pins the STDLIB operation (a regex for exec, a string
    // or its nullable spelling for match — the claim lower-containers
    // makes), so a user method that happens to be named `match` with a
    // regex argument never traces.
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      const name = expr.expression.name.text;
      const recvT = L.mapTypeOf(L.typeOf(expr.expression.expression));
      if (name === "exec" && expr.arguments.length === 1 && recvT?.kind === "regex") {
        return expr.expression.expression;
      }
      if (name === "match" && expr.arguments.length === 1 &&
          (recvT?.kind === "string" || (recvT !== null && recvT !== undefined && nullableStringType(L, recvT))) &&
          L.mapTypeOf(L.typeOf(expr.arguments[0]!))?.kind === "regex") {
        return expr.arguments[0]!;
      }
    }
    // A matchAll ROW by element access: rows[i] with rows tracing to the
    // drain call — or the direct s.matchAll(re)[i] spelling.
    if (ts.isElementAccessExpression(expr)) {
      return matchAllRegexOf(L, expr.expression);
    }
    if (ts.isIdentifier(expr)) {
      // The for-of binding over a matchAll drain: `for (const m of
      // s.matchAll(re))` (or over a stored const rows).
      const sym = L.resolveValueSymbol(expr);
      const decl = sym ? L.checker.valueDeclarationOf(sym) : undefined;
      if (
        decl !== undefined && ts.isVariableDeclaration(decl) &&
        ts.isVariableDeclarationList(decl.parent) && ts.isForOfStatement(decl.parent.parent)
      ) {
        return matchAllRegexOf(L, decl.parent.parent.expression);
      }
      // A stored const match result: `const m = re.exec(s)`.
      const init = constInitializerOf(L, expr);
      if (init !== null) return matchProducerRegexOf(L, init);
    }
    return null;
  }

/** The regex argument of a (possibly const-stored) `s.matchAll(re)`. */
  function matchAllRegexOf(L: Lowerer, e: ts.Expression): ts.Expression | null {
    let expr = e;
    for (;;) {
      if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) {
        expr = expr.expression;
        continue;
      }
      break;
    }
    if (
      ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "matchAll" && expr.arguments.length === 1 &&
      L.mapTypeOf(L.typeOf(expr.expression.expression))?.kind === "string" &&
      L.mapTypeOf(L.typeOf(expr.arguments[0]!))?.kind === "regex"
    ) {
      return expr.arguments[0]!;
    }
    // The eager-spread spelling: `[...s.matchAll(re)]`.
    if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 1) {
      const only = expr.elements[0]!;
      if (ts.isSpreadElement(only)) return matchAllRegexOf(L, only.expression);
    }
    if (ts.isIdentifier(expr)) {
      const init = constInitializerOf(L, expr);
      if (init !== null) return matchAllRegexOf(L, init);
    }
    return null;
  }

/** `m.groups` on a match result whose producing regex is statically
   * known: the honest slice already HOLDS every named group's value at
   * its capture index, so the groups object is a compile-time record
   * projection — `{ year: m[1], month: m[2] }` — built by one interned
   * helper per (shape, index list, receiver type). Node's exact shape
   * decisions:
   *   - no named groups → `undefined` (the identifier-receiver shapes —
   *     a call receiver would lose its own null trap, so those keep the
   *     member fence);
   *   - a nullable receiver (the JS `s.match(re).groups` idiom) throws
   *     Node's exact TypeError on the unit arms;
   *   - every declared name is a key (nonparticipating groups hold "" —
   *     divergence 51's rule, exactly the slice elements they project);
   *   - ES2025 duplicate names (distinct alternatives) project the first
   *     participating occurrence: at most one participates, and a
   *     participating-empty "" falls through to slots that are "" anyway;
   *   - key order is group declaration order (declaredOrder), Node's own.
   * The record has no prototype — Node's groups object is null-prototype,
   * observable only through util.inspect's "[Object: null prototype]"
   * prefix (the Object.groupBy stance, ledgered). Null when the receiver
   * isn't a match slice or the regex isn't traceable — the caller's
   * member fence (with the groups hint) names the gap. */
  export function lowerMatchGroupsRead(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (expr.name.text !== "groups" || expr.questionDotToken !== undefined) return null;
    const loc = locOf(expr);
    const strArr = arrayOf(STRING);
    const recvT = L.mapTypeOf(L.typeOf(expr.expression));
    if (!recvT || !isMatchSliceType(L, recvT) || !L.isStdlibMember(expr)) return null;
    const groups = matchResultNamedGroupsOf(L, expr.expression);
    if (groups === null) return null;
    if (groups.length === 0) {
      // Node: a match result of a group-less regex answers undefined —
      // the unit literal, exactly the `undefined` identifier's lowering.
      // Identifier receivers only (evaluation-free): a CALL receiver's
      // exec/match must still run and null-trap, which a folded unit
      // cannot carry — those keep the fence.
      let r: ts.Expression = expr.expression;
      while (ts.isParenthesizedExpression(r) || ts.isNonNullExpression(r)) r = r.expression;
      if (ts.isIdentifier(r) && typeEquals(recvT, strArr)) {
        return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc };
      }
      return null;
    }
    const recv = L.lowerExpr(expr.expression);
    if (!isMatchSliceType(L, recv.type)) return null;
    return lowerGroupsProjection(L, recv, groups, loc);
  }

/** True when the IR type is a string-or-units union — the Dict<string>
   * member spelling (`process.versions.openssl`), match's nullable
   * receiver claim. */
  function nullableStringType(L: Lowerer, t: IrType): boolean {
    if (t.kind !== "union") return false;
    const arms = L.unions.get(t.unionId)?.arms ?? [];
    return arms.some((a) => a.kind === "string") && arms.every((a) => a.kind === "string" || isUnitType(a));
  }

/** True when the IR type is the honest match slice — `string[]`, or a
   * union of it with unit arms only (`string[] | null`). The groups
   * projection's receiver gate, shared with the destructure interception. */
  export function isMatchSliceType(L: Lowerer, t: IrType): boolean {
    if (typeEquals(t, arrayOf(STRING))) return true;
    return t.kind === "union" && matchSliceUnionArms(L, t.unionId) !== null;
  }

/** The union-arm layout of a nullable match slice (`string[] | null`,
   * matchAll's checker spellings with undefined arms included): the
   * string[] arm's tag plus each unit arm's tag and spelling. Null when
   * the union holds anything else. */
  function matchSliceUnionArms(
    L: Lowerer,
    unionId: string,
  ): { arrTag: number; units: { tag: number; unit: "null" | "undefined" }[] } | null {
    const def = L.unions.get(unionId);
    if (!def) return null;
    const strArr = arrayOf(STRING);
    const arrTag = def.arms.findIndex((a) => typeEquals(a, strArr));
    if (arrTag < 0) return null;
    const units: { tag: number; unit: "null" | "undefined" }[] = [];
    for (let i = 0; i < def.arms.length; i++) {
      if (i === arrTag) continue;
      const a = def.arms[i]!;
      if (!isUnitType(a)) return null;
      units.push({ tag: i, unit: a.kind === "nullT" ? "null" : "undefined" });
    }
    return { arrTag, units };
  }

/** The groups-record projection call: the result is the CHECKER'S OWN
   * shape — `{ [key: string]: string }`, the hybrid index-signature
   * record with no declared fields — holding one OVERFLOW entry per
   * group name in declaration order, so every downstream consumer
   * (recordKeyGet reads, Object.keys, JSON, the `| undefined` union
   * wrap) meets exactly the type tsc reported. One lifted helper per
   * (index list, receiver representation) builds it; see
   * lowerMatchGroupsRead for the semantics the body encodes. */
  export function lowerGroupsProjection(
    L: Lowerer,
    recv: IrExpr,
    groups: { name: string; index: number }[],
    loc: SrcLoc,
  ): IrExpr {
    // Name → its capture indices, in declaration order (duplicates keep
    // every occurrence — the projection picks the participating one).
    const order: string[] = [];
    const indicesByName = new Map<string, number[]>();
    for (const g of groups) {
      const got = indicesByName.get(g.name);
      if (got) {
        got.push(g.index);
      } else {
        indicesByName.set(g.name, [g.index]);
        order.push(g.name);
      }
    }
    const shapeId = L.shapes.intern([], false, STRING);
    const recordT: IrType = { kind: "record", shapeId };
    const recvKey = recv.type.kind === "union" ? recv.type.unionId : "arr";
    const key = `regexgroups:${shapeId}:${groups.map((g) => `${g.name}=${g.index}`).join(",")}:${recvKey}`;
    let helper = L.widthHelpers.get(key);
    if (!helper) {
      helper = `%regex.groups.${L.widthHelpers.size}`;
      L.widthHelpers.set(key, helper);
      const body: IrStmt[] = [];
      const locals: IrLocal[] = [{ id: "m.0", name: "m", type: recv.type, mutable: true }];
      let mRef: IrExpr = { kind: "varRef", localId: "m.0", type: recv.type, loc };
      if (recv.type.kind === "union") {
        // Node's exact TypeError per unit arm, then the checked narrow.
        const arms = matchSliceUnionArms(L, recv.type.unionId)!;
        for (const u of arms.units) {
          body.push({
            kind: "if",
            cond: { kind: "unionIsTag", unionId: recv.type.unionId, tag: u.tag, negated: false, value: mRef, type: BOOL, loc },
            then: [
              {
                kind: "throw",
                value: {
                  kind: "libCall",
                  fn: "error.new",
                  args: [
                    { kind: "strLit", value: `Cannot read properties of ${u.unit} (reading 'groups')`, type: STRING, loc },
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
        }
        const narrowed: IrExpr = { kind: "unionNarrow", unionId: recv.type.unionId, tag: arms.arrTag, value: mRef, type: arrayOf(STRING), loc };
        locals.push({ id: "arr.0", name: "arr", type: arrayOf(STRING), mutable: false });
        body.push({ kind: "varDecl", localId: "arr.0", init: narrowed, loc });
        mRef = { kind: "varRef", localId: "arr.0", type: arrayOf(STRING), loc };
      }
      const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
      const elem = (index: number): IrExpr => ({ kind: "arrayGet", arr: mRef, index: num(index), type: STRING, loc });
      const values = new Map<string, IrExpr>();
      order.forEach((name, i) => {
        const idxs = indicesByName.get(name)!;
        if (idxs.length === 1) {
          values.set(name, elem(idxs[0]!));
          return;
        }
        // Duplicates: the first non-"" occurrence (at most one
        // participates; all-"" answers "" like any nonparticipating slot).
        const id = `g${i}.0`;
        locals.push({ id, name: `g${i}`, type: STRING, mutable: true });
        body.push({ kind: "varDecl", localId: id, init: elem(idxs[0]!), loc });
        const gRef: IrExpr = { kind: "varRef", localId: id, type: STRING, loc };
        for (const idx of idxs.slice(1)) {
          body.push({
            kind: "if",
            cond: { kind: "strEq", negated: false, left: gRef, right: { kind: "strLit", value: "", type: STRING, loc }, type: BOOL, loc },
            then: [{ kind: "assign", localId: id, value: elem(idx), loc }],
            else_: null,
            loc,
          });
        }
        values.set(name, gRef);
      });
      body.push({
        kind: "return",
        value: {
          kind: "recordLit",
          fields: order.map((name) => ({ name, value: values.get(name)!, overflow: true as const })),
          type: recordT,
          loc,
        },
        loc,
      });
      L.liftedFns.push({
        name: helper,
        params: [{ localId: "m.0", name: "m", type: recv.type }],
        returnType: recordT,
        locals,
        body,
        loc,
      });
    }
    return { kind: "call", callee: helper, args: [recv], type: recordT, loc };
  }

/** Field read `obj.f` on class-instance and record receivers, through the
   * shared FieldTarget union (fieldGet / recordGet). Bound method references
   * on classes are rejected specifically; func-typed record fields are
   * ordinary closure values, so bare references to them work (unlike class
   * methods, which have no bound-value form). */
  export function lowerFieldRead(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    const target = L.fieldTarget(expr);
    if (target) return L.fieldGetExpr(target, locOf(expr), expr);
    if (L.chainBlocked(expr)) return null;
    const receiverIr = L.mapTypeOf(L.typeOf(expr.expression));
    if (
      receiverIr?.kind === "object" &&
      (L.findMethodOn(L.classes.get(receiverIr.className) ?? null, expr.name.text) ||
        findGenericMethodOn(L, L.classes.get(receiverIr.className) ?? null, expr.name.text))
    ) {
      L.unsupported("SC1090", expr, `bound method references (call '${expr.name.text}' directly)`);
    }
    // An object-literal GENERIC method as a VALUE (`o.m` — the member is
    // excluded from the record shape): the pinned-value rule verbatim when
    // the receiver is the defining literal's own const binding (the value
    // is the pinned instance's closure — no `this` exists); anything else
    // fences by name inside the helpers.
    {
      const propSym = L.checker.getPropertyOfType(L.typeOf(expr.expression), expr.name.text);
      if (
        receiverIr?.kind !== "object" && propSym &&
        isGenericCallableMemberType(L.checker.getTypeOfSymbol(propSym), L.checker) &&
        // CLASS members keep the class-path fences (a poisoned class's own
        // diagnostics, the bound-method fence above).
        !L.checker.declarationsOf(propSym).some(
          (d) => d.parent !== undefined && (ts.isClassDeclaration(d.parent) || ts.isClassExpression(d.parent)),
        )
      ) {
        const found = objLitGenericFnNodeOf(L, propSym);
        if (!found) {
          L.unsupported(
            "SC1090",
            expr,
            `the generic method '${expr.name.text}' as a value with no defining object literal (only methods declared with a body in an object literal compile)`,
          );
        }
        requireObjLitGenericReceiver(L, expr, expr.expression, found.literal, expr.name.text);
        return L.lowerGenericFnValue(expr, objLitGenericFnInfoOf(L, expr, expr.name.text, found));
      }
    }
    // Dot access to an UNDECLARED key of an index-signature shape
    // (`bag.count` on `Record<string, number>`): tsc allows it without
    // noPropertyAccessFromIndexSignature, but the bracket spelling is the
    // canonical index-signature form here — point at it.
    if (receiverIr?.kind === "record") {
      const shape = L.shapes.get(receiverIr.shapeId);
      if (shape?.indexValue && !shape.fields.some((f) => f.name === expr.name.text)) {
        L.unsupported(
          "SC1090",
          expr,
          `dot access to index-signature keys (spell it r["${expr.name.text}"] — brackets are the index-signature form)`,
        );
      }
    }
    // `t.length` on a tuple: the arity CONSTANT (tuples are fixed-shape —
    // the checker types it as the literal arity too). Folding discards the
    // receiver's evaluation, so only side-effect-free receivers fold;
    // anything else (a call result) binds to a const first.
    if (receiverIr?.kind === "record" && expr.name.text === "length") {
      const shape = L.shapes.get(receiverIr.shapeId);
      if (shape?.tuple) {
        let root: ts.Expression = expr.expression;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (!ts.isIdentifier(root) && root.kind !== ts.SyntaxKind.ThisKeyword) {
          L.unsupported(
            "SC1090",
            expr,
            "'.length' of a computed tuple expression (the arity is a constant — bind the tuple to a const first)",
          );
        }
        return { kind: "numLit", value: shape.fields.length, type: F64, loc: locOf(expr) };
      }
    }
    return null;
  }

/** Shared-field read `r.f` on a UNION receiver: supported exactly when
   * every arm is a record/class possessing the field with ONE shared IR
   * type — the discriminant pattern (`r.kind`, primitive) and the
   * shared-payload pattern (`spec.config` where every ServiceSpec arm
   * carries the same record). Lowers to `unionDisc` (the backend switches
   * on the runtime tag and reads the field from the concrete arm), which
   * composes with existing strEq/bin/switch nodes, so `r.kind === "ok"`
   * and `switch (r.kind)` work without dedicated test nodes. Anything else
   * on a union receiver is rejected specifically (narrow first). */
  export function lowerUnionProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (L.chainBlocked(expr)) return null;
    const receiverIr = L.mapTypeOf(L.typeOf(expr.expression));
    if (receiverIr?.kind !== "union") return null;
    // Lower the receiver FIRST and read its actual IR union: a partially
    // narrowed receiver (checker type = a SUB-union of the binding's union)
    // stays the full union at runtime, and the tag switch must cover the
    // full union's arms.
    const value = L.lowerExpr(expr.expression);
    // A checker-union receiver whose VALUE lowered to a plain RECORD (the
    // merged-signature fiction — `runner(cmd, args)` where runner joined
    // a structural runner type with spawnSync's, and the local adopted
    // the record arm): read the record field directly, the dyn-receiver
    // fallback's discipline.
    // A checker-union receiver whose VALUE lowered checked-dynamic (a
    // never-tainted JS chain — `cmd[1].length` on `const cmd = ['pwd',
    // []]`, where the element read stayed a dyn node): read through the
    // dyn keyed read like the unmappable-receiver path below the chain.
    if (value.type.kind === "dyn") {
      const key: IrExpr = { kind: "strLit", value: expr.name.text, type: STRING, loc: locOf(expr.name) };
      return { kind: "dynKeyGet", key, value, type: DYN, loc: locOf(expr) };
    }
    if (value.type.kind === "record") {
      const shape = L.shapes.get(value.type.shapeId);
      const f = shape?.fields.find((x) => x.name === expr.name.text);
      if (f) {
        return {
          kind: "recordGet",
          obj: value,
          shapeId: value.type.shapeId,
          field: f.name,
          type: f.type,
          loc: locOf(expr),
        };
      }
      return null;
    }
    if (value.type.kind !== "union") {
      throw new Error("lowerer bug: union-typed receiver lowered to a non-union");
    }
    const field = expr.name.text;
    const wide = lowerUnionFieldRead(L, expr, value, field);
    if (wide) return wide;
    // The WIDE union cannot answer, but the CHECKER's picture at this site
    // may be a strict SUB-union that can — `isSendMediaMessage(content)`
    // leaves `content` a seven-arm media union while the value still
    // carries the whole `WaSendMessageContent`, string arm included.
    // Control-flow narrowing erases at lowering, so re-tag the value into
    // the narrowed union first: narrowedRetagHelper maps the arms the
    // checker kept and compiles the ones it proved away to catchable
    // TypeError cases (divergence 38's trust-the-checker stance, already
    // the rule for a narrowed union flowing into a narrower slot). Probed
    // against a dummy receiver FIRST so a read that still cannot be served
    // never orphans an interned re-tag helper.
    if (value.type.unionId !== receiverIr.unionId) {
      const probe: IrExpr = { kind: "varRef", localId: "%urprobe", type: receiverIr, loc: locOf(expr) };
      if (lowerUnionFieldRead(L, expr, probe, field)) {
        const h = L.narrowedRetagHelper(expr.expression, value.type.unionId, receiverIr.unionId, locOf(expr));
        if (h) {
          const recv: IrExpr = { kind: "call", callee: h, args: [value], type: receiverIr, loc: locOf(expr) };
          const narrowed = lowerUnionFieldRead(L, expr, recv, field);
          if (narrowed) return narrowed;
        }
      }
    }
    L.unsupported(
      "SC1090",
      expr,
      `reading '${field}' on a union-typed value (every arm must be an object/record ` +
        `with a same-typed field '${field}'; ` +
        `${NARROW_FIRST})`,
    );
  }

  /** The three ways a union receiver answers a literal field read, in
   * order: the shared-type discriminant read (unionDisc), the joined
   * keyed read (unionKeyGet), and the per-arm CONVERTING read for a join
   * an arm's declared answer only reaches through the width relation.
   * Null when none of them can serve the pair — the caller owns the fence
   * message and the narrowed-receiver retry. `value` is typed by the
   * union being read, which is NOT always the value the receiver lowered
   * to (the retry passes a re-tagged one). */
  function lowerUnionFieldRead(L: Lowerer, expr: ts.PropertyAccessExpression, value: IrExpr, field: string): IrExpr | null {
    if (value.type.kind !== "union") return null;
    const def = L.unions.get(value.type.unionId);
    if (!def) throw new Error(`lowerer bug: unknown union ${value.type.unionId}`);
    let common: IrType | null = null;
    for (const arm of def.arms) {
      let ft: IrType | undefined;
      if (arm.kind === "record") {
        ft = L.shapes.get(arm.shapeId)?.fields.find((f) => f.name === field)?.type;
      } else if (arm.kind === "object") {
        ft = L.classes.get(arm.className)?.fields.get(field);
      }
      if (!ft || ft.kind === "void" || isUnitType(ft) || (common && !typeEquals(common, ft))) {
        common = null;
        break;
      }
      common = ft;
    }
    if (common) {
      return {
        kind: "unionDisc",
        unionId: value.type.unionId,
        field,
        value,
        type: common,
        loc: locOf(expr),
      };
    }
    // The arms answer DIFFERENT types (or through index signatures / unit
    // arms): the JOIN path — `env.PORTLESS_PORT` on `ProcessEnv |
    // Record<string, string>`, the tail read of `loaded?.config.script`.
    const key: IrExpr = { kind: "strLit", value: field, type: STRING, loc: locOf(expr.name) };
    const keyed = lowerUnionKeyedRead(L, expr, value.type.unionId, value, key, field);
    if (keyed) return keyed;
    const joined = lowerUnionFieldJoinRead(L, expr, value, field);
    if (joined) return joined;
    return lowerUnionIntrinsicLengthRead(L, expr, value, field);
  }

  /** The FOURTH way a union receiver answers a literal read, and the only
   * one whose arms declare no field at all: `.length` over a union of
   * INTRINSIC arms. `inner.content.length` on
   * `Uint8Array | string | readonly BinaryNode[]` reads a field all three
   * arms answer in JavaScript and none of them answers in the IR — the
   * three paths above walk `def.arms` looking for a declared field and a
   * `bytes`/`string`/`array` arm has none, so the whole read declines and
   * the caller fences. There is nothing to look up: each arm's length is
   * an INTRINSIC of that arm's own representation
   * (`bytesIntrinsic`/`strIntrinsic`/`arrIntrinsic`), every one already
   * typed f64, so the join is f64 and the answer is a tag switch over the
   * three reads — the same lifted-function shape lowerUnionFieldJoinRead
   * writes, with the recordGet replaced by the arm's intrinsic.
   *
   * `length` is the whole rule, deliberately. It is the one name every
   * one of these representations answers with the SAME meaning the direct
   * read gives (this helper emits the identical node the non-union path
   * emits for that arm, so a union read and a narrowed read cannot
   * disagree). `byteLength` is NOT here: only the bytes arm answers it,
   * and inventing an answer for the other two is the wrong-answer trade
   * this codebase reverts.
   *
   * A UNIT arm is the `content?:` case, and it does not decline: it is
   * exactly the arm the checker proved away (the read only reaches here
   * behind `Array.isArray(...)` or a narrowing the lowering erased), so
   * it takes the stranded-arm stance unionRetagHelper already draws —
   * a runtime case throwing the CATCHABLE TypeError Node itself throws,
   * word for word ("Cannot read properties of undefined (reading
   * 'length')"). Sound narrowing never reaches it; an unsound one throws
   * what Node throws instead of answering a made-up number. At least one
   * arm must be intrinsic, so a unit-only union still declines. */
  function lowerUnionIntrinsicLengthRead(L: Lowerer, expr: ts.PropertyAccessExpression, value: IrExpr, field: string): IrExpr | null {
    if (field !== "length") return null;
    if (value.type.kind !== "union") return null;
    const fromId = value.type.unionId;
    const def = L.unions.get(fromId);
    if (!def || def.arms.length === 0) return null;
    const INTRINSIC = { bytes: "bytesIntrinsic", string: "strIntrinsic", array: "arrIntrinsic" } as const;
    const nodeKindOf = (k: string): (typeof INTRINSIC)[keyof typeof INTRINSIC] | null =>
      k === "bytes" || k === "string" || k === "array" ? INTRINSIC[k] : null;
    let intrinsicArms = 0;
    for (const arm of def.arms) {
      if (nodeKindOf(arm.kind) !== null) intrinsicArms++;
      else if (!isUnitType(arm)) return null;
    }
    if (intrinsicArms === 0) return null;
    const loc = locOf(expr);
    const key = `ulength:${fromId}`;
    let name = L.widthHelpers.get(key);
    if (name === undefined) {
      name = `%union.length.${L.widthHelpers.size}`;
      L.widthHelpers.set(key, name);
      const fromT: IrType = { kind: "union", unionId: fromId };
      const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
      const body: IrStmt[] = [];
      def.arms.forEach((arm, i) => {
        const nk = nodeKindOf(arm.kind);
        const read: IrExpr =
          nk === null
            ? nodeThrowExpr(
                1,
                "",
                `Cannot read properties of ${arm.kind === "undefinedT" ? "undefined" : "null"} (reading 'length')`,
                F64,
                loc,
              )
            : ({
                kind: nk,
                method: "length",
                receiver: { kind: "unionNarrow", unionId: fromId, tag: i, value: u, type: arm, loc },
                args: [],
                type: F64,
                loc,
              } as unknown as IrExpr);
        body.push({
          kind: "if",
          cond: { kind: "unionIsTag", unionId: fromId, tag: i, negated: false, value: u, type: BOOL, loc },
          then: [{ kind: "return", value: read, loc }],
          else_: null,
          loc,
        });
      });
      // Unreachable while the tag is one of the arms' — the same backstop
      // lowerUnionFieldJoinRead writes.
      body.push({
        kind: "throw",
        value: { kind: "strLit", value: "scriptc: internal error: invalid union tag", type: STRING, loc },
        loc,
      });
      L.liftedFns.push({
        name,
        params: [{ localId: "u.0", name: "u", type: fromT }],
        returnType: F64,
        locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
        body,
        loc,
      });
    }
    return { kind: "call", callee: name, args: [value], type: F64, loc };
  }

  /** unionKeyGet's arm answers must SURFACE as the join — each is the join
   * itself or one of its arms, so the emitted switch case can wrap a bare
   * payload and be done. An arm whose declared answer is a UNION cannot:
   * a `null`-typed field is the unit-only `null | undefined` union (a lone
   * unit arm has no representation), so `{socket: Sock} | {socket: null}`
   * joins to `Sock | null | undefined` with one arm needing a RE-TAG, not a
   * wrap. That conversion exists — it is widthLiftPlan's `retag` — but it
   * is a call, not an expression the tag switch can inline, so this form
   * lifts the whole read into a function: one tag test per arm, the
   * narrowed payload's field, and the planned conversion into the join.
   * Every arm must declare the field and every conversion must plan
   * (purely, before anything interns); index-signature arms stay with
   * unionKeyGet, whose helper owns the missing-key policy. */
  function lowerUnionFieldJoinRead(L: Lowerer, expr: ts.PropertyAccessExpression, value: IrExpr, field: string): IrExpr | null {
    if (value.type.kind !== "union") return null;
    const fromId = value.type.unionId;
    const def = L.unions.get(fromId);
    if (!def || def.arms.length === 0) return null;
    const declared: IrType[] = [];
    for (const arm of def.arms) {
      if (arm.kind !== "record") return null;
      const shape = L.shapes.get(arm.shapeId);
      if (!shape || shape.tuple) return null;
      const ft = shape.fields.find((f) => f.name === field)?.type;
      if (!ft || ft.kind === "void" || isUnitType(ft)) return null;
      declared.push(ft);
    }
    // The join is the flattened set of the arms' answers, exactly as
    // lowerUnionKeyedRead builds it — a union answer contributes its own
    // arms, so `Sock | (null | undefined)` joins to three arms, not two.
    const joinArms: IrType[] = [];
    const seen = new Set<string>();
    for (const t of declared) {
      const parts = t.kind === "union" ? L.unions.get(t.unionId)?.arms : [t];
      if (!parts) return null;
      for (const a of parts) {
        const k = typeKey(a);
        if (!seen.has(k)) {
          seen.add(k);
          joinArms.push(a);
        }
      }
    }
    if (joinArms.length === 0) return null;
    if (
      joinArms.length > 1 &&
      (!unionFuncSetArmsOk(joinArms) ||
        joinArms.some((a) => a.kind === "map" || a.kind === "dyn" || a.kind === "jsval" || a.kind === "generator" || a.kind === "caught"))
    ) {
      return null;
    }
    joinArms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    const join: IrType =
      joinArms.length === 1 ? joinArms[0]! : { kind: "union", unionId: L.unions.intern(joinArms) };
    // A single-arm join is unionDisc's job and it already declined (a unit
    // field, a void field); nothing here improves on that.
    if (join.kind !== "union") return null;
    const loc = locOf(expr);
    // Plan every conversion BEFORE interning, so a later arm that cannot
    // convert never leaves a half-built helper behind.
    const plans = declared.map((t) => (typeEquals(t, join) ? { how: "copy" as const } : L.widthLiftPlan(t, join)));
    if (plans.some((pl) => pl === null)) return null;
    const key = `ufield:${fromId}:${field}:${typeKey(join)}`;
    let name = L.widthHelpers.get(key);
    if (name === undefined) {
      name = `%union.field.${L.widthHelpers.size}`;
      L.widthHelpers.set(key, name);
      const fromT: IrType = { kind: "union", unionId: fromId };
      const u: IrExpr = { kind: "varRef", localId: "u.0", type: fromT, loc };
      const body: IrStmt[] = [];
      def.arms.forEach((arm, i) => {
        const narrowed: IrExpr = { kind: "unionNarrow", unionId: fromId, tag: i, value: u, type: arm, loc };
        const read: IrExpr = {
          kind: "recordGet",
          obj: narrowed,
          shapeId: (arm as IrType & { kind: "record" }).shapeId,
          field,
          type: declared[i]!,
          loc,
        };
        body.push({
          kind: "if",
          cond: { kind: "unionIsTag", unionId: fromId, tag: i, negated: false, value: u, type: BOOL, loc },
          then: [{ kind: "return", value: L.applyWidthLift(plans[i]!, read, join, loc), loc }],
          else_: null,
          loc,
        });
      });
      // Unreachable while the tag is one of the arms' — the same backstop
      // unionRetagHelper writes, and what keeps a corrupted tag loud
      // instead of returning an uninitialised slot.
      body.push({
        kind: "throw",
        value: { kind: "strLit", value: "scriptc: internal error: invalid union tag", type: STRING, loc },
        loc,
      });
      L.liftedFns.push({
        name,
        params: [{ localId: "u.0", name: "u", type: fromT }],
        returnType: join,
        locals: [{ id: "u.0", name: "u", type: fromT, mutable: true }],
        body,
        loc,
      });
    }
    return { kind: "call", callee: name, args: [value], type: join, loc };
  }

/** The unionDisc generalization: a keyed read on a union receiver whose
   * arms answer DIFFERENT (but joinable) types. Each arm contributes its
   * declared answer — a declared field's type (literal keys), an
   * index-signature arm's value type (plus its declared fields' types for
   * runtime keys, which reach them through the keyed-read helper), and
   * UNDEFINED for unit arms (reachable only through optional-chain tails,
   * where JS short-circuits to undefined; a unit arm the checker narrowed
   * away is simply unreachable). The result type is the JOIN of those
   * answers; every arm's answer must be the join itself or one of its
   * arms (sub-union RE-TAGGING between distinct unions stays fenced).
   * Returns null when any arm cannot answer — the caller owns the fence
   * message. The caller (the property/element dispatch) maybeNarrows. */
  function lowerUnionKeyedRead(L: Lowerer, expr: ts.Expression,
    unionId: string,
    value: IrExpr,
    key: IrExpr,
    literalField: string | null,): IrExpr | null {
    const def = L.unions.get(unionId);
    if (!def) return null;
    // Pass 1: per-arm declared answers, joined into the result type.
    const joinArms: IrType[] = [];
    const seen = new Set<string>();
    const push = (t: IrType): void => {
      const k = typeKey(t);
      if (!seen.has(k)) {
        seen.add(k);
        joinArms.push(t);
      }
    };
    const pushAnswer = (t: IrType): boolean => {
      if (t.kind === "void") return false;
      if (t.kind === "union") {
        const inner = L.unions.get(t.unionId);
        if (!inner) return false;
        for (const a of inner.arms) push(a);
        return true;
      }
      push(t);
      return true;
    };
    for (const arm of def.arms) {
      if (isUnitType(arm)) {
        push(UNDEFINED_T);
        continue;
      }
      if (arm.kind !== "record") return null;
      const shape = L.shapes.get(arm.shapeId);
      if (!shape || shape.tuple) return null;
      const declared =
        literalField !== null ? shape.fields.find((f) => f.name === literalField)?.type : undefined;
      if (declared) {
        if (!pushAnswer(declared)) return null;
        continue;
      }
      // Runtime keys can reach the declared fields through the keyed-read
      // helper's string switch — every one joins.
      if (literalField === null) {
        for (const f of shape.fields) if (!pushAnswer(f.type)) return null;
      }
      if (!shape.indexValue) {
        if (literalField === null && shape.fields.length > 0) continue;
        return null;
      }
      if (!pushAnswer(shape.indexValue)) return null;
    }
    if (joinArms.length === 0) return null;
    // The join must be a BUILDABLE union: arm kinds the union invariants
    // admit (no map/dyn/jsval/generator arms; func arms only beside
    // func/unit siblings — unionFuncSetArmsOk, the validator's rule). A
    // join mixing, say, a func answer with data answers has no union to
    // surface as; the caller owns the fence message.
    if (
      joinArms.length > 1 &&
      (!unionFuncSetArmsOk(joinArms) ||
        joinArms.some((a) => a.kind === "map" || a.kind === "dyn" || a.kind === "jsval" || a.kind === "generator" || a.kind === "caught"))
    ) {
      return null;
    }
    joinArms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    const type: IrType =
      joinArms.length === 1 ? joinArms[0]! : { kind: "union", unionId: L.unions.intern(joinArms) };
    // Pass 2: every arm's answer must SURFACE as the join, and index arms
    // must pass the single-record keyed-read constraints (the helper is
    // shared with recordKeyGet, its missing-key policy included).
    const surfaces = (t: IrType): boolean =>
      typeEquals(t, type) || (type.kind === "union" && L.armTag(type.unionId, t) >= 0);
    for (const arm of def.arms) {
      if (isUnitType(arm)) {
        if (!(type.kind === "union" && L.armTag(type.unionId, UNDEFINED_T) >= 0)) return null;
        continue;
      }
      if (arm.kind !== "record") return null;
      const shape = L.shapes.get(arm.shapeId);
      if (!shape) return null;
      const declared =
        literalField !== null ? shape.fields.find((f) => f.name === literalField)?.type : undefined;
      if (declared) {
        if (!surfaces(declared)) return null;
        continue;
      }
      const ovfShape = literalField !== null && shape.indexValue ? { ...shape, fields: [] } : shape;
      if (!recordKeyResultOk(L, ovfShape, type)) return null;
    }
    return { kind: "unionKeyGet", unionId, key, value, type, loc: locOf(expr) };
  }

/** Recognizes `obj.field` as an assignable field target: receiver is a
   * known class instance OR a record, and the member is a field or (class
   * receivers) a declared accessor property. Returns the pieces of a
   * fieldSet/recordSet/accessor-call (minus value/kind) or null. */
  export function fieldTarget(L: Lowerer, access: ts.PropertyAccessExpression): FieldTarget | null {
    if (L.chainBlocked(access)) return null;
    const receiverIr = L.mapTypeOf(L.typeOf(access.expression));
    if (receiverIr?.kind === "object") {
      const info = L.classes.get(receiverIr.className);
      if (!info) {
        // A receiver typed as a class whose collection deferred: the
        // deferred diagnostics are what explains the miss.
        L.flushDeferredClass(receiverIr.className);
        return null;
      }
      const fieldType = info.fields.get(access.name.text);
      if (fieldType) {
        const obj = L.lowerExpr(access.expression);
        return { container: "class", obj, className: receiverIr.className, field: access.name.text, fieldType };
      }
      // Accessor property: either half declared anywhere on the chain
      // makes the name an accessor target (fields and accessors share a
      // namespace — tsc rejects mixing them, so the halves agree on kind).
      const getF = L.findMethodOn(info, `get:${access.name.text}`);
      const setF = L.findMethodOn(info, `set:${access.name.text}`);
      if (getF || setF) {
        const obj = L.lowerExpr(access.expression);
        return {
          container: "accessor",
          obj,
          className: receiverIr.className,
          field: access.name.text,
          fieldType: getF ? getF.sig.ret : setF!.sig.params[0]!.type,
        };
      }
      return null;
    }
    if (receiverIr?.kind === "record") {
      const shape = L.shapes.get(receiverIr.shapeId);
      const fieldType = shape?.fields.find((f) => f.name === access.name.text)?.type;
      if (fieldType) {
        const obj = L.lowerExpr(access.expression);
        // A checker-record receiver whose VALUE stayed dyn (the erased
        // all-unknown-fields cast — `(err as { code?: unknown }).code`):
        // decline, and the dyn keyed-read fallback answers.
        if (obj.type.kind !== "record") {
          // The ADOPTED-INSTANCE write. The checker says record (the
          // binding's declared interface) while the VALUE is the class
          // instance lowerVarDecl's adoption arm kept, so the record
          // branch above resolved the member against a shape the value
          // never had. The adoption rule promises members "read as the
          // class's own"; its READ half is rescued at lowerFieldRead's
          // last-resort fence and its CALL half at lowerObjectMethodCall's,
          // but the WRITE half never was — `x.v = 1` through an adopted
          // binding fell all the way to "assignment to non-variables",
          // which is a FENCE, so nothing that compiles today reaches here.
          // Same authority as the read's: the flattened instance-field map
          // (inherited members included). An accessor-satisfied name has no
          // data slot and a method name is a bound reference, so both keep
          // the older fences, exactly the line the read rescue draws.
          if (obj.type.kind === "object") {
            const adoptedInfo = L.classes.get(obj.type.className);
            const adoptedFieldT = adoptedInfo?.fields.get(access.name.text);
            if (
              adoptedInfo !== undefined &&
              adoptedFieldT !== undefined &&
              L.findMethodOn(adoptedInfo, `get:${access.name.text}`) === null &&
              L.findMethodOn(adoptedInfo, `set:${access.name.text}`) === null &&
              L.findMethodOn(adoptedInfo, access.name.text) === null
            ) {
              return {
                container: "class",
                obj,
                className: obj.type.className,
                field: access.name.text,
                fieldType: adoptedFieldT,
              };
            }
          }
          return null;
        }
        // A user type-guard narrowing to `T & { f: … }` refines the
        // receiver's CHECKER shape to a SIBLING record (same fields, a
        // tighter member type — `exposeAs?: string` → `exposeAs: string`)
        // while the VALUE keeps its declared shape AND slot layout. Read the
        // field off the shape the VALUE actually has — its slot is what
        // exists at runtime — and let lowerFieldRead's maybeNarrow refine
        // the result to the narrowed occurrence type. Decline only if that
        // shape lacks the field (a genuinely different record).
        if (obj.type.shapeId !== receiverIr.shapeId) {
          const vField = L.shapes.get(obj.type.shapeId)?.fields.find((f) => f.name === access.name.text)?.type;
          if (!vField) return null;
          return { container: "record", obj, shapeId: obj.type.shapeId, field: access.name.text, fieldType: vField };
        }
        return { container: "record", obj, shapeId: receiverIr.shapeId, field: access.name.text, fieldType };
      }
      // A RECORD accessor property: either slot present makes the name an
      // accessor target (get/set share the property namespace — tsc
      // rejects mixing an accessor with a data property, so the halves
      // agree). Reads dispatch the %get: closure, writes the %set: one.
      {
        const getSlot = shape?.fields.find((f) => f.name === `%get:${access.name.text}`)?.type;
        const setSlot = shape?.fields.find((f) => f.name === `%set:${access.name.text}`)?.type;
        if (getSlot?.kind === "func" || setSlot?.kind === "func") {
          const obj = L.lowerExpr(access.expression);
          if (obj.type.kind !== "record") return null; // dyn-valued receiver: the keyed fallback answers
          const getType = getSlot?.kind === "func" ? getSlot : undefined;
          const setType = setSlot?.kind === "func" ? setSlot : undefined;
          return {
            container: "recordAccessor",
            obj,
            shapeId: receiverIr.shapeId,
            field: access.name.text,
            fieldType: getType ? getType.ret : setType!.params[0]!,
            ...(getType ? { getType } : {}),
            ...(setType ? { setType } : {}),
          };
        }
      }
      // Dot access to an UNDECLARED key of an index-signature shape: tsc
      // types it through the signature — the access resolves to NO property
      // symbol (mapped types like Record<string, T>) or to the signature's
      // own `__index` symbol (interface-declared signatures). A real member
      // symbol means a lib member like `toString` — not an index access;
      // those keep their fences below. It IS the bracket access in dot
      // spelling — the same overflow path.
      const nameSym = L.checker.getSymbolAtLocation(access.name);
      if (shape?.indexValue && !shape.tuple) {
        // A member the shape CANONICALIZATION dropped into the overflow
        // (the header family: @types declares `host?: string` on
        // IncomingHttpHeaders while the canonical shape is a pure index
        // record) is the bracket access in dot spelling too: a PROPERTY
        // declaration whose own type fits within the index value. METHOD
        // members (`toString` — the lib's inherited surface) keep their
        // fences: JS finds the prototype function, never an overflow miss.
        const canonicalized = (): boolean => {
          if (!nameSym) return false;
          const nameDecls = L.checker.declarationsOf(nameSym);
          if (!nameDecls.length) return false;
          if (!nameDecls.every((d) => ts.isPropertySignature(d))) return false;
          const declared = L.mapTypeOf(L.typeOf(access));
          if (!declared) return false;
          const iv = shape.indexValue!;
          if (typeEquals(declared, iv)) return true;
          if (iv.kind !== "union") return false;
          const ivArms = L.unions.get(iv.unionId)?.arms;
          if (!ivArms) return false;
          const declaredArms =
            declared.kind === "union" ? (L.unions.get(declared.unionId)?.arms ?? [declared]) : [declared];
          return declaredArms.every((a) => ivArms.some((b) => typeEquals(a, b)));
        };
        if (!nameSym || nameSym.name === ts.InternalSymbolName.Index || canonicalized()) {
          const obj = L.lowerExpr(access.expression);
          return { container: "recordOvf", obj, shapeId: receiverIr.shapeId, field: access.name.text, fieldType: shape.indexValue };
        }
      }
      return null;
    }
    return null;
  }

/** A STATICALLY-RESOLVABLE unique-symbol key: an identifier whose value
   * resolves (imports included) to a module-level `const k = Symbol(...)`
   * with no description or a literal one. tsc types such a const `unique
   * symbol` — a compile-time identity — so a `this[k]` member is an
   * ordinary hidden field of the static layout, named in Node's inspect
   * spelling (`Symbol(limit)`). Everything else is null and keeps the
   * symbol fences: `symbol`-typed parameters and locals (identity known
   * only at runtime), `Symbol.for(...)` consts (two distinct consts can
   * alias ONE runtime symbol through the global registry — tsc still
   * types them as distinct unique symbols, so static slots would split
   * what JS shares), and computed descriptions (the field name below
   * must BE Node's, for inspect). */
  export function uniqueSymbolKeyOf(L: Lowerer, key: ts.Expression): { sym: ts.Symbol; fieldName: string } | null {
    if (!ts.isIdentifier(key)) return null;
    const t = L.typeOf(key);
    // tsgo WIDENS a unique-symbol const's type to plain `symbol` through a
    // CJS require alias (5.9.3 kept `unique symbol` — the finding-5
    // family), so plain symbol passes this early filter too: every
    // correctness-bearing check is the DECLARATION-shape battery below
    // (module-level const initialized by a literal-description Symbol()),
    // which a runtime-identity symbol value can never satisfy.
    if (!(t.flags & (ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.ESSymbol))) return null;
    const sym = L.resolveValueSymbol(key);
    const decl = sym ? L.checker.valueDeclarationOf(sym) : undefined;
    if (!sym || !decl || !ts.isVariableDeclaration(decl)) return null;
    if (!(ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const)) return null;
    // Module level only: a unique-symbol const inside a FUNCTION is a
    // fresh runtime identity per call — one static slot would conflate
    // what JS keeps distinct.
    if (!ts.isVariableStatement(decl.parent.parent) || !ts.isSourceFile(decl.parent.parent.parent)) return null;
    const init = decl.initializer;
    if (!init || !ts.isCallExpression(init) || init.questionDotToken) return null;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== "Symbol") return null;
    if (!L.isStdlibSymbol(L.checker.getSymbolAtLocation(init.expression))) return null;
    const arg = init.arguments.length === 0 ? null : init.arguments.length === 1 ? init.arguments[0]! : undefined;
    if (arg === undefined) return null;
    if (arg !== null && !ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) return null;
    // Symbol() and Symbol('') both print `Symbol()` — Node's toString.
    return { sym, fieldName: `Symbol(${arg?.text ?? ""})` };
  }

/** The KEY symbol behind a LATE-BOUND (`__@name@id`) member declared in
   * TYPE position — `{ [K]?: T }`, the laundering cast's spelling — where
   * the declaration is a computed property signature rather than the
   * element-access ASSIGNMENT lateBoundKeySymOf reads. Kept separate from
   * that helper deliberately: it feeds only the hidden-slot agreement
   * check, and widening lateBoundKeySymOf itself would change which
   * late-bound class properties the JS constructor scan considers already
   * declared. */
  function declaredSymbolKeyOf(L: Lowerer, p: ts.Symbol): ts.Symbol | null {
    for (const d of L.checker.declarationsOf(p)) {
      const nm =
        (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) &&
        d.name !== undefined && ts.isComputedPropertyName(d.name)
          ? d.name.expression
          : null;
      if (!nm || !ts.isIdentifier(nm)) continue;
      const sym = L.resolveValueSymbol(nm);
      if (sym) return sym;
    }
    return null;
  }

/** The declared symbol-keyed field (class name / layout field / type)
   * `expr` resolves to, WITHOUT lowering the receiver — the routing test
   * for the wiring sites (statement dispatch must not emit anything when
   * it declines). Null off class receivers, for non-static keys, and for
   * keys no class on the chain declares. */
  export function symbolFieldInfo(L: Lowerer, expr: ts.ElementAccessExpression,): { className: string; field: string; fieldType: IrType } | null {
    if (L.chainBlocked(expr)) return null;
    const recvT = L.typeOf(expr.expression);
    const direct = symbolFieldOnClass(L, expr, L.mapTypeOf(recvT), recvT, false);
    if (direct) return direct;
    // A LAUNDERED receiver — `client as unknown as { [K]?: T }`. TypeScript
    // cannot declare a symbol member on a class another module owns, so
    // this cast IS the spelling of the Object.defineProperty idiom, and the
    // annotation maps to a RECORD while the binding still holds the class
    // (the cast is a no-op: no copy exists at runtime, and the local's IR
    // type says so). The local's own type is the representation every other
    // read of it uses, so it is the one the slot lives on. Strictly
    // ADDITIVE: this route answers only HIDDEN slots, so no read that
    // resolved some other way before resolves differently now.
    if (ts.isIdentifier(expr.expression)) {
      const local = L.resolveLocal(expr.expression);
      if (local?.type.kind === "object") return symbolFieldOnClass(L, expr, local.type, recvT, true);
    }
    return null;
  }

/** symbolFieldInfo against ONE candidate receiver representation.
   * `hiddenOnly` restricts the answer to Object.defineProperty-declared
   * slots — what makes the laundered route additive. */
  function symbolFieldOnClass(L: Lowerer, expr: ts.ElementAccessExpression, receiverIr: IrType | null, recvT: ts.Type, hiddenOnly: boolean,): { className: string; field: string; fieldType: IrType } | null {
    if (receiverIr?.kind !== "object") return null;
    const info = L.classes.get(receiverIr.className);
    if (!info) {
      L.flushDeferredClass(receiverIr.className);
      return null;
    }
    const key = uniqueSymbolKeyOf(L, expr.argumentExpression);
    if (!key) return null;
    const field = info.symbolFields?.get(key.sym);
    if (field === undefined) return null;
    const fieldType = info.fields.get(field);
    if (!fieldType) return null;
    const hidden = info.hiddenSymbolFields?.has(field) === true;
    if (hiddenOnly && !hidden) return null;
    // HIDDEN slots are reached through exactly that laundering, and a cast
    // can spell ANY member type — the slot's representation was fixed by
    // the WRITE. So the receiver type's own declaration of this key must
    // agree with the slot, or the read reinterprets one representation as
    // another. The DECLARED late-bound member is compared, not the
    // flow-narrowed read type: the narrowing rides on top of the slot
    // (maybeNarrow), it does not change what is stored. No declaration at
    // all, or a disagreeing one, keeps the fence. Constructor-declared
    // slots skip this — their field type came from the checker's own
    // property, so it agrees by construction.
    if (hidden) {
      let declared: IrType | null = null;
      for (const p of L.checker.getPropertiesOfType(recvT)) {
        if (!p.name.startsWith("__@")) continue;
        if (declaredSymbolKeyOf(L, p) !== key.sym) continue;
        declared = L.mapTypeOf(L.checker.getTypeOfSymbol(p));
        break;
      }
      if (declared === null || !typeEquals(declared, fieldType)) {
        if (process.env["SCRIPTC_DEFPROP_WHY"]) {
          process.stderr.write(
            `[defprop] read declined ${receiverIr.className}.${field}: declared=${declared ? L.fmt(declared) : "<none>"} slot=${L.fmt(fieldType)} recvT=${L.checker.typeToString(recvT)}\n`,
          );
        }
        return null;
      }
    }
    return { className: receiverIr.className, field, fieldType };
  }

/** `obj[k]` as an assignable field target — the symbol-keyed twin of
   * fieldTarget's class branch (the receiver lowers here, exactly once). */
  export function symbolFieldTarget(L: Lowerer, expr: ts.ElementAccessExpression): FieldTarget | null {
    const info = symbolFieldInfo(L, expr);
    if (!info) return null;
    const obj = L.lowerExpr(expr.expression);
    return { container: "class", obj, className: info.className, field: info.field, fieldType: info.fieldType };
  }

/** The read expression for a field target (fieldGet / recordGet /
   * getter call). `blame` locates the rejection of a setter-only read —
   * tsc-clean (the property types as the setter's param), but Node yields
   * undefined, which these property types cannot represent. */
  export function fieldGetExpr(L: Lowerer, target: FieldTarget, loc: SrcLoc, blame: ts.Node): IrExpr {
    // A record-shaped CHECKER target whose receiver VALUE lives in the checked-dynamic tree
    // (a JS file-scope object-literal global): the checked-dynamic keyed
    // read — dynKeyGet (a missing key answers the dyn undefined, exactly
    // JS); consumers validate (dynCheck) where a static type is required.
    if (
      (target.container === "record" || target.container === "recordOvf") &&
      target.obj.type.kind === "dyn"
    ) {
      return {
        kind: "dynKeyGet",
        key: { kind: "strLit", value: target.field, type: STRING, loc },
        value: target.obj,
        type: DYN,
        loc,
      };
    }
    if (target.container === "accessor") {
      const getF = L.findMethodOn(L.classes.get(target.className) ?? null, `get:${target.field}`);
      if (!getF) {
        L.unsupported(
          "SC1090",
          blame,
          `reading a property that has only a setter ('${target.field}' — Node would yield undefined)`,
        );
      }
      return L.accessorCall(target.className, `get:${target.field}`, target.obj, [], getF.sig.ret, loc);
    }
    // Record accessor properties: the read IS a call of the %get: closure
    // — once per read, side effects and all (JS's evaluation). The
    // setter-only read keeps the class-path fence: the property types as
    // the setter's param where Node yields undefined.
    if (target.container === "recordAccessor") {
      if (!target.getType) {
        L.unsupported(
          "SC1090",
          blame,
          `reading a property that has only a setter ('${target.field}' — Node would yield undefined)`,
        );
      }
      const closure: IrExpr = {
        kind: "recordGet",
        obj: target.obj,
        shapeId: target.shapeId,
        field: `%get:${target.field}`,
        type: target.getType,
        loc,
      };
      return { kind: "callValue", callee: closure, args: [], type: target.getType.ret, loc };
    }
    // Overflow dot reads: exactly the bracket read with a literal key —
    // recordKeyGet, overflowOnly (the name declares no field by
    // construction), typed as the index value armed with undefined under
    // noUncheckedIndexedAccess (mirroring lowerRecordKeyRead).
    if (target.container === "recordOvf") {
      let t: IrType = target.fieldType;
      if (L.program.getCompilerOptions().noUncheckedIndexedAccess) {
        const armed = L.withUndefinedArmOf(t);
        if (!armed) L.badType(blame, L.typeOf(blame));
        t = armed;
      }
      // The receiver's CHECKER shape and the shape its VALUE lowered can
      // DISAGREE, exactly as they can on the bracket read: `x as
      // Record<string, unknown>` retypes a value without reshaping it, so
      // the index signature that made this an overflow read belongs to the
      // ASSERTED type while the value underneath is still a union (or some
      // other record). Emitting the overflow read anyway builds a
      // recordKeyGet whose receiver is not that shape, and the validator
      // rejects it as an internal error — a compiler crash where the
      // program deserved either an answer or a named fence.
      //
      // This is the bracket path's rule, moved to its dot-access twin
      // because they are the same read: `(c as Record<string, unknown>).k`
      // and `(c as Record<string, unknown>)["k"]` differ only in spelling.
      // The bracket path has had the guard since the `Object.keys(o)`
      // iteration idiom needed it; the dot path never grew one, and
      // nothing reached it until a union became dyn-convertible.
      if (target.obj.type.kind !== "record" || target.obj.type.shapeId !== target.shapeId) {
        if (L.dynConvertible(target.obj.type)) {
          // Read the key in the checked-dynamic tree: a missing key answers
          // undefined, exactly JS, and `unknown` is what the cast promised.
          return {
            kind: "dynKeyGet",
            key: { kind: "strLit", value: target.field, type: STRING, loc },
            value: { kind: "dynFrom", value: target.obj, type: DYN, loc },
            type: DYN,
            loc,
          };
        }
        L.unsupported(
          "SC1090",
          blame,
          `reading '${target.field}' through a receiver whose value shape differs from its asserted type (a '… as T' cast retypes but does not reshape the value — read the property on each arm, or index a single concrete record)`,
        );
      }
      return {
        kind: "recordKeyGet",
        obj: target.obj,
        shapeId: target.shapeId,
        key: { kind: "strLit", value: target.field, type: STRING, loc },
        overflowOnly: true,
        type: t,
        loc,
      };
    }
    if (target.container === "class") {
      const read: IrExpr = { kind: "fieldGet", obj: target.obj, className: target.className, field: target.field, type: target.fieldType, loc };
      // DEFERRED-INIT fields (`stream!: T` assigned past the constructor's
      // top level — ClassInfo.deferredInitFields): the SLOT is the
      // undefined-armed union; the read CHECKED-extracts the declared type
      // — a genuinely unassigned read throws the catchable TypeError
      // where Node reads an undefined the declared type cannot hold.
      if (
        L.classes.get(target.className)?.deferredInitFields?.has(target.field) === true &&
        target.fieldType.kind === "union"
      ) {
        const inner = L.stripUndefinedArm(target.fieldType);
        const helper = L.deferredReadHelper(target.fieldType.unionId, inner, loc);
        if (helper) return { kind: "call", callee: helper, args: [read], type: inner, loc };
      }
      return read;
    }
    const recordRead: IrExpr = { kind: "recordGet", obj: target.obj, shapeId: target.shapeId, field: target.field, type: target.fieldType, loc };
    // An OPTIONAL slot the checker narrowed at THIS use (`if
    // (!deps.query) return; deps.query(...)`): bridge to the proven arm
    // in the READ, not at each consumer. The property dispatch already
    // maybeNarrows what it gets back, so for plain reads this is the same
    // answer arriving one frame earlier (the second call sees a
    // non-union and returns it untouched). What it ADDS is the paths that
    // build a field read directly and then judge it by its own IR type —
    // the record-field CALL path above all, where an optional method slot
    // reached the callee position still `func | undefined` and fenced,
    // even though the very same call spelled through a temporary
    // (`const q = deps.query; q(...)`) narrowed and compiled. Restricted
    // to union slots: that keeps this to the arm bridge maybeNarrow's
    // union case builds, and leaves its dyn/class cases to the read
    // dispatch that already asks for them.
    if (recordRead.type.kind === "union") return L.maybeNarrow(recordRead, blame);
    return recordRead;
  }

/** The write statement for a field target (fieldSet / recordSet / setter
   * call). A write to a getter-only property never gets here in a clean
   * program (tsc's TS2540 is the fence); the rejection is the backstop. */
  export function fieldSetStmt(L: Lowerer, target: FieldTarget, value: IrExpr, loc: SrcLoc, blame: ts.Node): IrStmt {
    // A record-shaped CHECKER target whose receiver VALUE lives in the checked-dynamic tree:
    // the checked-dynamic keyed write — dyn.keySet (later writes win,
    // insertion order; Node's TypeErrors on non-object receivers), the
    // value converting into the checked-dynamic tree.
    if (
      (target.container === "record" || target.container === "recordOvf") &&
      target.obj.type.kind === "dyn"
    ) {
      const v = L.coerceToExpected(value, DYN);
      if (v.type.kind !== "dyn") {
        L.unsupported(
          "SC1101",
          blame,
          `storing '${L.fmt(value.type)}' values in a checked-dynamic object (the value cannot convert into the checked-dynamic tree)`,
        );
      }
      return {
        kind: "exprStmt",
        expr: {
          kind: "libCall",
          fn: "dyn.keySet",
          args: [target.obj, { kind: "strLit", value: target.field, type: STRING, loc }, v],
          type: VOID,
          loc,
        },
        loc,
      };
    }
    if (target.container === "accessor") {
      const setF = L.findMethodOn(L.classes.get(target.className) ?? null, `set:${target.field}`);
      if (!setF) L.unsupported("SC1090", blame, `assignment to the getter-only property '${target.field}'`);
      return {
        kind: "exprStmt",
        expr: L.accessorCall(target.className, `set:${target.field}`, target.obj, [value], VOID, loc),
        loc,
      };
    }
    // Record accessor properties: the write calls the %set: closure with
    // the coerced value. A getter-only write never gets here in a clean
    // program (tsc's TS2540); the rejection is the backstop.
    if (target.container === "recordAccessor") {
      if (!target.setType) {
        L.unsupported("SC1090", blame, `assignment to the getter-only property '${target.field}'`);
      }
      const closure: IrExpr = {
        kind: "recordGet",
        obj: target.obj,
        shapeId: target.shapeId,
        field: `%set:${target.field}`,
        type: target.setType,
        loc,
      };
      return {
        kind: "exprStmt",
        expr: { kind: "callValue", callee: closure, args: [value], type: VOID, loc },
        loc,
      };
    }
    // Overflow dot writes: the bracket write with a literal key — a pure
    // overflow insert (recordKeySet, overflowOnly: the name declares no
    // field, so no declared collision exists to validate). The value was
    // coerced into the index-value slot type by the caller.
    if (target.container === "recordOvf") {
      return {
        kind: "recordKeySet",
        obj: target.obj,
        shapeId: target.shapeId,
        key: { kind: "strLit", value: target.field, type: STRING, loc },
        value,
        overflowOnly: true,
        loc,
      };
    }
    return target.container === "class"
      ? { kind: "fieldSet", obj: target.obj, className: target.className, field: target.field, value, loc }
      : { kind: "recordSet", obj: target.obj, shapeId: target.shapeId, field: target.field, value, loc };
  }

/** `Promise.reject(reason)` on THE Promise global: a pre-rejected
   * promise. The reason is pinned to the Error hierarchy (the executor
   * reject parameter's contract — rejection payloads share the
   * thrown-Error representation, so catch-side instanceof and the
   * uncaught printer keep working) and moves into the rejection slot
   * exactly as an executor's reject() would store it; the result enters
   * the unhandled ledger until something observes it, JS-exact. The
   * checker types the call Promise<never>, so the CONTEXT names the
   * result type (a declared return type, an annotated initializer, an
   * argument slot); without one no representable type exists and the
   * fence says so. Null for other members and non-Promise receivers. */
  export function lowerPromiseRejectCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    if (L.chainBlocked(call)) return null;
    if (L.stdlibGlobalMember(access, "Promise") !== "reject") return null;
    const loc = locOf(call);
    if (call.arguments.length !== 1) {
      L.noLowering(
        "Promise.reject with this argument count",
        call,
        "one Error reason is the supported form: Promise.reject(new Error(...))",
      );
    }
    const ctxT = L.checker.getContextualType(call);
    const type = ctxT ? L.mapTypeOf(ctxT) : null;
    const reasonNode = call.arguments[0]!;
    // A CHECKED-DYNAMIC reason (`Promise.reject(value)` where value rode
    // an untyped binding — the tracingChannel suite's shape): the checked-dynamic tree
    // value IS the rejection payload (the thrown-dyn representation, so
    // identity survives to catch/unhandledRejection observers), and the
    // result is promise<dyn> when no context names a concrete one.
    const reason = L.lowerExpr(reasonNode);
    if (reason.type.kind === "dyn") {
      // The result only ever REJECTS, so the inner type is unobservable:
      // adopt the context's promise type when one names it, else the
      // checker's own Promise<never> reading (promise<void> — exactly the
      // Error-reason form below).
      const resultT: IrType =
        type?.kind === "promise" ? type : { kind: "promise", inner: VOID };
      return { kind: "intrinsic", name: "promise.reject", args: [reason], type: resultT, loc };
    }
    // An Error reason with NO context-named promise type (a bare
    // top-level `Promise.reject(new Error())` — the unhandled-rejection
    // suite's shape): the result only ever rejects, so the checker's own
    // Promise<never> reading (promise<void>) is the honest type.
    const resultType: IrType =
      type?.kind === "promise" ? type : { kind: "promise", inner: VOID };
    if (type?.kind !== "promise" && !errorRootedObjectOf(L, L.typeOf(reasonNode))) {
      L.noLowering(
        "Promise.reject outside a position that names a concrete promise type",
        call,
        "the checker types the call Promise<never> — a declared return type or an " +
          "annotation (const p: Promise<T> = Promise.reject(...)) names the result",
      );
    }
    if (!errorRootedObjectOf(L, L.typeOf(reasonNode))) {
      L.unsupported(
        "SC1090",
        reasonNode,
        `Promise.reject reasons of type '${L.checker.typeToString(L.typeOf(reasonNode))}' ` +
          "(rejection payloads share the thrown-Error representation: pass an Error instance)",
      );
    }
    if (reason.type.kind !== "object") L.badType(reasonNode, L.typeOf(reasonNode));
    return { kind: "intrinsic", name: "promise.reject", args: [reason], type: resultType, loc };
  }

/** True when a `Promise.all(voids)` result is consumed as a VALUE rather
   * than for its settlement alone.
   *
   * Two parents mean it is not. Directly under an `await`, the void
   * collapse's `Promise<void>` yields void and that IS what the site reads
   * — every spelling the corpus and zapo write (`await Promise.all(ps)` as
   * a statement, `return await ...` from a void async function). As a bare
   * expression statement the value is discarded outright. Both keep the
   * collapse, so no program that compiles today allocates an array it did
   * not allocate before.
   *
   * Anything else is HOLDING the promise, and a `Promise<void>` value fits
   * nowhere tsc would put a `Promise<void[]>` — which is why every such
   * site fences today rather than compiling to something else.
   *
   * One copy, read by both of the uniform-literal paths (this file's tuple
   * claim and lower-builtins' static one) and by the array-expression
   * path. */
  export function voidAllResultIsAValue(call: ts.CallExpression): boolean {
    const p = call.parent as ts.Node | undefined;
    if (p === undefined) return false;
    return !ts.isAwaitExpression(p) && !ts.isExpressionStatement(p);
  }

/** `Promise.all([...])` where the literal's every entry is the SAME
   * promise type: the checker's tuple overload types the literal
   * [Promise<T>, Promise<T>] — a tuple RECORD, which the array path
   * rejects — but a homogeneous tuple of promises IS a Promise<T>[] in
   * every observable way, so the entries build the array directly and
   * the runtime's countdown combinator runs (the certs read-both-files
   * shape). Result Promise<T[]>; void inners collapse to Promise<void>
   * exactly like the array path. Null otherwise: heterogeneous literals
   * and non-literal arguments keep the array path and its fences. */
  export function lowerPromiseAllTupleCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    if (L.chainBlocked(call)) return null;
    if (L.stdlibGlobalMember(access, "Promise") !== "all") return null;
    const argNode = call.arguments.length === 1 ? call.arguments[0]! : null;
    if (
      !argNode ||
      !ts.isArrayLiteralExpression(argNode) ||
      argNode.elements.some(ts.isSpreadElement) ||
      argNode.elements.length === 0
    ) {
      return null;
    }
    // The claim test runs on checker types only (no side effects): every
    // element the same representable promise type.
    const mapped = argNode.elements.map((el) => L.mapTypeOf(L.typeOf(el)));
    const first = mapped[0];
    if (first?.kind !== "promise") return null;
    if (!mapped.every((m) => m?.kind === "promise" && typeEquals(m.inner, first.inner))) {
      return null;
    }
    const loc = locOf(call);
    const inner = first.inner;
    // An ALL-VOID literal whose result is HELD rather than awaited for its
    // effect declines here, so the static path's own uniform-literal
    // handler builds the array of undefineds Node fulfils with. This claim
    // and that one carry the SAME void collapse, and only one of them
    // should own the exception; declining BEFORE the elements are lowered
    // keeps them lowered exactly once, by whichever path takes the call.
    if (inner.kind === "void" && voidAllResultIsAValue(call)) return null;
    const entryT: IrType = { kind: "promise", inner };
    const elems = argNode.elements.map((el) => L.lowerExpr(el));
    const entries: IrExpr = { kind: "arrayLit", elems, type: arrayOf(entryT), loc };
    const type: IrType =
      inner.kind === "void"
        ? { kind: "promise", inner: VOID }
        : { kind: "promise", inner: arrayOf(inner) };
    return { kind: "intrinsic", name: "promise.all", args: [entries], type, loc };
  }

/** The value `x op= e` COMPUTES, split from the slot it is written into.
 *
 * `x op= e` is `x = x op e` with x read once, and what JS yields is the
 * value of the OPERATION — not a read-back of the slot. Those are the
 * same node whenever the slot's type is the operation's own (`n += 1`
 * over an f64 binding), and different whenever the slot has to convert:
 * a checked-dynamic slot BOXES the f64 sum back into a dyn cell, and an
 * f64 binding CHECKS a runtime-kinded sum down to a number. Statement
 * position never had to tell the two apart — nothing reads the value —
 * so it built one expression and stored it. Value position must tell
 * them apart, because `switch (c >>>= 3)` switches on the number and
 * `readU32(this.buf, this.pos += 4)` indexes with it; yielding the
 * boxed cell instead would hand every consumer a dyn where JS handed it
 * a Number, and the consumers are exactly the positions (a switch
 * discriminant, an index, a relational operand) that have no ToNumber of
 * their own.
 *
 * `natural` is JS's yielded value with its OWN type; `toSlot` converts
 * any expression of that type into the slot's, so statement position is
 * `toSlot(natural)` — the same node it always built — and value position
 * is `%t = natural; slot = toSlot(%t); yield %t`. Null when no arm claims
 * the (slot, rhs) pair; the caller fences (SC1043).
 *
 * `numeric` says the `+`/`-` arrived from a `++`/`--` desugar, where the
 * operator is ToNumeric and NOT the binary `+`: `o.f = '5'; o.f++` leaves
 * 6, while `o.f += 1` leaves '51'. The desugar hands over a literal 1 as
 * the right operand, so nothing downstream could tell the two apart — and
 * over an untyped slot, where `+` really can concatenate, telling them
 * apart is the difference between the answer and a plausible wrong one. */
export interface CompoundCombine {
  natural: IrExpr;
  toSlot: (v: IrExpr) => IrExpr;
  /** The READ under the operator's own conversion, and the combination
   * rebuilt over any expression of that (converted) type — present only
   * on the NUMBER-context arms, which are exactly the ones a `++`/`--`
   * desugar can reach.
   *
   * `natural` is `combine(read)`, so statement position and prefix
   * `++` need nothing else. POSTFIX does: what `x++` yields is the
   * CONVERTED OLD value, not the new one and not the old cell
   * (`o.f = '5'; o.f++` answers 5 and leaves 6), and it cannot be
   * recovered from the result — `(x + 1) - 1` is not `x` in doubles
   * (0.1 comes back 0.10000000000000009). So the postfix form holds
   * `read` in a temp and builds the store from it, which is the shape
   * the BINDING path (lowerIncDec's dyn arm) already had. */
  numericRead?: { read: IrExpr; combine: (converted: IrExpr) => IrExpr };
}

export function compoundCombine(
  L: Lowerer,
  op: CompoundOp,
  read: IrExpr,
  rhs: IrExpr,
  slot: IrType,
  blame: ts.Node,
  leftNode: ts.Node,
  rhsNode: ts.Node,
  loc: SrcLoc,
  numeric = false,
): CompoundCombine | null {
  const same = (v: IrExpr): IrExpr => v;
  if (slot.kind === "jsval" || rhs.type.kind === "jsval") {
    const JS_COMPOUND: Record<string, IrJsOp> = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "**": "pow" };
    const jop = JS_COMPOUND[op];
    if (jop === undefined) return null;
    const wrapped: IrExpr = {
      kind: "jsOp", op: jop,
      args: [L.jsvalIn(read, leftNode), L.jsvalIn(rhs, rhsNode)],
      type: JSVAL, loc,
    };
    return { natural: wrapped, toSlot: (v) => L.coerceInto(blame, v, slot) };
  }
  if (slot.kind === "bigint" && rhs.type.kind === "bigint") {
    // `n >>= 16n` and friends: the same operator family as the binary
    // form (lowerBinary's bigint branch), read-modify-write on the slot.
    const BIG_COMPOUND: Partial<Record<CompoundOp, IrLibFn>> = {
      "+": "big.add", "-": "big.sub", "*": "big.mul", "/": "big.div",
      "%": "big.rem", "**": "big.pow", "&": "big.and", "|": "big.or",
      "^": "big.xor", "<<": "big.shl", ">>": "big.shr",
    };
    const fn = BIG_COMPOUND[op];
    if (fn === undefined) return null;
    return { natural: { kind: "libCall", fn, args: [read, rhs], type: BIGINT, loc }, toSlot: same };
  }
  if (op === "+" && slot.kind === "string" && !numeric) {
    return {
      natural: { kind: "strConcat", left: read, right: ensureStringForPlus(L, rhs, rhsNode), type: STRING, loc },
      toSlot: same,
    };
  }
  if (slot.kind === "f64" && rhs.type.kind === "f64") {
    const combine = (v: IrExpr): IrExpr => ({ kind: "bin", op, left: v, right: rhs, type: F64, loc });
    return { natural: combine(read), toSlot: same, numericRead: { read, combine } };
  }
  // JS any-origin operands: run the operator's OWN conversion and compute
  // natively (the binary-operator stance) — the dyn slot takes the result
  // back through the usual dyn conversion.
  if (isJsSourceFile(blame.getSourceFile()) && (slot.kind === "dyn" || rhs.type.kind === "dyn")) {
    const toNum = (e: IrExpr, why: string): IrExpr => {
      if (e.type.kind !== "dyn") return e;
      tonumWhy(blame, why);
      return { kind: "libCall", fn: "dyn.toNumber", args: [e], type: F64, loc: e.loc };
    };
    if (op === "+" && !numeric) {
      // `x += v` is `x = x + v`, and `+` is not a number context: with an
      // untyped operand on either side the sum's KIND is decided at
      // runtime — a STRING on the other side makes the whole thing
      // concatenation (`o += '�'` over an untyped accumulator is the
      // decoder's spelling, and it is not arithmetic). A dyn slot takes
      // the sum as it comes; an f64 slot cannot hold a concatenation, so
      // the checked cast stays exactly where JS would have retyped the
      // binding — loud, and only there.
      const l = L.coerceToExpected(read, DYN);
      const r = L.coerceToExpected(rhs, DYN);
      if (l.type.kind === "dyn" && r.type.kind === "dyn") {
        tonumWhy(blame, "add-compound");
        const sum: IrExpr = { kind: "libCall", fn: "dyn.add", args: [l, r], type: DYN, loc };
        return {
          natural: sum,
          toSlot: (v) => (slot.kind === "dyn" ? v : { kind: "dynCheck", value: v, type: F64, loc }),
        };
      }
      return null;
    }
    // Every other compound operator IS a number context (`-`, `*`, `/`,
    // `%`, `**` are ToNumber; the bitwise six are ToInt32/ToUint32, which
    // is ToNumber plus a truncating wrap the f64 node already performs).
    if (
      (slot.kind === "dyn" || slot.kind === "f64") &&
      (rhs.type.kind === "dyn" || rhs.type.kind === "f64")
    ) {
      // Both conversions run ONCE, here — `combine` reuses the converted
      // right operand rather than re-lowering it, so a postfix caller that
      // builds the store from a temp cannot double-evaluate the operand or
      // double-count the tonumWhy note.
      const l = toNum(read, "compound");
      const r = toNum(rhs, "compound");
      const combine = (v: IrExpr): IrExpr => ({ kind: "bin", op, left: v, right: r, type: F64, loc });
      return {
        natural: combine(l),
        toSlot: (v) => (slot.kind === "dyn" ? { kind: "dynFrom", value: v, type: DYN, loc } : v),
        numericRead: { read: l, combine },
      };
    }
  }
  return null;
}

/** `obj.f op= e` (and `obj.f++` with rhs null ≡ 1) — the element spelling
   * `obj[k] op= e` included when k is a declared symbol-keyed field, split
   * into the VALUE the operation yields and the WRITE that stores it.
   * Restricted to side-effect-free receivers (identifier or `this`)
   * because the desugar evaluates the receiver twice.
   *
   * `write` re-lowers the receiver, so it must be called exactly once and
   * its statement placed AFTER `natural` has been evaluated — which is
   * both orders the callers need: statement position calls it with the
   * value inline, value position with a temp holding it. */
  export function fieldCompoundParts(L: Lowerer, access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    op: CompoundOp,
    rhsNode: ts.Expression | null,
    loc: SrcLoc,): { natural: IrExpr; write: (v: IrExpr) => IrStmt; numericRead?: CompoundCombine["numericRead"] } {
    if (access.expression.kind === ts.SyntaxKind.SuperKeyword) {
      L.unsupported("SC1090", access, "compound assignment through 'super' (read and write separately)");
    }
    if (!ts.isIdentifier(access.expression) && access.expression.kind !== ts.SyntaxKind.ThisKeyword) {
      L.unsupported("SC1090", access, "compound assignment to fields of computed receivers");
    }
    // A CHECKED-DYNAMIC receiver (`context.actual++` — test/common's call
    // accounting; dot spelling only — symbol-keyed element targets are
    // static fields): read the member (dynKeyGet), combine under the
    // operator's own conversion, write back (dyn.keySet). The receiver is
    // an identifier (checked above), so evaluating it for read and write
    // matches JS's once-evaluation observably.
    if (ts.isPropertyAccessExpression(access)) {
      const probed = probeLower(L, access.expression);
      if (probed?.type.kind === "dyn") {
        const key: IrExpr = { kind: "strLit", value: access.name.text, type: STRING, loc: locOf(access.name) };
        const read: IrExpr = { kind: "dynKeyGet", key, value: probed, type: DYN, loc };
        const rhs: IrExpr = rhsNode
          ? L.lowerExpr(rhsNode)
          : { kind: "numLit", value: 1, type: F64, loc };
        const combined = compoundCombine(L, op, read, rhs, DYN, access, access, rhsNode ?? access, loc, rhsNode === null);
        if (!combined) L.unsupported("SC1043", access);
        return {
          natural: combined.natural,
          ...(combined.numericRead ? { numericRead: combined.numericRead } : {}),
          // Second, independent evaluation of the (side-effect-free)
          // receiver, after the value — JS's order for a compound whose
          // reference was already resolved.
          write: (v) => ({
            kind: "exprStmt",
            expr: {
              kind: "libCall", fn: "dyn.keySet",
              args: [L.lowerExpr(access.expression), { ...key }, combined.toSlot(v)],
              type: VOID, loc,
            },
            loc,
          }),
        };
      }
    }
    const targetOf = (): FieldTarget | null =>
      ts.isPropertyAccessExpression(access) ? L.fieldTarget(access) : symbolFieldTarget(L, access);
    const target = targetOf();
    if (!target) L.unsupported("SC1090", access, "compound assignment to unsupported field targets");
    // Through an accessor target this desugars to get, op, set — with the
    // receiver an identifier/this, the observable order matches JS exactly:
    // getter, rhs side effects, setter (verified against Node).
    const read = L.fieldGetExpr(target, locOf(access), access);
    const rhs: IrExpr = rhsNode
      ? L.lowerExpr(rhsNode)
      : { kind: "numLit", value: 1, type: F64, loc };
    // CHECKED-DYNAMIC fields (implicit-any ctor assignments — countdown.js's
    // `this[kLimit]` shape) take the SAME arms a checked-dynamic BINDING
    // takes: the operator's own conversion, not a checked cast to number.
    // The two had drifted — the binding path learned ToNumber when the
    // binary operators did and the field path kept the older dynCheck, so
    // `this.pos += 4` over an untyped field threw where `pos += 4` over an
    // untyped local answered. One helper now settles both.
    const combined = compoundCombine(L, op, read, rhs, target.fieldType, access, access, rhsNode ?? access, loc, rhsNode === null);
    if (!combined) L.unsupported("SC1043", access);
    // Second, independent evaluation of the (side-effect-free) receiver.
    return {
      natural: combined.natural,
      ...(combined.numericRead ? { numericRead: combined.numericRead } : {}),
      write: (v) => L.fieldSetStmt(targetOf()!, combined.toSlot(v), loc, access),
    };
  }

/** `obj.f op= e` as a STATEMENT — the parts, written straight back. */
  export function lowerFieldCompound(L: Lowerer, access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    op: CompoundOp,
    rhsNode: ts.Expression | null,
    loc: SrcLoc,): IrStmt {
    const parts = fieldCompoundParts(L, access, op, rhsNode, loc);
    return parts.write(parts.natural);
  }

/** `obj.f++` / `--obj.f` in VALUE position (`buf[this.pos++]` — the byte
   * reader every generated protobuf decoder is built from): the same
   * read-modify-write the compound path performs, with BOTH values held
   * in temps so the expression can answer either one.
   *
   * A postfix `++` is not `o.f += 1` used for its value: what it yields
   * is the CONVERTED OLD value. The two agree over a number field and
   * disagree over an untyped one (`o.f = '5'; o.f++` answers 5 and leaves
   * 6), and the old value cannot be recovered from the new — the double
   * subtraction is lossy. So the shape is the BINDING path's, verbatim:
   *
   *     %old = <ToNumeric of the read>
   *     %new = %old ± 1
   *     <write %new through the slot's own conversion>
   *     yield  prefix ? %new : %old
   *
   * The write re-lowers the (identifier or `this`) receiver, exactly as
   * statement position does, and it is placed after both temps so the
   * order — read, combine, store — is JS's.
   *
   * `numericRead` is absent for every arm that is NOT a number context
   * (an island slot, a bigint one, a string field): those have no
   * ToNumeric to yield, so the fence stays and names the position. */
  export function lowerFieldIncDecValue(L: Lowerer, access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    op: CompoundOp,
    prefix: boolean,
    blame: ts.Node,
    loc: SrcLoc,): IrExpr {
    const parts = fieldCompoundParts(L, access, op, null, loc);
    const numeric = parts.numericRead;
    if (numeric === undefined) {
      L.unsupported(
        "SC1045",
        blame,
        "increment/decrement of this field in expression position (the slot has no numeric read to yield)",
      );
    }
    const t = numeric.read.type;
    const oldTmp = L.declareHiddenLocal("%incOld", t);
    const newTmp = L.declareHiddenLocal("%incNew", t);
    const oldRef = (): IrExpr => ({ kind: "varRef", localId: oldTmp.id, type: t, loc });
    const newRef = (): IrExpr => ({ kind: "varRef", localId: newTmp.id, type: t, loc });
    return {
      kind: "seqExpr",
      stmts: [
        { kind: "varDecl", localId: oldTmp.id, init: numeric.read, loc },
        { kind: "varDecl", localId: newTmp.id, init: numeric.combine(oldRef()), loc },
        parts.write(newRef()),
      ],
      result: prefix ? newRef() : oldRef(),
      type: t,
      loc,
    };
  }

/** `obj.f op= e` in VALUE position (`readU32(this.buf, this.pos += 4)`):
   * the same parts with the computed value held in a temp, so the write
   * stores it and the expression yields it. */
  export function lowerFieldCompoundValue(L: Lowerer, access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    op: CompoundOp,
    rhsNode: ts.Expression | null,
    loc: SrcLoc,): IrExpr {
    const parts = fieldCompoundParts(L, access, op, rhsNode, loc);
    const type = parts.natural.type;
    const tmp = L.declareHiddenLocal("%cmpVal", type);
    const ref = (): IrExpr => ({ kind: "varRef", localId: tmp.id, type, loc });
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: tmp.id, init: parts.natural, loc }, parts.write(ref())],
      result: ref(),
      type,
      loc,
    };
  }

/** Stream-rooted receivers' property surface (readableEnded, destroyed,
 * ...): the receiver's mapped class dispatches into lower-stream.ts.
 * Null off the stream hierarchy or for names the spoke does not own. */
function lowerStreamObjectProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  if (expr.questionDotToken && !L.chainHandled.has(expr)) return null;
  const recvT = L.mapTypeOf(L.typeOf(expr.expression));
  if (recvT?.kind !== "object") return null;
  const info = L.classes.get(recvT.className);
  if (!info || streamSidesOf(L, info) === null) return null;
  return lowerStreamProperty(L, expr, info);
}

/** The primitive-constructor closure (`String`/`Number`/`Boolean` as a
 * VALUE): interns one synthesized module function per constructor —
 * `%builtin.String` et al. — and returns the zero-capture closure over it.
 * The body IS the string-coercion the type mapping promised
 * (`(value: string) => primitive`): String is identity, Number the ECMA
 * StringToNumber (num.fromString — the same runtime call the direct
 * `Number(s)` lowering emits), Boolean the emptiness test. Interning makes
 * every reference the SAME immortal closure, so `opt.type === String`
 * compares like JS function identity. */
export function primitiveCtorClosure(
  L: Lowerer,
  name: "String" | "Number" | "Boolean",
  loc: SrcLoc,
): IrExpr {
  const ret = name === "String" ? STRING : name === "Number" ? F64 : BOOL;
  const fnT = funcOf([STRING], ret);
  let fnName = L.primitiveCtorFns.get(name);
  if (!fnName) {
    fnName = `%builtin.${name}`;
    L.primitiveCtorFns.set(name, fnName);
    const s: IrExpr = { kind: "varRef", localId: "v.0", type: STRING, loc };
    const value: IrExpr =
      name === "String"
        ? s
        : name === "Number"
          ? { kind: "libCall", fn: "num.fromString", args: [s], type: F64, loc }
          : { kind: "strEq", negated: true, left: s, right: { kind: "strLit", value: "", type: STRING, loc }, type: BOOL, loc };
    const fn: IrFunction = {
      name: fnName,
      params: [{ localId: "v.0", name: "value", type: STRING }],
      returnType: ret,
      locals: [{ id: "v.0", name: "value", type: STRING, mutable: false }],
      body: [{ kind: "return", value, loc }],
      loc,
    };
    L.liftedFns.push(fn);
  }
  return { kind: "closure", fnName, captures: [], type: fnT, loc };
}
/** A tuple, or a union whose every arm is one. Both ride the ARRAY
 * representation -- a union of same-element tuples collapses to an array
 * in types.ts -- and in both the `length` member is the tuple's own
 * synthesized property rather than Array.prototype's, so provenance alone
 * would refuse a read that the representation supports. */
function everyArmIsTuple(L: Lowerer, t: ts.Type): boolean {
  if (L.checker.isTupleType(t)) return true;
  if (!t.isUnionType()) return false;
  const parts = t.getTypes();
  return parts.length > 0 && parts.every((p) => L.checker.isTupleType(p));
}
          // UNTAGGED, unlike every other fence this file builds (5327,
          // 5387, 631) and unlike deferredFenceStmt: the message goes out
          // bare, with no "[SCxxxx at file:line]" suffix. Two consequences,
          // both measured on zapo's TU (estado-instruments section 2):
          //   1. a run-phase failure here does NOT name its blocker as
          //      precisely as a compile diagnostic would, which is the
          //      contract deferredFenceStmt documents for itself;
          //   2. the zapo trap census greps '[SC', so refusals leaving
          //      through this line are invisible to it. Exactly one does
          //      on zapo (the EventEmitter 'emit'-as-a-value SC1090, in
          //      lifted fn %fence.fn.240); emit-ws.ts's SC2020 is the
          //      other untagged refusal in that TU.
          // Tagging this is a real fix, not just an instrument fix -- it
          // just needs the lowering gate (both differential lanes,
          // order-parity, RC audit, QR pair) that a message change earns.
          // RE-MEASURED at 5d8e2103 (estado-inventory section 4): the count
          // above is one short, and the shape of the miss has changed.
          // zapo's TU carries THREE untagged refusals, not two:
          //   * this one, the EventEmitter 'emit'-as-a-value SC1090, in
          //     lifted fn %fence.fn.240 -- still exactly one, still with a
          //     synthetic location (the entry file's last line), because the
          //     fence function is interned per signature and shared;
          //   * TWO from emit-ws.ts, not one. Since wsInitBagPlan the
          //     generic option-bag refusal no longer occurs in zapo's TU at
          //     all; what survives is the pair of refuseIfPresent tests, one
          //     for 'dispatcher' and one for 'agent'.
          // Whole-TU accounting at 5d8e2103, so the next block does not have
          // to re-derive it: 140 scr_throw_error_msg_code calls = 53 the
          // census sees (message-tagged) + 3 untagged refusals + 84 SC9002
          // 'unreachable' guards, which are per-function boilerplate and not
          // refusals. The frontend captured 56 diagnostics onto fences: the
          // 53 + this untagged one + 2 that deferredFenceStmt DROPPED because
          // they were not captured[0] of their statement (the SC2004 cascade
          // markers for 'pickActiveSyncKey' and 'fetchLatestWaMobileVersion'
          // -- neither reaches the emitted C at all).
