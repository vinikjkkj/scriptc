/* Source-level desugaring of plain-JS spellings that mean exactly a
 * sequence of forms the lowering already models.
 *
 * NESTED require() DESTRUCTURING. Node binds
 *
 *     const { EventTarget: { addEventListener, removeEventListener } } =
 *       require('./event-target');
 *
 * as the flat read of the module's `EventTarget` export followed by an
 * ordinary object destructuring of that value. The lowering already models
 * both halves (a flat require binding aliases the exporter's declaration;
 * a destructuring of a record reads its fields), but not the nested form,
 * which preflight refused (SC1012). The text handed to the checker and the
 * lowering is therefore
 *
 *     const { EventTarget: __sc_n123 } = require('./event-target');
 *     const { addEventListener, removeEventListener } = __sc_n123;
 *
 * which is the same program: the binding of the intermediate value is
 * evaluated at the require statement's position, once, exactly as Node's
 * nested pattern reads it. Newlines are preserved (the extra statements are
 * appended on the statement's last line and the original line breaks are
 * kept), so no later line moves. Only whole TOP-LEVEL single-declarator
 * statements whose every pattern element is a plain `name` or `key: name`
 * or `key: <pattern>` are rewritten; defaults and rest elements stay in the
 * statement, where preflight still refuses them.
 *
 * Purely syntactic (typescript5 world, the sanctioned parsing island of
 * npm-static-rewrite.ts and provenance-rewrite.ts); the checker then
 * infers every type from the emitted spellings. */
import ts from "typescript5";
import { builtinModules } from "node:module";

const NESTED_REQUIRE_PREFILTER = /=\s*require\s*\(/;

interface Edit {
  start: number;
  end: number;
  text: string;
}

function isPlainPattern(p: ts.ObjectBindingPattern): boolean {
  return p.elements.every((e) => {
    if (e.dotDotDotToken !== undefined || e.initializer !== undefined) return false;
    if (e.propertyName !== undefined && !ts.isIdentifier(e.propertyName) && !ts.isStringLiteral(e.propertyName)) {
      return false;
    }
    if (ts.isIdentifier(e.name)) return true;
    return ts.isObjectBindingPattern(e.name) && e.propertyName !== undefined && isPlainPattern(e.name);
  });
}

function hasNested(p: ts.ObjectBindingPattern): boolean {
  return p.elements.some((e) => ts.isObjectBindingPattern(e.name));
}

/** Flattens one pattern level: nested patterns are replaced by a fresh
 * identifier and become their own destructuring declaration. */
function flatten(
  p: ts.ObjectBindingPattern,
  sf: ts.SourceFile,
  kw: string,
  extras: string[],
): string {
  const parts = p.elements.map((e) => {
    if (!ts.isObjectBindingPattern(e.name)) return e.getText(sf);
    const tmp = `__sc_n${e.name.getStart(sf)}`;
    // The declaration of this level is reserved BEFORE its deeper levels
    // are produced, so the statements run outermost first (each reads the
    // temporary the one before it bound).
    const slot = extras.length;
    extras.push("");
    const inner = flatten(e.name, sf, kw, extras);
    extras[slot] = `${kw} ${inner} = ${tmp};`;
    return `${e.propertyName!.getText(sf)}: ${tmp}`;
  });
  return `{ ${parts.join(", ")} }`;
}

/** The desugared text of `fileName`, or null when nothing in it needs it
 * (the fast path for every ordinary file). */
/** `Buffer[Symbol.species]` is Buffer's species constructor, which the
 * checker types `any`: every `new FastBuffer(...)` through it then has an
 * `any` instance and each member call on the result loses its receiver type.
 * The species constructor of Buffer constructs Buffers, so the spelling is
 * served as the global `Buffer` itself (typed), tagged with a marker comment
 * the lowering reads (bufferSpeciesAliasDecl) so the `const X = Buffer` alias
 * of this spelling — and only it — is the species constructor. */
const SPECIES_SPELLING = /\bBuffer\s*\[\s*Symbol\s*\.\s*species\s*\]/g;
export const SPECIES_MARKER = "/*@species*/";

/** `require("process")` IS the global `process` object (Node's `process` module
 * exports it). A binding of that name to the module is dropped (the global is
 * already in scope and typed), any other use is the global itself. */
const PROCESS_MODULE_DECL = /^([ \t]*)(?:const|let|var)\s+process\s*=\s*require\(\s*(['"])(?:node:)?process\2\s*\)\s*;?/gm;
const PROCESS_MODULE_USE = /\brequire\(\s*(['"])(?:node:)?process\1\s*\)/g;

/** `process.getBuiltinModule("node:x")` with a literal specifier IS
 * `require("node:x")` (Node 22+ answers the same module object). */
const GET_BUILTIN_MODULE = /\bprocess\.getBuiltinModule\(\s*(['"])((?:node:)?[a-z_/]+)\1\s*\)/g;

/** The Babel/rollup UMD wrapper (`long/umd/index.js`, many others):
 *
 *     (function (global, factory) {
 *       function preferDefault(exports) { return exports.default || exports; }
 *       if (typeof define === "function" && define.amd) {...}
 *       else if (typeof exports === "object") {
 *         factory(exports);
 *         if (typeof module === "object") module.exports = preferDefault(exports);
 *       } else {...}
 *     })(<global expr>, function (_exports) { <body> });
 *
 * Under CommonJS (the only branch a compiled program takes) that is the body
 * run against the `exports` object, then `module.exports = exports.default ||
 * exports`. The body is hoisted to module level so its function declarations
 * are what the lowering already models (a nested constructor function is not
 * a module-level class). Only this exact wrapper shape is rewritten. */
const UMD_PREFILTER = /factory\(exports\)[\s\S]*module\.exports\s*=\s*preferDefault\(exports\)/;

function umdUnwrap(fileName: string, text: string): string | null {
  if (!UMD_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    let call: ts.Expression = stmt.expression;
    while (ts.isParenthesizedExpression(call)) call = call.expression;
    if (!ts.isCallExpression(call) || call.arguments.length !== 2) continue;
    let callee: ts.Expression = call.expression;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    if (!ts.isFunctionExpression(callee) || callee.parameters.length !== 2) continue;
    const factory = call.arguments[1]!;
    if (!ts.isFunctionExpression(factory) || factory.parameters.length !== 1 || !ts.isIdentifier(factory.parameters[0]!.name)) continue;
    if (!/factory\(exports\)/.test(callee.getText(sf))) continue;
    const exp = (factory.parameters[0]!.name as ts.Identifier).text;
    const body = factory.body;
    const inner = text.slice(body.getStart(sf) + 1, body.getEnd() - 1);
    // Only the default-export-of-one-binding shape: every use of the exports
    // parameter is the __esModule marker, the `default = void 0` reset, and ONE
    // `(exports.default = Name)`. The rest of the body is the module.
    const esc = exp.replace(/[$]/g, "\\$&");
    let rest = inner
      .replace(new RegExp(`Object\\.defineProperty\\(\\s*${esc}\\s*,\\s*["']__esModule["']\\s*,\\s*\\{[^}]*\\}\\s*\\);?`), (m) => m.replace(/[^\n]/g, " "))
      .replace(new RegExp(`${esc}\\.default\\s*=\\s*void 0;?`), (m) => m.replace(/[^\n]/g, " "));
    const defMatch = new RegExp(`\\(\\s*${esc}\\.default\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\)`).exec(rest);
    if (defMatch === null) continue;
    rest = rest.replace(defMatch[0], defMatch[1]!);
    if (new RegExp(`(?<![\\w$.])${esc}(?![\\w$])`).test(rest)) continue;
    const newlinesBefore = (text.slice(stmt.getStart(sf), body.getStart(sf)).match(/\n/g) ?? []).length;
    const newlinesAfter = (text.slice(body.getEnd(), stmt.getEnd()).match(/\n/g) ?? []).length;
    const head = "\n".repeat(newlinesBefore);
    const tail = `module.exports = ${defMatch[1]};` + "\n".repeat(newlinesAfter);
    return text.slice(0, stmt.getStart(sf)) + head + rest + tail + text.slice(stmt.getEnd());
  }
  return null;
}

/** INLINE require()s: `require('./x').f`, `const g = require('./x')(opts)`,
 * `y = require('./x')` -- a require that is not itself the whole initializer of
 * a declaration. Node evaluates it at that point; the lowering models a
 * require as a BINDING whose module %init runs at the declaration. So a
 * require evaluated UNCONDITIONALLY by its statement is bound immediately
 * before that statement (`const __sc_rN = require('./x');`) and the call
 * becomes the binding -- the same load, at the same statement, in the same
 * order. A require under a conditional operator, a loop/branch body, or a
 * nested function is left alone (and never a builtin module: its member-read forms are
 * already modelled by the lowering), as is a statement that cannot take a
 * preceding declaration (an unbraced `if` body). */
const INLINE_REQUIRE_PREFILTER = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/;

const BUILTIN_SPECS = new Set(builtinModules);
function isBuiltinSpec(spec: string): boolean {
  return BUILTIN_SPECS.has(spec.startsWith("node:") ? spec.slice(5) : spec) || spec.startsWith("node:");
}

function inlineRequireEdits(fileName: string, text: string): string | null {
  if (!INLINE_REQUIRE_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const isRequireCall = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" &&
    n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]!) && !isBuiltinSpec(n.arguments[0]!.text) && !n.arguments[0]!.text.endsWith(".json");
  const statementOf = (n: ts.Node): ts.Statement | null => {
    for (let p: ts.Node | undefined = n; p !== undefined; p = p.parent) {
      if (ts.isStatement(p) && (ts.isSourceFile(p.parent) || ts.isBlock(p.parent) || ts.isCaseClause(p.parent) || ts.isDefaultClause(p.parent))) return p;
    }
    return null;
  };
  let counter = 0;
  const hoisted = new Map<ts.Statement, string[]>();
  const visit = (n: ts.Node): void => {
    if (isRequireCall(n)) {
      const stmt = statementOf(n);
      if (stmt !== null) {
        // Skip the whole-initializer declaration form: the lowering already
        // takes `const x = require(lit)` / `const {..} = require(lit)`, and the bare
        // `require(lit);` statement (a load for effects binds nothing).
        const parent = n.parent;
        const wholeInit = (ts.isVariableDeclaration(parent) && parent.initializer === n) || ts.isExpressionStatement(parent);
        // Walk the chain from the call up to the statement: any conditional
        // operator, loop/branch statement or function boundary on it disqualifies.
        let ok = !wholeInit;
        for (let p: ts.Node = n.parent; ok && p !== stmt; p = p.parent) {
          if (
            ts.isConditionalExpression(p) || ts.isFunctionLike(p) || ts.isClassLike(p) ||
            ts.isIterationStatement(p, false) || ts.isIfStatement(p) || ts.isSwitchStatement(p) ||
            ts.isTryStatement(p) || (ts.isBinaryExpression(p) &&
              (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
               p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
               p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) && p.right !== undefined && n.getStart(sf) >= p.right.getStart(sf)) ||
            ts.isOptionalChain(p)
          ) {
            ok = false;
          }
        }
        // A statement that assigns an export (`module.exports = require('./x')`,
        // `exports.y = require('./y')`) is the re-export form the export
        // machinery models itself.
        if (
          ok && ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) &&
          stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          /^(?:module\.)?exports\b/.test(stmt.expression.left.getText(sf))
        ) {
          ok = false;
        }
        if (ok && (ts.isExpressionStatement(stmt) || ts.isVariableStatement(stmt) || ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt))) {
          const name = `__sc_r${counter++}`;
          const lits = hoisted.get(stmt) ?? [];
          lits.push(`const ${name} = ${n.getText(sf)};`);
          hoisted.set(stmt, lits);
          edits.push({ start: n.getStart(sf), end: n.getEnd(), text: name });
          return;
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  for (const [stmt, decls] of hoisted) {
    edits.push({ start: stmt.getStart(sf), end: stmt.getStart(sf), text: decls.join(" ") + " " });
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

/* STATIC EXPANDOS ASSIGNED RIGHT AFTER THE CLASS. `tsc` below ES2022 spells
 * `static X = e` as a statement after the class,
 *
 *     class Command { ... }
 *     Command.FLAGS = { ... };
 *     Command._transformer = { ... };
 *
 * which defines the same own static properties, in the same order, with
 * nothing able to run between the class definition and them (the statements
 * are consecutive). The static field form is what the lowering models, so the
 * contiguous run of `C.name = expr;` statements directly after the class
 * declaration moves into its body. Only a plain identifier name that the class
 * does not already declare, and only the contiguous run: the first statement
 * that is anything else ends it, so no other code is reordered around a moved
 * initializer. */
function staticExpandoEdits(fileName: string, text: string): string | null {
  if (!/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*=[^=]/m.test(text) || !/\bclass\s+[A-Za-z_$]/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const stmts = sf.statements;
  for (let i = 0; i < stmts.length; i++) {
    const cls = stmts[i]!;
    if (!ts.isClassDeclaration(cls) || cls.name === undefined) continue;
    const cname = cls.name.text;
    const declared = new Set<string>();
    for (const m of cls.members) {
      if (m.name !== undefined && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) declared.add(m.name.text);
    }
    const moved: string[] = [];
    let last: ts.Statement | null = null;
    for (let j = i + 1; j < stmts.length; j++) {
      const st = stmts[j]!;
      if (!ts.isExpressionStatement(st)) break;
      const e = st.expression;
      if (
        !ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(e.left) ||
        !ts.isIdentifier(e.left.expression) || e.left.expression.text !== cname || !ts.isIdentifier(e.left.name)
      ) {
        break;
      }
      const name = e.left.name.text;
      if (declared.has(name) || name === "prototype" || name === "name" || name === "length") break;
      declared.add(name);
      moved.push(`static ${name} = ${e.right.getText(sf)};`);
      last = st;
    }
    if (last === null) continue;
    const closing = cls.getEnd() - 1;
    if (text[closing] !== "}") continue;
    edits.push({ start: closing, end: closing, text: ` ${moved.join(" ")} ` });
    edits.push({ start: cls.getEnd(), end: last.getEnd(), text: "" });
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

/* CHAINED PROPERTY ASSIGNMENT AS A STATEMENT. The CommonJS idiom
 *
 *     var matcher = module.exports.match = function (a, b) { ... };
 *     a.b = c.d = e;   x = c.d = e;
 *
 * assigns a property and yields the stored value in one expression. The two
 * statements `P = e; var matcher = P;` do the same thing in the same order
 * (the right-hand side is evaluated once, the property is written, the
 * outer target takes the stored value), and keep the anonymous function
 * anonymous the way a property assignment does. Only a PLAIN property path
 * (identifiers, `this`, dotted names) is re-read, so the re-read has no
 * effect of its own, and only as a whole statement, so nothing else can sit
 * between the write and the read. */
function isPlainPropertyPath(e: ts.Expression): boolean {
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(e) && !e.questionDotToken && ts.isIdentifier(e.name) && isPlainPropertyPath(e.expression);
}

function chainedPropertyAssignEdits(fileName: string, text: string): string | null {
  if (!/\.\s*[\w$]+\s*=(?!=)[^;]*=(?!=)/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const isEq = (e: ts.Expression): e is ts.BinaryExpression =>
    ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  const visit = (n: ts.Node): void => {
    if (ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      for (const st of n.statements) {
        if (ts.isVariableStatement(st)) {
          const decls = st.declarationList.declarations;
          if (decls.length !== 1) continue;
          const d = decls[0]!;
          if (!ts.isIdentifier(d.name) || d.initializer === undefined || !isEq(d.initializer)) continue;
          const inner = d.initializer;
          if (!ts.isPropertyAccessExpression(inner.left) || !isPlainPropertyPath(inner.left)) continue;
          const flags = st.declarationList.flags;
          const kw = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
          const path = inner.left.getText(sf);
          edits.push({
            start: st.getStart(sf),
            end: st.getEnd(),
            text: `${path} = ${inner.right.getText(sf)}; ${kw} ${d.name.text} = ${path};`,
          });
        } else if (ts.isExpressionStatement(st) && isEq(st.expression) && isEq(st.expression.right)) {
          const outer = st.expression;
          const inner = outer.right as ts.BinaryExpression;
          if (!ts.isPropertyAccessExpression(inner.left) || !isPlainPropertyPath(inner.left)) continue;
          if (!isPlainPropertyPath(outer.left)) continue;
          const path = inner.left.getText(sf);
          edits.push({
            start: st.getStart(sf),
            end: st.getEnd(),
            text: `${path} = ${inner.right.getText(sf)}; ${outer.left.getText(sf)} = ${path};`,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    if (ed.start < at) continue;
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

/* AN OWN PROPERTY THAT SHADOWS A METHOD WITH ANOTHER METHOD OF THE SAME CLASS.
 * pg's Result picks its row parser per instance:
 *
 *     class Result {
 *       constructor(rowMode) { if (rowMode === 'array') this.parseRow = this._parseRowAsArray }
 *       _parseRowAsArray(rowData) { ... }
 *       parseRow(rowData) { ... }
 *     }
 *
 * The write defines an own `parseRow` on that instance, and every
 * `this.parseRow(row)` then runs the other method with the same receiver. The
 * class is closed over its own members, so the choice is a per-instance state:
 * a PRIVATE flag (invisible to keys, inspection and JSON, which the own
 * property is not, see the divergence note in SEMANTICS) records the write,
 * and the shadowed method forwards to its replacement while the flag is set.
 * Only `this.M = this.K` where M and K are both instance methods of this
 * class declared with plain identifier parameters, K taking no more than M,
 * is rewritten; any other right-hand side keeps the refusal. */
function methodShadowEdits(fileName: string, text: string): string | null {
  if (!/this\.[\w$]+\s*=\s*this\.[\w$]+\s*;?/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const plainParams = (m: ts.MethodDeclaration): string[] | null => {
    const out: string[] = [];
    for (const p of m.parameters) {
      if (!ts.isIdentifier(p.name) || p.dotDotDotToken !== undefined || p.initializer !== undefined) return null;
      out.push(p.name.text);
    }
    return out;
  };
  const visitClass = (cls: ts.ClassDeclaration | ts.ClassExpression): void => {
    const methods = new Map<string, ts.MethodDeclaration>();
    for (const m of cls.members) {
      if (
        ts.isMethodDeclaration(m) && m.body !== undefined && ts.isIdentifier(m.name) && m.asteriskToken === undefined &&
        !m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword || mod.kind === ts.SyntaxKind.AsyncKeyword)
      ) {
        methods.set(m.name.text, m);
      }
    }
    const shadowed = new Map<string, string>();
    const stmts: Array<{ st: ts.ExpressionStatement; m: string }> = [];
    const walk = (n: ts.Node): void => {
      if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isClassLike(n)) return;
      if (ts.isExpressionStatement(n) && ts.isBinaryExpression(n.expression) && n.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const { left, right } = n.expression;
        if (
          ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(left.name) &&
          ts.isPropertyAccessExpression(right) && right.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(right.name)
        ) {
          const m = left.name.text;
          const k = right.name.text;
          const mm = methods.get(m);
          const km = methods.get(k);
          const mp = mm && plainParams(mm);
          const kp = km && plainParams(km);
          if (mm && km && m !== k && mp && kp && kp.length <= mp.length && (shadowed.get(m) ?? k) === k) {
            shadowed.set(m, k);
            stmts.push({ st: n, m });
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    for (const m of methods.values()) walk(m.body!);
    for (const c of cls.members) if (ts.isConstructorDeclaration(c) && c.body !== undefined) walk(c.body);
    if (stmts.length === 0) return;
    // A replacement that is itself shadowed would chain; keep to the flat case.
    for (const k of shadowed.values()) if (shadowed.has(k)) return;
    const heritageEnd = cls.heritageClauses?.length ? cls.heritageClauses[cls.heritageClauses.length - 1]!.getEnd() : -1;
    const bodyOpen = text.indexOf("{", Math.max(heritageEnd, cls.name !== undefined ? cls.name.getEnd() : cls.getStart(sf)));
    const fields = [...shadowed.keys()].map((m) => `#__sc_own_${m} = false;`).join(" ");
    edits.push({ start: bodyOpen + 1, end: bodyOpen + 1, text: ` ${fields} ` });
    for (const { st, m } of stmts) edits.push({ start: st.getStart(sf), end: st.getEnd(), text: `this.#__sc_own_${m} = true;` });
    for (const [m, k] of shadowed) {
      const mm = methods.get(m)!;
      const args = plainParams(mm)!.slice(0, plainParams(methods.get(k)!)!.length).join(", ");
      const at = mm.body!.getStart(sf) + 1;
      edits.push({ start: at, end: at, text: ` if (this.#__sc_own_${m}) { return this.${k}(${args}); } ` });
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) visitClass(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    if (ed.start < at) continue;
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

/* AN OPEN RECORD: AN OBJECT LITERAL THAT IS THE TARGET OF DYNAMIC-KEY WRITES.
 * A literal is a record: its keys are the fields it was written with. A program
 * that builds a map out of one
 *
 *     var obj = {};
 *     obj[fieldNames[idx]] = field;                      // pgpass, helper.js
 *
 *     keys.reduce(function (parsed, property) {          // postgres-interval
 *       parsed[property] = value; return parsed;
 *     }, {})
 *
 * adds keys the literal never named, so the record has nowhere to put them. The
 * object is the checked-dynamic object, which the language already models (a
 * `/** @type {any} *\/` literal builds one), and the decision is made PER
 * BINDING by scanning that binding's writes: a literal bound by `name = {…}`
 * becomes dynamic when anything in the binding's scope writes (assigns,
 * compound-assigns, increments or deletes) `name[<expression>]` with a key that
 * is not a string or number literal; a literal passed as the initial value of
 * `.reduce(callback, {…})` becomes dynamic when the inline callback writes
 * `accumulator[<expression>]` the same way. Every other literal keeps its record
 * shape. The text handed to the checker spells the cast, so every downstream
 * type (the reduce result, the function that returns the accumulator) is
 * `any` from the checker's own answer, not patched afterwards. */
const OPEN_RECORD_PREFILTER = /\]\s*(?:=(?!=)|[-+*\/%|&^]=|\+\+|--|\|\|=|&&=|\?\?=|<<=|>>>?=)/;
const ASSIGN_OPS = new Set<number>([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

function dynamicKeyAccessOf(e: ts.Expression, name: string): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isElementAccessExpression(e) || !ts.isIdentifier(e.expression) || e.expression.text !== name) return false;
  const k = e.argumentExpression;
  return !(ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) || ts.isNumericLiteral(k));
}

function writesDynamicKey(region: ts.Node, name: string): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBinaryExpression(n) && ASSIGN_OPS.has(n.operatorToken.kind) && dynamicKeyAccessOf(n.left, name)) {
      found = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) &&
      dynamicKeyAccessOf(n.operand, name)
    ) {
      found = true;
      return;
    }
    if (ts.isDeleteExpression(n) && dynamicKeyAccessOf(n.expression, name)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(region);
  return found;
}

function openRecordEdits(fileName: string, text: string): string | null {
  if (!text.includes("{}") && !/=\s*\{/.test(text)) return null;
  if (!OPEN_RECORD_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const marked = new Set<ts.Node>();
  const cast = (lit: ts.ObjectLiteralExpression): void => {
    if (marked.has(lit)) return;
    // Already typed by the author: `/** @type {...} */ ({...})`.
    const lead = text.slice(Math.max(0, lit.getFullStart() - 80), lit.getStart(sf));
    if (/@type\b/.test(lead)) return;
    marked.add(lit);
    edits.push({ start: lit.getStart(sf), end: lit.getStart(sf), text: "/** @type {any} */ (" });
    edits.push({ start: lit.getEnd(), end: lit.getEnd(), text: ")" });
  };
  const scopeOf = (n: ts.Node): ts.Node => {
    for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
      if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return p;
    }
    return sf;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
      let init: ts.Expression = n.initializer;
      while (ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init) && n.initializer === init && writesDynamicKey(scopeOf(n), n.name.text)) cast(init);
    }
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "reduce" || n.expression.name.text === "reduceRight") && n.arguments.length === 2
    ) {
      const cb = n.arguments[0]!;
      const seed = n.arguments[1]!;
      if (
        (ts.isFunctionExpression(cb) || ts.isArrowFunction(cb)) && ts.isObjectLiteralExpression(seed) &&
        cb.parameters.length > 0 && ts.isIdentifier(cb.parameters[0]!.name) && cb.body !== undefined &&
        writesDynamicKey(cb.body, (cb.parameters[0]!.name as ts.Identifier).text)
      ) {
        cast(seed);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    if (ed.start < at) continue;
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

export function jsDesugar(fileName: string, text: string): string | null {
  if (!/\.(?:c?js)$/.test(fileName) || fileName.endsWith(".d.ts")) return null;
  {
    const unwrapped = umdUnwrap(fileName, text);
    if (unwrapped !== null) return jsDesugar(fileName, unwrapped) ?? unwrapped;
  }
  {
    const shadow = methodShadowEdits(fileName, text);
    if (shadow !== null) return jsDesugar(fileName, shadow) ?? shadow;
  }
  {
    const open = openRecordEdits(fileName, text);
    if (open !== null) return jsDesugar(fileName, open) ?? open;
  }
  {
    const chained = chainedPropertyAssignEdits(fileName, text);
    if (chained !== null) return jsDesugar(fileName, chained) ?? chained;
  }
  {
    const expando = staticExpandoEdits(fileName, text);
    if (expando !== null) return jsDesugar(fileName, expando) ?? expando;
  }
  {
    const inlined = inlineRequireEdits(fileName, text);
    if (inlined !== null) return jsDesugar(fileName, inlined) ?? inlined;
  }
  if (/\bprocess\.getBuiltinModule\(/.test(text)) {
    const out = text.replace(GET_BUILTIN_MODULE, "require($1$2$1)");
    if (out !== text) return jsDesugar(fileName, out) ?? out;
  }
  if (/require\(\s*['"](?:node:)?process['"]\s*\)/.test(text)) {
    const out = text.replace(PROCESS_MODULE_DECL, "$1;").replace(PROCESS_MODULE_USE, "process");
    return jsDesugar(fileName, out) ?? out;
  }
  if (SPECIES_SPELLING.test(text)) {
    SPECIES_SPELLING.lastIndex = 0;
    const out = text.replace(SPECIES_SPELLING, `Buffer${SPECIES_MARKER}`);
    return jsDesugar(fileName, out) ?? out;
  }
  SPECIES_SPELLING.lastIndex = 0;
  if (!NESTED_REQUIRE_PREFILTER.test(text)) return null;
  if (!/\{[^{}]*:\s*\{/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) continue;
    const d = decls[0]!;
    if (!ts.isObjectBindingPattern(d.name) || d.initializer === undefined) continue;
    let init: ts.Expression = d.initializer;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    if (
      !ts.isCallExpression(init) ||
      !ts.isIdentifier(init.expression) ||
      init.expression.text !== "require" ||
      init.arguments.length !== 1 ||
      !ts.isStringLiteral(init.arguments[0]!)
    ) {
      continue;
    }
    if (!hasNested(d.name) || !isPlainPattern(d.name)) continue;
    const flags = stmt.declarationList.flags;
    const kw = (flags & ts.NodeFlags.Const) !== 0 ? "const" : (flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
    const extras: string[] = [];
    const outer = flatten(d.name, sf, kw, extras);
    const original = stmt.getText(sf);
    const newlines = (original.match(/\n/g) ?? []).length;
    const head = `${kw} ${outer} = ${init.getText(sf)};`;
    edits.push({
      start: stmt.getStart(sf),
      end: stmt.getEnd(),
      text: `${head} ${extras.join(" ")}${"\n".repeat(newlines)}`,
    });
  }
  if (edits.length === 0) return null;
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}
