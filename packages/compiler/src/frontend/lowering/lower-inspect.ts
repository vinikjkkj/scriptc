/* The node:util inspect/format lowering (a spoke module like
 * lower-assert.ts): STATIC util.inspect — one synthesized traversal
 * helper per argument type (the deepStrictEqual precedent, interned per
 * typeKey), producing Node v24's byte-exact DEFAULT-options rendering —
 * and util.format/formatWithOptions over compile-time format strings.
 *
 * The division of labor: the synthesized helpers own the TRAVERSAL the
 * static type dictates (fields, elements, entries, union arms, depth
 * bookkeeping); scr_inspect.c owns everything the type cannot know —
 * scalar formatting (-0, the quoting ladder, string splitting), Buffer
 * hex, and the layout engine (frames, break-length, grid grouping).
 * Checked-dynamic values render ENTIRELY in the runtime (the dyn
 * carries its own shape); island `any` values render their scalar kinds
 * and throw catchably on composites (the runtime tag is all there is).
 *
 * Options fence honestly, never approximate: depth takes any numeric
 * literal plus null/Infinity (cycle-capable types are safe unbounded —
 * the circular machinery cuts every cycle), colors:false / compact:3 /
 * breakLength:80 are the accepted no-op spellings, and everything else
 * names itself in the diagnostic. Values whose rendering would need
 * runtime type identity the static type lacks fence the same way: class
 * hierarchies (a subclass's name and extra fields are dynamic), function
 * values inside composites (no runtime name exists), Uint8Array-vs-
 * Buffer ambiguity.
 *
 * CYCLIC runtime data renders Node's exact `<ref *N>`/`[Circular *N]`
 * markers: helpers over cycle-capable composites (typeReachesItself)
 * drive the runtime seen/circular protocol (insp.circCheck/seenPush/
 * refWrap — scr_inspect.c), numbering in discovery order per top-level
 * value, exactly formatValue's ctx.seen/ctx.circular.
 *
 * Known-divergence corners (SEMANTICS.md): errors render the STACKLESS
 * `[Name: message]` form (compiled binaries carry no JS stack), and
 * record/class property order follows declaration order (SEMANTICS.md
 * 36's existing stance). */
import * as ts from "../ts7/adapter.js";
import type { NullProtoPatch } from "./ir-patch.js";
import type { Lowerer } from "./lowerer.js";
import { isJsSourceFile, locOf } from "../program.js";
import { BOOL, BYTES_ELEM_NAMES, DYN, F64, canBoxFuncIntoDyn, internalSlotFields, parseOwnShadowField, IrExpr, IrStmt, IrType, RUNTIME_ERROR_CLASSES, STRING, SrcLoc, UNDEFINED_T, VOID, shapeHasAccessorSlots, typeKey } from "../../ir/nodes.js";
import { CLASS_PROPS_FIELD, type ClassInfo } from "./lower-classes.js";
import { pureReemittable } from "./lower-exprs.js";
import { classInstanceToString, dynRestPack } from "./lower-calls.js";
import { lowerPromisifiedDiffieHellmanValue } from "./lower-builtins.js";
import { refuseCodecValue } from "../codec-shadow.js";

/* ── IR construction shorthand ───────────────────────────────────────── */

/** The string-literal node's own type, so a lowering that has to REVISE a
 * literal it already emitted can hold one without narrowing IrExpr. The
 * revision may replace the node's KIND outright — the record arm's
 * null-prototype prefix becomes a per-instance ternary — so a holder of
 * one must not read `.value` back after registering a revision. */
type StrLit = { kind: "strLit"; value: string; type: IrType; loc: SrcLoc };
const strNode = (value: string, loc: SrcLoc): StrLit => ({ kind: "strLit", value, type: STRING, loc });
const str = (value: string, loc: SrcLoc): IrExpr => ({ kind: "strLit", value, type: STRING, loc });
const num = (value: number, loc: SrcLoc): IrExpr => ({ kind: "numLit", value, type: F64, loc });
const boolLit = (value: boolean, loc: SrcLoc): IrExpr => ({ kind: "boolLit", value, type: BOOL, loc });
/** For a composite of n entries: the entries the traversal shows (Node's loop bound). */
const optShown = (n: IrExpr, loc: SrcLoc): IrExpr => ({ kind: "libCall", fn: "insp.shown", args: [n], type: F64, loc });
/** For a composite of n entries: the tail count n - maxLength ("more items" when > 0). */
const optRem = (n: IrExpr, loc: SrcLoc): IrExpr => ({ kind: "libCall", fn: "insp.rem", args: [n], type: F64, loc });
/** The active util.inspect depth (runtime options). */
const optDepth = (loc: SrcLoc): IrExpr => ({ kind: "libCall", fn: "insp.optDepth", args: [], type: F64, loc });

function concatAll(parts: IrExpr[], loc: SrcLoc): IrExpr {
  if (parts.length === 0) return str("", loc);
  let out = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    out = { kind: "strConcat", left: out, right: parts[i]!, type: STRING, loc };
  }
  return out;
}

/* ── argument evaluation order for the formatter family ─────────────── */

/** Syntactic purity of an argument expression: evaluating it can neither
 * run user code nor change a value another argument holds. Identifiers,
 * literals, property reads of those, and pure unary forms. Anything else (a
 * call, new, assignment, ++, await, yield, a literal containing one) counts
 * as an effect. Property reads count as pure: an accessor run by an argument
 * read is outside this rule. */
function syntacticallyPure(n: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) {
    return syntacticallyPure(n.expression);
  }
  if (
    ts.isIdentifier(n) ||
    ts.isStringLiteralLike(n) ||
    ts.isNumericLiteral(n) ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    n.kind === ts.SyntaxKind.NullKeyword ||
    n.kind === ts.SyntaxKind.ThisKeyword ||
    n.kind === ts.SyntaxKind.BigIntLiteral ||
    n.kind === ts.SyntaxKind.RegularExpressionLiteral
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(n)) return syntacticallyPure(n.expression);
  if (ts.isElementAccessExpression(n)) return syntacticallyPure(n.expression) && syntacticallyPure(n.argumentExpression);
  if (ts.isPrefixUnaryExpression(n)) {
    return n.operator !== ts.SyntaxKind.PlusPlusToken && n.operator !== ts.SyntaxKind.MinusMinusToken && syntacticallyPure(n.operand);
  }
  if (ts.isTypeOfExpression(n)) return syntacticallyPure(n.expression);
  if (ts.isTemplateExpression(n)) return n.templateSpans.every((sp) => syntacticallyPure(sp.expression));
  if (ts.isArrayLiteralExpression(n)) return n.elements.every((e) => !ts.isSpreadElement(e) && syntacticallyPure(e));
  if (ts.isObjectLiteralExpression(n)) {
    return n.properties.every((p) => ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && syntacticallyPure(p.initializer));
  }
  return false;
}

/** Node evaluates EVERY argument of console.log / util.format and then
 * formats them. The lowering formats an argument the moment it is lowered,
 * so an argument that holds mutable state (an object, array, Map, dyn box,
 * ...) followed by an argument that RUNS something would print the state
 * before the later argument mutated it. The hoist binds such an argument's
 * value to a hidden local, in argument order, before any formatting; the
 * formatter then reads the local. Immutable scalars need no hoist (their
 * value cannot change after evaluation), and neither does a call whose later
 * arguments are all syntactically pure (no code runs between the evaluation
 * and the formatting), so the common shapes lower exactly as before. */
export class ArgHoist {
  readonly stmts: IrStmt[] = [];
  private readonly nodes: ts.Expression[];
  private readonly lastEffect: number;
  constructor(private readonly L: Lowerer, nodes: readonly ts.Expression[]) {
    this.nodes = [...nodes];
    let last = -1;
    for (let i = 0; i < this.nodes.length; i++) if (!syntacticallyPure(this.nodes[i]!)) last = i;
    // An effect in the FIRST argument alone orders nothing: it runs before every other.
    this.lastEffect = last < 1 ? -1 : last;
  }
  /** The argument's lowered value, evaluated in argument order into a hidden
   * local when it or a LATER argument runs code. Every non-constant argument
   * up to the last effectful one is bound (scalars too: a variable read
   * must happen before the later argument's effect, and the bindings run
   * ahead of the whole formatted expression, so an unbound effectful
   * argument would otherwise run after a bound later one). */
  take(node: ts.Expression, value: IrExpr): IrExpr {
    const idx = this.nodes.indexOf(node);
    if (idx < 0 || idx > this.lastEffect) return value;
    if (value.kind === "numLit" || value.kind === "strLit" || value.kind === "boolLit" || value.kind === "unitLit") return value;
    const tk = value.type.kind;
    if (tk === "jsval") return value;
    if (tk === "void" || tk === "undefinedT" || tk === "nullT") {
      this.stmts.push({ kind: "exprStmt", expr: value, loc: value.loc });
      if (tk === "void") return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: value.loc };
      return { kind: "unitLit", unit: tk === "nullT" ? "null" : "undefined", type: value.type, loc: value.loc };
    }
    const slot = this.L.declareHiddenLocal("%fmtArg", value.type);
    this.stmts.push({ kind: "varDecl", localId: slot.id, init: value, loc: value.loc });
    return { kind: "varRef", localId: slot.id, type: value.type, loc: value.loc };
  }
  /** The call's result, wrapped so the hoisted bindings run first. */
  wrap(result: IrExpr): IrExpr {
    if (this.stmts.length === 0) return result;
    return { kind: "seqExpr", stmts: this.stmts, result, type: result.type, loc: result.loc };
  }
}

/* ── property-name rendering (compile-time keys) ─────────────────────── */

/** strEscape's quote ladder over a COMPILE-TIME string (record field
 * names, format-string chunks never pass through here — only keys).
 * Mirrors scr_inspect.c's insp_quote_into byte-for-byte. */
export function inspectQuote(s: string): string {
  const hasSingle = s.includes("'");
  const quote = !hasSingle ? "'" : !s.includes('"') ? '"' : !s.includes("`") && !s.includes("${") ? "`" : "'";
  let body = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20) {
      const meta = ["\\b", "\\t", "\\n", undefined, "\\f", "\\r"][c - 8];
      body += c >= 8 && c <= 13 && meta !== undefined ? meta : `\\x${c.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (c === 0x27 && quote === "'") {
      body += "\\'";
    } else if (c === 0x5c) {
      body += "\\\\";
    } else if (c >= 0x7f && c <= 0x9f) {
      body += `\\x${c.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        body += s[i]! + s[i + 1]!;
        i++;
      } else {
        body += `\\u${c.toString(16)}`;
      }
    } else {
      body += s[i]!;
    }
  }
  return quote + body + quote;
}

/** formatProperty's key rendering: bare identifiers stay bare
 * ('__proto__' excepted), everything else quotes. */
function inspectKey(name: string): string {
  if (name === "__proto__") return "['__proto__']";
  return /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name) ? name : inspectQuote(name);
}

/** A record field the checker named for a SYMBOL key (`__@<var>@<id>`, the
 * late-bound spelling of `{ [s]: v }`). `__@ord@` markers are not symbols. */
function isSymbolFieldName(name: string): boolean {
  return name.startsWith("__@") && !name.startsWith("__@ord@");
}

const symbolSpellingCache = new WeakMap<Lowerer, Map<string, string>>();

/** Node's `Symbol(desc)` spelling of a late-bound symbol key, from the
 * computed-key expression that declares it: `[s]` with `const s =
 * Symbol('desc')` / `Symbol()` / `Symbol.for('desc')`, or a well-known
 * `[Symbol.iterator]`. The checker names the member by the VARIABLE
 * (`__@s@51`), which carries no description, so the table is built once
 * per program from every computed key whose type is a unique symbol.
 * Null when the description cannot be read at build time. */
export function symbolSpellingOf(L: Lowerer, lateName: string): string | null {
  let map = symbolSpellingCache.get(L);
  if (map === undefined) {
    map = new Map<string, string>();
    symbolSpellingCache.set(L, map);
    const stack: ts.Node[] = [...L.moduleOrder];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (ts.isComputedPropertyName(n) && (L.typeOf(n.expression).flags & ts.TypeFlags.UniqueESSymbol) !== 0) {
        const late = L.checker.getSymbolAtLocation(n)?.name;
        const spelled = symbolDescriptionSpelling(L, n.expression);
        if (late !== undefined && late.startsWith("__@") && spelled !== null) map.set(late, spelled);
      }
      ts.forEachChild(n, (c) => {
        stack.push(c);
        return undefined;
      });
    }
  }
  return map.get(lateName) ?? null;
}

function symbolDescriptionSpelling(L: Lowerer, e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Symbol") {
    if (!L.isStdlibSymbol(L.checker.getSymbolAtLocation(e.expression))) return null;
    return `Symbol(Symbol.${e.name.text})`;
  }
  if (!ts.isIdentifier(e)) return null;
  const sym = L.resolveValueSymbol(e);
  const decl = sym ? L.checker.valueDeclarationOf(sym) : undefined;
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer || !ts.isCallExpression(decl.initializer)) return null;
  const init = decl.initializer;
  const callee = init.expression;
  const isSymbolCall = ts.isIdentifier(callee) && callee.text === "Symbol";
  const isSymbolFor =
    ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Symbol" &&
    callee.name.text === "for";
  if (!isSymbolCall && !isSymbolFor) return null;
  if (!L.isStdlibSymbol(L.checker.getSymbolAtLocation(isSymbolCall ? callee as ts.Identifier : (callee as ts.PropertyAccessExpression).expression))) return null;
  if (init.arguments.length === 0) return isSymbolCall ? "Symbol()" : null;
  const arg = init.arguments[0]!;
  if (init.arguments.length !== 1 || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return null;
  return `Symbol(${arg.text})`;
}

/* ── type support ────────────────────────────────────────────────────── */

/** The error-hierarchy gate: `info`'s instances render through the
 * runtime's name/message/code slots, which subclasses inherit — sound
 * only when NO descendant adds declared fields (they would be own
 * properties Node prints). */
function errorRenderable(info: ClassInfo): boolean {
  // The builtin classes' name/message/code live in runtime slots (the
  // ScrError prefix insp.error reads), not IR fields; only USER-declared
  // fields are own properties the runtime rendering would miss. #private
  // fields are NOT own properties — Node never prints them — so they
  // don't disqualify.
  if (!info.builtinError && info.def.fields.some((f) => !f.name.startsWith("#"))) return false;
  return info.subclasses.every((s) => errorRenderable(s));
}

function isErrorClass(L: Lowerer, className: string): boolean {
  if (RUNTIME_ERROR_CLASSES.has(className)) return true;
  return L.isSubclassOf(className, "%Error");
}

/** inspUnsupportedReason: the deepUnsupportedReason twin. Fences name the
 * FIRST unsupported constituent. `visiting` terminates recursive shapes
 * and records their existence (the depth-null gate). */
function inspectSupport(L: Lowerer, t: IrType, visiting: Set<string>, out: { recursive: boolean }): string | null {
  switch (t.kind) {
    case "f64":
    case "string":
    case "bool":
    case "undefinedT":
    case "nullT":
    case "bigint":
    case "regex":
    case "date":
    case "symbol":
    case "dyn":
    case "jsval":
      return null;
    case "array":
      return inspectSupport(L, t.elem, visiting, out);
    case "bytes":
      return "typed arrays inside composites have no inspect lowering yet (Buffer's <Buffer ..> form vs Uint8Array's is not recorded in the static type here)";
    case "record": {
      if (visiting.has(t.shapeId)) {
        out.recursive = true;
        return null;
      }
      visiting.add(t.shapeId);
      const shape = L.shapes.get(t.shapeId);
      if (!shape) return "this record shape has no inspect lowering";
      // Accessor-carrying shapes: Node prints the accessor names as
      // `x: [Getter]` / `[Setter]` / `[Getter/Setter]` in insertion order
      // — a position the static field walk does not track (accessor slots
      // live outside declaredOrder), so the render fences by name.
      if (shapeHasAccessorSlots(shape)) {
        return "shapes carrying get/set accessor properties have no inspect lowering yet (Node prints the accessor names as [Getter]/[Setter] in insertion order — read the properties explicitly)";
      }
      if (shape.indexValue !== undefined) {
        // PURE index-signature shapes (Record<string, V> — no declared
        // fields) render like the dyn's objects: a runtime key walk
        // (recordOvfKeys), each key through insp.key's bare-or-quoted
        // ladder. Hybrids keep the fence — JS orders integer keys first
        // ACROSS the declared and overflow stores, an interleave the
        // declared-then-overflow walk cannot honor.
        if (shape.fields.length > 0) {
          return "index-signature records with declared fields have no inspect lowering yet (JS interleaves integer keys across the declared and dynamic key sets)";
        }
        const why = inspectSupport(L, shape.indexValue, visiting, out);
        if (why !== null) return why;
        visiting.delete(t.shapeId);
        return null;
      }
      for (const f of shape.fields) {
        const why = inspectSupport(L, f.type, visiting, out);
        if (why !== null) return why;
      }
      visiting.delete(t.shapeId);
      return null;
    }
    case "weakmap":
      // Node cannot enumerate a weak collection: its inspect is the fixed
      // `WeakMap { <items unknown> }`, whatever the key and value kinds.
      return null;
    case "map": {
      const keyWhy = inspectSupport(L, t.key, visiting, out);
      if (keyWhy !== null) return keyWhy;
      return inspectSupport(L, t.value, visiting, out);
    }
    case "set":
      return inspectSupport(L, t.elem, visiting, out);
    case "union": {
      const def = L.unions.get(t.unionId);
      if (!def) return "this union has no inspect lowering";
      if (visiting.has(t.unionId)) {
        out.recursive = true;
        return null;
      }
      visiting.add(t.unionId);
      for (const arm of def.arms) {
        const why = inspectSupport(L, arm, visiting, out);
        if (why !== null) return why;
      }
      visiting.delete(t.unionId);
      return null;
    }
    case "func":
      // A function VALUE inspects through its checked-dynamic box: the box
      // resolves the JS name from the closure's entry point (the compiler's
      // fn-name table), so `[Function: name]` / `[Function (anonymous)]` is
      // the program's own answer, not a guess. Only a signature the dyn
      // boundary cannot carry keeps the fence.
      if (canBoxFuncIntoDyn(t, (id) => L.shapes.get(id), (id) => L.unions.get(id))) return null;
      return "function values have no inspect lowering (no runtime name exists — Node prints '[Function: name]'; pass the function's declared identifier directly to util.inspect for the baked form)";
    case "object": {
      const info = L.classes.get(t.className);
      if (!info) return `class '${t.className}' has no inspect lowering`;
      if (isErrorClass(L, t.className)) {
        return errorRenderable(info)
          ? null
          : "error subclasses with declared fields have no inspect lowering yet (the extra own properties are runtime-dynamic)";
      }
      if (info.subclasses.length > 0) {
        return `inspect of '${t.className}' values is not lowered (the class has subclasses — the runtime value's constructor name and fields are dynamic)`;
      }
      if (visiting.has(t.className)) {
        out.recursive = true;
        return null;
      }
      visiting.add(t.className);
      // #private fields never print (Node omits them — not own
      // properties), so their types don't gate support.
      for (const f of info.def.fields) {
        if (f.name.startsWith("#")) continue;
        const why = inspectSupport(L, f.type, visiting, out);
        if (why !== null) return why;
      }
      visiting.delete(t.className);
      return null;
    }
    default:
      return `'${L.fmt(t)}' values have no inspect lowering`;
  }
}

/* ── the per-type rendering expression ───────────────────────────────── */

/** True when a runtime value of `t` at index expr `v` answers
 * `typeof v === 'number'` — the grid-grouping order flag. */
function isNumberFlag(L: Lowerer, t: IrType, v: () => IrExpr, loc: SrcLoc): IrExpr {
  if (t.kind === "f64") return boolLit(true, loc);
  if (t.kind === "union") {
    const def = L.unions.get(t.unionId);
    const tag = def ? def.arms.findIndex((a) => a.kind === "f64") : -1;
    if (tag >= 0) {
      return { kind: "unionIsTag", unionId: t.unionId, tag, negated: false, value: v(), type: BOOL, loc };
    }
  }
  return boolLit(false, loc);
}

/** The rendering of one value of type `t` at runtime depth `recurse`
 * with the depth budget `depth` — a direct scalar libCall or a call of
 * the interned per-type helper. */
/** True when a class's hierarchy (the class, its bases and its subclasses) has a
 * JS-source class: a JS class's inferred fields are created by assignment, so their
 * insertion order is per instance (ir/nodes.ts orderRecordPlanOf). Such values print
 * through the runtime's dyn inspector, which walks the member table in that order;
 * the static printer walks the layout order and would be wrong for them. */
function jsHierarchyHasInferredFields(L: Lowerer, className: string): boolean {
  let root: ClassInfo | undefined = L.classes.get(className);
  if (root === undefined) return false;
  let guard = 0;
  while (root.base !== null && guard++ < 1000) root = root.base;
  const seen = new Set<string>();
  const stack: ClassInfo[] = [root];
  while (stack.length > 0) {
    const c = stack.pop()!;
    if (seen.has(c.def.name)) continue;
    seen.add(c.def.name);
    // A symbol-keyed field's layout name is Node's `Symbol(desc)` spelling, which the dyn member table
    // carries as a string key the dyn inspector would quote. Such a hierarchy keeps the static printer.
    if ((c.symbolFields?.size ?? 0) > 0) return false;
    if (c.decl != null && isJsSourceFile(c.decl.getSourceFile())) return true;
    for (const sub of c.subclasses) stack.push(sub);
  }
  return false;
}

function inspectExpr(
  L: Lowerer,
  t: IrType,
  value: IrExpr,
  recurse: IrExpr,
  depth: IrExpr,
  loc: SrcLoc,
): IrExpr {
  if (t.kind === "object" && jsHierarchyHasInferredFields(L, t.className)) {
    return { kind: "libCall", fn: "insp.dyn", args: [{ kind: "dynFrom", value, type: DYN, loc }, recurse, depth], type: STRING, loc };
  }
  switch (t.kind) {
    case "f64":
      return { kind: "libCall", fn: "insp.f64", args: [value], type: STRING, loc };
    case "string":
      return { kind: "libCall", fn: "insp.str", args: [value], type: STRING, loc };
    case "bool":
      return { kind: "toString", operand: value, type: STRING, loc };
    case "undefinedT":
      return str("undefined", loc);
    case "nullT":
      return str("null", loc);
    case "regex":
      return { kind: "libCall", fn: "insp.regex", args: [value], type: STRING, loc };
    // A Date renders as its ISO form (`Invalid Date` when NaN) at every
    // depth; a Date carries no own enumerable properties.
    case "date":
      return { kind: "libCall", fn: "insp.date", args: [value], type: STRING, loc };
    // Node renders a bigint with its `n` suffix at every depth ("1n",
    // "{ a: 1n }") — the suffix is part of the inspect form, not of
    // String(1n), so it is concatenated here and not inside big.str.
    case "bigint":
      return {
        kind: "strConcat",
        left: {
          kind: "libCall",
          fn: "big.str",
          args: [value, { kind: "numLit", value: 10, type: F64, loc }],
          type: STRING,
          loc,
        },
        right: str("n", loc),
        type: STRING,
        loc,
      };
    case "symbol":
      // inspect(sym) IS Symbol.prototype.toString's text ("Symbol(foo)")
      // — Node prints it unquoted at every depth.
      return { kind: "libCall", fn: "sym.toString", args: [value], type: STRING, loc };
    case "bytes":
      return { kind: "libCall", fn: "insp.buffer", args: [value], type: STRING, loc };
    case "dyn":
      return { kind: "libCall", fn: "insp.dyn", args: [value, recurse, depth], type: STRING, loc };
    case "func":
      return {
        kind: "libCall",
        fn: "insp.dyn",
        args: [{ kind: "dynFrom", value, type: DYN, loc }, recurse, depth],
        type: STRING,
        loc,
      };
    case "jsval":
      return { kind: "libCall", fn: "insp.jsval", args: [value, recurse, depth], type: STRING, loc };
    case "object":
      if (isErrorClass(L, t.className)) {
        return { kind: "libCall", fn: "insp.error", args: [value, recurse, depth], type: STRING, loc };
      }
      L.refuseHelperFieldEnumeration(value, loc, "console.log/util.inspect");
      return { kind: "call", callee: inspectHelper(L, t, loc), args: [value, recurse, depth], type: STRING, loc };
    default:
      if (t.kind === "record") L.noteKeyEnumeration(value, loc, "console.log/util.inspect");
      return { kind: "call", callee: inspectHelper(L, t, loc), args: [value, recurse, depth], type: STRING, loc };
  }
}

/** True when a VALUE of `t` can contain itself — t's type graph reaches t
 * again through record fields (index values included), array elements,
 * union arms, map keys/values, set elements, or class fields. Inspect
 * helpers over such types run Node's circular machinery (seen stack +
 * <ref *N>/[Circular *N]); everything acyclic keeps the zero-cost path
 * (a value of an acyclic type can never repeat on its own path). */
export function typeReachesItself(L: Lowerer, t: IrType): boolean {
  const root = typeKey(t);
  const seen = new Set<string>();
  const walk = (u: IrType): boolean => {
    const constituents: IrType[] = [];
    switch (u.kind) {
      case "record": {
        const shape = L.shapes.get(u.shapeId);
        if (!shape) return false;
        constituents.push(...shape.fields.map((f) => f.type));
        if (shape.indexValue) constituents.push(shape.indexValue);
        break;
      }
      case "array":
      case "set":
        constituents.push(u.elem);
        break;
      case "map":
        constituents.push(u.key, u.value);
        break;
      case "union": {
        const def = L.unions.get(u.unionId);
        if (def) constituents.push(...def.arms);
        break;
      }
      case "object": {
        const info = L.classes.get(u.className);
        if (info) constituents.push(...info.def.fields.map((f) => f.type));
        break;
      }
      default:
        return false;
    }
    for (const c of constituents) {
      const k = typeKey(c);
      if (k === root) return true;
      if (!seen.has(k)) {
        seen.add(k);
        if (walk(c)) return true;
      }
    }
    return false;
  };
  return walk(t);
}

/* ── the interned per-type helper ────────────────────────────────────── */

/** `%util.insp.<n>(v, r, d): string` — formatValue over the static type:
 * empty composites answer their literals (before the depth check, Node's
 * order), the depth budget answers `[Array]`/`[Object]`/`[Map]`/
 * `[Set]`/`[ClassName]`, and non-empty composites drive the runtime
 * frame engine (begin / entry / end). Registered in the cache BEFORE the
 * body builds, so recursive shapes call themselves by name. */
function inspectHelper(L: Lowerer, t: IrType, loc: SrcLoc): string {
  const key = `insp:${typeKey(t)}`;
  const existing = L.inspectHelpers.get(key);
  if (existing) return existing;
  const name = `%util.insp.${L.inspectHelpers.size}`;
  L.inspectHelpers.set(key, name);

  const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
  const v = (): IrExpr => ref("v.0", t);
  const r = (): IrExpr => ref("r.0", F64);
  const d = (): IrExpr => ref("d.0", F64);
  const rPlus1 = (): IrExpr => ({ kind: "bin", op: "+", left: r(), right: num(1, loc), type: F64, loc });
  const ret = (value: IrExpr): IrStmt => ({ kind: "return", value, loc });
  const exprStmt = (expr: IrExpr): IrStmt => ({ kind: "exprStmt", expr, loc });
  // CYCLE-CAPABLE composites (typeReachesItself) run Node's circular
  // machinery: circCheck first (a value already on the traversal stack
  // renders [Circular *N] — before the empty/depth answers, Node's
  // order), seen-push after begin, and refWrap around end's result (the
  // <ref *N> prefix on values the walk found circular). Acyclic types
  // keep the zero-cost path.
  const onCycle =
    (t.kind === "record" || t.kind === "array" || t.kind === "map" || t.kind === "object") &&
    typeReachesItself(L, t);
  const begin = (): IrStmt[] => [
    exprStmt({ kind: "libCall", fn: "insp.begin", args: [rPlus1()], type: { kind: "void" }, loc }),
    ...(onCycle
      ? [exprStmt({ kind: "libCall", fn: "insp.seenPush", args: [v()], type: { kind: "void" }, loc })]
      : []),
  ];
  const entry = (s: IrExpr, isNum: IrExpr): IrStmt =>
    exprStmt({ kind: "libCall", fn: "insp.entry", args: [s, isNum], type: { kind: "void" }, loc });
  const end = (base: IrExpr, b0: IrExpr, b1: IrExpr, arrayExtras: boolean, trailingMore: IrExpr): IrExpr => {
    const reduced: IrExpr = {
      kind: "libCall",
      fn: "insp.end",
      args: [base, b0, b1, rPlus1(), boolLit(arrayExtras, loc), trailingMore],
      type: STRING,
      loc,
    };
    if (!onCycle) return reduced;
    return { kind: "libCall", fn: "insp.refWrap", args: [v(), reduced], type: STRING, loc };
  };
  /** if (r > d) return "<placeholder>";
   *
   * Takes a NODE as well as a string so a caller that may have to REVISE
   * its placeholder later can keep a reference to it (the record arm's
   * null-prototype prefix — Lowerer.nullProtoRenderings). */
  const depthGate = (placeholder: string | StrLit): IrStmt => ({
    kind: "if",
    cond: { kind: "bin", op: ">", left: r(), right: d(), type: BOOL, loc },
    then: [ret(typeof placeholder === "string" ? str(placeholder, loc) : placeholder)],
    else_: null,
    loc,
  });
  const child = (elemT: IrType, value: IrExpr): IrExpr => inspectExpr(L, elemT, value, rPlus1(), d(), loc);

  const locals: { id: string; name: string; type: IrType; mutable: boolean }[] = [
    { id: "v.0", name: "v", type: t, mutable: false },
    { id: "r.0", name: "r", type: F64, mutable: false },
    { id: "d.0", name: "d", type: F64, mutable: false },
  ];
  let body: IrStmt[];

  switch (t.kind) {
    case "array": {
      const len = (): IrExpr => ({ kind: "arrIntrinsic", method: "length", receiver: v(), args: [], type: F64, loc });
      const at = (i: IrExpr): IrExpr => ({ kind: "arrayGet", arr: v(), index: i, type: t.elem, loc });
      locals.push(
        { id: "n.0", name: "n", type: F64, mutable: false },
        { id: "s.0", name: "s", type: F64, mutable: false },
        { id: "i.0", name: "i", type: F64, mutable: true },
      );
      const n = (): IrExpr => ref("n.0", F64);
      const shown = (): IrExpr => ref("s.0", F64);
      const i = (): IrExpr => ref("i.0", F64);
      const hasMore = (): IrExpr => ({ kind: "bin", op: ">", left: optRem(n(), loc), right: num(0, loc), type: BOOL, loc });
      body = [
        { kind: "varDecl", localId: "n.0", init: len(), loc },
        {
          kind: "if",
          cond: { kind: "bin", op: "===", left: n(), right: num(0, loc), type: BOOL, loc },
          then: [ret(str("[]", loc))],
          else_: null,
          loc,
        },
        depthGate("[Array]"),
        { kind: "varDecl", localId: "s.0", init: optShown(n(), loc), loc },
        ...begin(),
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0, loc), loc },
          cond: { kind: "bin", op: "<", left: i(), right: shown(), type: BOOL, loc },
          update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: i(), right: num(1, loc), type: F64, loc }, loc },
          body: [entry(child(t.elem, at(i())), isNumberFlag(L, t.elem, () => at(i()), loc))],
          loc,
        },
        {
          kind: "if",
          cond: hasMore(),
          then: [
            entry(
              {
                kind: "libCall",
                fn: "insp.moreItems",
                args: [optRem(n(), loc)],
                type: STRING,
                loc,
              },
              isNumberFlag(L, t.elem, () => at(shown()), loc),
            ),
          ],
          else_: null,
          loc,
        },
        ret(end(str("", loc), str("[", loc), str("]", loc), true, hasMore())),
      ];
      break;
    }
    case "record": {
      const shape = L.shapes.get(t.shapeId);
      if (!shape) throw new Error(`inspect of unknown shape ${t.shapeId}`);
      const get = (field: string, type: IrType): IrExpr => ({ kind: "recordGet", obj: v(), shapeId: t.shapeId, field, type, loc });
      if (shape.tuple) {
        // Tuples ARE arrays to Node: bracket form, array-extras grouping.
        if (shape.fields.length === 0) {
          body = [ret(str("[]", loc))];
          break;
        }
        body = [depthGate("[Array]"), ...begin()];
        for (const f of shape.fields) {
          body.push(entry(child(f.type, get(f.name, f.type)), isNumberFlag(L, f.type, () => get(f.name, f.type), loc)));
        }
        body.push(ret(end(str("", loc), str("[", loc), str("]", loc), true, boolLit(false, loc))));
        break;
      }
      if (shape.indexValue && shape.fields.length === 0) {
        // The PURE index-signature shape (Record<string, V>): a runtime
        // key walk in insertion order (recordOvfKeys — SEMANTICS.md 36's
        // key-order stance), each key rendered through insp.key's
        // bare-or-quoted ladder, each value read back through the keyed
        // get. No 100-entry cap: Node truncates arrays and iterables,
        // never plain objects.
        const iv = shape.indexValue;
        const ksT: IrType = { kind: "array", elem: STRING };
        locals.push(
          { id: "ks.0", name: "ks", type: ksT, mutable: false },
          { id: "n.0", name: "n", type: F64, mutable: false },
          { id: "i.0", name: "i", type: F64, mutable: true },
          { id: "k.0", name: "k", type: STRING, mutable: false },
        );
        const ks = (): IrExpr => ref("ks.0", ksT);
        const n = (): IrExpr => ref("n.0", F64);
        const i = (): IrExpr => ref("i.0", F64);
        const k = (): IrExpr => ref("k.0", STRING);
        const keyedRead = (): IrExpr =>
          ({ kind: "recordKeyGet", obj: v(), shapeId: t.shapeId, key: k(), overflowOnly: true, type: iv, loc });
        body = [
          { kind: "varDecl", localId: "ks.0", init: { kind: "recordOvfKeys", obj: v(), shapeId: t.shapeId, type: ksT, loc }, loc },
          { kind: "varDecl", localId: "n.0", init: { kind: "arrIntrinsic", method: "length", receiver: ks(), args: [], type: F64, loc }, loc },
          {
            kind: "if",
            cond: { kind: "bin", op: "===", left: n(), right: num(0, loc), type: BOOL, loc },
            then: [ret(str("{}", loc))],
            else_: null,
            loc,
          },
          depthGate("[Object]"),
          ...begin(),
          {
            kind: "for",
            init: { kind: "varDecl", localId: "i.0", init: num(0, loc), loc },
            cond: { kind: "bin", op: "<", left: i(), right: n(), type: BOOL, loc },
            update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: i(), right: num(1, loc), type: F64, loc }, loc },
            body: [
              { kind: "varDecl", localId: "k.0", init: { kind: "arrayGet", arr: ks(), index: i(), type: STRING, loc }, loc },
              entry(
                concatAll(
                  [
                    { kind: "libCall", fn: "insp.key", args: [k()], type: STRING, loc },
                    str(": ", loc),
                    child(iv, keyedRead()),
                  ],
                  loc,
                ),
                boolLit(false, loc),
              ),
            ],
            loc,
          },
          ret(end(str("", loc), str("{", loc), str("}", loc), false, boolLit(false, loc))),
        ];
        break;
      }
      // How Node RENDERS this shape, when the frontend interned it from a
      // builtin (IrRecordShape.builtin). It is the STATIC twin of the dyn
      // walk's cname/null_proto arms — the same value reaches BOTH
      // (`console.log(dirent)` comes here, `console.log(dirent as unknown)`
      // goes there), and one rendered with the prefix while the other did
      // not would be one object with two spellings inside one process.
      const bpre = shape.builtin?.ctorName
        ? `${shape.builtin.ctorName} `
        : shape.builtin?.nullProto
          ? "[Object: null prototype] "
          : "";
      // Past the depth budget Node says `[Dirent]` where a plain object
      // says `[Object]`, and `[Object: null prototype]` bare.
      const bdepth = shape.builtin?.ctorName
        ? `[${shape.builtin.ctorName}]`
        : shape.builtin?.nullProto
          ? "[Object: null prototype]"
          : "[Object]";
      // The shape's INTERNAL fields (the ones declaredOrder omits) that
      // Node keeps under an own SYMBOL: `Symbol(type): 1` for fs.Dirent,
      // listed AFTER every string key ([[OwnPropertyKeys]]'s order, the
      // same rule the class arm below follows for its symbol fields).
      // A slot the shape does NOT name a symbol for renders nowhere —
      // StringDecoder's %pending is the compiler's packed f64 where Node
      // holds a seven-byte native state buffer, and printing the f64
      // under Node's symbol name would be a fabricated value.
      const slotSyms = shape.builtin?.slotSymbols ?? {};
      const internalSyms = internalSlotFields(shape)
        .filter((n) => slotSyms[n] !== undefined)
        .map((n) => [n, slotSyms[n]!] as const);
      if (shape.fields.length === 0) {
        body = [ret(str(`${bpre}{}`, loc))];
        break;
      }
      // Object.keys' declared order (SEMANTICS.md 36's stance).
      // Baked into this inspect helper's body, and the body is built once —
      // so the shape's order is fixed here (Lowerer.noteEnumOrderBake).
      L.noteEnumOrderBake(t.shapeId, null);
      // SYMBOL-keyed members print after EVERY string key, in insertion
      // order ([[OwnPropertyKeys]]; Node 24 spells them `Symbol(desc): v`,
      // unbracketed). A symbol member whose description cannot be read at
      // build time, or whose value is a function (its name is Node's
      // `[desc]`), is refused by name rather than printed wrong.
      const declared = shape.declaredOrder ?? shape.fields.map((f) => f.name);
      const declaredSet = new Set(declared);
      const order = [
        ...declared.filter((n) => !isSymbolFieldName(n)),
        ...declared.filter((n) => isSymbolFieldName(n)),
        ...shape.fields.map((f) => f.name).filter((n) => isSymbolFieldName(n) && !declaredSet.has(n)),
      ];
      const byName = new Map(shape.fields.map((f) => [f.name, f.type] as const));
      const depthLit = strNode(bdepth, loc);
      body = [depthGate(depthLit), ...begin()];
      for (const fname of order) {
        const ft = byName.get(fname);
        if (!ft) continue;
        const keyText = (() => {
          if (!isSymbolFieldName(fname)) return inspectKey(fname);
          const spelled = symbolSpellingOf(L, fname);
          if (spelled === null || ft.kind === "func") {
            L.unsupported(
              "SC1090",
              L.moduleOrder[0]!,
              `a symbol-keyed member '${fname}' that prints as ${ft.kind === "func" ? "a function" : "an unreadable symbol description"} ` +
                `(util.inspect spells it Symbol(desc) with the function's own name)`,
            );
          }
          return spelled;
        })();
        const st = entry(
          concatAll([str(`${keyText}: `, loc), child(ft, get(fname, ft))], loc),
          boolLit(false, loc),
        );
        // A field some literal COMPLETED is not readable at all on an
        // instance that literal built: the slot holds the allocator's zero,
        // and this entry renders the field's VALUE. Measured before the
        // guard existed, `console.log(bag)` over a partly-filled
        // `{} as Record<K, V>` was an ACCESS VIOLATION - the renderer walks
        // every declared field and the mask had no say.
        //
        // Registered rather than asked, like every other own-key question:
        // which shapes a completion targeted is decided after the whole
        // walk, and a program with none keeps this statement exactly as it
        // is. Scoped to `recordSlotFilled` (not the own-key question) on
        // purpose - it is the COMPLETED bit alone that makes a slot
        // unreadable, and a crossing-armed shape must keep rendering the
        // members it materialised.
        const completable = ft.kind !== "dyn" && !(ft.kind === "union" && L.armTag(ft.unionId, UNDEFINED_T) >= 0);
        if (completable) {
          L.noteSlotFilledGuard(t.shapeId, fname, {
            kind: "guardStmtInPlace",
            slot: { node: st as unknown as Record<string, unknown> },
            obj: v(),
            loc,
          });
        }
        // An OPTIONAL member's entry renders only when the key is OWN. The
        // slot's undefined arm cannot say that (`{a: undefined}` and `{}`
        // both leave it there), so this asks the same node Object.keys,
        // `in` and hasOwn ask (recordKeyPresent): the instance's own-key
        // mask when its literal established one, the undefined-arm tag
        // test otherwise. Before this, every record printed every declared
        // field, `a: undefined` for a key its own Object.keys said it did
        // not have (SEMANTICS 37 against corpus 1632's explicit undefined:
        // the trade record-presence-two-surfaces.test.ts documented).
        if (ft.kind === "union" && L.armTag(ft.unionId, UNDEFINED_T) >= 0) {
          body.push({
            kind: "if",
            cond: { kind: "recordKeyPresent", obj: v(), shapeId: t.shapeId, field: fname, type: BOOL, loc },
            then: [st],
            else_: null,
            loc,
          });
          continue;
        }
        body.push(st);
      }
      for (const [fname, desc] of internalSyms) {
        const ft = byName.get(fname);
        if (!ft) continue;
        body.push(
          entry(
            concatAll([str(`Symbol(${desc}): `, loc), child(ft, get(fname, ft))], loc),
            boolLit(false, loc),
          ),
        );
      }
      const openBrace = strNode(`${bpre}{`, loc);
      body.push(ret(end(str("", loc), openBrace, str("}", loc), false, boolLit(false, loc))));
      // A null-prototype prefix is a claim about the RUNTIME's own builder,
      // and a shape is structural, so it cannot be a per-SHAPE constant in
      // a module that also MATERIALISES this shape out of a dynamic value.
      // Arming answers whether there is such a crossing, and it is decided
      // after the whole walk, so the revision is registered rather than
      // asked (Lowerer.nullProtoRenderings) — a module with no crossing
      // keeps byte-identical IR and the literal it always had.
      //
      // The revision used to STRIP the prefix for the whole shape, which
      // made the runtime-built value print plain where Node prefixes it
      // and — through the record→dyn walker's twin of this decision — made
      // `deepStrictEqual(os.userInfo(), {…the same members…})` compare
      // EQUAL where Node throws. It now asks the INSTANCE (recordNullProto,
      // whose answer is the source object's own [[Prototype]] for a value a
      // crossing wrote and the shape's claim for every other one), so both
      // kinds of instance render as Node renders them.
      //
      // A ctorName prefix needs no such revision: the two shapes that carry
      // one both hold an INTERNAL SLOT, so a fabricated instance is refused
      // at the slot check rather than rendered (corpus 5825).
      // Registered for EVERY shape that could ever answer yes, not only
      // the ones a builtin claims: a crossing out of an
      // `Object.create(null)` source is a null-prototype INSTANCE of an
      // ordinary shape, and its `claim` is simply false. A shape with a
      // ctorName is exempt (see below), and a shape no crossing arms is
      // never revised, so nothing here changes an unarmed program's IR.
      if (!shape.builtin?.ctorName) {
        const perInstanceNodes: NullProtoPatch["nodes"] = [];
        // In PLACE: the literal is already embedded in an emitted
        // statement (depthGate holds one, insp.end's arg list the other),
        // and the registration exists precisely because there is no handle
        // to the container. StrLit's own comment names this. Each node
        // carries its OWN receiver expression — the two must not come to
        // share one object, because the passes below this rewrite types in
        // place and would rewrite a shared node once per occurrence.
        const perInstance = (node: StrLit, whenNull: string, plain: string): void => {
          perInstanceNodes.push({
            slot: { node: node as unknown as Record<string, unknown> },
            obj: v(),
            whenNull,
            plain,
          });
        };
        perInstance(openBrace, "[Object: null prototype] {", "{");
        perInstance(depthLit, "[Object: null prototype]", "[Object]");
        L.noteNullProtoRendering(t.shapeId, {
          kind: "perInstancePrefix",
          loc,
          nodes: perInstanceNodes,
        });
      }
      break;
    }
    case "weakmap":
      body = [ret(str("WeakMap { <items unknown> }", loc))];
      break;
    case "map":
    case "set": {
      const isMap = t.kind === "map";
      // A WeakMap riding the strong table: Node cannot enumerate it either.
      if (isMap && t.weak) {
        body = [ret(str("WeakMap { <items unknown> }", loc))];
        break;
      }
      const mi = (method: string, args: IrExpr[], type: IrType): IrExpr =>
        isMap
          ? ({ kind: "mapIntrinsic", method: method as "size", receiver: v(), args, type, loc } as IrExpr)
          : ({ kind: "setIntrinsic", method: method as "size", receiver: v(), args, type, loc } as IrExpr);
      locals.push(
        { id: "n.0", name: "n", type: F64, mutable: false },
        { id: "i.0", name: "i", type: F64, mutable: true },
        { id: "c.0", name: "c", type: F64, mutable: true },
      );
      const n = (): IrExpr => ref("n.0", F64);
      const i = (): IrExpr => ref("i.0", F64);
      const c = (): IrExpr => ref("c.0", F64);
      const label = isMap ? "Map" : "Set";
      const keyT = isMap ? (t as IrType & { kind: "map" }).key : (t as IrType & { kind: "set" }).elem;
      const hasMore = (): IrExpr => ({ kind: "bin", op: ">", left: optRem(n(), loc), right: num(0, loc), type: BOOL, loc });
      const entryValue = (): IrExpr => {
        const k = child(keyT, mi("iterKey", [i()], keyT));
        if (!isMap) return k;
        const valueT = (t as IrType & { kind: "map" }).value;
        return concatAll([k, str(" => ", loc), child(valueT, mi("iterValue", [i()], valueT))], loc);
      };
      body = [
        { kind: "varDecl", localId: "n.0", init: mi("size", [], F64), loc },
        {
          kind: "if",
          cond: { kind: "bin", op: "===", left: n(), right: num(0, loc), type: BOOL, loc },
          then: [ret(str(`${label}(0) {}`, loc))],
          else_: null,
          loc,
        },
        depthGate(`[${label}]`),
        ...begin(),
        { kind: "varDecl", localId: "c.0", init: num(0, loc), loc },
        {
          kind: "for",
          init: { kind: "varDecl", localId: "i.0", init: num(0, loc), loc },
          cond: { kind: "bin", op: "<", left: i(), right: mi("iterCount", [], F64), type: BOOL, loc },
          update: { kind: "assign", localId: "i.0", value: { kind: "bin", op: "+", left: i(), right: num(1, loc), type: F64, loc }, loc },
          body: [
            {
              kind: "if",
              cond: { kind: "unary", op: "!", operand: mi("iterLive", [i()], BOOL), type: BOOL, loc },
              then: [{ kind: "continue", loc }],
              else_: null,
              loc,
            },
            {
              kind: "if",
              cond: { kind: "bin", op: ">=", left: c(), right: optShown(n(), loc), type: BOOL, loc },
              then: [{ kind: "break", loc }],
              else_: null,
              loc,
            },
            entry(entryValue(), boolLit(false, loc)),
            { kind: "assign", localId: "c.0", value: { kind: "bin", op: "+", left: c(), right: num(1, loc), type: F64, loc }, loc },
          ],
          loc,
        },
        {
          kind: "if",
          cond: hasMore(),
          then: [
            entry(
              {
                kind: "libCall",
                fn: "insp.moreItems",
                args: [optRem(n(), loc)],
                type: STRING,
                loc,
              },
              boolLit(false, loc),
            ),
          ],
          else_: null,
          loc,
        },
        ret(
          end(
            str("", loc),
            concatAll([str(`${label}(`, loc), { kind: "toString", operand: n(), type: STRING, loc }, str(") {", loc)], loc),
            str("}", loc),
            false,
            hasMore(),
          ),
        ),
      ];
      break;
    }
    case "union": {
      const def = L.unions.get(t.unionId);
      if (!def) throw new Error(`inspect of unknown union ${t.unionId}`);
      body = [];
      def.arms.forEach((arm, tag) => {
        // The union wrapper is not a nesting level: arms render at the
        // SAME recursion depth (formatValue dispatches on the value).
        const narrowed: IrExpr = { kind: "unionNarrow", unionId: t.unionId, tag, value: v(), type: arm, loc };
        body.push({
          kind: "if",
          cond: { kind: "unionIsTag", unionId: t.unionId, tag, negated: false, value: v(), type: BOOL, loc },
          then: [ret(inspectExpr(L, arm, narrowed, r(), d(), loc))],
          else_: null,
          loc,
        });
      });
      body.push(ret(str("", loc))); // unreachable: some arm always matches
      break;
    }
    case "object": {
      const info = L.classes.get(t.className);
      if (!info) throw new Error(`inspect of unknown class ${t.className}`);
      // Node prints the class's OWN name — the declaration's, never the
      // IR name's module qualifier (`m0.Timer` is the frontend's spelling
      // for a class declared in a non-entry module).
      const display = info.decl?.name?.text ?? info.def.name.replace(/^%/, "");
      // #private fields never render: they are not properties in any
      // observable way — Node's inspect omits them entirely (verified),
      // so a class whose only fields are private prints as `C {}`.
      // NON-ENUMERABLE symbol slots (Object.defineProperty's hidden data
      // descriptor) never render either: util.inspect lists only ENUMERABLE
      // own properties without showHidden, so Node omits them exactly as it
      // omits #private fields.
      const hidden = info.hiddenSymbolFields;
      // The RUN-TIME property table is not a property: it is the storage
      // the run-time-keyed defineProperty writes into, and its own name
      // is `%props`, which no JS key spells. Left in `visible` it printed
      // itself and its raw descriptor arrays —
      // `Client { name: 'c', '%props': { plug: [ false, [Function: get],
      // undefined, false, true ] } }` where Node says
      // `Client { name: 'c', plug: [Getter] }` — which is the whole
      // reason this arm has to know about the table at all.
      const propsTable = info.hasPropsTable === true;
      const visible = info.def.fields.filter(
        (f) => !f.name.startsWith("#") && f.name !== CLASS_PROPS_FIELD && hidden?.has(f.name) !== true,
      );
      const get = (field: string, type: IrType): IrExpr => ({ kind: "fieldGet", obj: v(), className: t.className, field, type, loc });
      // ABSENT-TRACKED slots (ClassInfo.absentTrackedFields): a JS field
      // first assigned outside the constructor's top level does not EXIST
      // on the instance until its write runs, so Node prints
      // `Loop { count: 0 }` where the layout — which always has the cell —
      // printed `Loop { count: 0, last: undefined }`. The slot's own
      // undefined arm is the presence answer, exactly as `in` already
      // reads it (undefinedArmedInAnswer), and the set is restricted to
      // the slots where that arm can ONLY mean absence, so this is not a
      // second approximation traded for the first.
      const presentTest = (field: string, type: IrType): IrExpr | null => {
        if (info.absentTrackedFields?.has(field) !== true) return null;
        // A CHECKED-DYNAMIC slot answers presence by its dyn KIND, which is
        // exactly how `in` has always answered it (undefinedArmedInAnswer's
        // dyn arm). Membership in absentTrackedFields is the proof that the
        // kind can only mean absence for this field; the arm itself is the
        // same test. Without it the two surfaces contradicted each other on
        // one slot — `'cb' in b` answered false while inspect printed
        // `cb: undefined` — and inspect was the one that was wrong.
        if (type.kind === "dyn") {
          return { kind: "dynTest", test: "undefined", negated: true, value: get(field, type), type: BOOL, loc };
        }
        if (type.kind !== "union") return null;
        const tag = L.armTag(type.unionId, UNDEFINED_T);
        if (tag < 0) return null;
        return { kind: "unionIsTag", unionId: type.unionId, tag, negated: true, value: get(field, type), type: BOOL, loc };
      };
      const propsRef = (): IrExpr => get(CLASS_PROPS_FIELD, DYN);
      // TWO calls, not one, and the declared fields go between them:
      // OrdinaryOwnPropertyKeys lists every ARRAY-INDEX key ahead of
      // every string key across the WHOLE object, so a table holding
      // "2" and "10" prints them BEFORE a field the constructor
      // assigned. Node: `C { '2': [Getter], '10': [Getter], a: 1, z:
      // [Getter] }`; one call answered `C { a: 1, '2': …` — the right
      // keys in the wrong order, which is a WRONG answer, not a partial
      // one.
      const propsEntries = (indexKeys: boolean): IrStmt => ({
        kind: "exprStmt",
        expr: {
          kind: "libCall", fn: "insp.clsProps",
          args: [propsRef(), rPlus1(), d(), boolLit(indexKeys, loc)],
          type: { kind: "void" }, loc,
        },
        loc,
      });
      // OWN PROPERTIES THAT SHADOW A METHOD (ir/nodes.ts OwnShadow): present
      // while their private flag is set, printed as `name: [Function: target]`
      // in the position the property was created.
      const shadows = info.def.fields.flatMap((f) => {
        const sh = parseOwnShadowField(f.name);
        return sh === null ? [] : [{ f, sh }];
      });
      const shadowFlag = (f: { name: string }): IrExpr => get(f.name, BOOL);
      const shadowStmt = (x: { f: { name: string }; sh: { method: string; target: string } }): IrStmt => ({
        kind: "if",
        cond: shadowFlag(x.f),
        then: [
          entry(
            concatAll([str(`${inspectKey(x.sh.method)}: `, loc), str(`[Function: ${x.sh.target}]`, loc)], loc),
            boolLit(false, loc),
          ),
        ],
        else_: null,
        loc,
      });
      if (visible.length === 0 && !propsTable && shadows.length === 0) {
        body = [ret(str(`${display} {}`, loc))];
        break;
      }
      body = [];
      if (visible.length === 0 && !propsTable) {
        // Only own method shadows can make a key: no key at all while every flag is clear.
        const anyOn = shadows
          .map((x) => shadowFlag(x.f))
          .reduce((a, b): IrExpr => ({ kind: "logical", op: "||", left: a, right: b, type: BOOL, loc }));
        body.push({
          kind: "if",
          cond: { kind: "unary", op: "!", operand: anyOn, type: BOOL, loc },
          then: [ret(str(`${display} {}`, loc))],
          else_: null,
          loc,
        });
      }
      if (visible.length === 0) {
        // Every key this class can have is a RUN-TIME one, so "is it
        // empty" is a runtime question — and it has to be asked BEFORE
        // the depth gate, because Node prints `C {}` for a keyless
        // object however deep it is and `[C]` only for one with keys.
        body.push({
          kind: "if",
          cond: {
            kind: "bin", op: "===",
            left: { kind: "libCall", fn: "cls.propsCount", args: [propsRef()], type: F64, loc },
            right: num(0, loc), type: BOOL, loc,
          },
          then: [ret(str(`${display} {}`, loc))],
          else_: null,
          loc,
        });
      }
      // Every visible slot ABSENT-TRACKED and no run-time table: whether
      // the instance has any key at all is a run-time question, the same
      // one the keyless-class arm above asks, and it has to be asked in
      // the same place — BEFORE the depth gate, because Node prints
      // `C {}` for a keyless object however deep it is and `[C]` only for
      // one with keys. insp.end cannot answer it later: with no entries
      // pushed it renders `C {  }`.
      const allTracked =
        visible.length > 0 && !propsTable &&
        visible.every((f) => presentTest(f.name, f.type) !== null);
      if (allTracked) {
        const anyPresent = [...visible.map((f) => presentTest(f.name, f.type)!), ...shadows.map((x) => shadowFlag(x.f))]
          .reduce((a, b): IrExpr => ({ kind: "logical", op: "||", left: a, right: b, type: BOOL, loc }));
        body.push({
          kind: "if",
          cond: { kind: "unary", op: "!", operand: anyPresent, type: BOOL, loc },
          then: [ret(str(`${display} {}`, loc))],
          else_: null,
          loc,
        });
      }
      body.push(depthGate(`[${display}]`), ...begin());
      if (propsTable) body.push(propsEntries(true));
      // def.fields carries layout order: the base chain first, then own —
      // exactly the own-property insertion order of a constructor that
      // assigns in declaration order (SEMANTICS.md 36's stance). SYMBOL-
      // keyed fields render LAST ([[OwnPropertyKeys]] lists all string
      // keys before all symbol keys — Node's inspect order) and their
      // layout name IS Node's key spelling (`Symbol(limit)`), printed
      // verbatim, never quoted.
      const symNames = new Set(info.symbolFields?.values() ?? []);
      const ordered = [
        ...visible.filter((f) => !symNames.has(f.name)),
        ...visible.filter((f) => symNames.has(f.name)),
      ];
      const placed = new Set<string>();
      const placeShadows = (after: string | null): void => {
        for (const x of shadows) {
          if (placed.has(x.f.name) || (after !== null && x.sh.after !== after)) continue;
          placed.add(x.f.name);
          body.push(shadowStmt(x));
        }
      };
      placeShadows("");
      for (const f of ordered) {
        const key = symNames.has(f.name) ? f.name : inspectKey(f.name);
        const one = entry(concatAll([str(`${key}: `, loc), child(f.type, get(f.name, f.type))], loc), boolLit(false, loc));
        const present = presentTest(f.name, f.type);
        body.push(present === null ? one : { kind: "if", cond: present, then: [one], else_: null, loc });
        placeShadows(f.name);
      }
      placeShadows(null);
      // The run-time table's entries come AFTER the declared fields, and
      // that IS Node's order: the table can only be filled once the
      // constructor has run, so every key in it was inserted later than
      // every field the constructor assigned.
      if (propsTable) body.push(propsEntries(false));
      body.push(ret(end(str("", loc), str(`${display} {`, loc), str("}", loc), false, boolLit(false, loc))));
      break;
    }
    default:
      throw new Error(`inspect helper over unexpected type ${typeKey(t)}`);
  }

  if (onCycle) {
    // The circular check, FIRST (before the empty-literal and depth
    // answers): a value already on the traversal stack renders
    // [Circular *N] and descends no further — Node's formatValue order
    // (a circular target beyond the depth budget still says Circular).
    locals.push({ id: "cc.0", name: "cc", type: F64, mutable: false });
    const cc = (): IrExpr => ref("cc.0", F64);
    body.unshift(
      {
        kind: "varDecl",
        localId: "cc.0",
        init: { kind: "libCall", fn: "insp.circCheck", args: [v()], type: F64, loc },
        loc,
      },
      {
        kind: "if",
        cond: { kind: "bin", op: ">", left: cc(), right: num(0, loc), type: BOOL, loc },
        then: [ret({ kind: "libCall", fn: "insp.circular", args: [cc()], type: STRING, loc })],
        else_: null,
        loc,
      },
    );
  }

  L.liftedFns.push({
    name,
    params: [
      { localId: "v.0", name: "v", type: t },
      { localId: "r.0", name: "r", type: F64 },
      { localId: "d.0", name: "d", type: F64 },
    ],
    returnType: STRING,
    locals,
    body,
    loc,
  });
  return name;
}

/* ── the console/format top-level value rendering ────────────────────── */

/** Node's formatWithOptions REST-ARG rule over one statically-typed value
 * (console.log's non-format arguments, util.format's %s and trailing
 * arguments): a STRING prints VERBATIM — never quote-wrapped, the classic
 * console.log vs inspect distinction — and every other kind renders
 * exactly as inspect at the given depth. Unions dispatch per arm AT
 * RUNTIME through an interned helper, so a string arm stays verbatim
 * while its sibling arms inspect. Callers check inspectSupport first. */
export function formatValueExpr(L: Lowerer, t: IrType, value: IrExpr, depth: number, loc: SrcLoc): IrExpr {
  switch (t.kind) {
    case "string":
      return value;
    case "f64":
      return { kind: "libCall", fn: "insp.f64", args: [value], type: STRING, loc };
    case "bool":
      return { kind: "toString", operand: value, type: STRING, loc };
    case "undefinedT":
      return str("undefined", loc);
    case "nullT":
      return str("null", loc);
    case "symbol":
      return { kind: "libCall", fn: "sym.toString", args: [value], type: STRING, loc };
    case "dyn":
      return { kind: "libCall", fn: "insp.dynS", args: [value, num(depth, loc)], type: STRING, loc };
    case "union":
      return { kind: "call", callee: formatUnionHelper(L, t, depth, loc), args: [value], type: STRING, loc };
    default:
      return inspectExpr(L, t, value, num(0, loc), num(depth, loc), loc);
  }
}

/** `%util.fmtv.<n>(v): string` — formatValueExpr's runtime dispatch over a
 * union's arms (interned per union + depth, the inspectHelper pattern).
 * The TOP-LEVEL union rule only: nested unions inside composites keep
 * inspect's own rendering, where string arms quote — exactly Node. */
function formatUnionHelper(L: Lowerer, t: IrType & { kind: "union" }, depth: number, loc: SrcLoc): string {
  const key = `fmtv:${typeKey(t)}:${depth}`;
  const existing = L.inspectHelpers.get(key);
  if (existing) return existing;
  const name = `%util.fmtv.${L.inspectHelpers.size}`;
  L.inspectHelpers.set(key, name);
  const def = L.unions.get(t.unionId);
  if (!def) throw new Error(`format value over unknown union ${t.unionId}`);
  const v = (): IrExpr => ({ kind: "varRef", localId: "v.0", type: t, loc });
  const body: IrStmt[] = [];
  def.arms.forEach((arm, tag) => {
    const narrowed: IrExpr = { kind: "unionNarrow", unionId: t.unionId, tag, value: v(), type: arm, loc };
    body.push({
      kind: "if",
      cond: { kind: "unionIsTag", unionId: t.unionId, tag, negated: false, value: v(), type: BOOL, loc },
      then: [{ kind: "return", value: formatValueExpr(L, arm, narrowed, depth, loc), loc }],
      else_: null,
      loc,
    });
  });
  body.push({ kind: "return", value: str("", loc), loc }); // unreachable: some arm always matches
  L.liftedFns.push({
    name,
    params: [{ localId: "v.0", name: "v", type: t }],
    returnType: STRING,
    locals: [{ id: "v.0", name: "v", type: t, mutable: false }],
    body,
    loc,
  });
  return name;
}

/** One console.log/info/debug/error/warn argument OUTSIDE the direct
 * scalar set (number/string/boolean ride the ScrLogArg protocol
 * untouched, and dyn/function values have their own paths at the call
 * site): the rendered STRING under Node's console semantics — inspect at
 * the rest-args depth 2 — or the honest fence naming the first
 * unsupported constituent. */
/** A console argument whose TYPE is a codec (TextEncoder/TextDecoder) refuses at the build: Node
 * prints `TextDecoder { encoding, fatal, ignoreBOM }`, and the lowered value is the utf-8 string,
 * which would print "utf-8". The console form has no lowering yet (OPEN, mgtextcodec). */
/** console arguments: the inspect form of a codec, direct or inside a record or array. */
export function refuseCodecInspect(L: Lowerer, node: ts.Expression): void {
  refuseCodecValue(L, node, "deep", "console");
}

export function lowerConsoleInspectArg(
  L: Lowerer,
  node: ts.Expression,
  value: IrExpr,
  surface: string,
  loc: SrcLoc,
): IrExpr {
  // AN ARGUMENT THAT HAS ALREADY UNWOUND. `global.undefRead` is the trap
  // family's lowered shape: an ambient-undefined name, or a binding whose
  // own initializer threw its ReferenceError. Module init dies at that
  // declaration, so this argument is never evaluated and its rendering is
  // never printed — planning an inspect for a type that no value will ever
  // have turns a provably dead statement into a build failure, which is
  // exactly the value-world lie the trap family exists to keep out. The
  // read is "typed by the use site" by contract (nsUndefRead), and the use
  // site here produces a string; the call throws before it returns, so the
  // type is never observed and the emitter already casts it (NULL for a
  // refcounted result). Corpus 2592's `console.log("never", dead)` is the
  // case: dead code past an uncaught ambient-root trap, whose type became
  // renderable-or-not only because a generic member kept its slot.
  // A codec value prints as `TextDecoder { encoding, fatal, ignoreBOM }` in Node. Its lowered
  // value is the utf-8 string, which would print "utf-8": the console form of a codec has no
  // lowering yet (OPEN, mgtextcodec), so the argument refuses at the build.
  refuseCodecInspect(L, node);
  if (value.kind === "libCall" && value.fn === "global.undefRead") {
    return { ...value, type: STRING };
  }
  const t = value.type;
  if (t.kind === "undefinedT" || t.kind === "nullT") {
    // The baked text ("undefined"/"null"): the operand is a literal or a
    // pure read, so dropping its evaluation loses nothing. Effectful
    // unit-typed operands keep a fence — a silent skip is banned.
    if (value.kind !== "unitLit" && !pureReemittable(value)) {
      L.unsupported(
        "SC1090",
        node,
        `${surface} of an effectful '${L.fmt(t)}'-typed expression (evaluate it first: const v = ...; ${surface}(v))`,
      );
    }
    return str(t.kind === "undefinedT" ? "undefined" : "null", loc);
  }
  if (t.kind === "bytes") {
    // One runtime representation serves Buffer AND Uint8Array; their
    // renderings differ, so the argument's checker type picks — and only
    // Buffer lowers (lowerInspectCall's stance).
    const tname = L.checker.typeToString(L.checker.getBaseTypeOfLiteralType(L.typeOf(node)));
    const isBuffer =
      tname === "Buffer" || tname === "NonSharedBuffer" || tname.startsWith("Buffer<") || tname.startsWith("NonSharedBuffer<");
    if (t.elem === "buf") {
      L.unsupported(
        "SC1090",
        node,
        `${surface} of '${tname}' values (an ArrayBuffer's own rendering is not lowered)`,
      );
    }
    // Node's typed-array form for every view but a Buffer: `Name(n) [ ... ]`.
    if (!(t.elem === "u8" && isBuffer)) {
      return {
        kind: "libCall",
        fn: t.elem === "i64" || t.elem === "u64" ? "insp.typedBig" : "insp.typed",
        args: [value, { kind: "strLit", value: BYTES_ELEM_NAMES[t.elem], type: STRING, loc }],
        type: STRING,
        loc,
      };
    }
    return inspectExpr(L, t, value, num(0, loc), num(2, loc), loc);
  }
  if (t.kind === "void") {
    // Node prints "undefined" for a void call's result: the call runs for
    // its effect, in argument order, and the rendering is the baked text.
    return {
      kind: "seqExpr",
      stmts: [{ kind: "exprStmt", expr: value, loc }],
      result: str("undefined", loc),
      type: STRING,
      loc,
    };
  }
  const walk = { recursive: false };
  const reason = inspectSupport(L, t, new Set(), walk);
  if (reason !== null) {
    L.unsupported("SC1090", node, `${surface} of '${L.fmt(t)}' values (${reason})`);
  }
  return formatValueExpr(L, t, value, 2, loc);
}

/* ── the callsite: options, direct function/class names ──────────────── */

/** The parsed options literal: the resolved depth (numeric; Infinity for
 * `null`), with every non-default knob fenced by name. */
/** Node's option keys this runtime does not render yet (OPEN, ci-classes iofmtopts). */
const INSPECT_OPEN_KEYS = new Set(["colors", "showHidden", "showProxy", "getters", "customInspect", "stylize"]);

/** Literal truthiness of a compile-time constant option value, or null when
 * the value is only known at run time. */
function literalTruthy(node: ts.Expression): boolean | null {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(node) && node.text === "undefined") return false;
  if (ts.isIdentifier(node) && node.text === "Infinity") return true;
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.length > 0;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return true;
  return null;
}


/** util.inspect options this runtime does not render yet (OPEN, ci-classes
 * iofmtopts). A literal value that shows the option non-default is a named
 * build refusal; a value known only at run time is checked by the runtime
 * options reader, which stops the program with the same name. */
function refuseOpenInspectOption(L: Lowerer, prop: ts.Node, key: string, value: ts.Expression): void {
  const open = (what: string): never =>
    L.noLowering(`util.inspect with the '${what}' option`, prop, "this option is OPEN (ci-classes iofmtopts): the rendering for it is not lowered yet");
  if (key === "stylize") open("stylize");
  if (key === "customInspect" && literalTruthy(value) === false) open("customInspect: false");
  if (["colors", "showHidden", "showProxy", "getters"].includes(key) && literalTruthy(value) === true) open(`${key}: true`);
  if (INSPECT_OPEN_KEYS.has(key) && key !== "customInspect" && literalTruthy(value) === null) open(`${key} (a run-time value)`);
  if (key === "customInspect" && literalTruthy(value) === null) open(`${key} (a run-time value)`);
  if (key === "compact" && literalTruthy(value) === null && valueMayBeTrue(L, value)) open("compact: true (a run-time value)");
  if (key === "compact" && value.kind === ts.SyntaxKind.TrueKeyword) open("compact: true");
  if (key === "sorted" && literalTruthy(value) === true && value.kind !== ts.SyntaxKind.TrueKeyword) open("sorted with a comparator");
  if (key === "sorted" && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) open("sorted with a comparator");
}

/** The constituents of a union type (the type itself otherwise). */
function typeParts(t: ts.Type): readonly ts.Type[] {
  return t.isUnionType() ? (t as unknown as { getTypes(): ts.Type[] }).getTypes() : [t];
}

/** Whether a value's static type admits the boolean `true`. */
function valueMayBeTrue(L: Lowerer, node: ts.Expression): boolean {
  const t = L.typeOf(node);
  const parts = typeParts(t);
  return parts.some((x) => (x.flags & ts.TypeFlags.Any) !== 0 || ((x.flags & ts.TypeFlags.BooleanLiteral) !== 0 && (x as { intrinsicName?: string }).intrinsicName === "true"));
}

/** util.inspect's options argument is admitted only in two forms, both of which the
 * runtime sees exactly as written: (1) an object literal (no spread, method or accessor),
 * or (2) an identifier naming a non-exported `const` initialised by such a literal, and
 * referenced nowhere except as the options argument (index 1) of a util.inspect call.
 * Form (2) cannot be mutated or aliased, so the object is the literal. Everything else
 * (a parameter, a width-coerced or cast value, a class instance, a JSON value, any) would
 * reach the runtime as the static shape its type names, which can drop or hide keys that
 * Node reads, so it is refused at build with main's surface wording. */
function nonLiteralOptions(L: Lowerer, node: ts.Expression, why: string): never {
  return L.noLowering("util.inspect with a non-literal options argument", node, why);
}

/** util.inspect's options expression is a constant-keyed literal: plain `key: value` and
 * shorthand entries only. Null when it has a spread, a method or an accessor. */
function literalOptionEntries(node: ts.ObjectLiteralExpression): { key: string; value: ts.Expression; prop: ts.Node }[] | null {
  const out: { key: string; value: ts.Expression; prop: ts.Node }[] = [];
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      out.push({ key: (p.name as ts.Identifier | ts.StringLiteral).text, value: p.initializer, prop: p });
    } else if (ts.isShorthandPropertyAssignment(p)) {
      out.push({ key: (p.name as ts.Identifier).text, value: p.name as ts.Identifier, prop: p });
    } else {
      return null;
    }
  }
  return out;
}

/** Whether a util.inspect callee is node:util's inspect, through the lowering's own builtin
 * resolver: `util.inspect` on a util namespace or default import, or a bare `inspect` named
 * import or require destructure. */
function isUtilInspectCallee(L: Lowerer, callee: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(callee)) {
    const bi = L.builtinMemberOf(callee);
    return bi !== null && bi.module === "util" && bi.member === "inspect";
  }
  if (ts.isIdentifier(callee)) {
    // A named import (`import { inspect } from "util"`) or a require destructure.
    const bi = L.builtinImportOf(callee);
    return bi !== null && bi.module === "util" && bi.member === "inspect";
  }
  return false;
}

/** The object literal an options identifier names, when the binding's whole life is safe:
 * a non-exported `const` initialised by an object literal, referenced only as the options
 * argument of a util.inspect call. Null otherwise. */
function admittedConstOptions(L: Lowerer, id: ts.Identifier): ts.ObjectLiteralExpression | null {
  const sym = L.resolveValueSymbol(id);
  if (!sym) return null;
  const decl = L.checker.declarationsOf(sym)[0];
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return null;
  if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) return null;
  const list = decl.parent;
  if (!list || !ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null;
  const stmt = list.parent;
  if (!stmt || !ts.isVariableStatement(stmt)) return null;
  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return null;
  let safe = true;
  const visit = (n: ts.Node): void => {
    if (!safe) return;
    if (ts.isIdentifier(n) && n.text === id.text && n !== decl.name) {
      const parent = n.parent;
      const propName = parent !== undefined &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === n) || (ts.isPropertyAssignment(parent) && parent.name === n));
      if (!propName) {
        const s2 = L.resolveValueSymbol(n);
        if (s2 === undefined || s2 === sym) {
          const okRef = parent !== undefined && ts.isCallExpression(parent) && parent.arguments[1] === n &&
            isUtilInspectCallee(L, parent.expression);
          if (!okRef) safe = false;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(id.getSourceFile());
  return safe ? decl.initializer : null;
}

/** The OPEN-key and any-typed checks over an admitted literal's entries (its values are
 * lowered where it is used; the checks run for the literal wherever it was written). */
function checkLiteralOptions(L: Lowerer, node: ts.ObjectLiteralExpression): { key: string; value: ts.Expression; prop: ts.Node }[] {
  const entries = literalOptionEntries(node);
  if (entries === null) nonLiteralOptions(L, node, "spread, method and accessor entries are not lowered in options objects");
  for (const e of entries) {
    refuseOpenInspectOption(L, e.prop, e.key, e.value);
    if ((L.typeOf(e.value).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      nonLiteralOptions(L, e.value, `the '${e.key}' option value has type any/unknown`);
    }
  }
  return entries;
}

/** The options argument of util.inspect as a run-time DYN object: an admitted literal
 * (inline, or a const bound to one, see admittedConstOptions). Anything else refuses. */
function inspectOptionsDyn(L: Lowerer, node: ts.Expression, loc: SrcLoc): IrExpr {
  if (ts.isObjectLiteralExpression(node)) {
    const entries = checkLiteralOptions(L, node);
    const fields: { key: IrExpr; value: IrExpr }[] = [];
    for (const e of entries) {
      const v = L.lowerExpr(e.value);
      const dv: IrExpr = v.type.kind === "dyn" ? v : { kind: "dynFrom", value: v, type: DYN, loc };
      fields.push({ key: str(e.key, loc), value: dv });
    }
    return { kind: "dynObjLit", fields, type: DYN, loc };
  }
  if (ts.isIdentifier(node)) {
    const init = admittedConstOptions(L, node);
    if (init !== null) {
      checkLiteralOptions(L, init);
      const v = L.lowerExpr(node);
      return v.type.kind === "dyn" ? v : { kind: "dynFrom", value: v, type: DYN, loc };
    }
  }
  return nonLiteralOptions(L, node, "the options must be an object literal, or a non-exported const bound to one that is used only as a util.inspect options argument");
}

/** util.inspect(value, options) with options: the interned helper
 * `%util.inspopts.<n>(v, o)` pushes `o` as the runtime's active options,
 * renders `v` at the options' depth, and pops in a finally, so a render that
 * throws (an unsupported dynamic class throws catchably) cannot leave its
 * options active. Interned per value type, the formatUnionHelper pattern. */
function inspectWithOptionsHelper(L: Lowerer, t: IrType, loc: SrcLoc): string {
  const key = `inspopts:${typeKey(t)}`;
  const existing = L.inspectHelpers.get(key);
  if (existing) return existing;
  const name = `%util.inspopts.${L.inspectHelpers.size}`;
  L.inspectHelpers.set(key, name);
  const v: IrExpr = { kind: "varRef", localId: "v.0", type: t, loc };
  const libStmt = (fn: "insp.optsPush" | "insp.optsPop", args: IrExpr[]): IrStmt => ({
    kind: "exprStmt",
    expr: { kind: "libCall", fn, args, type: { kind: "void" }, loc },
    loc,
  });
  const o: IrExpr = { kind: "varRef", localId: "o.0", type: DYN, loc };
  const body: IrStmt[] = [
    libStmt("insp.optsPush", [o]),
    {
      kind: "tryCatch",
      tryBody: [{ kind: "return", value: inspectExpr(L, t, v, num(0, loc), optDepth(loc), loc), loc }],
      catchBody: null,
      catchLocalId: null,
      finallyBody: [libStmt("insp.optsPop", [])],
      loc,
    },
  ];
  L.liftedFns.push({
    name,
    params: [
      { localId: "v.0", name: "v", type: t },
      { localId: "o.0", name: "o", type: DYN },
    ],
    returnType: STRING,
    locals: [
      { id: "v.0", name: "v", type: t, mutable: false },
      { id: "o.0", name: "o", type: DYN, mutable: false },
    ],
    body,
    loc,
  });
  return name;
}

/** util.inspect(value, options) with options: the value and the options are
 * evaluated in JS argument order (value first) as the helper's arguments. */
function lowerInspectWithOptions(L: Lowerer, value: IrExpr, optsNode: ts.Expression, loc: SrcLoc): IrExpr {
  return {
    kind: "call",
    callee: inspectWithOptionsHelper(L, value.type, loc),
    args: [value, inspectOptionsDyn(L, optsNode, loc)],
    type: STRING,
    loc,
  };
}

function parseInspectOptions(L: Lowerer, node: ts.Expression | undefined, recursive: boolean): number {
  if (!node || (ts.isIdentifier(node) && node.text === "undefined")) return 2;
  if (!ts.isObjectLiteralExpression(node)) {
    L.noLowering(
      "util.inspect with a non-literal options argument",
      node,
      "the options must be an object literal ({ depth, colors: false, ... }) so the knobs resolve at compile time",
    );
  }
  let depth = 2;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      L.noLowering("util.inspect options in this form", prop, "plain `key: literal` entries are the lowered options");
    }
    const key = prop.name.text;
    const value = prop.initializer;
    const numeric = (): number | null => {
      if (ts.isNumericLiteral(value)) return Number(value.text);
      if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) {
        return -Number(value.operand.text);
      }
      return null;
    };
    if (key === "depth") {
      if (value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "Infinity")) {
        // Unbounded depth is safe over recursive types too: the circular
        // machinery ([Circular *N]) cuts every cycle, so the walk is
        // bounded by the (finite) object graph — exactly Node.
        void recursive;
        depth = Infinity;
      } else if (!(ts.isIdentifier(value) && value.text === "undefined")) {
        const n = numeric();
        if (n === null) {
          L.noLowering("util.inspect with a non-literal depth option", value, "depth must be a numeric literal (or null)");
        }
        depth = n;
      }
    } else if (key === "colors") {
      if (value.kind !== ts.SyntaxKind.FalseKeyword) {
        L.noLowering("util.inspect with colors: true", value, "ANSI styling has no lowering — only colors: false");
      }
    } else if (key === "compact") {
      if (numeric() !== 3) {
        L.noLowering("util.inspect with a non-default compact option", value, "only the default compact: 3 is lowered");
      }
    } else if (key === "breakLength") {
      if (numeric() !== 80) {
        L.noLowering("util.inspect with a non-default breakLength option", value, "only the default breakLength: 80 is lowered");
      }
    } else {
      L.noLowering(
        `util.inspect with the '${key}' option`,
        prop,
        "the lowered options are depth (numeric literal or null), colors: false, compact: 3, and breakLength: 80",
      );
    }
  }
  return depth;
}

/** `util.inspect(fn)` / `util.inspect(Cls)` over a DIRECT identifier
 * naming a declared function or class: the name is compile-time truth,
 * so `[Function: name]` / `[class X extends Y]` bake as literals. Null
 * when the identifier is not such a declaration. */
function directCallableInspect(L: Lowerer, node: ts.Expression, loc: SrcLoc): IrExpr | null {
  if (!ts.isIdentifier(node)) return null;
  const sym = L.resolveValueSymbol(node);
  if (!sym) return null;
  const cls = L.classBySymbol.get(sym) ?? L.builtinErrorInfoOf(sym);
  // A rebindable decorated name is not compile-time truth — the binding
  // holds the decoration result; no literal folds.
  if (cls?.classDecorators?.valueGlobalId !== undefined) return null;
  if (cls) {
    if (cls.builtinError) {
      // Node's Error constructors are native functions, not classes.
      return str(`[Function: ${cls.def.name.replace(/^%/, "")}]`, loc);
    }
    const base = cls.base ? ` extends ${cls.base.def.name.replace(/^%/, "")}` : "";
    return str(`[class ${cls.def.name}${base}]`, loc);
  }
  const decl = L.checker.declarationsOf(sym)[0];
  if (!decl) return null;
  if (ts.isFunctionDeclaration(decl) && decl.name) {
    return str(`[Function: ${decl.name.text}]`, loc);
  }
  if (
    ts.isVariableDeclaration(decl) &&
    ts.isIdentifier(decl.name) &&
    decl.initializer &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
  ) {
    // JS name inference: the binding names the function value — unless
    // the function expression carries its OWN name, which wins.
    const own = ts.isFunctionExpression(decl.initializer) ? decl.initializer.name?.text : undefined;
    return str(`[Function: ${own ?? decl.name.text}]`, loc);
  }
  return null;
}

/** util.inspect(value[, options]) — the spoke's inspect entry. */
function lowerInspectCall(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc): IrExpr {
  if (expr.arguments.length < 1 || expr.arguments.length > 2) {
    L.noLowering(
      `util.inspect with ${expr.arguments.length} arguments`,
      expr,
      "the supported forms are inspect(value) and inspect(value, options)",
    );
  }
  const valueNode = expr.arguments[0]!;
  // Inline function/class literals and direct declared names render as
  // their baked forms; other function-typed values fence below.
  const direct = directCallableInspect(L, valueNode, loc);
  if (direct) {
    parseInspectOptions(L, expr.arguments[1], false);
    return direct;
  }
  if (ts.isArrowFunction(valueNode) || ts.isFunctionExpression(valueNode)) {
    parseInspectOptions(L, expr.arguments[1], false);
    return str(valueNode.kind === ts.SyntaxKind.FunctionExpression && (valueNode as ts.FunctionExpression).name ? `[Function: ${(valueNode as ts.FunctionExpression).name!.text}]` : "[Function (anonymous)]", loc);
  }
  const value = L.lowerExpr(valueNode);
  if (value.type.kind === "bytes") {
    // One runtime representation serves Buffer AND Uint8Array; their
    // renderings differ (<Buffer aa> vs Uint8Array(1) [ 170 ]), so the
    // TOP-LEVEL argument's checker type picks — and only Buffer lowers.
    // Nested bytes fence in inspectSupport (no checker type survives
    // into shapes).
    const tname = L.checker.typeToString(L.checker.getBaseTypeOfLiteralType(L.typeOf(valueNode)));
    const isBuffer = tname === "Buffer" || tname === "NonSharedBuffer" || tname.startsWith("Buffer<") || tname.startsWith("NonSharedBuffer<");
    if (value.type.elem === "buf") {
      L.noLowering(`util.inspect of '${tname}' values`, valueNode, "an ArrayBuffer's own rendering is not lowered");
    }
    if (!(value.type.elem === "u8" && isBuffer)) {
      // The typed-array form takes no options here: a depth or showHidden
      // request would change the rendering, so those calls fence.
      if (expr.arguments.length > 1) {
        L.noLowering(
          `util.inspect options on '${tname}' values`,
          valueNode,
          "the typed-array rendering is lowered without options; pass util.inspect(value) alone",
        );
      }
      return {
        kind: "libCall",
        fn: value.type.elem === "i64" || value.type.elem === "u64" ? "insp.typedBig" : "insp.typed",
        args: [value, { kind: "strLit", value: BYTES_ELEM_NAMES[value.type.elem], type: STRING, loc }],
        type: STRING,
        loc,
      };
    }
    const bufDepth = parseInspectOptions(L, expr.arguments[1], false);
    void bufDepth; // Buffers render fully at any depth (custom inspect)
    return inspectExpr(L, value.type, value, num(0, loc), num(2, loc), loc);
  }
  const walk = { recursive: false };
  const reason = inspectSupport(L, value.type, new Set(), walk);
  if (reason !== null) {
    L.noLowering(`util.inspect of '${L.fmt(value.type)}' values`, valueNode, reason);
  }
  const optsNode = expr.arguments[1];
  if (optsNode === undefined || (ts.isIdentifier(optsNode) && optsNode.text === "undefined")) {
    return inspectExpr(L, value.type, value, num(0, loc), num(2, loc), loc);
  }
  return lowerInspectWithOptions(L, value, optsNode, loc);
}

/* ── util.format / util.formatWithOptions ────────────────────────────── */

/** Node's builtInObjects: the constructor names hasBuiltInToString treats as
 * built-in. A user toString whose declaring constructor carries one of
 * these names is NOT user code, so Node inspects the value instead.
 * Object.getOwnPropertyNames(globalThis) filtered by /^[A-Z][a-zA-Z0-9]+$/
 * on Node v24.15 (the CI pin). */
const NODE_BUILTIN_CTOR_NAMES: ReadonlySet<string> = new Set(
  (
    "AbortController AbortSignal AggregateError Array ArrayBuffer AsyncDisposableStack Atomics BigInt " +
    "BigInt64Array BigUint64Array Blob Boolean BroadcastChannel Buffer ByteLengthQueuingStrategy CloseEvent " +
    "CompressionStream CountQueuingStrategy Crypto CryptoKey CustomEvent DOMException DataView Date " +
    "DecompressionStream DisposableStack Error EvalError Event EventTarget File FinalizationRegistry " +
    "Float16Array Float32Array Float64Array FormData Function Headers Infinity Int16Array Int32Array " +
    "Int8Array Intl Iterator JSON Map Math MessageChannel MessageEvent MessagePort NaN Navigator Number " +
    "Object Performance PerformanceEntry PerformanceMark PerformanceMeasure PerformanceObserver " +
    "PerformanceObserverEntryList PerformanceResourceTiming Promise Proxy RangeError " +
    "ReadableByteStreamController ReadableStream ReadableStreamBYOBReader ReadableStreamBYOBRequest " +
    "ReadableStreamDefaultController ReadableStreamDefaultReader ReferenceError Reflect RegExp Request " +
    "Response Set SharedArrayBuffer String SubtleCrypto SuppressedError Symbol SyntaxError TextDecoder " +
    "TextDecoderStream TextEncoder TextEncoderStream TransformStream TransformStreamDefaultController " +
    "TypeError URIError URL URLPattern URLSearchParams Uint16Array Uint32Array Uint8Array Uint8ClampedArray " +
    "WeakMap WeakRef WeakSet WebAssembly WebSocket WritableStream WritableStreamDefaultController " +
    "WritableStreamDefaultWriter"
  ).split(" "),
);

/** The class whose prototype supplies an instance's toString: the nearest
 * class in the chain that declares one (Node's "pointer" walk). */
function toStringDeclarer(L: Lowerer, className: string): ClassInfo | null {
  for (let info: ClassInfo | null = L.classes.get(className) ?? null; info; info = info.base) {
    if (info.methods.has("toString")) return info;
  }
  return null;
}

/** Statically visible %s shapes whose String(arg) Node runs (hasBuiltInToString
 * is false): a record whose toString or [Symbol.toPrimitive] member is a
 * function, a class instance whose toString comes from user code, a function
 * value (Node prints its source text), an Error (Node prints err.stack). A
 * union answers with its first hazardous arm. A hazard whose exact String(arg)
 * lowering is not yet available is fenced by the caller (OPEN, fmttostr). */
function sConversionHazard(L: Lowerer, t: IrType, seen: Set<string>): string | null {
  switch (t.kind) {
    case "func":
      return "a function value (Node prints its source text)";
    case "record": {
      const fields = L.shapes.get(t.shapeId)?.fields ?? [];
      if (fields.some((f) => f.name.startsWith("__@toPrimitive") && f.type.kind === "func")) {
        return "an object with a [Symbol.toPrimitive] member (Node calls it)";
      }
      const member = fields.find((f) => f.name === "toString");
      if (member && member.type.kind === "func") {
        return "an object whose toString member is a function (Node calls it)";
      }
      return null;
    }
    case "object": {
      if (isErrorClass(L, t.className)) return "an Error value (Node prints err.stack)";
      const info = toStringDeclarer(L, t.className);
      if (info !== null && !NODE_BUILTIN_CTOR_NAMES.has(info.def.jsName ?? "")) {
        return "a class instance whose class defines toString (Node calls it)";
      }
      return null;
    }
    case "union": {
      if (seen.has(t.unionId)) return null;
      seen.add(t.unionId);
      for (const arm of L.unions.get(t.unionId)?.arms ?? []) {
        const hit = sConversionHazard(L, arm, seen);
        if (hit !== null) return hit;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The exact %s text of a hazardous value, as String(arg) gives it: the
 * user's own method called with ToPrimitive's arguments, its string, number
 * or boolean result converted by ToString. A record's [Symbol.toPrimitive]
 * (hint "string") is consulted before its toString. Null = no exact lowering
 * (the caller fences). A union converts arm by arm: a hazardous arm through
 * this function, every other arm through the top-level %s rule it always had
 * (formatValueExpr), so an f64 arm keeps formatNumber's -0. */
function sUserStringExpr(L: Lowerer, t: IrType, value: IrExpr, node: ts.Expression, depth: number, loc: SrcLoc): IrExpr | null {
  // A function value converts to its source text (String(f) is fn.text).
  if (t.kind === "func") return { kind: "libCall", fn: "fn.text", args: [value], type: STRING, loc };
  if (t.kind === "union") {
    const arms = L.unions.get(t.unionId)?.arms;
    if (!arms || arms.length === 0) return null;
    const tmp = arms.length > 1 && !pureReemittable(value) ? L.declareHiddenLocal("%fmtS", t) : null;
    const src: IrExpr = tmp ? { kind: "varRef", localId: tmp.id, type: t, loc } : value;
    const armText = (tag: number): IrExpr | null => {
      const arm = arms[tag]!;
      const narrowed: IrExpr = { kind: "unionNarrow", unionId: t.unionId, tag, value: src, type: arm, loc };
      if (sConversionHazard(L, arm, new Set()) !== null) return sUserStringExpr(L, arm, narrowed, node, depth, loc);
      const walk = { recursive: false };
      const reason = inspectSupport(L, arm, new Set(), walk);
      if (reason !== null) L.noLowering(`util.format %s of '${L.fmt(t)}' values`, node, reason);
      return formatValueExpr(L, arm, narrowed, depth, loc);
    };
    const texts: (IrExpr | null)[] = arms.map((_, tag) => armText(tag));
    if (texts.some((x) => x === null)) return null;
    let result = texts[arms.length - 1]!;
    for (let tag = arms.length - 2; tag >= 0; tag--) {
      result = {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId: t.unionId, tag, negated: false, value: src, type: BOOL, loc },
        then: texts[tag]!,
        else_: result,
        type: STRING,
        loc,
      };
    }
    if (!tmp) return result;
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: tmp.id, init: value, loc }],
      result,
      type: STRING,
      loc,
    };
  }
  if (t.kind === "record") {
    const shape = L.shapes.get(t.shapeId);
    if (!shape || shape.tuple) return null;
    const hint = shape.fields.find((f) => f.name.startsWith("__@toPrimitive") && f.type.kind === "func");
    if (hint !== undefined) return recordMethodString(L, t, value, hint, true, loc);
    const slot = shape.fields.find((f) => f.name === "toString");
    if (slot !== undefined && slot.type.kind === "func") return recordMethodString(L, t, value, slot, false, loc);
    return null;
  }
  if (t.kind === "object") {
    // An Error's %s is its stack (fenced by the caller), never String(err).
    if (isErrorClass(L, t.className)) return null;
    // classInstanceToString answers only a toString it can call with a string
    // result; anything else (a non-string return, a required parameter, an
    // abstract method) answers null here and stays fenced.
    return classInstanceToString(L, value, loc);
  }
  return null;
}

/** Calls a record's function-typed toString (or [Symbol.toPrimitive] with
 * hint "string") and converts its result as ToPrimitive then ToString do.
 * Only the shapes whose answer is a primitive the lowering can convert are
 * exact: a string, number or boolean result. A declared object result would
 * fall through to valueOf (or throw), so it stays fenced. */
function recordMethodString(
  L: Lowerer,
  t: IrType & { kind: "record" },
  value: IrExpr,
  member: { name: string; type: IrType },
  hinted: boolean,
  loc: SrcLoc,
): IrExpr | null {
  const ft = member.type;
  if (ft.kind !== "func" || ft.rest === true || ft.restAbi !== undefined) return null;
  let args: IrExpr[];
  if (hinted) {
    if (ft.params.length === 0) args = [];
    else if (ft.params.length === 1 && ft.params[0]!.kind === "string") args = [{ kind: "strLit", value: "string", type: STRING, loc }];
    else return null;
  } else {
    if (ft.params.length !== 0) return null;
    args = [];
  }
  const ret = ft.ret;
  const unit = ret.kind === "void" || ret.kind === "undefinedT" || ret.kind === "nullT";
  if (ret.kind !== "string" && ret.kind !== "f64" && ret.kind !== "bool" && !unit) return null;
  const callee: IrExpr = { kind: "recordGet", obj: value, shapeId: t.shapeId, field: member.name, type: ft, loc };
  const call: IrExpr = { kind: "callValue", callee, args, type: ret, loc };
  // A method that answers nothing (a throw-only body is void) converts its
  // undefined (or null) result to that text; the call still runs for effect,
  // and a throw in it propagates from here.
  if (unit) {
    const text = ret.kind === "nullT" ? "null" : "undefined";
    return {
      kind: "seqExpr",
      stmts: [{ kind: "exprStmt", expr: call, loc }],
      result: { kind: "strLit", value: text, type: STRING, loc },
      type: STRING,
      loc,
    };
  }
  if (ret.kind === "string") return call;
  return { kind: "toString", operand: call, type: STRING, loc };
}

/** A `[Symbol.toPrimitive]` member on the checker's view of an argument that
 * is NOT a bare record (a record's member is read from its shape fields):
 * String(arg) calls it, and the lowering has no exact call for a class. Union
 * constituents are checked one by one. */
function toPrimitiveHazard(L: Lowerer, type: ts.Type): string | null {
  if (type.isUnionType()) {
    for (const c of ts.constituentTypes(type)) {
      const hit = toPrimitiveHazard(L, c);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const p of L.checker.getPropertiesOfType(type)) {
    // Built-in members (Date's [Symbol.toPrimitive]) are not user code:
    // Node's hasBuiltInToString inspects them, so they never fence.
    if (L.isStdlibSymbol(p)) continue;
    if (String(p.escapedName).startsWith("__@toPrimitive")) {
      return "an object with a [Symbol.toPrimitive] member (Node calls it)";
    }
  }
  return null;
}


/** One argument as format's %s conversion (Node: numbers via
 * formatNumber, strings verbatim, objects through inspect at the given
 * depth). Null = fence with the given reason.
 *
 * `sSpec` distinguishes the two conversions Node's formatter actually
 * has, which differ on exactly one value shape. A `%s` POSITION reads
 * `!hasBuiltInToString(arg) ? String(arg) : inspect(arg)`, so an object
 * carrying its own `toString` is converted; a TRAILING argument — the
 * same code path that renders `console.log`'s non-format arguments —
 * always inspects. `util.format("%s", {toString(){return "U"}})` is
 * "U" and `console.log({toString(){return "U"}})` is
 * "{ toString: … }", measured on Node v25.9.0. */
function formatSArg(L: Lowerer, node: ts.Expression, depth: number, loc: SrcLoc, sSpec: boolean, hoist?: ArgHoist): IrExpr {
  const lowered = L.lowerExpr(node);
  const value = hoist ? hoist.take(node, lowered) : lowered;
  const t = value.type;
  if (t.kind === "string") return value;
  if (t.kind === "f64") return { kind: "libCall", fn: "insp.f64", args: [value], type: STRING, loc };
  if (t.kind === "bool") return { kind: "toString", operand: value, type: STRING, loc };
  if (t.kind === "undefinedT") return str("undefined", loc);
  if (t.kind === "nullT") return str("null", loc);
  // %s of a symbol prints inspect's text ("Symbol(foo)") — String(sym)'s
  // answer too, one runtime call either way.
  if (t.kind === "symbol") return { kind: "libCall", fn: "sym.toString", args: [value], type: STRING, loc };
  if (t.kind === "dyn") {
    // The %s position runs an object's OWN toString; the trailing-argument
    // position never does (that is console.log's conversion).
    const fn = sSpec ? "insp.fmtS" : "insp.dynS";
    return { kind: "libCall", fn, args: [value, num(depth, loc)], type: STRING, loc };
  }
  // The %s position runs String(arg) for any object whose toString or
  // [Symbol.toPrimitive] is user code (Node's hasBuiltInToString), and
  // prints the function's source text or the Error's stack. The user-method
  // shapes lower to the call and its converted result (sUserStringExpr); the
  // rest, and a checker-visible toPrimitive on a class or union, refuse at
  // build time (OPEN, fmttostr) rather than print the inspect form. dyn
  // arguments are NOT fenced: their conversion is the runtime's insp.fmtS,
  // and the class-instance loss at dyn boxing is a separate open item.
  // A function VALUE in the %s position: Node's String(f), the source text.
  if (sSpec && t.kind === "func") return { kind: "libCall", fn: "fn.text", args: [value], type: STRING, loc };
  if (sSpec) {
    const primChecker = t.kind === "record" ? null : toPrimitiveHazard(L, L.typeOf(node));
    const hazard = sConversionHazard(L, t, new Set()) ?? primChecker;
    if (hazard !== null) {
      const exact = primChecker === null ? sUserStringExpr(L, t, value, node, depth, loc) : null;
      if (exact !== null) return exact;
      L.noLowering(
        `util.format %s of '${L.fmt(t)}' values`,
        node,
        `OPEN, fmttostr: ${hazard}. Node converts it through String(arg); this lowering has no exact conversion for it.`,
      );
    }
  }
  // A UNION argument dispatches per arm at runtime: a string arm prints
  // VERBATIM (typeof arg === 'string' in Node's formatter — inspect's
  // quoting never applies at the top level), every other arm inspects.
  if (t.kind === "union") {
    const walk = { recursive: false };
    const reason = inspectSupport(L, t, new Set(), walk);
    if (reason !== null) L.noLowering(`util.format %s of '${L.fmt(t)}' values`, node, reason);
    return formatValueExpr(L, t, value, depth, loc);
  }
  if (t.kind === "bytes") {
    L.noLowering(`util.format %s of typed-array values`, node, "pass util.inspect(buf) explicitly");
  }
  const walk = { recursive: false };
  const reason = inspectSupport(L, t, new Set(), walk);
  if (reason !== null) L.noLowering(`util.format %s of '${L.fmt(t)}' values`, node, reason);
  return inspectExpr(L, t, value, num(0, loc), num(depth, loc), loc);
}

/** %O (depth 2) / %o (showHidden, depth 4) — inspect with the spec's
 * option deltas; %o fences over arrays (showHidden adds their hidden
 * [length] entry, which has no lowering). */
function formatOArg(L: Lowerer, node: ts.Expression, depth: number, loc: SrcLoc, hoist?: ArgHoist): IrExpr {
  const lowered = L.lowerExpr(node);
  const value = hoist ? hoist.take(node, lowered) : lowered;
  if (value.type.kind === "bytes") {
    L.noLowering(`util.format %${depth === 4 ? "o" : "O"} of typed-array values`, node, "pass util.inspect(buf) explicitly");
  }
  const walk = { recursive: false };
  const reason = inspectSupport(L, value.type, new Set(), walk);
  if (reason !== null) L.noLowering(`util.format %${depth === 4 ? "o" : "O"} of '${L.fmt(value.type)}' values`, node, reason);
  if (depth === 4 && typeTreeHasArray(L, value.type, new Set())) {
    L.noLowering(
      "util.format %o over arrays",
      node,
      "%o renders with showHidden (arrays gain a hidden [length] entry) — use %O for the default rendering",
    );
  }
  return inspectExpr(L, value.type, value, num(0, loc), num(depth, loc), loc);
}

/** util.format(...) / util.formatWithOptions({}, ...): the compile-time
 * %-substitution over a literal format string (formatWithOptionsInternal
 * ported exactly — the arg cursor, the args-exhausted guard, %c's
 * consume-and-drop), with per-static-type conversions. Non-literal
 * format strings lower only in the substitution-free shapes. */
export function lowerFormatCall(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc, withOptions: boolean): IrExpr {
  const hoist = new ArgHoist(L, expr.arguments);
  return hoist.wrap(lowerFormatCallIn(L, expr, loc, withOptions, hoist));
}

function lowerFormatCallIn(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc, withOptions: boolean, hoist: ArgHoist): IrExpr {
  const argNodes = [...expr.arguments];
  if (withOptions) {
    const opts = argNodes.shift();
    if (!opts || !ts.isObjectLiteralExpression(opts) || opts.properties.length > 0) {
      L.noLowering(
        "util.formatWithOptions with a non-empty options literal",
        opts ?? expr,
        "only the empty literal {} (the defaults — exactly util.format) is lowered",
      );
    }
  }
  if (argNodes.length === 0) return str("", loc);
  const first = argNodes[0]!;
  const firstIsLiteral = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first);

  // A RUNTIME argument list -- a spread (`util.format(...args)`), or a first argument that
  // may be a format string the compiler cannot read (`util.format(fmt, a, b)` with `fmt` a
  // variable, an `any`): where the %-substitutions fall is a run-time fact, so the whole
  // list packs into one checked-dynamic array and the runtime formatter (scr_insp_format,
  // formatWithOptionsInternal over dyn values) answers.
  if (!firstIsLiteral) {
    const firstT = L.mapTypeOf(L.typeOf(first));
    const mayFormat = firstT === null || firstT.kind === "string" || firstT.kind === "dyn" || firstT.kind === "union";
    if (argNodes.some((a) => ts.isSpreadElement(a)) || (argNodes.length > 1 && mayFormat)) {
      return { kind: "libCall", fn: "insp.format", args: [dynRestPack(L, argNodes, expr, loc)], type: STRING, loc };
    }
  }

  /** The rest-args tail: ` ` + (strings verbatim, everything else
   * inspected at the default depth). */
  const restArg = (node: ts.Expression): IrExpr => formatSArg(L, node, 2, loc, false, hoist);

  if (!firstIsLiteral) {
    const firstT = L.mapTypeOf(L.typeOf(first));
    if (firstT?.kind === "string" && argNodes.length > 1) {
      L.noLowering(
        "util.format with a runtime format string and further arguments",
        first,
        "the %-substitution positions are runtime-dependent — use a string literal",
      );
    }
    // No substitutions possible: every argument joins with spaces.
    const parts: IrExpr[] = [];
    for (let i = 0; i < argNodes.length; i++) {
      if (i > 0) parts.push(str(" ", loc));
      parts.push(restArg(argNodes[i]!));
    }
    return concatAll(parts, loc);
  }

  const fmt = (first as ts.StringLiteralLike).text;
  // Node's early return: a lone string first argument passes VERBATIM —
  // no substitution runs, "%%" stays "%%".
  if (argNodes.length === 1) return str(fmt, loc);
  const parts: IrExpr[] = [];
  let a = 0; // the arg cursor over argNodes (0 = the format string)
  let lastPos = 0;
  const args = argNodes;
  const convert = (spec: number, node: ts.Expression): IrExpr => {
    switch (spec) {
      case 115: // %s
        return formatSArg(L, node, 0, loc, true, hoist);
      case 100: {
        // %d — Number(arg) formatted: numbers as-is, booleans 1/0,
        // strings through the runtime's ECMA-exact StringToNumber
        // (num.fromString — the same lowering Number(aString) takes).
        const value = hoist.take(node, L.lowerExpr(node));
        if (value.type.kind === "f64") return { kind: "libCall", fn: "insp.f64", args: [value], type: STRING, loc };
        if (value.type.kind === "string") {
          const parsed: IrExpr = { kind: "libCall", fn: "num.fromString", args: [value], type: F64, loc };
          return { kind: "libCall", fn: "insp.f64", args: [parsed], type: STRING, loc };
        }
        if (value.type.kind === "bool") {
          return {
            kind: "libCall",
            fn: "insp.f64",
            args: [{ kind: "ternary", cond: value, then: num(1, loc), else_: num(0, loc), type: F64, loc }],
            type: STRING,
            loc,
          };
        }
        // A checked-dynamic argument (`console.log('... actual %d.',
        // context.actual)` — test/common's exit report): VALIDATE it as a
        // number (dynCheck) and format. A non-number dyn value throws the
        // catchable TypeError where Node would print its ToNumber (NaN
        // for objects) — loud, never a silent wrong answer (SEMANTICS.md).
        if (value.type.kind === "dyn") {
          return {
            kind: "libCall",
            fn: "insp.f64",
            args: [{ kind: "dynCheck", value, type: F64, loc }],
            type: STRING,
            loc,
          };
        }
        L.noLowering(`util.format %d of '${L.fmt(value.type)}' values`, node, "numbers, booleans, and strings lower; ToNumber over other types has no static lowering");
        break;
      }
      case 105: {
        // %i — parseInt(ToString(arg)): the spec-exact composition.
        const value = hoist.take(node, L.lowerExpr(node));
        if (value.type.kind === "f64" || value.type.kind === "bool" || value.type.kind === "string") {
          const text: IrExpr = value.type.kind === "string" ? value : { kind: "toString", operand: value, type: STRING, loc };
          const parsed: IrExpr = { kind: "libCall", fn: "num.parseInt", args: [text, num(0, loc)], type: F64, loc };
          return { kind: "libCall", fn: "insp.f64", args: [parsed], type: STRING, loc };
        }
        L.noLowering(`util.format %i of '${L.fmt(value.type)}' values`, node);
        break;
      }
      case 106: {
        // %j — JSON.stringify; undefined-valued args print "undefined"
        // (Node appends the non-string result of tryStringify).
        const value = hoist.take(node, L.lowerExpr(node));
        if (value.type.kind === "undefinedT") return str("undefined", loc);
        // JSON.stringify(sym) is undefined in Node — %j prints the
        // "undefined" text. Folding drops the operand, so only
        // side-effect-free reads compose (the typeof-fold stance).
        if (value.type.kind === "symbol") {
          if (!pureReemittable(value)) {
            L.noLowering(
              `util.format %j of computed symbol values`,
              node,
              "bind the symbol to a const first (the %j text is always \"undefined\")",
            );
          }
          return str("undefined", loc);
        }
        // A checked-dynamic argument (`console.error('headers: %j',
        // headers)` — the suite's http logging idiom): the runtime dyn
        // walk stringifies JS-exactly (root undefined/function prints
        // "undefined"; a handle in the tree throws the loud fence).
        if (value.type.kind === "dyn") {
          return { kind: "libCall", fn: "insp.jsonDyn", args: [value], type: STRING, loc };
        }
        if (!L.jsonStringifiable(value.type)) {
          L.noLowering(`util.format %j of '${L.fmt(value.type)}' values`, node, "only JSON-safe static types lower");
        }
        L.noteKeyEnumeration(value, loc, "util.format %j");
        return { kind: "jsonStringify", value, type: STRING, loc };
      }
      case 79: // %O — inspect at the defaults
        return formatOArg(L, node, 2, loc, hoist);
      case 111: // %o — showHidden semantics; depth 4
        return formatOArg(L, node, 4, loc, hoist);
    }
    throw new Error("unreachable format spec");
  };

  for (let i = 0; i < fmt.length - 1; i++) {
    if (fmt.charCodeAt(i) === 37 /* % */) {
      const nextChar = fmt.charCodeAt(++i);
      if (a + 1 !== args.length) {
        switch (nextChar) {
          case 115: // s
          case 106: // j
          case 100: // d
          case 79: // O
          case 111: // o
          case 105: { // i
            const node = args[++a]!;
            if (lastPos !== i - 1) parts.push(str(fmt.slice(lastPos, i - 1), loc));
            parts.push(convert(nextChar, node));
            lastPos = i + 1;
            continue;
          }
          case 102: // f — parseFloat's full grammar has no static lowering
            L.noLowering("util.format %f", expr, "parseFloat has no static lowering (it runs with --dynamic)");
            break;
          case 99: // c — consumes its argument, contributes nothing
            a += 1;
            if (lastPos !== i - 1) parts.push(str(fmt.slice(lastPos, i - 1), loc));
            lastPos = i + 1;
            continue;
          case 37: // %%
            parts.push(str(fmt.slice(lastPos, i), loc));
            lastPos = i + 1;
            continue;
          default:
            continue;
        }
      } else if (nextChar === 37) {
        parts.push(str(fmt.slice(lastPos, i), loc));
        lastPos = i + 1;
      }
    }
  }
  if (lastPos !== 0) {
    a++;
    if (lastPos < fmt.length) parts.push(str(fmt.slice(lastPos), loc));
  } else {
    // No substitution touched the format string: it joins verbatim, and
    // the cursor advances past it.
    parts.push(str(fmt, loc));
    a++;
  }
  for (; a < args.length; a++) {
    parts.push(str(" ", loc));
    parts.push(restArg(args[a]!));
  }
  return concatAll(parts, loc);
}

/** Arrays anywhere in the tree — the %o (showHidden) gate. */
function typeTreeHasArray(L: Lowerer, t: IrType, visiting: Set<string>): boolean {
  switch (t.kind) {
    case "array":
      return true;
    case "record": {
      if (visiting.has(t.shapeId)) return false;
      visiting.add(t.shapeId);
      const shape = L.shapes.get(t.shapeId);
      if (shape?.tuple) return true;
      return (shape?.fields ?? []).some((f) => typeTreeHasArray(L, f.type, visiting));
    }
    case "map":
      return typeTreeHasArray(L, t.key, visiting) || typeTreeHasArray(L, t.value, visiting);
    case "set":
      return typeTreeHasArray(L, t.elem, visiting);
    case "union": {
      if (visiting.has(t.unionId)) return false;
      visiting.add(t.unionId);
      return (L.unions.get(t.unionId)?.arms ?? []).some((a) => typeTreeHasArray(L, a, visiting));
    }
    case "object": {
      if (visiting.has(t.className)) return false;
      visiting.add(t.className);
      return (L.classes.get(t.className)?.def.fields ?? []).some((f) => typeTreeHasArray(L, f.type, visiting));
    }
    case "bytes":
      return true;
    default:
      return false;
  }
}

/* ── the module dispatch ─────────────────────────────────────────────── */

/** The spoke's entry, called from both the named-import and namespace/
 * default-import call paths. Null for other modules and members (the
 * module tables' fence takes over). */
export function lowerUtilModuleCall(
  L: Lowerer,
  expr: ts.CallExpression,
  bi: { module: string; member: string },
  loc: SrcLoc,
): IrExpr | null {
  if (bi.module !== "util") return null;
  switch (bi.member) {
    case "inspect":
      return lowerInspectCall(L, expr, loc);
    case "format":
      return lowerFormatCall(L, expr, loc, false);
    case "formatWithOptions":
      return lowerFormatCall(L, expr, loc, true);
    case "getCallSites":
      return lowerGetCallSitesCall(L, expr, loc);
    case "promisify":
      // The one promisify target with a VALUE lowering; every other target
      // keeps the declaration-form registry and its fence.
      return lowerPromisifiedDiffieHellmanValue(L, expr, bi, loc);
    case "deprecate":
      return lowerDeprecateCall(L, expr, loc);
    default:
      return null;
  }
}

/** `util.format.apply(thisArg, argList)` / `util.format.call(thisArg, ...args)`: the same
 * runtime formatter as a spread call. `format` reads no receiver, so only an effect-free
 * thisArg (`util`, a binding, `this`, null, undefined) can drop honestly; the argument list is
 * an array LITERAL (its elements pack one by one) or any value that boxes to a dyn array
 * (the `arguments` object, a rest array). Null leaves the other lowerings the call. */
export function lowerUtilFormatApply(L: Lowerer, call: ts.CallExpression, access: ts.PropertyAccessExpression): IrExpr | null {
  if (access.questionDotToken !== undefined || call.questionDotToken !== undefined) return null;
  const name = access.name.text;
  if (name !== "apply" && name !== "call") return null;
  const inner = access.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  const bi = L.builtinMemberOf(inner);
  if (bi === null || bi.module !== "util" || bi.member !== "format") return null;
  if (call.arguments.length === 0 || (name === "apply" && call.arguments.length > 2)) return null;
  const thisNode = call.arguments[0]!;
  const effectFree =
    thisNode.kind === ts.SyntaxKind.ThisKeyword ||
    thisNode.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(thisNode);
  if (!effectFree) return null;
  const loc = locOf(call);
  let pack: IrExpr;
  if (name === "call") {
    pack = dynRestPack(L, call.arguments.slice(1), call, loc);
  } else if (call.arguments.length === 1) {
    pack = dynRestPack(L, [], call, loc);
  } else {
    const list = call.arguments[1]!;
    if (ts.isArrayLiteralExpression(list)) {
      pack = dynRestPack(L, list.elements, call, loc);
    } else {
      const lowered = L.lowerExprExpecting(list, DYN);
      if (lowered.type.kind !== "dyn") return null;
      pack = lowered;
    }
  }
  return { kind: "libCall", fn: "insp.format", args: [pack], type: STRING, loc };
}

/** `util.deprecate(fn, msg, code?)`: a function with fn's own signature that
 * warns on its FIRST call (process.emitWarning(msg, 'DeprecationWarning',
 * code), once per wrapper, and once per code across wrappers), then runs fn
 * with the arguments it was given and answers fn's result. The wrapper holds
 * fn, the message, the code, and its own warned flag in boxed hidden locals,
 * the bindThisClosure creation shape. Null (the caller's fence) for a rest
 * signature, a spread argument, or a non-string message/code. */
function lowerDeprecateCall(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  const argNodes = expr.arguments;
  if (argNodes.length < 2 || argNodes.length > 3 || argNodes.some(ts.isSpreadElement)) return null;
  const fn = L.lowerExpr(argNodes[0]!);
  const ft = fn.type;
  if (ft.kind !== "func" || ft.rest === true) return null;
  const msg = L.lowerExpr(argNodes[1]!);
  if (msg.type.kind !== "string") return null;
  const code = argNodes.length === 3 ? L.lowerExpr(argNodes[2]!) : null;
  if (code !== null && code.type.kind !== "string") return null;
  const key = `deprecate:${typeKey(ft)}:${code !== null ? "code" : "nocode"}`;
  const existing = L.widthHelpers.get(key);
  const name = existing ?? `%deprecate.${L.widthHelpers.size}`;
  if (!existing) {
    L.widthHelpers.set(key, name);
    const capParams = [
      { localId: "tf.0", name: "tf", type: ft },
      { localId: "dm.0", name: "dm", type: STRING },
      ...(code !== null ? [{ localId: "dc.0", name: "dc", type: STRING }] : []),
      { localId: "dw.0", name: "dw", type: BOOL },
    ];
    const params = ft.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
    const ref = (id: string, t: IrType): IrExpr => ({ kind: "varRef", localId: id, type: t, loc });
    const dynOf = (e: IrExpr): IrExpr => ({ kind: "dynFrom", value: e, type: DYN, loc });
    const vector: IrExpr = {
      kind: "dynArrLit",
      elems: [dynOf(ref("dm.0", STRING)), dynOf(str("DeprecationWarning", loc)), ...(code !== null ? [dynOf(ref("dc.0", STRING))] : [])],
      type: DYN,
      loc,
    };
    const call: IrExpr = {
      kind: "callValue",
      callee: ref("tf.0", ft),
      args: params.map((p) => ref(p.localId, p.type)),
      type: ft.ret,
      loc,
    };
    L.liftedFns.push({
      name,
      params,
      returnType: ft.ret,
      captures: capParams,
      locals: [
        ...capParams.map((c) => ({ id: c.localId, name: c.name, type: c.type, mutable: c.localId === "dw.0", boxed: true as const })),
        ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      ],
      body: [
        {
          kind: "if",
          cond: { kind: "unary", op: "!", operand: ref("dw.0", BOOL), type: BOOL, loc },
          then: [
            { kind: "assign", localId: "dw.0", value: boolLit(true, loc), loc },
            { kind: "exprStmt", expr: { kind: "libCall", fn: "util.deprecationWarn", args: [vector], type: VOID, loc }, loc },
          ],
          else_: null,
          loc,
        },
        ft.ret.kind === "void" ? { kind: "exprStmt", expr: call, loc } : { kind: "return", value: call, loc },
      ],
      loc,
    });
  }
  const ctx = L.ctx;
  const inits: IrStmt[] = [];
  const capIds: string[] = [];
  const hold = (init: IrExpr, mutable: boolean): void => {
    const n = ctx.localCounters.get("%deprecate") ?? 0;
    ctx.localCounters.set("%deprecate", n + 1);
    const id = `%deprecate.${n}`;
    ctx.locals.push({ id, name: "%deprecate", type: init.type, mutable, boxed: true });
    inits.push({ kind: "varDecl", localId: id, init, loc });
    capIds.push(id);
  };
  hold(fn, false);
  hold(msg, false);
  if (code !== null) hold(code, false);
  hold(boolLit(false, loc), true);
  return {
    kind: "seqExpr",
    stmts: inits,
    result: { kind: "closure", fnName: name, captures: capIds, type: ft, loc },
    type: ft,
    loc,
  };
}

/** util.getCallSites() in a JS source: compiled binaries keep no runtime
 * call stacks, so the honest STATIC answer is a fixed-shape placeholder —
 * a fresh dyn array of three call-site records whose scriptName is the
 * CALL SITE's own file (compile-time-knowable) and whose line/column are
 * 0 (SEMANTICS.md; the fields exist so consumers like test/common's
 * mustNotCall — `callSite.scriptName`:`callSite.lineNumber` in the
 * failure text — read a printable value instead of throwing). Argument
 * forms and TypeScript keep the SC2020 fence: a typed consumer asserting
 * real frames must fail loudly at compile time, not read placeholders. */
function lowerGetCallSitesCall(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  if (expr.arguments.length !== 0) return null;
  if (!isJsSourceFile(expr.getSourceFile())) return null;
  const frame = (): IrExpr => {
    const field = (name: string, value: IrExpr): { key: IrExpr; value: IrExpr } => ({
      key: { kind: "strLit", value: name, type: STRING, loc },
      value: { kind: "dynFrom", value, type: DYN, loc },
    });
    return {
      kind: "dynObjLit",
      fields: [
        field("functionName", { kind: "strLit", value: "", type: STRING, loc }),
        field("scriptName", { kind: "strLit", value: expr.getSourceFile().fileName, type: STRING, loc }),
        field("scriptId", { kind: "strLit", value: "0", type: STRING, loc }),
        field("lineNumber", { kind: "numLit", value: 0, type: F64, loc }),
        field("column", { kind: "numLit", value: 0, type: F64, loc }),
      ],
      type: DYN,
      loc,
    };
  };
  return { kind: "dynArrLit", elems: [frame(), frame(), frame()], type: DYN, loc };
}

/** The coercion sinks of a call: String(x), JSON.stringify(x), Object.prototype.toString.call(x),
 * and the string-forming methods (toString, toLocaleString, valueOf, join) on a codec or an
 * array of codecs. Each refuses at the build when the value holds a codec. */
export function refuseCodecCoercionCall(L: Lowerer, call: ts.CallExpression): void {
  const callee = call.expression;
  const arg0 = call.arguments[0];
  if (ts.isIdentifier(callee)) {
    if (callee.text === "String" && arg0 !== undefined && L.isStdlibGlobal(callee, "String")) {
      refuseCodecValue(L, arg0, "array", "String()");
    }
    return;
  }
  if (!ts.isPropertyAccessExpression(callee)) return;
  const name = callee.name.text;
  if (name === "stringify" && arg0 !== undefined && L.isStdlibGlobal(callee.expression, "JSON")) {
    refuseCodecValue(L, arg0, "deep", "JSON.stringify");
    return;
  }
  if ((name === "call" || name === "apply") && arg0 !== undefined) {
    const fn = callee.expression;
    if (
      ts.isPropertyAccessExpression(fn) &&
      fn.name.text === "toString" &&
      ts.isPropertyAccessExpression(fn.expression) &&
      fn.expression.name.text === "prototype" &&
      L.isStdlibGlobal(fn.expression.expression, "Object")
    ) {
      refuseCodecValue(L, arg0, "direct", "Object.prototype.toString");
      return;
    }
  }
  if (name === "toString" || name === "toLocaleString" || name === "valueOf" || name === "join") {
    refuseCodecValue(L, callee.expression, "array", `${name}()`);
  }
}
