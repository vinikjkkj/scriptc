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
 *   `typeof fetch` AS A TYPE. The value form's signature is
 *   `(input: string) => Promise<Response>` -- arity ONE, because fetch's
 *   `init` argument has no static representation (lower-fetch.ts walks an
 *   object LITERAL at the call site, and there is no RequestInit value).
 *   Adding a mapType arm for `typeof fetch` would make zapo's
 *   `WaFetchVersionOptions` record compile, and every two-argument call
 *   through that field would then become a NEW refusal inside a function
 *   body that produces none today. That is the trade lower-fetch.ts's
 *   header already refused, for the same reason, and refusing a type is
 *   loud where a narrowed type mapping would be a silent lie about arity.
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
  arrayOf,
  BOOL,
  F64,
  funcOf,
  type IrExpr,
  type IrFunction,
  type IrLibFn,
  type IrType,
  RESPONSE_T,
  type SrcLoc,
  STRING,
  typeEquals,
} from "../../ir/nodes.js";

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

const FETCH_VALUE_RET: IrType = { kind: "promise", inner: RESPONSE_T };

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
  // BUILTIN_FN_VALUE_RESOLVERS above. The FETCH_VALUE_RET constant stays
  // as the shape that resolver requires.
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
};

/** Does `name` have a value form in this build? */
export function hasBuiltinFnValue(L: Lowerer, name: string): boolean {
  if (BUILTIN_FN_VALUE_RESOLVERS[name] !== undefined) return !L.dynamic;
  const entry = BUILTIN_FN_VALUES[name];
  if (entry === undefined) return false;
  return !(entry.staticOnly === true && L.dynamic);
}

/** The entry for `name` at THIS identifier's mapped type: the fixed table
 * row, or the resolver's row for the one name whose signature is the
 * checker's. Null when the name has no value form here, or when the
 * resolver refused the shape. */
function entryFor(L: Lowerer, name: string, mapped: IrType | null): BuiltinFnValue | null {
  const resolver = BUILTIN_FN_VALUE_RESOLVERS[name];
  if (resolver !== undefined) return mapped === null ? null : resolver(L, mapped);
  return BUILTIN_FN_VALUES[name] ?? null;
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
function gatedValueType(L: Lowerer, expr: ts.Identifier): IrType | null {
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
  const sym = L.resolveValueSymbol(expr);
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
export function builtinFnValueOf(L: Lowerer, expr: ts.Identifier, loc: SrcLoc): IrExpr | null {
  const want = gatedValueType(L, expr);
  if (want === null) return null;
  return builtinFnValueClosure(L, expr.text, want, loc);
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
