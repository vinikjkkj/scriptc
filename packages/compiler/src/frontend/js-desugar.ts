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

/* TYPESCRIPT-DOWNLEVELED PRIVATE MEMBERS. `tsc` below ES2022 spells a class's
 * `#private` members as module-level state plus two helpers:
 *
 *     var _C_instances, _a, _C_count, _C_step;            (the state names)
 *     class C {
 *       constructor() { _C_instances.add(this); _C_count.set(this, 0); }
 *       m() { __classPrivateFieldSet(this, _C_count, __classPrivateFieldGet(this, _C_count, "f") + 1, "f");
 *             return __classPrivateFieldGet(this, _C_instances, "m", _C_step).call(this, 1); }
 *     }
 *     _a = C, _C_count = new WeakMap(), _C_instances = new WeakSet(),
 *       _C_step = function _C_step(x) { ... };           (the registrations)
 *     _C_LIMIT = { value: 10 };                            (a static private field)
 *
 * which is exactly the native class with `#count = 0`, `#step(x) {...}` and
 * `static #LIMIT = 10`: the private fields are WeakMap-keyed slots that the
 * constructor fills in field order, a read/write is a keyed get/set that
 * throws on a non-instance, and a private method is a function the helper
 * hands back. The native spelling is typed (a field is a slot, a private
 * method a direct call), where the downlevel form routes every access
 * through an untyped helper. The rewrite is exact for the shapes tsc emits
 * and is refused (the file is left as written) for anything else: a
 * receiver other than `this` (or the static alias), an accessor, a state
 * name used any other way, a leading constructor run that is not purely
 * private initializers, or an initializer that mentions `this` or a
 * constructor parameter. Method bodies move into the class, so lines after
 * the class shift. */
const PRIVATE_HELPERS = /__classPrivateField(?:Get|Set)\(/;

function privateMemberEdits(fileName: string, text: string): string | null {
  if (!PRIVATE_HELPERS.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const stmts = sf.statements;
  // 1. The helper declarations (the tsc idiom, possibly already without its `this` guard).
  const helperDecls: ts.VariableStatement[] = [];
  for (const st of stmts) {
    if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) continue;
    const d = st.declarationList.declarations[0]!;
    if (ts.isIdentifier(d.name) && (d.name.text === "__classPrivateFieldGet" || d.name.text === "__classPrivateFieldSet")) {
      helperDecls.push(st);
    }
  }
  if (helperDecls.length === 0) return null;
  // 2. The classes and their registrations. State var lists: `var a, b, c;` with no initializers.
  const stateNames = new Set<string>();
  const stateDecls: ts.VariableStatement[] = [];
  for (const st of stmts) {
    if (!ts.isVariableStatement(st) || helperDecls.includes(st)) continue;
    const decls = st.declarationList.declarations;
    if (decls.every((d) => ts.isIdentifier(d.name) && d.initializer === undefined && /^_(?:[A-Za-z$]\w*_\w+|[a-z])$/.test(d.name.text))) {
      if (!decls.some((d) => ts.isIdentifier(d.name) && /^_[A-Za-z$]\w*_\w+$/.test(d.name.text))) continue;
      stateDecls.push(st);
      for (const d of decls) stateNames.add((d.name as ts.Identifier).text);
    }
  }
  if (stateDecls.length === 0) return null;
  const bail = (): null => null;
  // Registration statements: top-level expression statements that are comma chains of `NAME = expr` over state names / alias.
  type Reg = { kind: "alias"; name: string; cls: string } | { kind: "weakmap"; name: string } | { kind: "weakset"; name: string } | { kind: "method"; name: string; fn: ts.FunctionExpression } | { kind: "static"; name: string; init: ts.Expression };
  const regs: Reg[] = [];
  const regStmts: ts.Statement[] = [];
  const flattenComma = (e: ts.Expression, out: ts.Expression[]): void => {
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      flattenComma(e.left, out);
      flattenComma(e.right, out);
    } else out.push(e);
  };
  const classNames = new Set<string>();
  for (const st of stmts) if (ts.isClassDeclaration(st) && st.name) classNames.add(st.name.text);
  for (const st of stmts) {
    if (!ts.isExpressionStatement(st)) continue;
    const parts: ts.Expression[] = [];
    flattenComma(st.expression, parts);
    const mine: Reg[] = [];
    let ok = true;
    for (const p of parts) {
      if (!ts.isBinaryExpression(p) || p.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(p.left) || !stateNames.has(p.left.text)) {
        ok = false;
        break;
      }
      const name = p.left.text;
      const r = p.right;
      if (ts.isIdentifier(r) && classNames.has(r.text)) mine.push({ kind: "alias", name, cls: r.text });
      else if (ts.isNewExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "WeakMap" && (r.arguments?.length ?? 0) === 0) mine.push({ kind: "weakmap", name });
      else if (ts.isNewExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "WeakSet" && (r.arguments?.length ?? 0) === 0) mine.push({ kind: "weakset", name });
      else if (ts.isFunctionExpression(r) && r.name !== undefined && r.name.text === name) mine.push({ kind: "method", name, fn: r });
      else if (
        ts.isObjectLiteralExpression(r) && r.properties.length === 1 && ts.isPropertyAssignment(r.properties[0]!) &&
        ts.isIdentifier(r.properties[0]!.name) && (r.properties[0]!.name as ts.Identifier).text === "value"
      ) mine.push({ kind: "static", name, init: (r.properties[0] as ts.PropertyAssignment).initializer });
      else {
        ok = false;
        break;
      }
    }
    if (ok && mine.length > 0) {
      regs.push(...mine);
      regStmts.push(st);
    }
  }
  if (regs.length === 0) return bail();
  // Every state name is registered exactly once (aliases `_a` may repeat to different classes: not supported).
  const regByName = new Map<string, Reg>();
  for (const r of regs) {
    if (regByName.has(r.name)) return bail();
    regByName.set(r.name, r);
  }
  const aliasOf = new Map<string, string>(); // `_a` -> class
  const brandSets = new Set<string>();
  for (const r of regs) {
    if (r.kind === "alias") aliasOf.set(r.name, r.cls);
    if (r.kind === "weakset") brandSets.add(r.name);
  }
  // The class a state name belongs to: `_Cls_member`.
  const memberOf = (state: string): { cls: string; member: string } | null => {
    for (const c of classNames) {
      if (state.startsWith(`_${c}_`)) return { cls: c, member: state.slice(c.length + 2) };
    }
    return null;
  };
  for (const n of stateNames) {
    if (aliasOf.has(n)) continue;
    if (!regByName.has(n) && !/^_[a-z]$/.test(n)) return bail();
    if (!/^_[a-z]$/.test(n) && memberOf(n) === null) return bail();
  }
  // 3. Uses. Every identifier occurrence of a state name must be (a) its own registration target, (b) the declaration,
  // (c) an argument of a recognised helper call, or (d) `X.set(this, init)` / `I.add(this)` in a constructor.
  interface Site { node: ts.Node; start: number; end: number; render: () => string }
  const sites: Site[] = [];
  const classBodies = new Map<string, ts.ClassDeclaration>();
  for (const st of stmts) if (ts.isClassDeclaration(st) && st.name) classBodies.set(st.name.text, st);
  const ctorRemovals: { start: number; end: number }[] = [];
  const accessorUse = new Map<string, "get" | "set">();
  const staticMethodNames = new Set<string>();
  const handled = new Set<ts.Node>();
  const privName = (state: string): string => `#${memberOf(state)!.member}`;
  const isThis = (e: ts.Expression): boolean => e.kind === ts.SyntaxKind.ThisKeyword;
  let failed = false;
  const sub = (n: ts.Node): string => applySites(n.getStart(sf), n.getEnd());
  const applySites = (from: number, to: number): string => {
    const inner = sites.filter((s) => s.start >= from && s.end <= to).sort((a, b) => a.start - b.start || b.end - a.end);
    let out = "";
    let at = from;
    for (const s of inner) {
      if (s.start < at) continue; // nested inside an already-emitted site
      out += text.slice(at, s.start) + s.render();
      at = s.end;
    }
    return out + text.slice(at, to);
  };
  const stateArg = (e: ts.Expression | undefined): string | null => (e !== undefined && ts.isIdentifier(e) && stateNames.has(e.text) ? e.text : null);
  const tempAssign = new Set<ts.Node>();
  // A static receiver: the alias identifier itself, `tmp = alias`, or a temp that some assignment `tmp = alias` binds.
  const isAliasRecv = (recv: ts.Expression, aliasState: string): boolean => {
    if (ts.isIdentifier(recv) && recv.text === aliasState) return true;
    if (ts.isBinaryExpression(recv) && recv.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(recv.left) && ts.isIdentifier(recv.right) && recv.right.text === aliasState) return true;
    if (!ts.isIdentifier(recv)) return false;
    let bound = false;
    const find = (x: ts.Node): void => {
      if (bound) return;
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(x.left) && x.left.text === recv.text && ts.isIdentifier(x.right) && x.right.text === aliasState) bound = true;
      else x.forEachChild(find);
    };
    find(sf);
    return bound;
  };
  const visitUses = (n: ts.Node): void => {
    if (failed) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fnName = n.expression.text;
      if (fnName === "__classPrivateFieldGet" || fnName === "__classPrivateFieldSet") {
        const isGet = fnName === "__classPrivateFieldGet";
        const a = n.arguments;
        const recv = a[0];
        const classOfRecv = (e: ts.Expression): string | null =>
          ts.isIdentifier(e) ? (aliasOf.get(e.text) ?? (classNames.has(e.text) ? e.text : null)) : null;
        const st = stateArg(a[1]) ?? (a[1] !== undefined && classOfRecv(a[1]) !== null ? "<class>" : null);
        const kindArg = a[isGet ? 2 : 3];
        const kind = kindArg !== undefined && ts.isStringLiteral(kindArg) ? kindArg.text : null;
        if (recv === undefined || st === null || kind === null) { failed = true; return; }
        // Get(recv, S, "f") instance field | Get(recv, S, "f", Static) static field | Get(recv, S, "m", fn) method
        // | Get(recv, S, "a", fn) / Set(recv, S, v, "a", fn) accessor | Set(recv, S, v, "f")
        let target: string;
        let staticRecv: string | null = null;
        const accName = (fnState: string): string => privName(fnState).replace(/_(?:get|set)$/, "");
        if (isGet && kind === "m" && a.length === 4) {
          const mArg = stateArg(a[3]);
          if (mArg === null || regByName.get(mArg)?.kind !== "method") { failed = true; return; }
          if (isThis(recv) && brandSets.has(st)) target = `this.${privName(mArg)}`;
          else if (classOfRecv(recv) !== null && a[1] !== undefined && ts.isIdentifier(a[1]) && a[1].text === (recv as ts.Identifier).text) {
            staticRecv = (recv as ts.Identifier).text;
            staticMethodNames.add(mArg);
            target = `${classOfRecv(recv)!}.${privName(mArg)}`;
          } else { failed = true; return; }
        } else if (kind === "a" && a.length === (isGet ? 4 : 5)) {
          const fArg = stateArg(a[isGet ? 3 : 4]);
          if (!isThis(recv) || !brandSets.has(st) || fArg === null || regByName.get(fArg)?.kind !== "method") { failed = true; return; }
          if (!new RegExp(`_${isGet ? "get" : "set"}$`).test(fArg)) { failed = true; return; }
          accessorUse.set(fArg, isGet ? "get" : "set");
          target = `this.${accName(fArg)}`;
        } else if (kind === "f" && a.length === (isGet ? 4 : 5)) {
          // static field: the receiver is the class alias (`_a`), or a temp bound to it in the same expression (`_b = _a`)
          const sArg = stateArg(a[isGet ? 3 : 4]);
          if (!aliasOf.has(st) || sArg === null || regByName.get(sArg)?.kind !== "static" || !isAliasRecv(recv, st)) { failed = true; return; }
          target = `${aliasOf.get(st)!}.${privName(sArg)}`;
          tempAssign.add(recv);
        } else if (kind === "f" && a.length === (isGet ? 3 : 4)) {
          if (!isThis(recv) || regByName.get(st)?.kind !== "weakmap") { failed = true; return; }
          target = `this.${privName(st)}`;
        } else { failed = true; return; }
        // Mark the identifier uses handled.
        for (const x of a) if (ts.isIdentifier(x) && stateNames.has(x.text)) handled.add(x);
        if (ts.isBinaryExpression(recv) && ts.isIdentifier(recv.right) && stateNames.has(recv.right.text)) handled.add(recv.right);
        if (isGet) {
          // `.call(this, ...rest)` of a method read is a direct call of the private method
          const par = n.parent;
          if (
            kind === "m" && par !== undefined && ts.isPropertyAccessExpression(par) && par.expression === n && par.name.text === "call" &&
            par.parent !== undefined && ts.isCallExpression(par.parent) && par.parent.expression === par &&
            par.parent.arguments.length >= 1 &&
            (staticRecv === null ? isThis(par.parent.arguments[0]!) : ts.isIdentifier(par.parent.arguments[0]!) && (par.parent.arguments[0] as ts.Identifier).text === staticRecv)
          ) {
            const call = par.parent;
            if (staticRecv !== null && ts.isIdentifier(call.arguments[0]!)) handled.add(call.arguments[0]!);
            sites.push({
              node: call, start: call.getStart(sf), end: call.getEnd(),
              render: () => `${target}(${call.arguments.slice(1).map((x) => sub(x)).join(", ")})`,
            });
            for (const x of call.arguments.slice(1)) visitUses(x);
            for (const x of a) visitUses(x);
            return;
          }
          sites.push({ node: n, start: n.getStart(sf), end: n.getEnd(), render: () => target });
        } else {
          const v = a[2]!;
          sites.push({ node: n, start: n.getStart(sf), end: n.getEnd(), render: () => `(${target} = ${sub(v)})` });
        }
        for (const x of a) visitUses(x);
        return;
      }
    }
    n.forEachChild(visitUses);
  };
  for (const st of stmts) {
    if ((helperDecls as ts.Statement[]).includes(st) || (stateDecls as ts.Statement[]).includes(st)) continue;
    visitUses(st);
  }
  if (failed) return bail();
  // 4. Constructor registrations and the class edits.
  const edits: Edit[] = [];
  const addFields = new Map<string, string[]>(); // class -> field declarations (in order)
  const addMethods = new Map<string, string[]>();
  const addStatics = new Map<string, string[]>();
  for (const [cname, cls] of classBodies) {
    const ctor = cls.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
    const ctorStmts = ctor?.body?.statements ?? [];
    const params = new Set<string>();
    for (const p of ctor?.parameters ?? []) if (ts.isIdentifier(p.name)) params.add(p.name.text);
    let i = 0;
    const skipTemps = (): void => {
      while (i < ctorStmts.length && ts.isVariableStatement(ctorStmts[i]!) && (ctorStmts[i] as ts.VariableStatement).declarationList.declarations.every((d) => d.initializer === undefined)) i++;
    };
    skipTemps();
    if (ctorStmts[i] !== undefined && ts.isExpressionStatement(ctorStmts[i]!) && ts.isCallExpression((ctorStmts[i] as ts.ExpressionStatement).expression) && ((ctorStmts[i] as ts.ExpressionStatement).expression as ts.CallExpression).expression.kind === ts.SyntaxKind.SuperKeyword) i++;
    skipTemps();
    const fields: string[] = [];
    let anyPrivate = false;
    for (; i < ctorStmts.length; i++) {
      const s = ctorStmts[i]!;
      if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression) || !ts.isPropertyAccessExpression(s.expression.expression)) break;
      const call = s.expression;
      const callee = call.expression as ts.PropertyAccessExpression;
      if (!ts.isIdentifier(callee.expression) || !stateNames.has(callee.expression.text)) break;
      const st = callee.expression.text;
      const reg = regByName.get(st);
      const mo = memberOf(st);
      if (reg === undefined || mo === null || mo.cls !== cname) break;
      if (callee.name.text === "add" && reg.kind === "weakset" && call.arguments.length === 1 && isThis(call.arguments[0]!)) {
        handled.add(callee.expression);
        ctorRemovals.push({ start: s.getFullStart(), end: s.getEnd() });
        anyPrivate = true;
        continue;
      }
      if (callee.name.text === "set" && reg.kind === "weakmap" && call.arguments.length === 2 && isThis(call.arguments[0]!)) {
        const init = call.arguments[1]!;
        let bad = false;
        const scan = (x: ts.Node): void => {
          if (x.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(x) && (params.has(x.text) || x.text === "arguments"))) bad = true;
          x.forEachChild(scan);
        };
        scan(init);
        if (bad) return bail();
        handled.add(callee.expression);
        const isUndef = (ts.isVoidExpression(init) && ts.isNumericLiteral(init.expression)) || (ts.isIdentifier(init) && init.text === "undefined");
        fields.push(isUndef ? `${privName(st)};` : `${privName(st)} = ${sub(init)};`);
        ctorRemovals.push({ start: s.getFullStart(), end: s.getEnd() });
        anyPrivate = true;
        continue;
      }
      break;
    }
    // Any state registration use left in the constructor body or elsewhere is unhandled (checked below).
    void anyPrivate;
    addFields.set(cname, fields);
  }
  for (const r of regs) {
    const mo = r.kind === "alias" ? null : memberOf(r.name);
    if (r.kind === "method") {
      const fn = r.fn;
      const params = fn.parameters.map((p) => sub(p)).join(", ");
      const acc = accessorUse.get(r.name);
      const mods = acc !== undefined ? `${acc} ` : (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "") + (fn.asteriskToken ? "*" : "");
      const body = sub(fn.body);
      const arr = addMethods.get(mo!.cls) ?? [];
      const staticKw = staticMethodNames.has(r.name) ? "static " : "";
      const nm = acc !== undefined ? privName(r.name).replace(/_(?:get|set)$/, "") : privName(r.name);
      arr.push(`${staticKw}${mods}${nm}(${params}) ${body}`);
      addMethods.set(mo!.cls, arr);
    } else if (r.kind === "static") {
      const arr = addStatics.get(mo!.cls) ?? [];
      arr.push(`static ${privName(r.name)} = ${sub(r.init)};`);
      addStatics.set(mo!.cls, arr);
    }
  }
  // Every remaining mention of a state name must have been handled or be a registration/declaration.
  const regTargets = new Set<ts.Node>();
  for (const st of regStmts) {
    const parts: ts.Expression[] = [];
    flattenComma((st as ts.ExpressionStatement).expression, parts);
    for (const p of parts) {
      if (!ts.isBinaryExpression(p)) continue;
      regTargets.add(p.left);
      if (ts.isFunctionExpression(p.right) && p.right.name !== undefined) regTargets.add(p.right.name);
    }
  }
  const declIds = new Set<ts.Node>();
  for (const st of stateDecls) for (const d of st.declarationList.declarations) declIds.add(d.name);
  let stray = false;
  const findStray = (n: ts.Node): void => {
    if (stray) return;
    if (ts.isIdentifier(n) && stateNames.has(n.text) && !handled.has(n) && !regTargets.has(n) && !declIds.has(n)) {
      // identifiers inside registration RHS functions are visited too; they are covered by `handled` through visitUses.
      stray = true;
      return;
    }
    n.forEachChild(findStray);
  };
  findStray(sf);
  if (stray) return bail();
  // 5. Emit. Class insertions: fields at the start of the body, methods + statics at its end.
  for (const [cname, cls] of classBodies) {
    const f = addFields.get(cname) ?? [];
    const m = addMethods.get(cname) ?? [];
    const s = addStatics.get(cname) ?? [];
    if (f.length === 0 && m.length === 0 && s.length === 0) continue;
    const openBrace = cls.members.pos - 1; // position of `{`
    if (text[openBrace] !== "{") return bail();
    if (f.length + s.length > 0) edits.push({ start: openBrace + 1, end: openBrace + 1, text: " " + [...s, ...f].join(" ") + " " });
    if (m.length > 0) edits.push({ start: cls.getEnd() - 1, end: cls.getEnd() - 1, text: " " + m.join("\n") + "\n" });
  }
  const blank = (n: ts.Node): void => {
    edits.push({ start: n.getStart(sf), end: n.getEnd(), text: "\n".repeat((n.getText(sf).match(/\n/g) ?? []).length) });
  };
  for (const st of helperDecls) blank(st);
  for (const st of stateDecls) blank(st);
  for (const st of regStmts) blank(st);
  for (const r of ctorRemovals) {
    const piece = text.slice(r.start, r.end);
    edits.push({ start: r.start, end: r.end, text: "\n".repeat((piece.match(/\n/g) ?? []).length) });
  }
  // Call-site rewrites inside function bodies of the class (methods other than moved ones).
  const classRanges = [...classBodies.values()].map((c) => [c.getStart(sf), c.getEnd()] as const);
  for (const s of sites) {
    const inClass = classRanges.some(([a, b]) => s.start >= a && s.end <= b) || regStmts.some((rs) => s.start >= rs.getStart(sf) && s.end <= rs.getEnd());
    if (!inClass) return bail(); // a private access outside any class body would be a SyntaxError natively
  }
  // Outermost sites inside classes (nested ones are rendered by their parents).
  const outer = sites.filter((s) => !sites.some((o) => o !== s && o.start <= s.start && o.end >= s.end && (o.start < s.start || o.end > s.end)));
  for (const s of outer) {
    // Sites inside a moved method body or constructor-moved initializer are rendered through `sub`; skip those regions.
    edits.push({ start: s.start, end: s.end, text: s.render() });
  }
  // Drop edits that fall inside a region replaced wholesale (moved bodies / removed statements).
  const wholesale = [
    ...regStmts.map((st) => [st.getStart(sf), st.getEnd()] as const),
    ...ctorRemovals.map((r) => [r.start, r.end] as const),
  ];
  const kept = edits.filter((e) => {
    const isWhole = wholesale.some(([a, b]) => e.start === a && e.end === b) || e.start === e.end;
    if (isWhole) return true;
    return !wholesale.some(([a, b]) => e.start >= a && e.end <= b);
  });
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const ed of kept) {
    if (ed.start < at) return bail();
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}

/* NODE-VERSION PROBES. A compiled binary answers `process.version` /
 * `process.versions.node` with the runtime's one compatibility target
 * (divergence 60: "v" + 24.0.0, scr_lib.c's SCR_NODE_COMPAT_VERSION), so a
 * test built only from those values and literals has ONE answer for every
 * build. Packages that pick an implementation by the running Node's version
 * (redis-errors: `process.version.charCodeAt(1) < 55 && process.version
 * .charCodeAt(2) === 46 ? require('./lib/old') : require('./lib/modern')`)
 * then name a module that is never loaded: the conditional is replaced by its
 * taken branch, which also keeps the dead module out of the program. The
 * evaluator knows `process.version`, `process.versions.node`, `charCodeAt`,
 * `startsWith`, `slice`, `parseInt`/`Number`, comparisons,
 * `&&`, `||` and `!`; anything else makes the whole test "not a probe" and the
 * source is left as written. Conditional expressions and `if` statements. */
export const NODE_COMPAT_VERSION = "24.0.0"; // mirrors SCR_NODE_COMPAT_VERSION (packages/runtime/src/scr_lib.c); a unit test pins the pair
const VERSION_PROBE_PREFILTER = /process\.versions?\b/;
const NOT_A_PROBE = Symbol("not-a-probe");
type ProbeValue = number | string | boolean | typeof NOT_A_PROBE;

function evalVersionProbe(e: ts.Expression, seen: { process: boolean }): ProbeValue {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "version") {
      seen.process = true;
      return `v${NODE_COMPAT_VERSION}`;
    }
    if (
      ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) &&
      e.expression.expression.text === "process" && e.expression.name.text === "versions" && e.name.text === "node"
    ) {
      seen.process = true;
      return NODE_COMPAT_VERSION;
    }
    return NOT_A_PROBE;
  }
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    const v = evalVersionProbe(e.operand, seen);
    return v === NOT_A_PROBE ? v : !v;
  }
  if (ts.isCallExpression(e)) {
    const args = e.arguments.map((a) => evalVersionProbe(a, seen));
    if (args.some((a) => a === NOT_A_PROBE)) return NOT_A_PROBE;
    if (ts.isIdentifier(e.expression) && (e.expression.text === "parseInt" || e.expression.text === "Number" || e.expression.text === "parseFloat")) {
      const a0 = args[0];
      if (typeof a0 !== "string" && typeof a0 !== "number") return NOT_A_PROBE;
      if (e.expression.text === "parseInt") return args.length === 1 ? parseInt(String(a0), 10) : NOT_A_PROBE;
      return e.expression.text === "Number" ? Number(a0) : parseFloat(String(a0));
    }
    if (ts.isPropertyAccessExpression(e.expression)) {
      const recv = evalVersionProbe(e.expression.expression, seen);
      const name = e.expression.name.text;
      if (typeof recv === "string") {
        if (name === "charCodeAt" && args.length === 1 && typeof args[0] === "number") return recv.charCodeAt(args[0]);
        if (name === "startsWith" && args.length === 1 && typeof args[0] === "string") return recv.startsWith(args[0]);
        if (name === "slice" && args.every((a) => typeof a === "number") && args.length >= 1 && args.length <= 2) {
          return recv.slice(args[0] as number, args[1] as number | undefined);
        }
      }
    }
    return NOT_A_PROBE;
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      const l = evalVersionProbe(e.left, seen);
      if (l === NOT_A_PROBE) return l;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken ? !l : !!l) return l;
      return evalVersionProbe(e.right, seen);
    }
    const l = evalVersionProbe(e.left, seen);
    const r = evalVersionProbe(e.right, seen);
    if (l === NOT_A_PROBE || r === NOT_A_PROBE) return NOT_A_PROBE;
    if (typeof l !== typeof r || typeof l === "boolean") return NOT_A_PROBE;
    switch (op) {
      case ts.SyntaxKind.LessThanToken: return l < r;
      case ts.SyntaxKind.LessThanEqualsToken: return l <= r;
      case ts.SyntaxKind.GreaterThanToken: return l > r;
      case ts.SyntaxKind.GreaterThanEqualsToken: return l >= r;
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
      case ts.SyntaxKind.EqualsEqualsToken: return l === r;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      case ts.SyntaxKind.ExclamationEqualsToken: return l !== r;
      default: return NOT_A_PROBE;
    }
  }
  return NOT_A_PROBE;
}

function versionProbeEdits(fileName: string, text: string): string | null {
  if (!VERSION_PROBE_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const nl = (n: ts.Node): number => (n.getText(sf).match(/\n/g) ?? []).length;
  const visit = (n: ts.Node): void => {
    if (ts.isConditionalExpression(n)) {
      const seen = { process: false };
      const v = evalVersionProbe(n.condition, seen);
      if (v !== NOT_A_PROBE && seen.process) {
        const keep = v ? n.whenTrue : n.whenFalse;
        const keptText = keep.getText(sf);
        // A primary expression (identifier, call, member access, literal) needs no
        // parentheses where the conditional stood; anything else keeps them.
        const primary =
          ts.isIdentifier(keep) || ts.isCallExpression(keep) || ts.isPropertyAccessExpression(keep) ||
          ts.isElementAccessExpression(keep) || ts.isParenthesizedExpression(keep) || ts.isLiteralExpression(keep);
        const kept = primary ? keptText : `(${keptText})`;
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: kept + "\n".repeat(Math.max(0, nl(n) - (kept.match(/\n/g) ?? []).length)) });
        return; // nested probes inside the kept branch are rewritten on the next pass
      }
    }
    if (ts.isIfStatement(n)) {
      const seen = { process: false };
      const v = evalVersionProbe(n.expression, seen);
      if (v !== NOT_A_PROBE && seen.process) {
        const keep = v ? n.thenStatement : n.elseStatement;
        const kept = keep === undefined ? "" : ts.isBlock(keep) ? keep.getText(sf) : `{ ${keep.getText(sf)} }`;
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: kept + "\n".repeat(Math.max(0, nl(n) - (kept.match(/\n/g) ?? []).length)) });
        return;
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

export function jsDesugar(fileName: string, text: string): string | null {
  if (!/\.(?:c?js)$/.test(fileName) || fileName.endsWith(".d.ts")) return null;
  {
    const unwrapped = umdUnwrap(fileName, text);
    if (unwrapped !== null) return jsDesugar(fileName, unwrapped) ?? unwrapped;
  }
  {
    const chained = chainedPropertyAssignEdits(fileName, text);
    if (chained !== null) return jsDesugar(fileName, chained) ?? chained;
  }
  {
    const tsCjs = tsCjsEdits(fileName, text);
    if (tsCjs !== null) return jsDesugar(fileName, tsCjs) ?? tsCjs;
  }
  {
    const priv = privateMemberEdits(fileName, text);
    if (priv !== null) return jsDesugar(fileName, priv) ?? priv;
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
    const versioned = versionProbeEdits(fileName, text);
    if (versioned !== null) return jsDesugar(fileName, versioned) ?? versioned;
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
