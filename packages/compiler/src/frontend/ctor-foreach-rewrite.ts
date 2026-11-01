/* A forEach over a literal array of builtin constructors that exports one member per constructor.
 *
 * THE SHAPE (webidl-conversions lib/index.js, mongodb's dependency):
 *
 *   [Int8Array, Int16Array, …, Float64Array].forEach(func => {
 *     const { name } = func;
 *     const article = /^[AEIOU]/u.test(name) ? "an" : "a";
 *     exports[name] = (value, options = {}) => { … name … article … };
 *   });
 *
 * Every key is statically known: a builtin constructor's `.name` is its identifier, so the callback runs once per
 * element with a fixed name. The lowering cannot write an export under a key it does not know at compile time
 * (`exports[name]` is a dynamic-keyed write, refused as "assignment to non-array elements" plus the
 * "binding form" refusal of `exports`), so the statement is UNROLLED as served text before the checker and the
 * lowering read the file:
 *
 *   const __scriptc_ctor_forEach_0 = (name) => {
 *     const article = /^[AEIOU]/u.test(name) ? "an" : "a";
 *     return (value, options = {}) => { … name … article … };
 *   };
 *   exports.Int8Array = __scriptc_ctor_forEach_0("Int8Array"); … (one call per element, in order; a name that is not
 *   an identifier is written as `exports["…"]`)
 *
 * Each call runs the body's statements in the same order the forEach callback ran them, with the same name
 * value, and returns the closure the callback exported, so the export table gets the same members in the same
 * order. The helper is a const arrow, so `this` and `arguments` are the module's (the body is refused if it
 * names either: the conservative rule keeps the rewrite exact). The rewrite keeps the file's line count
 * (the replacement is padded with newlines), so every later line in the file keeps its number; lines inside
 * the unrolled region are reported at their served position, not the on-disk one.
 *
 * REFUSED (the statement is left as it is, and its refusal stands): any element that is not an un-shadowed builtin
 * constructor name from BUILTIN_CTORS, a callback that is not `(p) => { const { n } = p; …; exports[n] = <expr>; }`
 * with the export as its LAST statement, a `return`, `this`, `arguments`, `exports`, `module` or `require` reference in
 * the body, a body that reads the constructor parameter (a builtin constructor taken as a value is the global identity
 * token, not a function object: `instanceof` on it throws at run time), a declaration of `n` inside the body, an ES
 * module file, and a rewrite that would move later lines. */
import ts from "typescript5";

const BUILTIN_CTORS: ReadonlySet<string> = new Set([
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "ArrayBuffer", "DataView", "Map", "Set",
  "WeakMap", "WeakSet", "Array", "Date", "RegExp", "Promise", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "EvalError", "URIError", "Number", "String", "Boolean", "Object",
]);

const IDENT_RE: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const CTOR_ELEMENT_RE: RegExp = new RegExp(`\\b(?:${[...BUILTIN_CTORS].join("|")})\\s*,`);

interface Edit { readonly start: number; readonly end: number; readonly text: string }

/** Every name a declaration in the file binds (variables, parameters, functions, classes, imports, destructuring). */
function declaredNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) ||
      ts.isClassDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) &&
      n.name !== undefined && ts.isIdentifier(n.name)) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** True when the subtree names `this`, `arguments`, `exports`, `module`, or declares/returns out of the callback. */
function bodyRefusal(root: ts.Node, nameLocal: string): string | null {
  let why: string | null = null;
  const visit = (n: ts.Node, nested: boolean): void => {
    if (why !== null) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) { why = "this"; return; }
    if (ts.isIdentifier(n)) {
      if (n.text === "arguments" || n.text === "exports" || n.text === "module" || n.text === "require") { why = n.text; return; }
    }
    if (!nested && ts.isReturnStatement(n)) { why = "return"; return; }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nameLocal) { why = "redeclared name"; return; }
    if (ts.isFunctionDeclaration(n) && n.name !== undefined && n.name.text === nameLocal) { why = "redeclared name"; return; }
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === nameLocal) { why = "shadowed name"; return; }
    ts.forEachChild(n, (c) => visit(c, nested || ts.isFunctionLike(n)));
  };
  visit(root, false);
  return why;
}

function usesIdentifier(root: ts.Node, text: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === text) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function countNewlines(s: string): number {
  let k = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) k++;
  return k;
}

/** One top-level forEach statement's unrolled text, or null when the shape does not match (see the header). */
function unrollOne(stmt: ts.Statement, sf: ts.SourceFile, declared: ReadonlySet<string>, helperName: string): Edit | null {
  if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) return null;
  const call = stmt.expression;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "forEach" || callee.questionDotToken !== undefined) return null;
  const arr = callee.expression;
  if (!ts.isArrayLiteralExpression(arr) || arr.elements.length === 0) return null;
  const elems: string[] = [];
  for (const el of arr.elements) {
    if (!ts.isIdentifier(el) || !BUILTIN_CTORS.has(el.text) || declared.has(el.text)) return null;
    elems.push(el.text);
  }
  if (call.arguments.length !== 1) return null;
  const fn = call.arguments[0]!;
  if (!ts.isArrowFunction(fn) || !ts.isBlock(fn.body) || fn.parameters.length !== 1) return null;
  const p = fn.parameters[0]!;
  if (p.dotDotDotToken !== undefined || p.initializer !== undefined || !ts.isIdentifier(p.name)) return null;
  const paramName = p.name.text;
  const stmts = fn.body.statements;
  if (stmts.length < 2) return null;
  // The destructuring prologue: `const { name } = func;` (one plain element, no rename, no default).
  const first = stmts[0]!;
  if (!ts.isVariableStatement(first) || (first.declarationList.flags & ts.NodeFlags.Const) === 0 || first.declarationList.declarations.length !== 1) return null;
  const decl = first.declarationList.declarations[0]!;
  if (!ts.isObjectBindingPattern(decl.name) || decl.name.elements.length !== 1 || decl.initializer === undefined) return null;
  if (!ts.isIdentifier(decl.initializer) || decl.initializer.text !== paramName) return null;
  const be = decl.name.elements[0]!;
  if (be.propertyName !== undefined || be.dotDotDotToken !== undefined || be.initializer !== undefined || !ts.isIdentifier(be.name)) return null;
  const nameLocal = be.name.text;
  if (nameLocal === paramName) return null;
  // The export: `exports[<name>] = <expr>;` as the LAST statement.
  const last = stmts[stmts.length - 1]!;
  if (!ts.isExpressionStatement(last) || !ts.isBinaryExpression(last.expression) || last.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const lhs = last.expression.left;
  if (!ts.isElementAccessExpression(lhs) || !ts.isIdentifier(lhs.expression) || lhs.expression.text !== "exports") return null;
  if (!ts.isIdentifier(lhs.argumentExpression) || lhs.argumentExpression.text !== nameLocal) return null;
  const valueExpr = last.expression.right;
  const middle = stmts.slice(1, -1);
  // The body may not name `this`/`arguments`/`exports`/`module`/`require`, leave the callback, or redeclare the
  // name: each refusal here keeps the forEach statement exactly as it was (the refusal it had stands).
  for (const s of stmts.slice(0, -1)) if (bodyRefusal(s, nameLocal) !== null) return null;
  if (bodyRefusal(valueExpr, nameLocal) !== null) return null;
  // A body that reads the constructor itself (`func`) keeps its refusal: a builtin constructor taken as a value is
  // the global identity token, not a function object (`x instanceof Int8Array` throws at run time), and that is a
  // separate defect. The rewrite maps only the name-only shape (webidl-conversions).
  if (middle.some((s) => usesIdentifier(s, paramName)) || usesIdentifier(valueExpr, paramName)) return null;
  const params = nameLocal;
  const middleText = middle.length === 0 ? "" : sf.text.slice(middle[0]!.getStart(sf), middle[middle.length - 1]!.getEnd());
  const valueText = sf.text.slice(valueExpr.getStart(sf), valueExpr.getEnd());
  const helper = `const ${helperName} = (${params}) => {\n${middleText}${middleText === "" ? "" : "\n"}return ${valueText};\n};`;
  const calls: string[] = [];
  const seen = new Set<string>();
  for (const e of elems) {
    if (seen.has(e)) return null;
    seen.add(e);
    const key = JSON.stringify(e);
    // A name that is an identifier is written as a property (`exports.Int8Array = …`): Node's key order for a
    // property write is the write order, which the module object keeps; a non-identifier key stays an element write.
    const lhs = IDENT_RE.test(e) ? `exports.${e}` : `exports[${key}]`;
    calls.push(`${lhs} = ${helperName}(${key});`);
  }
  const text = `${helper}\n${calls.join(" ")}`;
  const start = stmt.getStart(sf);
  const end = stmt.getEnd();
  const oldLines = countNewlines(sf.text.slice(start, end));
  const newLines = countNewlines(text);
  if (newLines > oldLines) return null;
  return { start, end, text: text + "\n".repeat(oldLines - newLines) };
}

/** The unrolled text of `text` when it has a qualifying forEach statement, otherwise null. */
export function unrollBuiltinCtorForEach(fileName: string, text: string): string | null {
  if (!/\.(c|m)?js$/.test(fileName) || fileName.endsWith(".mjs")) return null;
  if (!text.includes(".forEach(")) return null;
  // Cheap pre-check before a parse: some element of the array must be a listed constructor followed by a comma.
  if (!CTOR_ELEMENT_RE.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // An ES module has no `exports` object in Node, so the rewrite does not apply to one.
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) || ts.isExportAssignment(s) || ts.isExportDeclaration(s)) return null;
    if (ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return null;
  }
  const declared = declaredNames(sf);
  const edits: Edit[] = [];
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s)) continue;
    let n = edits.length;
    let helperName = `__scriptc_ctor_forEach_${n}`;
    while (text.includes(helperName)) helperName = `__scriptc_ctor_forEach_${++n}`;
    const e = unrollOne(s, sf, declared, helperName);
    if (e !== null) edits.push(e);
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
