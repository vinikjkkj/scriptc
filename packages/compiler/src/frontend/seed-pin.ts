/* SEED PIN: a JavaScript container whose element types are a GUESS must not
 * be built as a typed box when untyped code can store another type into it.
 *
 * THE DEFECT. In a JavaScript source, `new Map([["a", 1]])` is
 * Map<string, number> and `new Set([1])` is Set<number>: the SEED overload
 * pins the type arguments, nobody wrote them. Node does not enforce that
 * guess. `put(m, "b", "x")` through an untyped helper is legal there, and the
 * typed box (static key/value slots, typed readers) has nowhere to put the
 * store: the binary answered a TypeError where Node succeeds. Widening the
 * box in place would make the typed readers misread memory, so no runtime
 * change can close it. The TYPE has to be the dyn-flavoured one, and the
 * type is the checker's, so the repair has to happen before the checker
 * runs: this pass decides on one checked program, and the sites it names
 * are re-served with their seed wrapped in `/** @type {any} *\/ (seed)`. The
 * `any` argument makes the constructor overload infer Map<any, any> (Set<any>,
 * WeakMap<WeakKey, any>, WeakSet<WeakKey>) everywhere the container flows:
 * locals, fields, returns, parameters, array elements. Those are the types
 * mapany's dyn-flavoured container (dynMapNew) already carries end to end.
 *
 * WHAT STAYS TYPED. A site stays a typed box, untouched, when the program
 * proves no other type can reach it:
 *   - it is an annotated container (any contextual type: JSDoc, typed
 *     parameter, typed return) -- the author's own claim, kept as before;
 *   - its element types are not all scalars (string, number, boolean). A
 *     record or an array crosses into a dyn box by COPY, so a dyn box would
 *     lose the identity the typed box keeps; that is a worse wrong answer
 *     than the one being fixed, and it is reported as open, not hidden;
 *   - it is `const NAME = new Map(seed)` and EVERY reference to NAME is a
 *     member operation whose arguments have exactly the inferred types, a
 *     for-of subject, a spread, a typeof, an equality, a call to a stdlib
 *     sink that cannot store into it (console.*, Array.from, ...), or an
 *     argument to a same-file function whose parameter is itself only read.
 *     This is the scan inferContainerTypeFromUses already runs for unseeded
 *     containers, extended with the argument-type check (a seeded container
 *     has an inferred type to disagree with);
 *   - or it also flows into an ANNOTATED typed sink (a typed parameter). The
 *     author asserted the type there, and a dyn box cannot enter a typed
 *     slot ("expected Map, got Map"): pinning would break every run to
 *     fix a store that may never happen. Kept typed; the residual is open.
 *
 * Everything else (a field, a return, an argument, a `let`, an exported
 * binding, a bare reference to an untyped consumer) is built dyn. */
import * as ts from "./ts7/adapter.js";

export interface SeedPin {
  /** Offsets of the seed argument within the text the checker saw. */
  readonly start: number;
  readonly end: number;
  /** The seed's own text, so the re-serve can verify its offsets. */
  readonly text: string;
  readonly why: string;
}

const FLAVORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);
const MAP_READ = new Set(["get", "has", "delete"]);
const ITER_MEMBERS = new Set(["keys", "values", "entries", "clear"]);

type Scalar = "s" | "n" | "b";

function scalarKinds(t: ts.Type): Set<Scalar> | null {
  const out = new Set<Scalar>();
  for (const c of t.isUnionType() ? ts.constituentTypes(t) : [t]) {
    if ((c.flags & ts.TypeFlags.StringLike) !== 0) out.add("s");
    else if ((c.flags & ts.TypeFlags.NumberLike) !== 0) out.add("n");
    else if ((c.flags & ts.TypeFlags.BooleanLike) !== 0) out.add("b");
    else return null;
  }
  return out.size === 0 ? null : out;
}

function isAnyType(t: ts.Type): boolean {
  return (t.flags & ts.TypeFlags.Any) !== 0;
}

function isLibFile(program: ts.Program, sf: ts.SourceFile): boolean {
  return sf.isDeclarationFile || program.isSourceFileDefaultLibrary(sf);
}

/** Is `t` the stdlib Map/Set/WeakMap/WeakSet interface? Returns its name. */
function containerName(program: ts.Program, checker: ts.TypeChecker, t: ts.Type): string | null {
  const sym = t.getSymbol();
  if (sym === undefined || !FLAVORS.has(sym.name)) return null;
  return checker.declarationsOf(sym).some((d) => ts.isInterfaceDeclaration(d) && isLibFile(program, d.getSourceFile()))
    ? sym.name
    : null;
}

const STDLIB_SINK = /^(console\.[A-Za-z]+|Array\.from|Object\.fromEntries|JSON\.stringify|String|assert\.(deepStrictEqual|deepEqual|strictEqual|equal|notDeepStrictEqual|ok))$/;

function calleeText(call: ts.CallExpression | ts.NewExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) {
    return `${e.expression.text}.${e.name.text}`;
  }
  return null;
}

interface Ctx {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
}

/** The verdict of one reference. */
type RefVerdict = "ok" | "typed-sink" | "escape";

function kindsSubset(arg: ts.Expression, allowed: Set<Scalar>, c: Ctx): boolean {
  const t = c.checker.getBaseTypeOfLiteralType(c.checker.getTypeAtLocation(arg));
  const k = scalarKinds(t);
  if (k === null) return false;
  for (const x of k) if (!allowed.has(x)) return false;
  return true;
}

interface SiteShape {
  readonly name: string;
  readonly keyKinds: Set<Scalar> | null; // null for weak flavors
  readonly valKinds: Set<Scalar> | null; // null for sets
}

/** Classifies one reference to the container binding. `readOnly` forbids the
 * writers (used for the parameter of a same-file callee). */
function classifyRef(ref: ts.Identifier, shape: SiteShape, readOnly: boolean, c: Ctx): RefVerdict {
  const p = ref.parent;
  if (p === undefined) return "escape";
  if (ts.isPropertyAccessExpression(p) && p.expression === ref && ts.isIdentifier(p.name)) {
    const name = p.name.text;
    const call = p.parent;
    const isCall = call !== undefined && ts.isCallExpression(call) && call.expression === p;
    if (name === "size") return isCall ? "escape" : "ok";
    if (!isCall) return "escape";
    const args = call.arguments;
    if (ITER_MEMBERS.has(name)) return name === "clear" && readOnly ? "escape" : "ok";
    if (name === "forEach") {
      const cb = args[0];
      if (cb === undefined || args.length > 2) return "escape";
      if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters.length <= 2) return "ok";
      return "escape";
    }
    if (MAP_READ.has(name)) {
      if (name === "delete" && readOnly) return "escape";
      const a0 = args[0];
      if (a0 === undefined || args.length !== 1) return "escape";
      const keyKinds = shape.name === "Set" ? shape.valKinds ?? shape.keyKinds : shape.keyKinds;
      return keyKinds !== null && kindsSubset(a0, keyKinds, c) ? "ok" : "escape";
    }
    const writer = shape.name === "Map" ? "set" : shape.name === "Set" ? "add" : null;
    if (writer !== null && name === writer) {
      if (readOnly) return "escape";
      // The call's value is the container itself: a used result is an alias.
      const stmt = call.parent;
      if (stmt === undefined || !ts.isExpressionStatement(stmt)) return "escape";
      if (shape.name === "Map") {
        if (args.length !== 2 || shape.keyKinds === null || shape.valKinds === null) return "escape";
        return kindsSubset(args[0]!, shape.keyKinds, c) && kindsSubset(args[1]!, shape.valKinds, c) ? "ok" : "escape";
      }
      if (args.length !== 1 || shape.valKinds === null) return "escape";
      return kindsSubset(args[0]!, shape.valKinds, c) ? "ok" : "escape";
    }
    return "escape";
  }
  if (ts.isForOfStatement(p) && p.expression === ref) return "ok";
  if (ts.isSpreadElement(p)) return "ok";
  if (ts.isTypeOfExpression(p)) return "ok";
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return "ok";
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken ||
      (op === ts.SyntaxKind.InstanceOfKeyword && p.left === ref)
    ) return "ok";
  }
  if (ts.isIfStatement(p) && p.expression === ref) return "ok";
  if (ts.isWhileStatement(p) && p.expression === ref) return "ok";
  if (ts.isConditionalExpression(p) && p.condition === ref) return "ok";
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments !== undefined && p.arguments.includes(ref as never)) {
    const text = calleeText(p);
    if (ts.isNewExpression(p) && text !== null && FLAVORS.has(text)) return "ok";
    if (ts.isCallExpression(p) && text !== null && STDLIB_SINK.test(text)) return "ok";
    // An ANNOTATED typed sink: the contextual type of this reference is a
    // Map/Set whose type arguments are not `any`.
    const ctx = c.checker.getContextualType(ref);
    if (ctx !== undefined) {
      const name = containerName(c.program, c.checker, ctx);
      if (name !== null && !c.checker.getTypeArguments(ctx as ts.TypeReference).every(isAnyType)) return "typed-sink";
    }
    if (ts.isCallExpression(p) && !readOnly) {
      const index = p.arguments.indexOf(ref as never);
      if (index >= 0 && readOnlyParameter(p, index, shape, c)) return "ok";
    }
  }
  return "escape";
}

/** One level of interprocedural reach: `f(m)` where `f` is a same-file
 * function whose parameter at that position is an identifier that is only
 * ever READ (no writer, no further hand-off). */
function readOnlyParameter(call: ts.CallExpression, index: number, shape: SiteShape, c: Ctx): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const fsym = c.checker.getSymbolAtLocation(call.expression);
  if (fsym === undefined) return false;
  const decl = c.checker.declarationsOf(fsym)[0];
  if (decl === undefined) return false;
  let fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined;
  if (ts.isFunctionDeclaration(decl)) fn = decl;
  else if (
    ts.isVariableDeclaration(decl) && decl.initializer !== undefined &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
  ) fn = decl.initializer;
  if (fn === undefined || fn.getSourceFile() !== call.getSourceFile()) return false;
  const param = fn.parameters[index];
  if (param === undefined || !ts.isIdentifier(param.name) || param.dotDotDotToken !== undefined) return false;
  const pname = param.name.text;
  const psym = c.checker.getSymbolAtLocation(param.name);
  if (psym === undefined || fn.body === undefined) return false;
  let ok = true;
  const visit = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isIdentifier(n) && n !== param.name && n.text === pname) {
      if (ts.isShorthandPropertyAssignment(n.parent)) { ok = false; return; }
      if (c.checker.getSymbolAtLocation(n) === psym && classifyRef(n, shape, true, c) !== "ok") ok = false;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn.body);
  return ok;
}

/** The nearest enclosing statement or class member of `node`: the node a
 * leading JSDoc block attaches to. */
function ownerOf(node: ts.Node): ts.Node {
  let n: ts.Node = node;
  while (n.parent !== undefined) {
    if (ts.isSourceFile(n.parent) || ts.isBlock(n.parent) || ts.isClassDeclaration(n.parent) || ts.isClassExpression(n.parent) || ts.isModuleBlock(n.parent)) return n;
    n = n.parent;
  }
  return n;
}

/** Does a JSDoc block directly before `owner` carry a `@type` tag? */
function hasTypeJsdocOnOwner(owner: ts.Node): boolean {
  const o = ownerOf(owner);
  const text = o.getSourceFile().text;
  let i = o.getStart();
  // Skip back over whitespace to a closing `*/`.
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  if (text.slice(i - 2, i) !== "*/") return false;
  const open = text.lastIndexOf("/**", i - 2);
  return open >= 0 && /@type\b/.test(text.slice(open, i));
}

function hasTypeJsdoc(site: ts.Node): boolean {
  return hasTypeJsdocOnOwner(site);
}

/** Every identifier of `sf` spelled `name`, from one walk per file (a file
 * with many container sites must not be walked once per site). */
const identIndex = new WeakMap<ts.SourceFile, Map<string, ts.Identifier[]>>();
function identifiersNamed(sf: ts.SourceFile, name: string): readonly ts.Identifier[] {
  let index = identIndex.get(sf);
  if (index === undefined) {
    const built = new Map<string, ts.Identifier[]>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const list = built.get(n.text);
        if (list === undefined) built.set(n.text, [n]);
        else list.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    identIndex.set(sf, built);
    index = built;
  }
  return index.get(name) ?? [];
}

function proofOfNoMismatch(site: ts.NewExpression, shape: SiteShape, c: Ctx): boolean {
  const decl = site.parent;
  if (
    decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer !== site ||
    !ts.isIdentifier(decl.name) || decl.type !== undefined
  ) return false;
  const list = decl.parent;
  if (list === undefined || !ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return false;
  // `export const m` is reachable from other files.
  const stmt = list.parent;
  if (stmt !== undefined && ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return false;
  const declName = decl.name.text;
  const sym = c.checker.getSymbolAtLocation(decl.name);
  if (sym === undefined) return false;
  const sf = site.getSourceFile();
  let escape = false;
  let typedSink = false;
  // No early exit on `escape`: a LATER reference may still be the annotated
  // typed sink that overrules it.
  for (const n of identifiersNamed(sf, declName)) {
    if (n === decl.name) continue;
    if (ts.isShorthandPropertyAssignment(n.parent)) { escape = true; continue; }
    if (c.checker.getSymbolAtLocation(n) !== sym) continue;
    const v = classifyRef(n, shape, false, c);
    if (v === "escape") escape = true;
    else if (v === "typed-sink") typedSink = true;
  }
  // Conflicting evidence (an annotated typed sink AND an untyped escape):
  // the typed sink wins, because a dyn box cannot enter a typed slot.
  return !escape || typedSink;
}

/** Walks the program's JavaScript sources and names every seeded container
 * site that must be built dyn-flavoured. */
export function computeSeedPins(program: ts.Program): Map<string, SeedPin[]> {
  const checker = program.getTypeChecker();
  const c: Ctx = { program, checker };
  const out = new Map<string, SeedPin[]>();
  for (const sf of program.getSourceFiles()) {
    if (isLibFile(program, sf) || !/\.(m|c)?jsx?$/.test(sf.fileName)) continue;
    if (!/new\s+(Map|Set|WeakMap|WeakSet)\s*\(/.test(sf.text)) continue;
    const pins: SeedPin[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && FLAVORS.has(n.expression.text)) {
        const pin = decide(n, c);
        if (pin !== null) pins.push(pin);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (pins.length > 0) out.set(sf.fileName, pins);
  }
  return out;
}

function isClassInstanceType(t: ts.Type, c: Ctx): boolean {
  const parts = t.isUnionType() ? ts.constituentTypes(t) : [t];
  return parts.every((p) => {
    const sym = p.getSymbol();
    return sym !== undefined && c.checker.declarationsOf(sym).some((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d));
  });
}

function decide(site: ts.NewExpression, c: Ctx): SeedPin | null {
  const args = site.arguments ?? [];
  if (args.length !== 1 || ts.isSpreadElement(args[0]!)) return null;
  const type = c.checker.getTypeAtLocation(site);
  const name = containerName(c.program, c.checker, type);
  if (name === null || name !== (site.expression as ts.Identifier).text) return null;
  const targs = c.checker.getTypeArguments(type as ts.TypeReference);
  // Already any-typed (the seed is untyped, or the context says any).
  if (targs.some(isAnyType)) return null;
  const weak = name === "WeakMap" || name === "WeakSet";
  // ANNOTATED: a JSDoc `@type` on the statement that holds the site, or a
  // contextual type that is not `any`, is the author's claim. The one
  // contextual type that is NOT a claim is the one an ASSIGNMENT target
  // hands its right-hand side: `l = new Map(seed)` is contextually typed by
  // `l`'s own inferred type, so it counts only when the target's declaration
  // carries a JSDoc `@type`.
  if (hasTypeJsdoc(site)) return null;
  const ctx = c.checker.getContextualType(site);
  if (ctx !== undefined && !isAnyType(ctx)) {
    const parent = site.parent;
    const assigned =
      parent !== undefined && ts.isBinaryExpression(parent) && parent.right === site &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    if (!assigned) return null;
    const target = c.checker.getSymbolAtLocation(parent.left);
    const annotated = target !== undefined && c.checker.declarationsOf(target).some(hasTypeJsdocOnOwner);
    if (annotated) return null;
  }
  // Scalar element types only (see the header: a record or array crosses a
  // dyn box by copy).
  let keyKinds: Set<Scalar> | null = null;
  let valKinds: Set<Scalar> | null = null;
  if (name === "Map") {
    keyKinds = scalarKinds(targs[0]!);
    valKinds = scalarKinds(targs[1]!);
    if (keyKinds === null || valKinds === null) return null;
  } else if (name === "Set") {
    valKinds = scalarKinds(targs[0]!);
    if (valKinds === null) return null;
  } else if (name === "WeakMap") {
    valKinds = scalarKinds(targs[1]!);
    if (valKinds === null) return null;
  }
  // A weak container keys by object identity. Only a CLASS INSTANCE key keeps
  // its identity across a dyn box; a plain record is copied by the crossing
  // (and `[{}, 1]` does not even lower as a dyn pair), so the typed box is
  // kept for those (see the header).
  if (weak && !isClassInstanceType(targs[0]!, c)) return null;
  const shape: SiteShape = { name, keyKinds, valKinds };
  if (!weak && proofOfNoMismatch(site, shape, c)) return null;
  const arg = args[0]!;
  const start = arg.getStart();
  const end = arg.getEnd();
  return {
    start,
    end,
    text: site.getSourceFile().text.slice(start, end),
    why: weak ? "weak container with an inferred value type" : "seed-inferred container that can receive another type",
  };
}

/** Re-serves `text` with every pinned seed wrapped in an `any` cast. The
 * wrap adds no line break, so line numbers are unchanged. Returns null when
 * an offset no longer names the recorded seed (the text moved under us). */
export function applySeedPins(text: string, pins: readonly SeedPin[]): string | null {
  const sorted = [...pins].sort((a, b) => b.start - a.start);
  let out = text;
  for (const p of sorted) {
    if (out.slice(p.start, p.end) !== p.text) return null;
    out = `${out.slice(0, p.start)}/** @type {any} */ (${p.text})${out.slice(p.end)}`;
  }
  return out;
}
