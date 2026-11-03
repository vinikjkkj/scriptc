/* AN INERT OPTIONAL STREAMING INSTALL: a module-level feature probe on the
 * `stream` module whose whole effect is to install exports nothing reads.
 *
 * The shape (iconv-lite lib/index.js, reached by mysql2):
 *
 *   var streamModule
 *   try { streamModule = require("stream") } catch (e) {}
 *   if (streamModule && streamModule.Transform) {
 *     module.exports.enableStreamingAPI(streamModule)
 *   } else {
 *     module.exports.encodeStream = module.exports.decodeStream = function () { throw ... }
 *   }
 *
 * `enableStreamingAPI` loads ./streams, whose factory defines ES5 subclasses
 * of Transform (`Transform.call(this, o)`, `X.prototype = Object.create(
 * Transform.prototype, ...)`) and hands them back; they land on
 * `module.exports.IconvLite*Stream` / `encodeStream` / `decodeStream`.
 *
 * A module namespace as a value, a runtime class as a value and ES5
 * subclassing of a runtime class have no lowering (sonnet queue item 3), so
 * the statements refuse (SC2020). But when nothing in the program can read
 * what the statements install, running them is unobservable and skipping
 * them is EXACT. This module proves that, fail-closed.
 *
 * WHAT IS PROVED (every item, or the proof fails and the refusal stays):
 *  1. The seed is a top-level `V = require("stream")` (optionally inside a
 *     `try {} catch {}` with an empty catch) over a module-level `var V` with
 *     no initializer. Every other reference to V lies in a top-level `if`
 *     statement ("region") that the walker below accepts.
 *  2. EXECUTED CODE is walked abstractly: the region, and the bodies of the
 *     functions it calls (`module.exports.N(...)` resolved to its single
 *     function-expression store; `require("./m")(...)` resolved to the
 *     module's `module.exports = function`). The walker admits only: local
 *     variables, local function declarations, if/block/return, stores to
 *     `module.exports.<N>` (N joins the DEAD FIELD set DF), `X.prototype =
 *     Object.create(<stream class>.prototype, {literal descriptors})` and
 *     stores of allowlisted names on that fresh prototype, property reads off
 *     the stream namespace (Transform/Readable/Writable/Duplex/PassThrough
 *     only, so no read can throw) and off object literals, and the calls
 *     above. Loops, try, throw, `new`, any other call, any other store, any
 *     unknown identifier fail. Both branches of every `if` are walked, so the
 *     answer does not depend on which one runs.
 *  3. A module the region requires first (./streams) must have an inert init
 *     (directive, `module.exports = function`, requires of builtins or of
 *     modules the host already initialised unconditionally before the seed),
 *     so not running it changes no order.
 *  4. DF is never read or stored outside the region, the bodies of the
 *     functions stored into DF fields (reachable only through DF reads, so
 *     they never run) and top-level literal initial values; no file other
 *     than the host and the walked factory module names a DF name anywhere;
 *     and every require of the host module in the program is used only
 *     through member reads (never the whole object), so nothing can
 *     enumerate or pass the exports.
 *  5. `module.exports` as a whole is not used by the host, EXCEPT as an
 *     argument of a call/`new` (iconv's `new codecDef(opts, module.exports)`).
 *     Then consumers may only CALL members (no `iconv.encodings.x = F`), and
 *     the code that can receive the object (the require closure of what the
 *     escaping function loads, inside the host's package) is audited by a
 *     name closure (auditEscape): no enumeration, run-time-key index, spread,
 *     call argument or literal member over a name the object is bound to.
 *
 * INFERRED, not proven: (a) a run-time `require(e)` / `import(e)` that Node
 * would resolve to the host is not seen (the compiler refuses or lowers those
 * to throws elsewhere; sq4); `module.children`-style reflection; (b) the
 * escape audit's residual (see auditEscape); (c) a constructor used with `new`
 * that has no `this` and returns an object built from its parameter.
 *
 * All walks over the user's source are iterative (explicit stacks), because
 * this runs before the compiler's nesting-depth guard. The walker's own
 * recursion is bounded by the shapes it admits (statements of the region, a
 * call depth of MAX_DEPTH). */
import * as ts from "../ts7/adapter.js";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeStream from "node:stream";
import { canonicalBuiltinModule, tsgoPath } from "../shared.js";
import type { Lowerer } from "./lowerer.js";

class Fail extends Error {}
function fail(why: string): never {
  throw new Fail(why);
}

const NS_MEMBERS = new Set(["Transform", "Readable", "Writable", "Duplex", "PassThrough"]);
/** Names a fresh prototype derived from a stream class may receive without
 * running a setter: Node's stream prototypes carry these as plain methods. */
const PROTO_STORE_NAMES = new Set(["_transform", "_flush", "_read", "_write", "_final", "_destroy", "_writev"]);
const DESCRIPTOR_KEYS = new Set(["value", "writable", "enumerable", "configurable"]);
const MAX_DEPTH = 6;

type Kind =
  | { tag: "ns" } // the stream module namespace
  | { tag: "cls" } // a class of it
  | { tag: "proto" } // <class>.prototype
  | { tag: "fn" } // a local function declaration
  | { tag: "fnexpr" } // a function expression value (never invoked here)
  | { tag: "obj" } // a fresh non-null object
  | { tag: "util" } // the `util` builtin module (only `inherits` is modelled)
  | { tag: "any" } // any value that is not dereferenced
  | { tag: "mod"; file: ts.SourceFile }; // a program module's exports (its `module.exports = function`)

const ANY: Kind = { tag: "any" };
const OBJ: Kind = { tag: "obj" };

function strip(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** Every node under `root` (inclusive), iteratively. */
function forEachNode(root: ts.Node, cb: (n: ts.Node) => void): void {
  const stack: ts.Node[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    cb(n);
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    n.kind === ts.SyntaxKind.FunctionDeclaration ||
    n.kind === ts.SyntaxKind.FunctionExpression ||
    n.kind === ts.SyntaxKind.ArrowFunction ||
    n.kind === ts.SyntaxKind.MethodDeclaration ||
    n.kind === ts.SyntaxKind.GetAccessor ||
    n.kind === ts.SyntaxKind.SetAccessor ||
    n.kind === ts.SyntaxKind.Constructor
  );
}

function isInside(n: ts.Node, anc: ReadonlySet<ts.Node>): boolean {
  for (let p: ts.Node | undefined = n; p !== undefined; p = p.parent) if (anc.has(p)) return true;
  return false;
}

function isJsFile(sf: ts.SourceFile): boolean {
  return /\.[cm]?js$/.test(sf.fileName) && !sf.isDeclarationFile;
}

/** Is `e` the ambient CJS `require(<string literal>)` call; its specifier. */
function requireLiteral(L: Lowerer, e: ts.Expression): { call: ts.CallExpression; spec: string } | null {
  const x = strip(e);
  if (!ts.isCallExpression(x) || !ts.isIdentifier(x.expression) || x.expression.text !== "require") return null;
  if (!L.isStdlibGlobal(x.expression, "require")) return null;
  if (x.arguments.length !== 1 || !ts.isStringLiteral(x.arguments[0]!)) return null;
  return { call: x, spec: (x.arguments[0] as ts.StringLiteral).text };
}

function isStreamRequire(L: Lowerer, e: ts.Expression): boolean {
  const r = requireLiteral(L, e);
  return r !== null && canonicalBuiltinModule(r.spec) === "stream";
}

/** `module.exports` / bare `exports` as the base of a member access. */
function isExportsRef(L: Lowerer, e: ts.Expression): boolean {
  const x = strip(e);
  if (ts.isPropertyAccessExpression(x) && x.name.text === "exports" && ts.isIdentifier(x.expression) && x.expression.text === "module") {
    // `module` must be the ambient CJS one (the file's own module symbol, or the @types/node global), not a local binding
    const sym = L.checker.getSymbolAtLocation(x.expression);
    return sym !== undefined && L.checker.declarationsOf(sym).every((d) => d.kind === ts.SyntaxKind.SourceFile || d.getSourceFile().isDeclarationFile);
  }
  return false;
}

/** `module.exports.N` (non-computed): N, else null. */
function exportsField(L: Lowerer, e: ts.Expression): string | null {
  const x = strip(e);
  if (ts.isPropertyAccessExpression(x) && isExportsRef(L, x.expression)) return x.name.text;
  return null;
}

// --- per-file verdicts -------------------------------------------------

const cache = new WeakMap<object, Map<string, Set<ts.Statement>>>();
const EMPTY: Set<ts.Statement> = new Set();

/** True when `stmt` (a top-level statement of a JS module) belongs to a
 * proven-inert streaming install: lowering skips it entirely. */
export function isProvenInertStatement(L: Lowerer, stmt: ts.Statement): boolean {
  const sf = stmt.parent;
  if (sf === undefined || !ts.isSourceFile(sf) || !isJsFile(sf)) return false;
  let m = cache.get(L);
  if (m === undefined) cache.set(L, (m = new Map()));
  let set = m.get(sf.fileName);
  if (set === undefined) {
    set = inertStatementsOf(L, sf);
    m.set(sf.fileName, set);
  }
  return set.has(stmt);
}

/** The seed target of a top-level statement, or null. */
function seedOf(L: Lowerer, st: ts.Statement): ts.Identifier | null {
  let s: ts.Statement = st;
  if (ts.isTryStatement(s)) {
    if (s.finallyBlock !== undefined) return null;
    if (s.catchClause === undefined || s.catchClause.block.statements.length !== 0) return null;
    if (s.tryBlock.statements.length !== 1) return null;
    s = s.tryBlock.statements[0]!;
  }
  if (!ts.isExpressionStatement(s)) return null;
  const e = strip(s.expression);
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (!ts.isIdentifier(e.left) || !isStreamRequire(L, e.right)) return null;
  return e.left;
}

function inertStatementsOf(L: Lowerer, sf: ts.SourceFile): Set<ts.Statement> {
  let out: Set<ts.Statement> | null = null;
  for (const st of sf.statements) {
    const target = seedOf(L, st);
    if (target === null) continue;
    try {
      const region = prove(L, sf, st, target);
      if (out === null) out = new Set();
      for (const r of region) out.add(r);
    } catch (e) {
      // A nesting depth that overflows the walker's own stack is a failed proof, not a crash.
      if (!(e instanceof Fail) && !(e instanceof RangeError)) throw e;
      if (process.env["SCRIPTC_INERT_WHY"] !== undefined) process.stderr.write(`stream-inert: ${sf.fileName}: ${e.message}\n`);
    }
  }
  return out ?? EMPTY;
}

// --- the proof ---------------------------------------------------------

interface Ctx {
  L: Lowerer;
  host: ts.SourceFile;
  vsym: ts.Symbol;
  visitedV: Set<ts.Node>;
  /** Fields the region installs (and the functions it resolves by name). */
  df: Set<string>;
  /** Function expressions stored into DF fields or fresh prototypes: never invoked. */
  deadFns: Set<ts.Node>;
  /** `module.exports.N` store targets the walk accepted. */
  okTargets: Set<ts.Node>;
  /** The top-level `module.exports.N = function ...` statements of resolved callees: dead closures, not lowered. */
  defStatements: Set<ts.Statement>;
  /** Files whose init the host already ran unconditionally before the seed. */
  initialised: Set<ts.SourceFile>;
  /** Modules whose exported function the walk executed (their own names are not host fields). */
  walkedFiles: Set<ts.SourceFile>;
  /** Sites where the host's whole exports object is an argument. */
  escapes: Array<{ index: number; isNew: boolean; site: ts.Node }>;
  stack: ts.Node[];
}

interface Frame {
  kinds: Map<ts.Symbol, Kind>;
  /** Local functions whose `prototype` was assigned a fresh Object.create. */
  fresh: Set<ts.Symbol>;
  returns: Kind[];
}

function symOf(c: Ctx, id: ts.Identifier): ts.Symbol {
  const s = c.L.checker.getSymbolAtLocation(id);
  if (s === undefined) fail(`no symbol for ${id.text}`);
  return s;
}

function prove(L: Lowerer, host: ts.SourceFile, seed: ts.Statement, target: ts.Identifier): Set<ts.Statement> {
  // A CommonJS script: no ES import/export, no top-level await.
  for (const st of host.statements) {
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st) || ts.isImportEqualsDeclaration(st)) {
      fail("the host is an ES module");
    }
  }
  const vsym = L.checker.getSymbolAtLocation(target);
  if (vsym === undefined) fail("no symbol for the seed variable");
  const decls = L.checker.declarationsOf(vsym);
  if (decls.length !== 1) fail("the seed variable has several declarations");
  const d = decls[0]!;
  if (!ts.isVariableDeclaration(d) || d.initializer !== undefined || !ts.isIdentifier(d.name)) fail("the seed variable is not a bare var");
  const vs = d.parent.parent;
  if (!ts.isVariableStatement(vs) || vs.parent !== host) fail("the seed variable is not module-level");

  // Every reference to V outside the seed lives in one top-level `if`.
  const refs: ts.Identifier[] = [];
  forEachNode(host, (n) => {
    if (ts.isIdentifier(n) && n.text === target.text && n !== target && n !== d.name && L.checker.getSymbolAtLocation(n) === vsym) refs.push(n);
  });
  const regionSet = new Set<ts.Statement>();
  for (const r of refs) {
    let p: ts.Node = r;
    while (p.parent !== undefined && p.parent !== host) p = p.parent;
    if (p.parent !== host) fail("a reference outside any top-level statement");
    const top = p as ts.Statement;
    if (top === seed) fail("the seed statement mentions V twice");
    if (!ts.isIfStatement(top)) fail("V is referenced outside an if statement");
    regionSet.add(top);
  }
  if (regionSet.size === 0) fail("V is never read");

  // Modules the host initialised unconditionally before the seed.
  const initialised = new Set<ts.SourceFile>();
  for (const st of host.statements) {
    if (st === seed) break;
    const found: ts.CallExpression[] = [];
    const roots: ts.Node[] = [];
    if (ts.isVariableStatement(st)) for (const dd of st.declarationList.declarations) if (dd.initializer !== undefined) roots.push(dd.initializer);
    if (ts.isExpressionStatement(st)) roots.push(st.expression);
    for (const root of roots) {
      forEachNode(root, (n) => {
        if (isFunctionLike(n)) return;
        if (ts.isCallExpression(n)) found.push(n);
      });
      // function bodies under a root are not executed at this point; the
      // callback above cannot prune, so filter by ancestry instead.
    }
    for (const call of found) {
      let inFn = false;
      for (let p: ts.Node | undefined = call; p !== undefined && p !== st; p = p.parent) if (isFunctionLike(p)) inFn = true;
      if (inFn) continue;
      const r = requireLiteral(L, call);
      if (r === null) continue;
      const dep = L.requireDepOf(r.spec, call);
      if (dep !== null) initialised.add(dep);
    }
  }

  const c: Ctx = {
    L,
    host,
    vsym,
    visitedV: new Set(),
    df: new Set(),
    deadFns: new Set(),
    okTargets: new Set(),
    defStatements: new Set(),
    initialised,
    walkedFiles: new Set(),
    escapes: [],
    stack: [],
  };
  const frame: Frame = { kinds: new Map(), fresh: new Set(), returns: [] };
  frame.kinds.set(vsym, { tag: "ns" });
  for (const r of regionSet) walkStmt(c, frame, r, 0);
  for (const r of refs) if (!c.visitedV.has(r)) fail("a reference to V the walk did not classify");

  const region = new Set<ts.Statement>(regionSet);
  region.add(seed);
  checkHost(c, region);
  checkProgram(c);
  for (const d of c.defStatements) region.add(d);
  return region;
}

// --- the abstract walk of executed code --------------------------------

function walkStmt(c: Ctx, f: Frame, st: ts.Statement, depth: number): void {
  if (ts.isBlock(st)) {
    for (const s of st.statements) walkStmt(c, f, s, depth);
    return;
  }
  if (ts.isEmptyStatement(st)) return;
  if (ts.isFunctionDeclaration(st)) return; // pre-declared by the frame setup
  if (ts.isIfStatement(st)) {
    evalExpr(c, f, st.expression, depth);
    walkStmt(c, f, st.thenStatement, depth);
    if (st.elseStatement !== undefined) walkStmt(c, f, st.elseStatement, depth);
    return;
  }
  if (ts.isReturnStatement(st)) {
    f.returns.push(st.expression === undefined ? ANY : evalExpr(c, f, st.expression, depth));
    return;
  }
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) fail("a destructuring declaration");
      const sym = symOf(c, d.name);
      f.kinds.set(sym, d.initializer === undefined ? ANY : evalExpr(c, f, d.initializer, depth));
    }
    return;
  }
  if (ts.isExpressionStatement(st)) {
    const e = strip(st.expression);
    if (ts.isStringLiteral(e)) return; // directive
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      walkAssign(c, f, e, depth);
      return;
    }
    if (ts.isCallExpression(e)) {
      evalExpr(c, f, e, depth);
      return;
    }
    fail(`an expression statement of kind ${ts.SyntaxKind[e.kind]}`);
  }
  fail(`a statement of kind ${ts.SyntaxKind[st.kind]}`);
}

function walkAssign(c: Ctx, f: Frame, e: ts.BinaryExpression, depth: number): void {
  const left = strip(e.left);
  const right = e.right;
  // module.exports.N = rhs
  const field = exportsField(c.L, left);
  if (field !== null) {
    if (left.getSourceFile() !== c.host) fail("a store to the exports of a walked module");
    const rk = evalExpr(c, f, right, depth);
    c.df.add(field);
    c.okTargets.add(left);
    if (rk.tag === "fnexpr") c.deadFns.add(strip(right));
    return;
  }
  // local = rhs (a local declared in a walked frame)
  if (ts.isIdentifier(left)) {
    const sym = symOf(c, left);
    if (!f.kinds.has(sym) || sym === c.vsym) fail(`a store to ${left.text}`);
    f.kinds.set(sym, evalExpr(c, f, right, depth));
    return;
  }
  if (ts.isPropertyAccessExpression(left)) {
    // X.prototype = Object.create(<stream class>.prototype, {descriptors})
    if (left.name.text === "prototype" && ts.isIdentifier(left.expression)) {
      const xs = symOf(c, left.expression);
      if (f.kinds.get(xs)?.tag !== "fn") fail("prototype of a non-local-function");
      const rk = evalExpr(c, f, right, depth);
      if (rk.tag !== "obj" || !isObjectCreate(c, right)) fail("prototype assigned something other than Object.create");
      f.fresh.add(xs);
      return;
    }
    // X.prototype.name = rhs on a fresh prototype
    const base = strip(left.expression);
    if (ts.isPropertyAccessExpression(base) && base.name.text === "prototype" && ts.isIdentifier(base.expression)) {
      const xs = symOf(c, base.expression);
      if (!f.fresh.has(xs)) fail("a store on a prototype that is not fresh");
      if (!PROTO_STORE_NAMES.has(left.name.text) && hostChainHas(left.name.text)) fail(`a store to ${left.name.text}, which a stream prototype defines`);
      const rk = evalExpr(c, f, right, depth);
      if (rk.tag === "fnexpr") c.deadFns.add(strip(right));
      return;
    }
  }
  fail("an assignment target the walk does not model");
}

let hostNames: Set<string> | null = null;
/** Own property names along the build host's Transform.prototype chain: a
 * store to one of them might hit an accessor. Names outside it (`collect`)
 * are plain own properties of the fresh prototype. */
function hostChainHas(name: string): boolean {
  if (hostNames === null) {
    hostNames = new Set();
    for (let p: object | null = nodeStream.Transform.prototype; p !== null; p = Object.getPrototypeOf(p) as object | null) {
      for (const n of Object.getOwnPropertyNames(p)) hostNames.add(n);
    }
  }
  return hostNames.has(name);
}

function isObjectCreate(c: Ctx, e: ts.Expression): boolean {
  const x = strip(e);
  return (
    ts.isCallExpression(x) &&
    ts.isPropertyAccessExpression(x.expression) &&
    x.expression.name.text === "create" &&
    ts.isIdentifier(x.expression.expression) &&
    x.expression.expression.text === "Object" &&
    c.L.isStdlibGlobal(x.expression.expression, "Object")
  );
}

function evalExpr(c: Ctx, f: Frame, e0: ts.Expression, depth: number): Kind {
  const e = strip(e0);
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return ANY;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return ANY;
  if (ts.isIdentifier(e)) {
    const sym = symOf(c, e);
    const k = f.kinds.get(sym) ?? moduleLevelUtil(c, sym);
    if (k === undefined) fail(`an unmodelled identifier ${e.text}`);
    if (sym === c.vsym) c.visitedV.add(e);
    return k;
  }
  if (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return { tag: "fnexpr" };
  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) evalExpr(c, f, p.initializer, depth);
      else if (ts.isShorthandPropertyAssignment(p)) evalExpr(c, f, p.name as ts.Expression, depth);
      else fail("an object literal member the walk does not model");
    }
    return OBJ;
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      evalExpr(c, f, e.left, depth);
      evalExpr(c, f, e.right, depth);
      return ANY;
    }
    fail("a binary operator the walk does not model");
  }
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.name) === false) fail("a private name");
    if (isExportsRef(c.L, e.expression)) {
      if (e.getSourceFile() !== c.host) fail("a read of the exports of a walked module");
      // a read of an exports field: never throws; only the exports object itself escapes elsewhere
      return ANY;
    }
    const rk = evalExpr(c, f, e.expression, depth);
    if (rk.tag === "ns") {
      if (!NS_MEMBERS.has(e.name.text)) fail(`stream.${e.name.text} is not a modelled member`);
      return { tag: "cls" };
    }
    if (rk.tag === "cls" && e.name.text === "prototype") return { tag: "proto" };
    if (rk.tag === "obj") return ANY;
    fail(`a property read on a ${rk.tag}`);
  }
  if (ts.isCallExpression(e)) return evalCall(c, f, e, depth);
  fail(`an expression of kind ${ts.SyntaxKind[e.kind]}`);
}

/** A module-level `var util = require("util")` of the file the walk is in. */
function moduleLevelUtil(c: Ctx, sym: ts.Symbol): Kind | undefined {
  const decls = c.L.checker.declarationsOf(sym);
  if (decls.length !== 1) return undefined;
  const d = decls[0]!;
  if (!ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
  const vs = d.parent.parent;
  if (!ts.isVariableStatement(vs) || !ts.isSourceFile(vs.parent)) return undefined;
  const r = requireLiteral(c.L, d.initializer);
  if (r === null || canonicalBuiltinModule(r.spec) !== "util") return undefined;
  // the binding must never be reassigned
  let reassigned = false;
  forEachNode(d.getSourceFile(), (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = strip(n.left);
      if (ts.isIdentifier(l) && c.L.checker.getSymbolAtLocation(l) === sym) reassigned = true;
    }
  });
  return reassigned ? undefined : { tag: "util" };
}

function evalCall(c: Ctx, f: Frame, e: ts.CallExpression, depth: number): Kind {
  if (e.typeArguments !== undefined && e.typeArguments.length > 0) fail("type arguments");
  for (const a of e.arguments) if (ts.isSpreadElement(a)) fail("a spread argument");
  // require("<lit>")
  const rq = requireLiteral(c.L, e);
  if (rq !== null) {
    if (canonicalBuiltinModule(rq.spec) !== null) {
      if (canonicalBuiltinModule(rq.spec) === "stream") return { tag: "ns" };
      if (canonicalBuiltinModule(rq.spec) === "util") return { tag: "util" };
      return ANY;
    }
    const dep = c.L.requireDepOf(rq.spec, e);
    if (dep === null) fail(`require(${rq.spec}) names no program module`);
    return { tag: "mod", file: dep };
  }
  // Object.create(<proto>, {descriptors})
  if (isObjectCreate(c, e)) {
    if (e.arguments.length !== 2) fail("Object.create with other than two arguments");
    const pk = evalExpr(c, f, e.arguments[0]!, depth);
    if (pk.tag !== "proto") fail("Object.create over something other than a stream prototype");
    const desc = strip(e.arguments[1]!);
    if (!ts.isObjectLiteralExpression(desc)) fail("non-literal descriptors");
    for (const p of desc.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) fail("a descriptor member");
      if (!PROTO_STORE_NAMES.has(p.name.text) && p.name.text !== "constructor" && hostChainHas(p.name.text)) fail("a descriptor over a stream prototype member");
      const dv = strip(p.initializer);
      if (!ts.isObjectLiteralExpression(dv)) fail("a descriptor that is not a literal");
      for (const q of dv.properties) {
        if (!ts.isPropertyAssignment(q) || !ts.isIdentifier(q.name) || !DESCRIPTOR_KEYS.has(q.name.text)) fail("a descriptor key");
        evalExpr(c, f, q.initializer, depth);
      }
    }
    return OBJ;
  }
  const args = e.arguments.map((a) => evalExpr(c, f, a, depth));
  const callee = strip(e.expression);
  // util.inherits(Local, <stream class>): sets Local.super_ and the prototype
  // link of Local's own fresh default prototype; nothing outside Local changes.
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "inherits") {
    const rk = evalExpr(c, f, callee.expression, depth);
    if (rk.tag === "util") {
      const a0 = e.arguments[0] !== undefined ? strip(e.arguments[0]) : undefined;
      if (e.arguments.length !== 2 || a0 === undefined || !ts.isIdentifier(a0) || args[0]!.tag !== "fn" || args[1]!.tag !== "cls") {
        fail("util.inherits over something other than a local function and a stream class");
      }
      f.fresh.add(symOf(c, a0));
      return ANY;
    }
  }
  // module.exports.N(args): resolved to its single function-expression store
  const field = exportsField(c.L, callee);
  if (field !== null) {
    if (callee.getSourceFile() !== c.host) fail("a call through the exports of a walked module");
    const def = findExportFn(c, field);
    c.df.add(field);
    return callFunction(c, def.fn, args, depth, null);
  }
  // <module value>(args): the module's `module.exports = function`
  const ck = evalExpr(c, f, callee, depth);
  if (ck.tag === "mod") {
    const fn = moduleExportFn(c, ck.file);
    return callFunction(c, fn, args, depth, ck.file);
  }
  fail("a call the walk does not model");
}

/** The single `module.exports.N = function ...` of the host, N never otherwise stored. */
function findExportFn(c: Ctx, name: string): { fn: ts.FunctionExpression } {
  let def: ts.FunctionExpression | null = null;
  let n = 0;
  forEachNode(c.host, (x) => {
    if (!ts.isPropertyAccessExpression(x) || x.name.text !== name || !isExportsRef(c.L, x.expression)) return;
    const p = x.parent;
    if (ts.isBinaryExpression(p) && p.left === x && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      n++;
      const r = strip(p.right);
      if (ts.isFunctionExpression(r) && p.parent !== undefined && ts.isExpressionStatement(p.parent)) {
        def = r;
        c.okTargets.add(x);
        if (ts.isSourceFile(p.parent.parent!)) c.defStatements.add(p.parent);
      }
    }
  });
  if (def === null || n !== 1) fail(`module.exports.${name} is not stored exactly once as a function expression`);
  c.deadFns.add(def);
  return { fn: def };
}

/** `module.exports = function ...` of a program module with an inert init. */
function moduleExportFn(c: Ctx, file: ts.SourceFile): ts.FunctionExpression {
  if (!isJsFile(file)) fail("a required module that is not a JS file");
  if (file === c.host) fail("the host requires itself");
  let fn: ts.FunctionExpression | null = null;
  c.walkedFiles.add(file);
  for (const st of file.statements) {
    if (ts.isExpressionStatement(st)) {
      const e = strip(st.expression);
      if (ts.isStringLiteral(e)) continue; // directive
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const l = strip(e.left);
        if (isExportsRef(c.L, l)) {
          const r = strip(e.right);
          if (fn !== null || !ts.isFunctionExpression(r)) fail("module.exports of the required module is not one function expression");
          fn = r;
          continue;
        }
      }
      fail("a top-level statement of the required module that is not an inert init");
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.initializer === undefined) fail("an init declaration of the required module");
        let init = strip(d.initializer);
        if (ts.isPropertyAccessExpression(init)) init = strip(init.expression); // require(...).member / __sc_rN.member
        if (ts.isIdentifier(init)) continue; // alias of an earlier `const __sc_rN = require(..)`, validated at its declaration
        const r = requireLiteral(c.L, init);
        if (r === null) fail("an init initializer of the required module that is not a require");
        if (canonicalBuiltinModule(r.spec) !== null) continue;
        const dep = c.L.requireDepOf(r.spec, r.call);
        if (dep === null || !c.initialised.has(dep)) fail(`the required module's init would run ${r.spec} for the first time`);
      }
      continue;
    }
    fail("a top-level statement of the required module that is not an inert init");
  }
  if (fn === null) fail("the required module has no `module.exports = function`");
  c.deadFns.add(fn);
  return fn;
}

function callFunction(c: Ctx, fn: ts.FunctionExpression, args: Kind[], depth: number, file: ts.SourceFile | null): Kind {
  if (depth >= MAX_DEPTH) fail("call depth");
  if (c.stack.includes(fn)) fail("recursion");
  if (fn.body === undefined || !ts.isBlock(fn.body)) fail("a function without a block body");
  if (fn.parameters.length > args.length && fn.parameters.length > 0) {
    // missing arguments are undefined: fine for locals, but keep it simple
  }
  const frame: Frame = { kinds: new Map(), fresh: new Set(), returns: [] };
  fn.parameters.forEach((p, i) => {
    if (!ts.isIdentifier(p.name) || p.initializer !== undefined || p.dotDotDotToken !== undefined) fail("a parameter shape the walk does not model");
    frame.kinds.set(symOf(c, p.name), args[i] ?? ANY);
  });
  // local function declarations are hoisted
  for (const st of fn.body.statements) {
    if (ts.isFunctionDeclaration(st) && st.name !== undefined) {
      frame.kinds.set(symOf(c, st.name), { tag: "fn" });
    }
  }
  void file;
  c.stack.push(fn);
  try {
    for (const st of fn.body.statements) walkStmt(c, frame, st, depth + 1);
  } finally {
    c.stack.pop();
  }
  // every return is an object literal: a fresh non-null object
  if (frame.returns.length > 0 && frame.returns.every((k) => k.tag === "obj")) return OBJ;
  return ANY;
}

// --- who can observe what the region installs --------------------------

function checkHost(c: Ctx, region: ReadonlySet<ts.Statement>): void {
  const { L, host } = c;
  const df = c.df;
  const dead = c.deadFns;
  forEachNode(host, (n) => {
    if (n.kind === ts.SyntaxKind.WithStatement) fail("with");
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "eval") fail("direct eval");
    // `module.exports` / `exports` only as the base of a non-computed member access
    if (ts.isPropertyAccessExpression(n) && isExportsRef(L, n)) {
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        // a named member access: fine
      } else if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments !== undefined && p.expression !== n && p.arguments.indexOf(n as ts.Expression) >= 0) {
        // handed whole to a callee: audited below (auditEscape)
        c.escapes.push({ index: p.arguments.indexOf(n as ts.Expression), isNew: ts.isNewExpression(p), site: p });
      } else fail("module.exports escapes as a whole");
    }
    if (ts.isIdentifier(n) && n.text === "exports" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      const p = n.parent;
      if (!(ts.isPropertyAccessExpression(p) && p.expression === n)) fail("a bare `exports`");
    }
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      let p: ts.Node | undefined = n.parent;
      let inFn = false;
      while (p !== undefined) {
        if (isFunctionLike(p) && p.kind !== ts.SyntaxKind.ArrowFunction) {
          inFn = true;
          break;
        }
        p = p.parent;
      }
      if (!inFn) fail("a top-level `this`");
    }
    // DF names: only inside the region, a dead function, or an accepted store target
    const name = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : null;
    if (name !== null && df.has(name) && (ts.isPropertyAccessExpression(n) ? isExportsRef(L, n.expression) : true)) {
      if (!c.okTargets.has(n) && !isInside(n, region) && !isInside(n, dead) && !isLiteralInit(n)) fail(`${name}, a field the region installs, is used outside it`);
    }
    // a computed `module.exports[...]`
    if (ts.isElementAccessExpression(n) && isExportsRef(L, n.expression)) fail("a computed read of module.exports");
  });
  if (c.escapes.length > 0) auditEscape(c);
}

/** `module.exports.N = <literal>;` as a top-level statement: an initial value
 * no code can read (N is dead), with no effect of its own. */
function isLiteralInit(n: ts.Node): boolean {
  const p = n.parent;
  if (!ts.isBinaryExpression(p) || p.left !== n || p.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  if (!ts.isExpressionStatement(p.parent) || p.parent.parent === undefined || !ts.isSourceFile(p.parent.parent)) return false;
  const r = strip(p.right);
  return ts.isStringLiteralLike(r) || ts.isNumericLiteral(r) || r.kind === ts.SyntaxKind.TrueKeyword || r.kind === ts.SyntaxKind.FalseKeyword || r.kind === ts.SyntaxKind.NullKeyword;
}

function checkProgram(c: Ctx): void {
  const { L, host } = c;
  const names = [...c.df];
  for (const sf of L.program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf === host) continue;
    // 1. no mention of a DF name (the walked module's own local names are not host fields)
    if (!c.walkedFiles.has(sf) && names.some((n) => sf.text.includes(n))) {
      forEachNode(sf, (n) => {
        if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isPrivateIdentifier(n)) && c.df.has(n.text)) fail(`${sf.fileName} mentions ${n.text}`);
      });
    }
    // 2. every require / import of the host is used by member reads only
    if (!/require|import|export/.test(sf.text)) continue;
    forEachNode(sf, (n) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
        const s = L.checker.getSymbolAtLocation(n.moduleSpecifier);
        if (s !== undefined && L.checker.declarationsOf(s).some((d) => d.getSourceFile() === host)) fail(`${sf.fileName} imports the host as an ES module`);
      }
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
        const s = L.checker.getSymbolAtLocation(n.moduleReference.expression);
        if (s !== undefined && L.checker.declarationsOf(s).some((d) => d.getSourceFile() === host)) fail(`${sf.fileName} import-requires the host`);
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]!)) {
        if (L.requireDepOf((n.arguments[0] as ts.StringLiteral).text, n) === host) fail(`${sf.fileName} dynamically imports the host`);
      }
      const rq = ts.isCallExpression(n) ? requireLiteral(L, n) : null;
      if (rq === null || canonicalBuiltinModule(rq.spec) !== null) return;
      if (L.requireDepOf(rq.spec, rq.call) !== host) return;
      checkConsumer(c, sf, rq.call);
    });
  }
}

/** A require of the host: its result must be used only by member reads. */
function checkConsumer(c: Ctx, sf: ts.SourceFile, call: ts.CallExpression): void {
  let n: ts.Node = call;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  const direct = c.escapes.length > 0; // the exports object reaches package code: no consumer may reach through a member
  const calledMember = (acc: ts.PropertyAccessExpression): boolean => !direct || (ts.isCallExpression(acc.parent) && acc.parent.expression === acc);
  if (ts.isPropertyAccessExpression(p) && p.expression === n) {
    if (!calledMember(p)) fail(`${sf.fileName}: a member of the host is read without being called`);
    return;
  }
  if (ts.isExpressionStatement(p)) return;
  if (ts.isVariableDeclaration(p) && p.initializer === n) {
    if (ts.isObjectBindingPattern(p.name)) {
      if (direct) fail(`${sf.fileName}: the host is destructured`);
      for (const el of p.name.elements) {
        if (el.dotDotDotToken !== undefined || el.name === undefined || !ts.isIdentifier(el.name) || (el.propertyName !== undefined && !ts.isIdentifier(el.propertyName))) {
          fail(`${sf.fileName}: the host is destructured with a shape the proof does not model`);
        }
      }
      return;
    }
    if (ts.isIdentifier(p.name)) {
      const bsym = c.L.checker.getSymbolAtLocation(p.name);
      if (bsym === undefined) fail("no symbol for a consumer binding");
      const bad: string[] = [];
      forEachNode(sf, (x) => {
        if (!ts.isIdentifier(x) || x.text !== (p.name as ts.Identifier).text || x === p.name) return;
        if (c.L.checker.getSymbolAtLocation(x) !== bsym) return;
        const xp = x.parent;
        if (ts.isPropertyAccessExpression(xp) && xp.expression === x && calledMember(xp)) return;
        bad.push(x.text);
      });
      if (bad.length > 0) fail(`${sf.fileName}: the host binding ${bad[0]} is used as a whole`);
      return;
    }
  }
  fail(`${sf.fileName}: the host module is used in a way the proof does not model`);
}

// --- the exports object handed to package code -------------------------

/** Walk up from `file` to the directory holding the nearest package.json.
 * Both the input and the answer are slash-normalized (tsgoPath), the form
 * every SourceFile name has: Node's path APIs print backslashes on win32, and
 * a prefix test between the two forms never matches there. */
export function packageRootOf(file: string, exists: (p: string) => boolean = nodeFs.existsSync, platform: NodeJS.Platform = process.platform): string {
  let dir = nodePath.posix.dirname(tsgoPath(file, platform));
  for (;;) {
    if (exists(nodePath.posix.join(dir, "package.json"))) return dir;
    const up = nodePath.posix.dirname(dir);
    if (up === dir) fail("the host has no package.json");
    dir = up;
  }
}

/** Is `file` inside directory `root` (both in any separator form)? */
export function isUnderRoot(file: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const r = tsgoPath(root, platform);
  return tsgoPath(file, platform).startsWith(r.endsWith("/") ? r : r + "/");
}

function containsThis(fn: ts.Node): boolean {
  let found = false;
  const stack: ts.Node[] = [];
  ts.forEachChild(fn, (ch) => {
    stack.push(ch);
  });
  while (stack.length > 0 && !found) {
    const n = stack.pop()!;
    if (n.kind === ts.SyntaxKind.ThisKeyword) found = true;
    if (isFunctionLike(n) && n.kind !== ts.SyntaxKind.ArrowFunction) continue;
    ts.forEachChild(n, (ch) => {
      stack.push(ch);
    });
  }
  return found;
}

/** A function a `new` can build instances of: a class constructor, a named
 * function declaration that uses `this`, or a function expression bound to a
 * plain variable that uses `this` (an ES5 constructor). Methods (function
 * expressions stored on a member, class and object-literal methods) are not
 * constructors, so their parameters are not seeds. */
function isConstructorLike(_file: ts.SourceFile, fn: ts.Node): boolean {
  if (ts.isConstructorDeclaration(fn)) return true;
  if (ts.isFunctionDeclaration(fn)) return fn.name !== undefined && containsThis(fn);
  if (ts.isFunctionExpression(fn)) {
    const p = fn.parent;
    const bound = (ts.isVariableDeclaration(p) && p.initializer === fn) || (ts.isBinaryExpression(p) && p.right === fn && ts.isIdentifier(p.left));
    return bound && containsThis(fn);
  }
  return false;
}

/** The host's whole exports object is an argument of `new X(.., module.exports)`
 * or a call. The callee is a value out of the host's own codec table, so the
 * code that can hold the object lives in the host's package. The audit is a
 * NAME closure over that package: N = the names the object can be bound to
 * (the parameter at the escaped index of every function that uses `this`,
 * grown through `a.N = <N>` / `var N = <N>` copies); every occurrence of an N
 * name in the package must be the base of a named member read, a parameter, a
 * store target, or the right side of a copy into an N name. A `for-in`,
 * `x[k]`, `Object.keys(x)`, spread, call argument or return of such a name
 * fails the proof.
 *
 * INFERRED residual (not mechanised): an object that merely CONTAINS the
 * exports object (a codec instance, field N) enumerated by value and then
 * indexed by a key built at run time that spells a DF name. No file names a
 * DF name (checkProgram), so such a key must be assembled from pieces. */
function auditEscape(c: Ctx): void {
  const root = packageRootOf(c.host.fileName);
  const files = c.L.program.getSourceFiles().filter((f) => !f.isDeclarationFile && isUnderRoot(f.fileName, root) && isJsFile(f));
  const names = new Set<string>();
  const seedParams = (fn: ts.Node, index: number): void => {
    const params = (fn as ts.FunctionLikeDeclaration).parameters;
    if (params === undefined || index >= params.length) return;
    const p = params[index]!;
    if (p.dotDotDotToken !== undefined) fail("a rest parameter at the escaped index");
    if (!ts.isIdentifier(p.name)) fail("a destructured parameter at the escaped index");
    names.add(p.name.text);
  };
  // The callee is a value out of a table the escaping function loads (a
  // `require("../encodings")` inside getCodec, or a module-level binding it
  // reads): the code that can receive the object is the require closure of
  // those loads, inside the package.
  const candidate = new Set<ts.SourceFile>();
  const queue: ts.SourceFile[] = [];
  const enqueueRequires = (root: ts.Node): void => {
    forEachNode(root, (n) => {
      const r = ts.isCallExpression(n) ? requireLiteral(c.L, n) : null;
      if (r === null || canonicalBuiltinModule(r.spec) !== null) return;
      const dep = c.L.requireDepOf(r.spec, r.call);
      if (dep !== null && isUnderRoot(dep.fileName, root0) && isJsFile(dep) && !candidate.has(dep)) {
        candidate.add(dep);
        queue.push(dep);
      }
    });
  };
  const root0 = root;
  for (const e of c.escapes) {
    let g: ts.Node | undefined = e.site.parent;
    while (g !== undefined && !isFunctionLike(g)) g = g.parent;
    if (g === undefined) fail("the exports object escapes at the top level of the host");
    enqueueRequires(g);
    // ... and the modules bound at module level to a name the escaping function reads
    forEachNode(g, (n) => {
      if (!ts.isIdentifier(n)) return;
      const sym = c.L.checker.getSymbolAtLocation(n);
      if (sym === undefined) return;
      for (const d of c.L.checker.declarationsOf(sym)) {
        if (!ts.isVariableDeclaration(d) || d.initializer === undefined || d.getSourceFile() !== c.host) continue;
        const vs = d.parent.parent;
        if (!ts.isVariableStatement(vs) || vs.parent !== c.host) continue;
        enqueueRequires(d.initializer);
      }
    });
  }
  if (candidate.size === 0) fail("the escaping function loads no module the callee could come from");
  while (queue.length > 0) enqueueRequires(queue.pop()!);
  for (const f of candidate) {
    forEachNode(f, (n) => {
      if (!isConstructorLike(f, n)) return;
      for (const e of c.escapes) seedParams(n, e.index);
    });
  }
  // grow through copies
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      forEachNode(f, (n) => {
        let target: string | null = null;
        let rhs: ts.Expression | undefined;
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const l = strip(n.left);
          target = ts.isIdentifier(l) ? l.text : ts.isPropertyAccessExpression(l) ? l.name.text : null;
          rhs = n.right;
        } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
          target = n.name.text;
          rhs = n.initializer;
        }
        if (target === null || rhs === undefined || names.has(target)) return;
        const r = strip(rhs);
        const rn = ts.isIdentifier(r) ? r.text : ts.isPropertyAccessExpression(r) ? r.name.text : null;
        if (rn !== null && names.has(rn)) {
          names.add(target);
          changed = true;
        }
      });
    }
  }
  if (names.size === 0) fail("the escaped exports object has no recorded binding name");
  for (const f of files) {
    forEachNode(f, (n) => {
      if (ts.isStringLiteralLike(n) && names.has(n.text) && ts.isElementAccessExpression(n.parent)) fail(`${f.fileName}: ["${n.text}"] on an exports holder`);
      if (!ts.isIdentifier(n) || !names.has(n.text)) return;
      const par = n.parent;
      // a property NAME position: the occurrence is the whole access
      let e: ts.Node = n;
      if (ts.isPropertyAccessExpression(par) && par.name === n) e = par;
      else if (ts.isPropertyAssignment(par) && par.name === n) return; // an object-literal key
      else if (ts.isParameter(par) && par.name === n) return;
      else if (ts.isVariableDeclaration(par) && par.name === n) return;
      else if (ts.isFunctionLike(par) && (par as { name?: ts.Node }).name === n) return;
      const p = e.parent;
      // Constructs that enumerate, index by a run-time key, or hand the holder
      // to code the audit does not see.
      let bad: string | null = null;
      if (ts.isElementAccessExpression(p) && p.expression === e) bad = "indexed by a run-time key";
      else if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.expression === e) bad = "enumerated";
      else if (ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) bad = "spread";
      else if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InKeyword && p.right === e) bad = "the right operand of `in`";
      else if (ts.isCallExpression(p) && p.expression !== e) bad = "a call argument";
      else if (ts.isNewExpression(p) && p.expression === e) bad = "a constructor";
      else if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isArrayLiteralExpression(p) || ts.isTemplateSpan(p)) bad = "stored into a literal";
      else if (ts.isThrowStatement(p) || ts.isAwaitExpression(p) || ts.isYieldExpression(p)) bad = "thrown or awaited";
      else if (ts.isVariableDeclaration(p) && p.initializer === e && !ts.isIdentifier(p.name)) bad = "destructured";
      if (bad === null) return;
      fail(`${f.fileName}: the exports holder ${n.text} is ${bad}`);
    });
  }
}
