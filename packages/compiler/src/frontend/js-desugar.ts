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
 * nested function is left alone (and only RELATIVE specifiers: a builtin or package
 * require keeps the member-read forms the lowering already models), as is a statement that cannot take a
 * preceding declaration (an unbraced `if` body). */
const INLINE_REQUIRE_PREFILTER = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/;

function inlineRequireEdits(fileName: string, text: string): string | null {
  if (!INLINE_REQUIRE_PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const isRequireCall = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" &&
    n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]!) && n.arguments[0]!.text.startsWith(".");
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

export function jsDesugar(fileName: string, text: string): string | null {
  if (!/\.(?:c?js)$/.test(fileName) || fileName.endsWith(".d.ts")) return null;
  {
    const unwrapped = umdUnwrap(fileName, text);
    if (unwrapped !== null) return jsDesugar(fileName, unwrapped) ?? unwrapped;
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
