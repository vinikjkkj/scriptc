/* A BUILTIN used as a VALUE rather than called: `const f = fetch`,
 * `use(parseInt)`, `{ enc: encodeURIComponent }`, `f === f`.
 *
 * The claim this file was written against was "no builtin in this
 * compiler has a closure form". It is false, and the counter-example is
 * the design: `String` / `Number` / `Boolean` already lower to an
 * interned zero-capture closure over a synthesized module function
 * (primitiveCtorClosure, lower-exprs.ts), and every value form works
 * through it -- alias, argument, record field, `??` default, capture in a
 * closure that outlives its frame, and `===` identity. What did NOT exist
 * was a way to say the same thing about a builtin that is a plain
 * FUNCTION rather than a constructor interface. This is that table.
 *
 * HOW IT WORKS, and why identity comes out right for free. The value is
 * `{ kind: "closure", fnName: "%builtin.<name>.value", captures: [] }`
 * over a lifted module function whose BODY is the same libCall the direct
 * call form lowers to. A lifted function carries no `captures` array, and
 * the backends' closure case interns exactly that shape into one immortal
 * static closure per function (emit-exprs.ts / llvm/emitter.ts) -- so
 * every mention of `fetch` in a program yields the SAME pointer and
 * `fetch === fetch` is `true`, the way Node has it. The memo below is per
 * program, so a program that mentions a builtin twice gets one lifted
 * function, not two.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   A NARROWED signature for `fetch`. Its value form used to be
 *   `(input: string) => Promise<Response>` -- arity ONE, because `init`
 *   had no static representation -- and this paragraph used to say that
 *   mapping `typeof fetch` to that narrower shape would be a silent lie
 *   about arity. It would have been. What landed instead is the AMBIENT
 *   signature: `RequestInit` is a value now and `Request` a type, so the
 *   entry is resolved from the checker's own mapping rather than written
 *   down here (BUILTIN_FN_VALUE_RESOLVERS), and nothing is narrowed.
 *
 *   A NARROWED SLOT, though, is a refusal -- see narrowedSlotFence. A slot
 *   whose function type is not the builtin's own takes an adapter, and an
 *   adapter is a fresh closure with a different pointer: `rec.call ===
 *   fetch` printed false against Node's true, measured, the first time
 *   that became reachable.
 *
 *   `.name` and `.length`. Not a builtin question at all: they are SC2020
 *   on a USER function value too (`function g() {}; g.name`), so the
 *   family is "properties of a function object", and answering them here
 *   would make builtins the only functions in the language that have
 *   them.
 *
 *   A builtin METHOD taken off its object (`const p = console.log`,
 *   `const m = Math.max`). Those keep their existing per-surface fences.
 *   A method carries a `this` question this table has no answer for, and
 *   `k.m` on a user class is SC1090 for the same reason.
 *
 *   `.bind`. In TypeScript `f.bind(x)` is a documented ERASURE that
 *   compiles to `f` itself (lower-calls.ts, corpus 2690), so a builtin
 *   value inherits it: `isNaN.bind(null) === isNaN` answers true where
 *   Node answers false. That divergence is NOT this table's -- a USER
 *   function's `g.bind(null) === g` already answers true on main, measured
 *   -- and making the builtin behave differently from every other function
 *   value would be the worse trade. builtin-fn-value.test.ts pins the two
 *   halves EQUAL rather than pinning either answer, so the day the erasure
 *   is fixed both move together.
 *
 *   ARITY. Each entry declares ONE exact arity, and a call through the
 *   value at any other arity is a type error at the call -- loud. Node
 *   would complete `parseInt("42")` to radix 0; a compiled value cannot,
 *   because the func ABI has no absent-argument state, and inventing a
 *   default at the ABI would make `f("42")` and `parseInt("42")` two
 *   different functions. Optional-parameter declarations already meet
 *   requireExactArityValue for user functions; this is the same rule.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import {
  BOOL,
  F64,
  funcOf,
  type IrExpr,
  type IrFunction,
  type IrLibFn,
  type IrType,
  type SrcLoc,
  STRING,
  typeEquals,
  DYN,
  VOID,
  typeKey,
  isUnitType,
} from "../../ir/nodes.js";
import { type BuiltinModuleFn, builtinMemberFnValueAllowed, builtinModuleFnOf, stdlibGlobalNameOf } from "./surfaces.js";
import { optionalTimerHandleClear } from "./lower-calls.js";
import { DYN_BUILTIN_SIGS, dynBuiltinFnType } from "../dyn-builtin-sigs.js";
import { isJsSourceFile } from "../program.js";


interface BuiltinFnValue {
  /** The value form's exact parameter types, in order. */
  readonly params: readonly (readonly [name: string, type: IrType])[];
  readonly ret: IrType;
  /** The body's returned expression, over the parameter reads. */
  readonly body: (args: readonly IrExpr[], loc: SrcLoc) => IrExpr;
  /** Static builds only -- under --dynamic the island owns the surface
   * and its own value story applies. */
  readonly staticOnly?: true;
}

function libCall(fn: IrLibFn, args: readonly IrExpr[], type: IrType, loc: SrcLoc): IrExpr {
  return { kind: "libCall", fn, args: [...args], type, loc };
}

/** An entry whose signature is the CHECKER'S OWN mapping of the name
 * rather than a shape written here.
 *
 * `fetch` is the only one, and it needs to be: its parameter types are
 * UNIONS the ambient signature spells (`string | Request | URL` and
 * `RequestInit | undefined`), and a union's IR identity is its interned
 * id, which is per program. A fixed shape here could never equal the
 * mapping, so the gate would reject the entry in every program — which is
 * exactly what it did while `RequestInit` had no type at all.
 *
 * The resolver is a GATE in its own right, not a rubber stamp: it accepts
 * only the arm sets `fetch.goValue` dispatches on, so a lib whose `fetch`
 * is declared differently keeps its SC2020 instead of reaching a runtime
 * entry point that would read a tag that is not there. */
type BuiltinFnValueResolver = (L: Lowerer, mapped: IrType) => BuiltinFnValue | null;

/** The arm kinds of a union IR type, or null when it is not a union. */
function armKinds(L: Lowerer, t: IrType): Set<string> | null {
  if (t.kind !== "union") return null;
  const def = L.unions.get(t.unionId);
  if (def === undefined) return null;
  return new Set(def.arms.map((a) => a.kind));
}

const BUILTIN_FN_VALUE_RESOLVERS: Readonly<Record<string, BuiltinFnValueResolver | undefined>> = {
  fetch: (L, mapped) => {
    if (mapped.kind !== "func" || mapped.params.length !== 2) return null;
    if (mapped.ret.kind !== "promise" || mapped.ret.inner.kind !== "response") return null;
    const input = mapped.params[0]!;
    const init = mapped.params[1]!;
    // The INPUT union must be exactly what the runtime entry knows how to
    // unpack: a string arm it can use as the URL, optionally a URL arm it
    // serializes through url.href, optionally the uninhabitable Request
    // arm. Any other arm would reach the entry's throw.
    const inArms = armKinds(L, input);
    if (inArms === null || !inArms.has("string")) return null;
    for (const k of inArms) if (k !== "string" && k !== "url" && k !== "request") return null;
    // The INIT union is `RequestInit | undefined` and nothing else: an
    // absent init is not an empty one, and the entry tells them apart by
    // tag.
    const initArms = armKinds(L, init);
    if (initArms === null || initArms.size !== 2) return null;
    if (!initArms.has("requestInit") || !initArms.has("undefinedT")) return null;
    return {
      params: [["input", input], ["init", init]],
      ret: mapped.ret,
      body: (a, loc) => libCall("fetch.goValue", [a[0]!, a[1]!], mapped.ret, loc),
      staticOnly: true,
    };
  },
};

/** The global builtins with a value form, each mapping to the SAME lib
 * entry its direct call lowers to (lower-calls.ts) -- so a program cannot
 * observe a difference between `parseInt(s, 10)` and `const f = parseInt;
 * f(s, 10)` beyond the arity rule stated in this file's header. */
const BUILTIN_FN_VALUES: Readonly<Record<string, BuiltinFnValue | undefined>> = {
  // `fetch` has NO fixed row: its signature is the checker's own mapping
  // of the ambient global, resolved per program by
  // BUILTIN_FN_VALUE_RESOLVERS above.
  // parseInt's radix is EXPLICIT in the value form -- see the header's
  // arity note. Its direct call completes an omitted radix to 0.
  parseInt: {
    params: [["string", STRING], ["radix", F64]],
    ret: F64,
    body: (a, loc) => libCall("num.parseInt", [a[0]!, a[1]!], F64, loc),
  },
  // parseFloat / isFinite are ALSO island-surface globals, so their value
  // form is static-lane only: under --dynamic the island owns the surface
  // and keeps its existing SC1090.
  parseFloat: {
    params: [["string", STRING]],
    ret: F64,
    body: (a, loc) => libCall("num.parseFloat", [a[0]!], F64, loc),
    staticOnly: true,
  },
  // isNaN / isFinite take a NUMBER, where the global's ToNumber coercion
  // is the identity and the test is Number.isNaN / Number.isFinite
  // exactly -- the same pinning the direct call form requires.
  isNaN: {
    params: [["number", F64]],
    ret: BOOL,
    body: (a, loc) => libCall("num.isNaN", [a[0]!], BOOL, loc),
  },
  isFinite: {
    params: [["number", F64]],
    ret: BOOL,
    body: (a, loc) => libCall("number.isFinite", [a[0]!], BOOL, loc),
    staticOnly: true,
  },
  encodeURIComponent: {
    params: [["uriComponent", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.encodeUriComponent", [a[0]!], STRING, loc),
  },
  encodeURI: {
    params: [["uri", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.encodeUri", [a[0]!], STRING, loc),
  },
  decodeURIComponent: {
    params: [["encodedURIComponent", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.decodeUriComponent", [a[0]!], STRING, loc),
  },
  escape: {
    params: [["string", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.escape", [a[0]!], STRING, loc),
  },
  unescape: {
    params: [["string", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.unescape", [a[0]!], STRING, loc),
  },
  decodeURI: {
    params: [["encodedURI", STRING]],
    ret: STRING,
    body: (a, loc) => libCall("str.decodeUri", [a[0]!], STRING, loc),
  },
};

/** OWN-property read of one of the tables above. The tables are plain
 * object literals, so a bare `table[name]` for an identifier called
 * `hasOwnProperty`, `toString`, `valueOf` or `constructor` answers the
 * INHERITED Object.prototype function, which then ran as a "resolver" and
 * crashed the compiler (sql-escaper's `const hasOwnProperty =
 * Object.prototype.hasOwnProperty`). */
function ownRow<T>(table: Readonly<Record<string, T | undefined>>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

/** Does `name` have a value form in this build? */
export function hasBuiltinFnValue(L: Lowerer, name: string): boolean {
  if (ownRow(BUILTIN_FN_VALUE_RESOLVERS, name) !== undefined) return !L.dynamic;
  const entry = ownRow(BUILTIN_FN_VALUES, name);
  if (entry === undefined) return false;
  return !(entry.staticOnly === true && L.dynamic);
}

/** The entry for `name` at THIS identifier's mapped type: the fixed table
 * row, or the resolver's row for the one name whose signature is the
 * checker's. Null when the name has no value form here, or when the
 * resolver refused the shape. */
function entryFor(L: Lowerer, name: string, mapped: IrType | null): BuiltinFnValue | null {
  const resolver = ownRow(BUILTIN_FN_VALUE_RESOLVERS, name);
  if (resolver !== undefined) return mapped === null ? null : resolver(L, mapped);
  return ownRow(BUILTIN_FN_VALUES, name) ?? null;
}

/** THE GATE, and the reason this file cannot produce a silently wrong
 * identity.
 *
 * A closure whose type differs from the slot it flows into is ADAPTED —
 * `%fn.adapt.N` mints a FRESH closure over the original, and a fresh
 * closure is a different pointer, so `a === parseInt` answers false where
 * Node answers true. The adapter is not wrong in itself (it is how a
 * `(string, number) => number` reaches a `(string, number | undefined) =>
 * number` slot); what would be wrong is a builtin value whose declared
 * shape disagrees with the checker's own mapping for the same name, since
 * every ordinary `const f = X` slot takes its type from that mapping.
 *
 * So the table is only ever offered when `mapType` of the identifier's
 * own type is EXACTLY the entry's signature — the same gate
 * stringMethodFnValueOf applies to STR_INTRINSIC_SIGS, for the same
 * reason. `parseInt` is the case that proves the gate earns its keep: its
 * radix is OPTIONAL, so `typeof parseInt` maps to `(string, number |
 * undefined) => number`, an adapter is minted, and `const a = parseInt;
 * a === parseInt` printed `false` against Node's `true` before this gate
 * existed. It keeps its SC2020 instead.
 *
 * The one entry with NO mapping is `fetch` (its `init` parameter is a
 * RequestInit, which nothing maps): there is no checker-side shape to
 * disagree with, the value's type is this file's own contract, and
 * builtinFnValueDeclType below is the only thing that can put it in a
 * slot. */
function gatedValueType(L: Lowerer, expr: ts.Identifier, symOverride?: ts.Symbol): IrType | null {
  if (!hasBuiltinFnValue(L, expr.text)) return null;
  const entry = entryFor(L, expr.text, L.mapTypeOf(L.typeOf(expr)));
  if (entry === null) return null;
  // Provenance, and STRICTER than isStdlibSymbol — which answers `.some`
  // over the declaration list and is therefore true for a MERGED symbol.
  // The globals in this table are `declare function`s, so a user's own
  // `function isNaN(n: number) { return n === 42 }` at module scope does
  // not shadow the ambient one: it MERGES with it into a single symbol
  // carrying both declarations, and isStdlibSymbol says yes. Offering the
  // builtin value there would answer the LIBRARY's function for a name the
  // program itself defines — measured: with the loose test, `function
  // encodeURI(s) { return s + "!" }` compiled and printed the library's
  // answer for a direct call while the alias answered the user's. Every
  // declaration must be the library's.
  const sym = symOverride ?? L.resolveValueSymbol(expr);
  if (!sym) return null;
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
  const want = funcOf(
    entry.params.map(([, t]) => t),
    entry.ret,
  );
  const mapped = L.mapTypeOf(L.typeOf(expr));
  if (mapped !== null && !typeEquals(mapped, want)) return null;
  return want;
}

/** `fetch` / `parseFloat` / ... as a VALUE: the interned zero-capture
 * closure over the memoized lift. Null for every identifier that is not
 * one of these globals, and for one that is but does not pass the gate
 * above, so the caller keeps its own fence. */
export function builtinFnValueOf(L: Lowerer, expr: ts.Identifier, loc: SrcLoc, symOverride?: ts.Symbol): IrExpr | null {
  const want = gatedValueType(L, expr, symOverride);
  if (want === null) return null;
  narrowedSlotFence(L, expr, want);
  return builtinFnValueClosure(L, expr.text, want, loc);
}

/** A builtin value flowing into a slot whose function type is NOT the
 * builtin's own — `const g: (u: string) => Promise<Response> = fetch`, a
 * record field or an array element or a parameter of that shape.
 *
 * The ADAPTER would take it: `%fn.adapt.N` wraps the value in a fresh
 * closure that converts at the boundary, and every CALL through it is
 * right. What is not right is the identity — a fresh closure is a
 * different pointer, so `rec.call === fetch` answers false where Node
 * answers true. That is the exact failure the gate above was written for,
 * one level out: there the danger was the checker's mapping disagreeing
 * with a shape written in this file, here it is the PROGRAM's slot
 * disagreeing with both.
 *
 * It became reachable when `fetch` stopped being arity-one. While its
 * value form was `(input: string) => Promise<Response>`, that was also
 * the only slot shape a program could write for it, so no adapter could
 * fire; now the value carries the ambient signature and any narrower
 * annotation is a different type.
 *
 * The refusal is the answer rather than the adapter, and the hint names
 * the fix (`typeof fetch`), because a silently non-identical function is
 * exactly the trade this whole table refuses to make. */
function narrowedSlotFence(L: Lowerer, expr: ts.Identifier, want: IrType): void {
  const ctx = (() => {
    try {
      return L.checker.getContextualType(expr);
    } catch {
      return undefined;
    }
  })();
  if (ctx === undefined) return;
  const mapped = L.mapTypeOf(ctx);
  if (mapped === null || mapped.kind !== "func" || typeEquals(mapped, want)) return;
  L.noLowering(
    `'${expr.text}' stored in a slot typed '${L.fmt(mapped)}'`,
    expr,
    `the value's own signature is '${L.fmt(want)}'; a slot of another shape would take an ` +
      `adapter, and an adapter is a FRESH closure — '${expr.text}' held there would compare ` +
      `unequal to '${expr.text}' where Node compares equal. Annotate the slot 'typeof ${expr.text}'`,
  );
}

/** The mint, split out so the declaration-type arm and the expression arm
 * cannot disagree about the shape. Memoized per program by name. */
export function builtinFnValueClosure(L: Lowerer, name: string, want: IrType, loc: SrcLoc): IrExpr {
  const entry = entryFor(L, name, want)!;
  const fnName = `%builtin.${name}.value`;
  const fnT = want;
  if (!L.liftedFns.some((f) => f.name === fnName)) {
    const args: IrExpr[] = entry.params.map(([pname, type], i) => ({
      kind: "varRef",
      localId: `${pname}.${i}`,
      type,
      loc,
    }));
    const fn: IrFunction = {
      name: fnName,
      params: entry.params.map(([pname, type], i) => ({
        localId: `${pname}.${i}`,
        name: pname,
        type,
      })),
      returnType: entry.ret,
      locals: entry.params.map(([pname, type], i) => ({
        id: `${pname}.${i}`,
        name: pname,
        type,
        mutable: false,
      })),
      body: [{ kind: "return", value: entry.body(args, loc), loc }],
      loc,
    };
    L.liftedFns.push(fn);
  }
  return { kind: "closure", fnName, captures: [], type: fnT, loc };
}

/** `const f = fetch` -- the DECLARATION's type.
 *
 * The binding's declared type is the builtin's own, which maps nowhere
 * (`fetch` is `(input: RequestInfo | URL, init?: RequestInit) =>
 * Promise<Response>`), so without this the initializer lowers and the
 * SLOT then fences on a type the value never had. The
 * objectStaticFnValueDeclType / diffieHellmanFnValueDeclType arms in
 * lower-modules.ts make the same move for the same reason; this is their
 * third sibling, and it is keyed on the INITIALIZER's shape so no other
 * declaration in the program can be affected by it.
 *
 * Deliberately NOT applied when the declared type already maps: a program
 * that wrote its own annotation gets the slot it asked for, and a
 * mismatch between that annotation and the value form is a type error at
 * the assignment -- loud -- rather than an annotation this arm quietly
 * overrode. Null for everything else. */
export function builtinFnValueDeclType(L: Lowerer, decl: ts.VariableDeclaration): IrType | null {
  // An explicit annotation is the program's own claim about the slot and
  // is never overridden here: it either maps (and the ordinary rule takes
  // it, adapting the value if the shapes differ) or it does not (and the
  // declaration fences on the type the program wrote). Only the
  // UNANNOTATED form reaches this arm, where the "declared type" is
  // nothing but the builtin's own and the value is the only shape in
  // sight.
  if (decl.type !== undefined) return null;
  if (decl.initializer === undefined) return null;
  let inner: ts.Expression = decl.initializer;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  // `const parseRef = JSON.parse`: the overloaded declared type maps nowhere
  // (SC2007 at the binding), while the value is the one-argument closure
  // lowerJsonProperty mints. The slot takes that closure's own type.
  if (
    ts.isPropertyAccessExpression(inner) && !L.dynamic && inner.name.text === "parse" &&
    L.stdlibGlobalMember(inner, "JSON") === "parse"
  ) {
    return funcOf([STRING], DYN);
  }
  if (!ts.isIdentifier(inner)) return null;
  const want = gatedValueType(L, inner);
  if (want === null) return null;
  // The mapped case needs nothing from this arm — the ordinary rule
  // already puts the identical type in the slot (the gate proved they are
  // identical). `fetch` USED to be the one case that reached here, because
  // its `init` parameter had no type; now that RequestInit and Request map,
  // every entry in the table is mapped and this arm answers null for all of
  // them. It is kept rather than deleted: it is the only thing that would
  // put a table entry with no checker-side mapping into a slot, and the
  // day another one is added it is what the value form will need.
  if (L.mapTypeOf(L.typeOf(inner)) !== null) return null;
  return want;
}

/* ── builtin MODULE MEMBERS as values ────────────────────────────────────
 *
 * `const exists = fs.existsSync`, `const d = path.dirname`, `{ dir:
 * dirname }` — a member of a node builtin module taken as a value rather
 * than called.
 *
 * The file's own list of what it deliberately does not answer says "a
 * builtin METHOD taken off its object (`const p = console.log`, `const m
 * = Math.max`) ... a method carries a `this` question this table has no
 * answer for". A builtin MODULE member is not that: node's module
 * functions do not read `this` — `const d = require("path").dirname;
 * d("/a/b")` is `/a` in Node, measured — so the `this` reason does not
 * reach them and the SC1090 they were keeping was a fence with no
 * argument behind it.
 *
 * WHAT MAKES IT SAFE, in three layers, none of which is optional:
 *
 *   1. BUILTIN_MEMBER_FN_VALUES (surfaces.ts) — the explicit allow-list of
 *      members whose table ROW is the whole truth about the call. A member
 *      whose dispatch special-cases an argument shape is absent, because a
 *      value minted from its row would answer a different libCall than the
 *      call form does.
 *   2. THE GATE — `mapTypeOf` of the member's own type must equal
 *      `funcOf(row.params, row.result)` EXACTLY. This is the same gate
 *      gatedValueType applies to the globals, for the same reason, and it
 *      is what keeps the wider @types/node signatures out: `existsSync`
 *      takes a `PathLike`, `platform()` returns `NodeJS.Platform`,
 *      `randomUUID` has an optional options bag. Each of those would take
 *      an ADAPTER, and an adapter is a fresh closure with a different
 *      pointer — `f === existsSync` would answer false where Node answers
 *      true. They keep their SC1090.
 *   3. THE SLOT FENCE — a value flowing into a slot of another function
 *      type refuses rather than adapting, exactly as narrowedSlotFence
 *      does for the globals.
 *
 * Identity comes out right for free, the same way it does above: the
 * value is a zero-capture closure over a LIFTED function, and the
 * backends intern exactly that shape into one immortal static closure per
 * function, so every mention of `path.dirname` in a program is the same
 * pointer and `dirname === dirname` is `true`.
 *
 * `.name` and `.length` are NOT answered here, and that is the same
 * decision the globals took: they are SC2020 on a user function value
 * too, so answering them for builtin members would make these the only
 * functions in the language that have them. `path.dirname.name` keeps its
 * refusal — loud — rather than gaining an answer this table cannot keep
 * true for every other function.
 *
 * The lift is keyed on the ROW's libFn rather than on the module name, so
 * `path.dirname` and `path/posix.dirname` on a posix target — the same
 * row, reached through two specifiers — mint ONE function and compare
 * equal, which is what Node does (`path.dirname === path.posix.dirname`
 * is true there). */
/** True when the checker types this builtin-module member as a plain callable:
 * at least one call signature and no construct signature (a class such as
 * EventEmitter or Worker has both, a namespace or a constant neither). */
export function builtinMemberIsFunction(L: Lowerer, node: ts.Node): boolean {
  const t = L.typeOf(node);
  return L.checker.getCallSignatures(t).length > 0 && L.checker.getConstructSignatures(t).length === 0;
}

export function builtinMemberFnValueType(
  L: Lowerer,
  node: ts.Node,
  bi: { module: string; member: string },
): { want: IrType; row: BuiltinModuleFn } | null {
  // BOTH SPELLINGS, in TypeScript and JavaScript sources. This used to bail
  // for JS ("the named-import spelling lowers to the token string
  // `[builtin path.dirname]`"), which kept the two spellings consistent only
  // by making BOTH wrong: `typeof dirname` answered 'string' and a call through
  // the value threw. A function member now has one value in every source,
  // the interned closure, so `path.dirname === dirname` holds in a JS file
  // too, and a member outside the table is refused at the reference.
  if (!builtinMemberFnValueAllowed(bi.module, bi.member)) return null;
  const row = builtinModuleFnOf(L, bi.module, bi.member);
  if (!row) return null;
  // Belt and braces over the allow-list: neither shape can be a value.
  if (row.variadicPack === true || row.defaults !== undefined) return null;
  const want = funcOf([...row.params], row.result);
  // tls.checkServerIdentity: the row's runtime verdict is a dyn value; the
  // value's declared return (Error | undefined) is the checker's own mapping,
  // so the row adopts it and the body dyn-checks the verdict into it. The cert
  // parameter maps to dyn (types.ts, tls.PeerCertificate), so the whole
  // signature is the checker's mapping and the typeEquals gate below holds.
  let row2 = row;
  let want2 = want;
  if (bi.module === "tls" && bi.member === "checkServerIdentity") {
    const sigs = L.checker.getCallSignatures(L.typeOf(node));
    if (sigs.length !== 1) return null;
    const retMapped = L.mapTypeOf(L.checker.getReturnTypeOfSignature(sigs[0]!));
    if (retMapped === null) return null;
    row2 = { ...row, result: retMapped };
    want2 = funcOf([...row2.params], retMapped);
  }
  const mapped = L.mapTypeOf(L.typeOf(node));
  if (mapped === null || !typeEquals(mapped, want2)) return null;
  return { want: want2, row: row2 };
}

/** The slot fence, module-member spelling. Identical rule to
 * narrowedSlotFence: a slot of another function type would take an
 * adapter, and an adapter compares unequal. */
function memberNarrowedSlotFence(L: Lowerer, node: ts.Expression, text: string, want: IrType): void {
  const ctx = (() => {
    try {
      return L.checker.getContextualType(node);
    } catch {
      return undefined;
    }
  })();
  if (ctx === undefined) return;
  const mapped = L.mapTypeOf(ctx);
  if (mapped === null || mapped.kind !== "func" || typeEquals(mapped, want)) return;
  L.noLowering(
    `'${text}' stored in a slot typed '${L.fmt(mapped)}'`,
    node,
    `the value's own signature is '${L.fmt(want)}'; a slot of another shape would take an ` +
      `adapter, and an adapter is a FRESH closure — '${text}' held there would compare ` +
      `unequal to '${text}' where Node compares equal. Annotate the slot 'typeof ${text}'`,
  );
}

/** The lifted body's value: the row's libCall, dyn-checked into the row's
 * declared result when that result is not dyn (tls.checkServerIdentity's
 * verdict is a dyn value; its declared type is Error | undefined). */
function builtinRowResult(row: BuiltinModuleFn, args: readonly IrExpr[], loc: SrcLoc): IrExpr {
  // Only the dyn-returning rows (tls.checkServerIdentity) are dyn-checked; every
  // other row's libCall is typed by its own result, as before.
  if (row.fn !== "tls.checkServerIdentity" || row.result.kind === "dyn") return libCall(row.fn, args, row.result, loc);
  return { kind: "dynCheck", value: libCall(row.fn, args, DYN, loc), type: row.result, loc };
}

/** `fs.existsSync` / `dirname` (a named import binding) as a VALUE: the
 * interned zero-capture closure over the memoized lift, or null when the
 * member is not in the allow-list or does not pass the gate — in which
 * case the caller keeps its own SC1090. */
export function builtinMemberFnValueOf(
  L: Lowerer,
  node: ts.Expression,
  bi: { module: string; member: string },
  text: string,
  loc: SrcLoc,
): IrExpr | null {
  const got = builtinMemberFnValueType(L, node, bi);
  if (got === null) return null;
  memberNarrowedSlotFence(L, node, text, got.want);
  const fnName = `%builtin.${got.row.fn}.value`;
  if (!L.liftedFns.some((f) => f.name === fnName)) {
    const params = got.row.params.map((type, i) => ({ localId: `a.${i}`, name: `a${i}`, type }));
    const args: IrExpr[] = params.map((p) => ({ kind: "varRef", localId: p.localId, type: p.type, loc }));
    const fn: IrFunction = {
      name: fnName,
      params,
      returnType: got.row.result,
      locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      body: [{ kind: "return", value: builtinRowResult(got.row, args, loc), loc }],
      loc,
    };
    L.liftedFns.push(fn);
  }
  return { kind: "closure", fnName, captures: [], type: got.want, loc };
}


/* GLOBAL FUNCTIONS TAKEN AS VALUES IN A JAVASCRIPT SOURCE.
 *
 * `const f = atob`, `[setTimeout, clearTimeout]`, `{ parse: parseInt }`: in
 * Node each is a real function, and a JS program may call it through the
 * value. These used to be the identity token string (`typeof f` answered
 * 'string', `f(x)` threw "f is not a function", or the slot refused the
 * string at run time), which is a silent divergence.
 *
 * A row here is a lifted function whose parameters are the TYPES THE CHECKER
 * MAPS `typeof <global>` to (never a shape written here), so the slot the
 * binding gets is the closure's own type and no adapter is minted: the closure
 * is interned (one per program, a zero-capture closure over a lifted
 * function) and `f === atob` is JS identity. The body is the same lowering
 * the direct call takes, over the parameters. A global with no row, or whose
 * checker type has another shape, returns null and the caller refuses at the
 * reference. */
interface JsGlobalRow {
  /** The function body over the parameter reads, or null when this program's
   * mapping of the global has a shape the row does not know. */
  readonly build: (L: Lowerer, mapped: Extract<IrType, { kind: "func" }>, args: readonly IrExpr[], loc: SrcLoc) => IrExpr | null;
}

function dynView(L: Lowerer, e: IrExpr, loc: SrcLoc): IrExpr | null {
  if (e.type.kind === "dyn") return e;
  if (e.kind === "unitLit" || L.dynConvertible(e.type)) return { kind: "dynFrom", value: e, type: DYN, loc };
  return null;
}

/** The tag of the arm of kind `kind` in a union type, or -1. */
function armTag(L: Lowerer, t: IrType, kind: string): number {
  if (t.kind !== "union") return -1;
  const def = L.unions.get(t.unionId);
  if (def === undefined) return -1;
  return def.arms.findIndex((a) => a.kind === kind);
}

const JS_GLOBAL_NATIVE: Readonly<Record<string, IrLibFn | undefined>> = {
  setTimeout: "timers.setTimeoutFnValue",
  setInterval: "timers.setIntervalFnValue",
  setImmediate: "timers.setImmediateFnValue",
  structuredClone: "dyn.structuredCloneFnValue",
};

const JS_GLOBAL_ROWS: Readonly<Record<string, JsGlobalRow | undefined>> = {
  atob: {
    build: (L, m, a, loc) => {
      if (m.params.length !== 1 || m.ret.kind !== "string") return null;
      const d = dynView(L, a[0]!, loc);
      return d === null ? null : libCall("str.atob", [d], STRING, loc);
    },
  },
  btoa: {
    build: (L, m, a, loc) => {
      if (m.params.length !== 1 || m.ret.kind !== "string") return null;
      const d = dynView(L, a[0]!, loc);
      return d === null ? null : libCall("str.btoa", [d], STRING, loc);
    },
  },
  encodeURIComponent: {
    build: (L, m, a, loc) => {
      if (m.params.length !== 1 || m.ret.kind !== "string") return null;
      const p = a[0]!;
      if (p.type.kind === "string") return libCall("str.encodeUriComponent", [p], STRING, loc);
      const d = dynView(L, p, loc);
      if (d === null) return null;
      const s: IrExpr = { kind: "toString", operand: d, hint: "default", type: STRING, loc };
      return libCall("str.encodeUriComponent", [s], STRING, loc);
    },
  },
  parseInt: {
    build: (L, m, a, loc) => {
      if (m.params.length !== 2 || m.params[0]!.kind !== "string" || m.ret.kind !== "f64") return null;
      const radixT = m.params[1]!;
      const radix = a[1]!;
      let r: IrExpr;
      if (radixT.kind === "f64") {
        r = radix;
      } else {
        const numTag = armTag(L, radixT, "f64");
        const undefTag = armTag(L, radixT, "undefinedT");
        if (radixT.kind !== "union" || numTag < 0 || undefTag < 0) return null;
        // An omitted radix is 0 (the direct call completes it the same way).
        r = {
          kind: "ternary",
          cond: { kind: "unionIsTag", unionId: radixT.unionId, tag: numTag, negated: false, value: radix, type: BOOL, loc },
          then: { kind: "unionNarrow", unionId: radixT.unionId, tag: numTag, value: radix, type: F64, loc },
          else_: { kind: "numLit", value: 0, type: F64, loc },
          type: F64,
          loc,
        };
      }
      return libCall("num.parseInt", [a[0]!, r], F64, loc);
    },
  },
  queueMicrotask: {
    build: (_L, m, a, loc) => {
      if (m.params.length !== 1 || m.params[0]!.kind !== "func" || m.ret.kind !== "void") return null;
      const cbT = m.params[0]!;
      if (cbT.params.length !== 0 || cbT.rest === true || cbT.ret.kind !== "void") return null;
      return libCall("timers.queueMicrotask", [a[0]!], VOID, loc);
    },
  },
  clearTimeout: { build: (L, m, a, loc) => clearRow(L, m, a, "timers.clearTimeout", loc) },
  clearInterval: { build: (L, m, a, loc) => clearRow(L, m, a, "timers.clearInterval", loc) },
  clearImmediate: { build: (L, m, a, loc) => clearRow(L, m, a, "timers.clearImmediate", loc) },
};

function clearRow(L: Lowerer, m: Extract<IrType, { kind: "func" }>, a: readonly IrExpr[], fn: IrLibFn, loc: SrcLoc): IrExpr | null {
  if (m.params.length !== 1 || m.ret.kind !== "void") return null;
  return optionalTimerHandleClear(L, a[0]!, fn, loc);
}

/** The timer globals a TypeScript source may take as VALUES. Their overloaded
 * declared types map nowhere, so the value is the runtime's dyn function
 * (jsGlobalFnValueOf answers them in both sources). */
export const TIMER_GLOBAL_VALUE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate",
]);

/** The slot of a binding initialized by a timer global (`const st =
 * setTimeout`) in ANY source: the declared type is the overload set, which
 * maps nowhere, so the slot is the runtime's dyn function (the same value
 * jsGlobalFnValueOf hands out). Null for every other initializer. */
export function timerGlobalDeclType(L: Lowerer, init: ts.Expression | undefined): IrType | null {
  if (init === undefined) return null;
  let e: ts.Expression = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isIdentifier(e)) return null;
  const name = stdlibGlobalNameOf(L, e);
  if (name === null || !TIMER_GLOBAL_VALUE_NAMES.has(name)) return null;
  return DYN;
}

/** The value of a global function in a JavaScript source: the interned
 * closure of its row, or null (no row, a user symbol of that name, or a
 * mapping the row does not recognise). */
export function jsGlobalFnValueOf(L: Lowerer, expr: ts.Identifier, name: string, loc: SrcLoc, symOverride?: ts.Symbol): IrExpr | null {
  // The globals whose signature the checker leaves unmapped (overloads, a rest
  // of arguments, a generic): the runtime's own dyn function, one immortal
  // closure each.
  const native = JS_GLOBAL_NATIVE[name];
  if (native !== undefined && Object.prototype.hasOwnProperty.call(JS_GLOBAL_NATIVE, name)) {
    const sym = symOverride ?? L.resolveValueSymbol(expr);
    if (!sym) return null;
    const decls = L.checker.declarationsOf(sym);
    if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
    return { kind: "libCall", fn: native, args: [], type: DYN, loc };
  }
  const row = ownRow(JS_GLOBAL_ROWS, name);
  if (row === undefined) return null;
  const mapped = L.mapTypeOf(L.typeOf(expr));
  if (mapped === null || mapped.kind !== "func") return null;
  // Every declaration must be the library's (a shadowing user function merges
  // into one symbol with the ambient one).
  const sym = symOverride ?? L.resolveValueSymbol(expr);
  if (!sym) return null;
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
  const fnName = `%builtin.js.${name}.value`;
  if (!L.liftedFns.some((f) => f.name === fnName)) {
    const params = mapped.params.map((type, i) => ({ localId: `p${i}.0`, name: `p${i}`, type }));
    const args: IrExpr[] = params.map((p) => ({ kind: "varRef", localId: p.localId, type: p.type, loc }));
    const body = row.build(L, mapped, args, loc);
    if (body === null) return null;
    const fn: IrFunction = {
      name: fnName,
      params,
      returnType: mapped.ret,
      locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      body: mapped.ret.kind === "void"
        ? [{ kind: "exprStmt", expr: body, loc }]
        : [{ kind: "return", value: body, loc }],
      loc,
    };
    L.liftedFns.push(fn);
  }
  return { kind: "closure", fnName, captures: [], type: mapped, loc };
}

/* THE DYN-SIGNATURE FORM of a global builtin function taken as a value.
 *
 * Every entry above is typed by the checker's own mapping of the name, and
 * the gate refuses a builtin whose mapping has no exact row. The refusal
 * cases are the callbacks a dyn receiver passes: `anyArray.map(String)`
 * (the element is any value), `.filter(Boolean)`, `.map(parseInt)`. In a
 * JavaScript source the identifier used to be an identity TOKEN (the
 * string "[builtin String]"), and `token(elem)` threw "string ... is not a
 * function" at run time where Node calls the function. That is the
 * mysql2 dateStringsKey site (parser_cache.js: `dateStrings.map(String)`).
 *
 * The form here is the one a user arrow already gets when it is handed to
 * a dyn receiver: an interned lifted function whose PARAMETERS are DYN, so
 * the caller's boxed elements arrive as they are, and whose body is the
 * JS conversion (ToString / ToNumber / ToBoolean / Array.isArray /
 * JSON.stringify) over them. Identity is the interned closure, so
 * `f === f` holds. Extra arguments a callback receives (`map` passes
 * index and array) are dropped, as JS drops them for a function that
 * declares fewer parameters; `parseInt` declares its radix, so the index
 * IS its radix, as in Node.
 */
interface DynBuiltinFn {
  readonly body: (a: readonly IrExpr[], loc: SrcLoc) => IrExpr;
}

function toStr(a: IrExpr, loc: SrcLoc): IrExpr {
  return libCall("dyn.toStringCoerce", [a], STRING, loc);
}
function toNum(a: IrExpr, loc: SrcLoc): IrExpr {
  return libCall("dyn.toNumber", [a], F64, loc);
}

/** The keys are the global's source spelling (`String`, `JSON.stringify`). */
const DYN_BUILTIN_FNS: Readonly<Record<string, DynBuiltinFn | undefined>> = {
  String: { body: (a, loc) => toStr(a[0]!, loc) },
  Number: { body: (a, loc) => toNum(a[0]!, loc) },
  Boolean: { body: (a, loc) => ({ kind: "dynTest", test: "truthy", value: a[0]!, type: BOOL, loc }) },
  parseInt: {
    body: (a, loc) => libCall("num.parseInt", [toStr(a[0]!, loc), toNum(a[1]!, loc)], F64, loc),
  },
  parseFloat: { body: (a, loc) => libCall("num.parseFloat", [toStr(a[0]!, loc)], F64, loc) },
  isNaN: { body: (a, loc) => libCall("num.isNaN", [toNum(a[0]!, loc)], BOOL, loc) },
  isFinite: { body: (a, loc) => libCall("number.isFinite", [toNum(a[0]!, loc)], BOOL, loc) },
  encodeURIComponent: { body: (a, loc) => libCall("str.encodeUriComponent", [toStr(a[0]!, loc)], STRING, loc) },
  encodeURI: { body: (a, loc) => libCall("str.encodeUri", [toStr(a[0]!, loc)], STRING, loc) },
  decodeURIComponent: { body: (a, loc) => libCall("str.decodeUriComponent", [toStr(a[0]!, loc)], STRING, loc) },
  decodeURI: { body: (a, loc) => libCall("str.decodeUri", [toStr(a[0]!, loc)], STRING, loc) },
  escape: { body: (a, loc) => libCall("str.escape", [toStr(a[0]!, loc)], STRING, loc) },
  unescape: { body: (a, loc) => libCall("str.unescape", [toStr(a[0]!, loc)], STRING, loc) },
  "Array.isArray": { body: (a, loc) => ({ kind: "dynTest", test: "array", value: a[0]!, type: BOOL, loc }) },
  "JSON.stringify": { body: (a, loc) => ({ kind: "jsonStringify", value: a[0]!, type: STRING, loc }) },
};

/** The DYN-table key of a global function EXPRESSION (`String`, `parseInt`,
 * `JSON.stringify`, `Array.isArray`), or null: the identifier must resolve
 * to the library's own declarations, the member must be the stdlib's. */
export function dynBuiltinKeyOf(L: Lowerer, node: ts.Expression): string | null {
  let key: string;
  if (ts.isIdentifier(node)) {
    key = node.text;
    const sym = L.resolveValueSymbol(node);
    if (!sym) return null;
    const decls = L.checker.declarationsOf(sym);
    if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
  } else if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
    if (L.stdlibGlobalMember(node, "Array") === "isArray") key = "Array.isArray";
    else if (L.stdlibGlobalMember(node, "JSON") === "stringify") key = "JSON.stringify";
    else return null;
  } else {
    return null;
  }
  return hasDynBuiltinFnValue(key) ? key : null;
}

/** `String.name`, `String.length`, `parseInt.length`, `JSON.stringify.length`
 * (a builtin's Function properties, read off the builtin's own identifier):
 * constants, as Node reports them. The `name` of a member is its last
 * segment (`JSON.stringify` is "stringify"). Null for every other read. */
export function dynBuiltinFnPropertyOf(L: Lowerer, expr: ts.PropertyAccessExpression, loc: SrcLoc): IrExpr | null {
  const prop = expr.name.text;
  if (prop !== "name" && prop !== "length") return null;
  const key = dynBuiltinKeyOf(L, expr.expression);
  if (key === null) return null;
  if (prop === "name") return { kind: "strLit", value: key.slice(key.lastIndexOf(".") + 1), type: STRING, loc };
  const sig = ownRow(DYN_BUILTIN_SIGS, key);
  if (sig === undefined) return null;
  // Node's declared length: JSON.stringify takes (value, replacer, space).
  const declared = key === "JSON.stringify" ? 3 : sig.arity;
  return { kind: "numLit", value: declared, type: F64, loc };
}

/** Is `key` one of the globals with a DYN-signature value form? */
export function hasDynBuiltinFnValue(key: string): boolean {
  return ownRow(DYN_BUILTIN_FNS, key) !== undefined && ownRow(DYN_BUILTIN_SIGS, key) !== undefined;
}

/** The interned DYN-signature closure of the global `key`, lifted once per
 * program. The caller proves the identifier is the library's own symbol. */
export function dynBuiltinFnValueOf(L: Lowerer, key: string, loc: SrcLoc): IrExpr {
  const row = ownRow(DYN_BUILTIN_FNS, key);
  const sig = ownRow(DYN_BUILTIN_SIGS, key);
  if (row === undefined || sig === undefined) throw new Error(`dynBuiltinFnValueOf: no row for ${key}`);
  const fnName = `%builtin.dyn.${key}`;
  if (!L.liftedFns.some((f) => f.name === fnName)) {
    const params = Array.from({ length: sig.arity }, (_, i) => ({ localId: `p${i}.0`, name: `p${i}`, type: DYN }));
    const args: IrExpr[] = params.map((p) => ({ kind: "varRef", localId: p.localId, type: DYN, loc }));
    L.liftedFns.push({
      name: fnName,
      params,
      returnType: sig.ret,
      locals: params.map((p) => ({ id: p.localId, name: p.name, type: DYN, mutable: false })),
      body: [{ kind: "return", value: row.body(args, loc), loc }],
      loc,
    });
  }
  return { kind: "closure", fnName, captures: [], type: dynBuiltinFnType(sig), loc };
}


/** `Array.isArray` / `JSON.stringify` read without a call, as the DYN-
 * signature value. Null for every other receiver and member. */
export function staticMemberDynFnValueOf(L: Lowerer, expr: ts.PropertyAccessExpression, loc: SrcLoc): IrExpr | null {
  if (expr.questionDotToken) return null;
  if (L.stdlibGlobalMember(expr, "Array") === "isArray") return dynBuiltinFnValueOf(L, "Array.isArray", loc);
  if (!L.dynamic && L.stdlibGlobalMember(expr, "JSON") === "stringify") return dynBuiltinFnValueOf(L, "JSON.stringify", loc);
  return null;
}

/** The typed-row globals: their value form predates this one (lower-fnvalue.ts's
 * BUILTIN_FN_VALUES and the JS rows), so this form only fills their callbacks
 * where no value form exists. */
const TYPED_ROW_KEYS: ReadonlySet<string> = new Set([
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "encodeURI",
  "decodeURIComponent", "decodeURI", "escape", "unescape",
]);

/** A callback parameter the DYN boxing takes faithfully: a dyn, a primitive,
 * an array, undefined/null, or a union of those. */
function boxableCallbackParam(L: Lowerer, t: IrType): boolean {
  if (t.kind === "dyn" || t.kind === "jsval" || t.kind === "f64" || t.kind === "bool" || t.kind === "string" || t.kind === "array") return true;
  if (isUnitType(t)) return true;
  if (t.kind === "union") {
    const arms = L.unions.get(t.unionId)?.arms;
    return arms !== undefined && arms.every((a) => boxableCallbackParam(L, a));
  }
  return false;
}

/** A DYN-signature builtin passed as a HOF CALLBACK (`xs.map(String)`,
 * `xs.filter(Boolean)`, `xs.map(parseInt)`): minted at the element types
 * the loop actually passes, so the static element needs no adapter.
 *
 * The loop passes the lead values (the element; accumulator + element for
 * reduce), then the index (F64) and the array. The callback declares a
 * PREFIX of those, so parameter i has the i-th of that list, and the body
 * boxes each one into the builtin's DYN parameter (dynFrom) before the
 * conversion. Like booleanCtorHofCallback (lower-containers.ts), the
 * closure is consumed by the HOF's own helper and never compared, so no
 * identity escapes; every REFERENCE to the builtin still lowers to the
 * interned value above.
 *
 * Null (the caller keeps its own fence) when the identifier is not the
 * library's, has no row, or an element type does not box into DYN. */
export function dynBuiltinHofCallback(
  L: Lowerer,
  argNode: ts.Expression,
  lead: readonly IrType[],
  arrT: IrType,
  loc: SrcLoc,
): { fnArg: IrExpr & { type: IrType & { kind: "func" } }; arity: number } | null {
  const key = dynBuiltinKeyOf(L, argNode);
  if (key === null) return null;
  const sig = ownRow(DYN_BUILTIN_SIGS, key);
  if (sig === undefined) return null;
  const row = ownRow(DYN_BUILTIN_FNS, key);
  if (row === undefined) return null;
  // Which callbacks this form takes. Boolean has its own static predicate
  // (booleanCtorHofCallback), so it is taken here only over a dyn element. The
  // typed-row globals (parseInt, encodeURIComponent, ...) already have a value
  // form that main lowers for a static callback and in JavaScript, so this form
  // takes them only over a dyn element in a TypeScript source; every other
  // combination keeps the path it had.
  const dynLead = lead[0]?.kind === "dyn" || lead[0]?.kind === "jsval";
  if (key === "Boolean" && !dynLead) return null;
  if (TYPED_ROW_KEYS.has(key) && (!dynLead || isJsSourceFile(argNode.getSourceFile()))) return null;
  // Parameter i of the callback receives: the lead values, then the index, then the array.
  const passed: IrType[] = [...lead, F64, arrT];
  const params: IrType[] = [];
  for (let i = 0; i < sig.arity; i++) {
    const t = passed[i];
    if (t === undefined) return null;
    params.push(t);
  }
  // A static OBJECT element is not boxed here: the boxed object's ToString
  // is the runtime's object protocol, which has no Object.prototype member
  // table, so it refuses at run time where Node prints "[object Object]".
  // Those callbacks keep their refusal at compile time instead.
  for (const t of params) {
    if (!boxableCallbackParam(L, t)) return null;
  }
  // JSON.stringify of an undefined-capable element: the direct call refuses
  // it (SC1090), because the walker would print the TEXT "undefined" where
  // Node answers the undefined value. The callback form refuses the same way.
  if (key === "JSON.stringify") {
    for (const t of params) {
      const arms = t.kind === "union" ? (L.unions.get(t.unionId)?.arms ?? []) : [t];
      if (arms.some((a) => isUnitType(a) || a.kind === "void")) return null;
    }
  }
  const fnName = `%builtin.dyn.hof.${key}.${params.map((t) => typeKey(t)).join("|")}`;
  if (!L.liftedFns.some((f) => f.name === fnName)) {
    const ps = params.map((type, i) => ({ localId: `p${i}.0`, name: `p${i}`, type }));
    const args: IrExpr[] = ps.map((p) => {
      const v: IrExpr = { kind: "varRef", localId: p.localId, type: p.type, loc };
      return p.type.kind === "dyn" ? v : { kind: "dynFrom", value: v, type: DYN, loc };
    });
    L.liftedFns.push({
      name: fnName,
      params: ps,
      returnType: sig.ret,
      locals: ps.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      body: [{ kind: "return", value: row.body(args, loc), loc }],
      loc,
    });
  }
  return {
    fnArg: { kind: "closure", fnName, captures: [], type: funcOf(params, sig.ret), loc } as IrExpr & { type: IrType & { kind: "func" } },
    arity: sig.arity,
  };
}

/** A global builtin passed as an ARGUMENT of a method call on a dyn (or
 * jsval) receiver: `anyArr.map(String)`, `anyArr.filter(Boolean)`. The
 * receiver's elements are dyn values, so the callback must take any value;
 * the typed value form (STRING parameter) fails on the first non-string
 * element at run time. The DYN-signature closure is the callback there,
 * and only there: every other reference keeps the value it had.
 * TypeScript keeps the typed-row globals' own value forms everywhere else. */
export function dynReceiverCallbackValue(L: Lowerer, expr: ts.Identifier, loc: SrcLoc): IrExpr | null {
  const key = expr.text;
  if (ownRow(DYN_BUILTIN_FNS, key) === undefined || !hasDynBuiltinFnValue(key)) return null;
  const isJs = isJsSourceFile(expr.getSourceFile());
  if (TYPED_ROW_KEYS.has(key) && isJs) return null;
  const call = expr.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(expr)) return null;
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const recvNode = call.expression.expression;
  const recvTs = L.typeOf(recvNode);
  const recv = L.mapTypeOf(recvTs);
  const dynKind = (k: IrType | null | undefined): boolean => k !== null && k !== undefined && (k.kind === "dyn" || k.kind === "jsval");
  const dynElems = recv !== null && recv.kind === "array" && dynKind(recv.elem);
  // A receiver whose type names `any` (`any`, `any[]`, or a union with one):
  // its elements are dyn values whatever the mapper settled on.
  const anyish = L.checker.typeToString(recvTs).split(/[^A-Za-z]+/).includes("any");
  if (!dynKind(recv) && !dynElems && !anyish) return null;
  const sym = L.resolveValueSymbol(expr);
  if (!sym) return null;
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
  return dynBuiltinFnValueOf(L, key, loc);
}
