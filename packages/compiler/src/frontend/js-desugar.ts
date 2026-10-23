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
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { cjsLexerVisibleNames } from "./cjs-lexer.js";

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
  // A file that declares its own `require` (a parameter, a variable, a
  // function, a destructured name) calls a LOCAL function at some of these
  // sites, and a hoisted `const x = require('lit')` would be read as the
  // module global. Syntax alone cannot say which sites are which, so such a
  // file is left untouched.
  {
    let shadowed = false;
    const find = (n: ts.Node): void => {
      if (shadowed) return;
      if (
        (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) ||
          ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) &&
        n.name !== undefined && ts.isIdentifier(n.name) && n.name.text === "require"
      ) {
        shadowed = true;
        return;
      }
      n.forEachChild(find);
    };
    find(sf);
    if (shadowed) return null;
  }
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

/* TYPESCRIPT-EMITTED COMMONJS. `tsc --module commonjs` spells a module's
 * export surface with four idioms the export-table lowering does not model
 * as written but models exactly in their plain spelling:
 *
 *   exports.a = exports.b = void 0;                   (the hoisted prologue)
 *   Object.defineProperty(exports, "n", { enumerable: true, get: function () { return B.m; } });
 *                                                      (`export { m as n } from`)
 *   __exportStar(require("./x"), exports);             (`export * from`)
 *   var __createBinding = (this && this.__createBinding) || ...;  (its helpers)
 *
 * The prologue is the same statements one per name, in the order the chain
 * evaluates them (right to left). The re-export getter is `exports.n = B.m`
 * (the member read the getter performs, bound at the require the getter's
 * target already loaded). `__exportStar` copies, for every name the target
 * module exports that is not already an own export here, the same binding;
 * the names are the target's Node-lexer-visible export set, which for a
 * module tsc emitted is all of them. The helper declarations are then dead
 * and are removed only when nothing else reads them. Newlines are kept so no
 * line moves. Top-level statements only. */
const TS_CJS_PREFILTER = /Object\.defineProperty\(\s*exports|__exportStar|=\s*exports\.\w+\s*=|exports\.\w+\s*=\s*exports\.\w+\s*=/;

function isExportsMember(n: ts.Node): n is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "exports" && ts.isIdentifier(n.name);
}

function resolveRelativeJs(fromFile: string, spec: string): string | null {
  const base = join(dirname(fromFile), spec);
  for (const c of [base, `${base}.js`, `${base}.cjs`, join(base, "index.js")]) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* unreadable candidate */
    }
  }
  return null;
}

function tsCjsEdits(fileName: string, text: string): string | null {
  if (!TS_CJS_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const nlOf = (n: ts.Node): string => "\n".repeat((n.getText(sf).match(/\n/g) ?? []).length);
  // Top-level `const|var|let B = require("lit")` bindings.
  const requireBindings = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      const init = d.initializer;
      if (
        ts.isIdentifier(d.name) && init !== undefined && ts.isCallExpression(init) && ts.isIdentifier(init.expression) &&
        init.expression.text === "require" && init.arguments.length === 1 && ts.isStringLiteral(init.arguments[0]!)
      ) {
        requireBindings.add(d.name.text);
      }
    }
  }
  const ownBefore = new Set<string>();
  const noteOwn = (stmt: ts.Statement): void => {
    if (!ts.isExpressionStatement(stmt)) return;
    for (let e: ts.Expression = stmt.expression; ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken; e = e.right) {
      if (isExportsMember(e.left)) ownBefore.add(e.left.name.text);
    }
  };
  const starUses: ts.Statement[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const e = stmt.expression;
    // (a) the chained prologue
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken && isExportsMember(e.left)) {
      const names: string[] = [];
      let cur: ts.Expression = e;
      while (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.EqualsToken && isExportsMember(cur.left)) {
        names.push(cur.left.name.text);
        cur = cur.right;
      }
      if (names.length > 1 && ts.isVoidExpression(cur) && ts.isNumericLiteral(cur.expression) && cur.expression.text === "0") {
        edits.push({
          start: stmt.getStart(sf),
          end: stmt.getEnd(),
          text: names.reverse().map((n) => `exports.${n} = void 0;`).join(" ") + nlOf(stmt),
        });
        for (const n of names) ownBefore.add(n);
        continue;
      }
    }
    // (b) the re-export getter
    if (
      ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) &&
      e.expression.expression.text === "Object" && e.expression.name.text === "defineProperty" && e.arguments.length === 3 &&
      ts.isIdentifier(e.arguments[0]!) && (e.arguments[0] as ts.Identifier).text === "exports" && ts.isStringLiteral(e.arguments[1]!) &&
      ts.isObjectLiteralExpression(e.arguments[2]!)
    ) {
      const name = (e.arguments[1] as ts.StringLiteral).text;
      const props = (e.arguments[2] as ts.ObjectLiteralExpression).properties;
      let enumerable = false;
      let getter: ts.Expression | null = null;
      let other = false;
      for (const p of props) {
        const key = p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        if (key === "enumerable" && ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.TrueKeyword) enumerable = true;
        else if (key === "get" && ts.isPropertyAssignment(p)) getter = p.initializer;
        else if (key === "get" && ts.isMethodDeclaration(p)) getter = p as unknown as ts.Expression;
        else other = true;
      }
      if (enumerable && !other && getter !== null && /^[A-Za-z_$][\w$]*$/.test(name)) {
        const fn = getter as unknown as ts.FunctionExpression | ts.MethodDeclaration;
        const body = ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn) ? fn.body : undefined;
        if (
          body !== undefined && ts.isBlock(body) && body.statements.length === 1 && ts.isReturnStatement(body.statements[0]!) &&
          fn.parameters.length === 0
        ) {
          const ret = (body.statements[0] as ts.ReturnStatement).expression;
          if (
            ret !== undefined && ts.isPropertyAccessExpression(ret) && ts.isIdentifier(ret.expression) &&
            requireBindings.has(ret.expression.text)
          ) {
            edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: `exports.${name} = ${ret.getText(sf)};${nlOf(stmt)}` });
            ownBefore.add(name);
            continue;
          }
        }
      }
    }
    // (c) export *
    if (
      ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "__exportStar" && e.arguments.length === 2 &&
      ts.isCallExpression(e.arguments[0]!) && ts.isIdentifier((e.arguments[0] as ts.CallExpression).expression) &&
      ((e.arguments[0] as ts.CallExpression).expression as ts.Identifier).text === "require" &&
      (e.arguments[0] as ts.CallExpression).arguments.length === 1 &&
      ts.isStringLiteral((e.arguments[0] as ts.CallExpression).arguments[0]!) && ts.isIdentifier(e.arguments[1]!) &&
      (e.arguments[1] as ts.Identifier).text === "exports"
    ) {
      const spec = ((e.arguments[0] as ts.CallExpression).arguments[0] as ts.StringLiteral).text;
      if (spec.startsWith(".")) {
        const target = resolveRelativeJs(fileName, spec);
        if (target !== null) {
          let names: string[] | null = null;
          try {
            const memo = new Map<string, Set<string>>();
            const visible = cjsLexerVisibleNames(
              target,
              (f) => readFileSync(f, "utf8"),
              (from, sp) => (sp.startsWith(".") ? resolveRelativeJs(from, sp) : null),
              memo,
            );
            names = [...visible].filter((n) => n !== "default" && n !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(n));
          } catch {
            names = null;
          }
          if (names !== null) {
            const tmp = `__sc_es${stmt.getStart(sf)}`;
            const own = new Set(ownBefore);
            const copies = names.filter((n) => !own.has(n)).map((n) => `exports.${n} = ${tmp}.${n};`);
            edits.push({
              start: stmt.getStart(sf),
              end: stmt.getEnd(),
              text: `const ${tmp} = require(${JSON.stringify(spec)}); ${copies.join(" ")}${nlOf(stmt)}`,
            });
            for (const n of names) ownBefore.add(n);
            starUses.push(stmt);
            continue;
          }
        }
      }
    }
    noteOwn(stmt);
  }
  if (edits.length === 0) return null;
  // Dead helpers: `var __createBinding|__exportStar = (this && this.__X) || ...;`
  if (starUses.length > 0) {
    const handled = new Set<ts.Node>(starUses);
    const stray = (name: string): boolean => {
      let found = false;
      const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isIdentifier(n) && n.text === name) {
          for (let p: ts.Node | undefined = n; p !== undefined; p = p.parent) {
            if (handled.has(p)) return;
            if (ts.isVariableStatement(p) && p.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && (d.name.text === "__createBinding" || d.name.text === "__exportStar") && ts.isSourceFile(p.parent))) return;
          }
          found = true;
          return;
        }
        n.forEachChild(visit);
      };
      visit(sf);
      return found;
    };
    if (!stray("__exportStar") && !stray("__createBinding")) {
      for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt) || stmt.declarationList.declarations.length !== 1) continue;
        const d = stmt.declarationList.declarations[0]!;
        if (!ts.isIdentifier(d.name) || (d.name.text !== "__createBinding" && d.name.text !== "__exportStar")) continue;
        if (d.initializer === undefined || !d.initializer.getText(sf).startsWith(`(this && this.${d.name.text})`)) continue;
        edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: nlOf(stmt) });
      }
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
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

/* ENVIRONMENT-PROBE BRANCHES. A module that picks its implementation by
 * asking whether it runs in a browser or an Electron renderer,
 *
 *     if (typeof process === 'undefined' || process.type === 'renderer' ||
 *         process.browser === true || process.__nwjs) {
 *       module.exports = require('./browser.js');
 *     } else {
 *       module.exports = require('./node.js');
 *     }
 *
 * asks four questions whose answers are fixed for a compiled binary: the
 * `process` global exists, and `process.type`, `process.browser` and
 * `process.__nwjs` are undefined in Node (Electron and NW.js define them;
 * a compiled binary is neither). So the test is false and the else branch is
 * the module. A TOP-LEVEL `if` whose condition is a disjunction of exactly
 * these probes is replaced by its else branch (nothing when there is none),
 * which also removes the browser-only module from the program: it would never
 * be loaded. Any other operand in the condition leaves the statement alone. */
const ENV_PROBE_PREFILTER = /process\.(?:type|browser|__nwjs)/;

function isNodeFalseProbe(e: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  const procMember = (n: ts.Expression, member: string): boolean =>
    ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "process" && n.name.text === member;
  if (procMember(e, "__nwjs")) return true;
  if (!ts.isBinaryExpression(e)) return false;
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    if (ts.isTypeOfExpression(e.left) && ts.isIdentifier(e.left.expression) && e.left.expression.text === "process") {
      return ts.isStringLiteral(e.right) && e.right.text === "undefined";
    }
    if (procMember(e.left, "type")) return ts.isStringLiteral(e.right) && e.right.text === "renderer";
    if (procMember(e.left, "browser")) return e.right.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

function envProbeBranchEdits(fileName: string, text: string): string | null {
  if (!ENV_PROBE_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isIfStatement(stmt)) continue;
    const operands: ts.Expression[] = [];
    const collect = (e: ts.Expression): void => {
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        collect(e.left);
        collect(e.right);
      } else {
        operands.push(e);
      }
    };
    collect(stmt.expression);
    if (!operands.every(isNodeFalseProbe)) continue;
    const keep = stmt.elseStatement;
    const original = stmt.getText(sf);
    const nl = (original.match(/\n/g) ?? []).length;
    let body = "";
    if (keep !== undefined) {
      const inner = ts.isBlock(keep) ? keep.statements.map((st) => st.getText(sf)).join(" ") : keep.getText(sf);
      body = inner;
    }
    const kept = keep === undefined ? 0 : (body.match(/\n/g) ?? []).length;
    edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: body + "\n".repeat(Math.max(0, nl - kept)) });
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

/* TYPESCRIPT HELPER DECLARATIONS. Every helper `tsc` emits into a CommonJS
 * file (`__classPrivateFieldGet`, `__awaiter`, `__rest`, `__extends`, ...) is
 * declared as
 *
 *     var __helper = (this && this.__helper) || function (...) { ... };
 *
 * so a file that is inlined into another bundle reuses the bundle's copy. At a
 * module's top level `this` is the module's own `exports` object (ESM: undefined),
 * and no module assigns a `__`-named member of it, so the left operand is
 * always falsy and the binding is the function expression. The lowering needs
 * the binding to BE a function declaration form: a read of the `||` value from
 * inside a function (a class constructor calling `__classPrivateFieldSet`) has
 * no static callee. Only a top-level single-declarator `var`, only a `__`
 * prefixed name that spells the idiom exactly, and only when the file never
 * assigns that name as a member of `exports`/`this`/`module.exports`. */
const TS_HELPER_PREFILTER = /\(this\s*&&\s*this\.__\w+\)\s*\|\|/;

function tsHelperVarEdits(fileName: string, text: string): string | null {
  if (!TS_HELPER_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || stmt.declarationList.declarations.length !== 1) continue;
    const d = stmt.declarationList.declarations[0]!;
    if (!ts.isIdentifier(d.name) || !d.name.text.startsWith("__") || d.initializer === undefined) continue;
    const init = d.initializer;
    if (!ts.isBinaryExpression(init) || init.operatorToken.kind !== ts.SyntaxKind.BarBarToken) continue;
    if (!ts.isFunctionExpression(init.right)) continue;
    let left: ts.Expression = init.left;
    while (ts.isParenthesizedExpression(left)) left = left.expression;
    if (!ts.isBinaryExpression(left) || left.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) continue;
    if (left.left.kind !== ts.SyntaxKind.ThisKeyword) continue;
    if (!ts.isPropertyAccessExpression(left.right) || left.right.expression.kind !== ts.SyntaxKind.ThisKeyword) continue;
    if (left.right.name.text !== d.name.text) continue;
    // The member is never written anywhere in the file.
    const name = d.name.text;
    let written = false;
    const visit = (n: ts.Node): void => {
      if (written) return;
      if (
        ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) &&
        n.left.name.text === name
      ) {
        written = true;
        return;
      }
      n.forEachChild(visit);
    };
    visit(sf);
    if (written) continue;
    edits.push({ start: init.getStart(sf), end: init.right.getStart(sf), text: "" });
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

/* FIELDS INITIALIZED TO UNDEFINED. A class field declared `next = undefined;`
 * (or `void 0`, the spelling tsc and Babel emit for a bare `#x;`) defines the
 * same own property as the bare declaration `next;`: both [[Define]] it as
 * undefined at the field's position. They are NOT the same to the type
 * checker: the initializer pins the field's type to `undefined`, a type with
 * no representation, while a bare declaration in a JavaScript file is typed
 * by what the class assigns to it (`this.next = fn` elsewhere), exactly like
 * the constructor-assigned form. Only an INSTANCE field with no type annotation
 * (the JavaScript spelling), private or not: an initializer-less STATIC field has
 * no lowering, so a static one keeps its spelling. */
function undefinedFieldEdits(fileName: string, text: string): string | null {
  if (!/=\s*(?:undefined|void\s+0)\s*[;\n}]/.test(text) || !/\bclass\b/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyDeclaration(n) && n.type === undefined && n.initializer !== undefined && !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
      let init: ts.Expression = n.initializer;
      while (ts.isParenthesizedExpression(init)) init = init.expression;
      const isUndef =
        (ts.isIdentifier(init) && init.text === "undefined") ||
        (ts.isVoidExpression(init) && ts.isNumericLiteral(init.expression) && init.expression.text === "0");
      if (isUndef && n.name !== undefined) {
        edits.push({ start: n.name.getEnd(), end: n.initializer.getEnd(), text: "" });
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const ed of edits) {
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
    const tsCjs = tsCjsEdits(fileName, text);
    if (tsCjs !== null) return jsDesugar(fileName, tsCjs) ?? tsCjs;
  }
  {
    const undef = undefinedFieldEdits(fileName, text);
    if (undef !== null) return jsDesugar(fileName, undef) ?? undef;
  }
  {
    const helpers = tsHelperVarEdits(fileName, text);
    if (helpers !== null) return jsDesugar(fileName, helpers) ?? helpers;
  }
  {
    const probes = envProbeBranchEdits(fileName, text);
    if (probes !== null) return jsDesugar(fileName, probes) ?? probes;
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
