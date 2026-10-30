/* The exact Function.prototype.toString text of a user function value.
 *
 * Node prints a function's SOURCE TEXT: the characters from the start of
 * the function (its `function`/`async` keyword, its parameter list for an
 * arrow, its method name for a method) to its closing brace or expression
 * end. For a `.ts` file the text is the one Node's type stripper produces,
 * which BLANKS every erasable type form to spaces at its own position:
 * `function tf(a: number): number { return a; }` prints
 * `function tf(a        )         { return a; }`. Newlines inside a blanked
 * span survive, so line numbers never move.
 *
 * This module computes that text from the TypeScript AST. Each erasable
 * form contributes a blank span, measured on $NODE_CI (v24.15.0):
 *   - a type annotation: from its colon to the end of the type (on a
 *     parameter the `?` before the colon blanks too);
 *   - a definite `!` on a declaration; an optional `?` on a method;
 *   - type parameters `<T>`, type arguments `f<T>()` / `new C<T>()`;
 *   - `as T` / `satisfies T` (from the operand's end) and the `!` of `x!`;
 *   - an `implements` clause;
 *   - accessibility, abstract, override, readonly and declare modifiers.
 * A function value's text starts after export/default/declare and the
 * accessibility/static/abstract/override modifiers; `async`, `*`, `get`
 * and `set` stay.
 *
 * FORMS NODE REFUSES. Under strip-only mode Node stops on enums, namespaces,
 * `import x = require()`, `export =`, angle-bracket type assertions and
 * parameter properties, with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX for the WHOLE
 * module. A file containing one has no Node text to match, so its functions
 * have no text here either (null: the caller fences).
 *
 * THE LAYOUT THIS DOES NOT REPRODUCE. A return type whose colon sits on a
 * later line than the token before it: Node moves the `)` in its output
 * (`(a: number)\n  : number => a` prints `(a         \n         ) => a`),
 * which is not a positional blank. Such a function has no text here (null).
 *
 * Plain .js files are their own text. A file the program rewrote before
 * parsing (js-desugar.ts) is the caller's to fence.
 */
import * as ts from "./ts7/adapter.js";

interface FileText {
  /** The file's text with every erasable span blanked, or null when Node
   * refuses the module outright. */
  stripped: string | null;
  /** Function-like nodes whose return-type layout is the quirk above. */
  quirk: Set<ts.Node>;
}

const fileCache = new WeakMap<ts.SourceFile, FileText>();

function isTsFile(sf: ts.SourceFile): boolean {
  return !/\.(c|m)?jsx?$/.test(sf.fileName);
}

/** Skip whitespace and comments forward from `i`. */
function skipTriviaForward(text: string, i: number): number {
  for (;;) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return text.length;
      i = close + 2;
      continue;
    }
    return i;
  }
}

/** Skip whitespace and block comments backward from `i` (exclusive). Returns
 * the index of the nearest significant character, or -1. A `//` comment
 * here reads as a non-matching character, which fences (never mis-blanks). */
function skipTriviaBackward(text: string, i: number): number {
  let j = i - 1;
  for (;;) {
    while (j >= 0 && /\s/.test(text[j]!)) j--;
    if (j >= 1 && text[j] === "/" && text[j - 1] === "*") {
      const open = text.lastIndexOf("/*", j - 2);
      if (open < 0) return -1;
      j = open - 1;
      continue;
    }
    return j;
  }
}

const MODIFIER_BLANK: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.OverrideKeyword,
  ts.SyntaxKind.DeclareKeyword,
]);

function computeFileText(sf: ts.SourceFile): FileText {
  const text = sf.text;
  const spans: Array<[number, number]> = [];
  const quirk = new Set<ts.Node>();
  /** The `<` before a type list through the `>` after it. */
  const angleSpan = (first: ts.Node, last: ts.Node): [number, number] | null => {
    const lt = skipTriviaBackward(text, first.getStart(sf));
    if (lt < 0 || text[lt] !== "<") return null;
    let j = skipTriviaForward(text, last.end);
    if (text[j] === ",") j = skipTriviaForward(text, j + 1);
    if (text[j] !== ">") return null;
    return [lt, j + 1];
  };
  /** A type annotation's colon through the end of its type. */
  const annotationSpan = (type: ts.TypeNode): [number, number] | null => {
    const colon = skipTriviaBackward(text, type.getStart(sf));
    if (colon < 0 || text[colon] !== ":") return null;
    return [colon, type.end];
  };
  // Iterative walk: the 7000-level guard rule for new AST walks.
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    ts.forEachChild(n, (c) => {
      stack.push(c);
      return undefined;
    });
    if (n === sf) continue;
    // Forms Node refuses for the whole module.
    if (
      ts.isEnumDeclaration(n) ||
      ts.isModuleDeclaration(n) ||
      ts.isImportEqualsDeclaration(n) ||
      (ts.isExportAssignment(n) && n.isExportEquals) ||
      n.kind === ts.SyntaxKind.TypeAssertionExpression ||
      (ts.isParameter(n) && n.modifiers?.some((m) => MODIFIER_BLANK.has(m.kind)))
    ) {
      return { stripped: null, quirk };
    }
    // Whole statements that are types only.
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) {
      spans.push([n.getStart(sf), n.end]);
      continue;
    }
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) {
      spans.push([n.expression.end, n.end]);
    }
    if (ts.isHeritageClause(n) && n.token === ts.SyntaxKind.ImplementsKeyword) {
      spans.push([n.getStart(sf), n.end]);
    }
    // Definite `!` and optional `?` markers: token nodes on the declaration.
    const marks = n as { exclamationToken?: ts.Node; questionToken?: ts.Node };
    if (marks.exclamationToken !== undefined) {
      spans.push([marks.exclamationToken.getStart(sf), marks.exclamationToken.end]);
    }
    if (marks.questionToken !== undefined) {
      spans.push([marks.questionToken.getStart(sf), marks.questionToken.end]);
    }
    if (
      (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertySignature(n)) &&
      n.type !== undefined
    ) {
      const sp = annotationSpan(n.type);
      if (sp === null) return { stripped: null, quirk };
      spans.push(sp);
    }
    if (
      (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) ||
        ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) &&
      n.type !== undefined
    ) {
      const sp = annotationSpan(n.type);
      if (sp === null) return { stripped: null, quirk };
      if (text.slice(skipTriviaBackward(text, sp[0]) + 1, sp[0]).includes("\n")) quirk.add(n);
      spans.push(sp);
    }
    const tps = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
    if (tps !== undefined && tps.length > 0) {
      const sp = angleSpan(tps[0]!, tps[tps.length - 1]!);
      if (sp === null) return { stripped: null, quirk };
      spans.push(sp);
    }
    if (
      (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n) ||
        ts.isExpressionWithTypeArguments(n) || ts.isTypeReferenceNode(n)) &&
      n.typeArguments !== undefined && n.typeArguments.length > 0
    ) {
      const sp = angleSpan(n.typeArguments[0]!, n.typeArguments[n.typeArguments.length - 1]!);
      if (sp === null) return { stripped: null, quirk };
      spans.push(sp);
    }
    const mods = (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined) ?? [];
    for (const m of mods) {
      if (MODIFIER_BLANK.has(m.kind)) spans.push([m.getStart(sf), m.end]);
    }
  }
  const chars = text.split("");
  for (const [a, b] of spans) {
    for (let i = a; i < b; i++) {
      const c = chars[i];
      if (c !== "\n" && c !== "\r") chars[i] = " ";
    }
  }
  return { stripped: chars.join(""), quirk };
}

function fileText(sf: ts.SourceFile): FileText {
  let ft = fileCache.get(sf);
  if (ft === undefined) {
    ft = isTsFile(sf) ? computeFileText(sf) : { stripped: sf.text, quirk: new Set() };
    fileCache.set(sf, ft);
  }
  return ft;
}

/** Node's start of a function value's text: the first character after any
 * export/default/declare keyword and the accessibility, static, abstract,
 * override and readonly modifiers. `async`, `*`, `get` and `set` stay. */
function valueTextStart(sf: ts.SourceFile, node: ts.Node): number {
  const text = sf.text;
  let i = node.getStart(sf);
  for (;;) {
    const m = /^(export|default|declare|public|private|protected|static|abstract|override|readonly)\b/.exec(text.slice(i, i + 16));
    if (m === null) return i;
    const after = skipTriviaForward(text, i + m[0].length);
    // A method NAMED like a modifier (`static() {}`) is followed by `(`.
    if (text[after] === "(" || text[after] === ":" || text[after] === "=" || text[after] === ";") return i;
    i = after;
  }
}

/** Is `node` a function whose value Node prints as source text? */
export function isValueFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
  );
}

/** The exact toString text of the function `node`, or null when this module
 * has no exact text for it (the caller fences). */
export function functionSourceText(node: ts.Node): string | null {
  if (!isValueFunctionNode(node)) return null;
  const sf = node.getSourceFile();
  const ft = fileText(sf);
  if (ft.stripped === null || ft.quirk.has(node)) return null;
  return ft.stripped.slice(valueTextStart(sf, node), node.end);
}
