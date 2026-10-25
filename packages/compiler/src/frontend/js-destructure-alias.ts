/* DESTRUCTURED ALIASES. `const { f, g: h } = o;` -> `const f = o.f, h = o.g;`
 * for a plain identifier or property-chain initializer, with plain identifier or
 * string-keyed properties and no defaults, rest, or nesting; and
 * `const { x } = { x: v }` -> `const x = v` for a literal whose values are plain names
 * or literals (no effects, so the record is never built). The binding then IS the
 * property's value, and a write through it reaches the object, which the pattern
 * form has no lowering for. Patterns with defaults, rest, nested patterns, or a
 * `require(...)` initializer are left alone. Purely syntactic (typescript5). */
import ts from "typescript5";

interface Edit {
  start: number;
  end: number;
  text: string;
}

function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function isPlainReadChain(e: ts.Expression): boolean {
  e = unparen(e);
  if (ts.isIdentifier(e)) return true;
  if (ts.isPropertyAccessExpression(e) && !e.questionDotToken) return isPlainReadChain(e.expression);
  return false;
}

/* DESTRUCTURED ALIASES. `const { f, g: h } = o;` -> `const f = o.f, h = o.g;`
 * for a plain identifier or property-chain initializer, with plain identifier or
 * string-keyed properties and no defaults, rest, or nesting. */
export function destructuredAliasEdits(fileName: string, text: string): string | null {
  if (!/\{[^}]*\}\s*=\s*[\w${]/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer &&
      ts.isVariableDeclarationList(n.parent) && ts.isVariableStatement(n.parent.parent) &&
      (isPlainReadChain(n.initializer) || literalAliasOf(n.initializer, n.name) !== null) && n.name.elements.length > 0 &&
      n.name.elements.every((e) => {
        if (e.dotDotDotToken !== undefined || e.initializer !== undefined) return false;
        if (!ts.isIdentifier(e.name)) return false;
        if (e.propertyName === undefined) return true;
        return ts.isIdentifier(e.propertyName) || ts.isStringLiteral(e.propertyName);
      })
    ) {
      const literal = literalAliasOf(n.initializer, n.name);
      if (literal !== null) {
        // `const { x } = { x: v }` binds x to v: the literal's values are plain names or
        // literals (no effects), so the record is never built.
        const parts = n.name.elements.map((e) => {
          const local = (e.name as ts.Identifier).text;
          const prop = e.propertyName === undefined ? local : (e.propertyName as ts.Identifier | ts.StringLiteral).text;
          return `${local} = ${literal.get(prop)}`;
        });
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: parts.join(", ") });
        ts.forEachChild(n, visit);
        return;
      }
      const init = text.slice(n.initializer.getStart(sf), n.initializer.getEnd());
      const parts = n.name.elements.map((e) => {
        const local = (e.name as ts.Identifier).text;
        const prop = e.propertyName === undefined ? local : (e.propertyName as ts.Identifier | ts.StringLiteral).text;
        const access = /^[A-Za-z_$][\w$]*$/.test(prop) ? `${init}.${prop}` : `${init}[${JSON.stringify(prop)}]`;
        return `${local} = ${access}`;
      });
      edits.push({ start: n.getStart(sf), end: n.getEnd(), text: parts.join(", ") });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

/** The property -> value text of an object literal whose every property is a plain
 * `key: name|literal` or shorthand `name`, with no spread, computed or method members;
 * null otherwise (or when a pattern element names a key the literal does not carry). */
function literalAliasOf(init: ts.Expression, pattern: ts.ObjectBindingPattern): Map<string, string> | null {
  const e = unparen(init);
  if (!ts.isObjectLiteralExpression(e)) return null;
  const sf = e.getSourceFile();
  const out = new Map<string, string>();
  for (const p of e.properties) {
    if (ts.isShorthandPropertyAssignment(p)) {
      out.set(p.name.text, p.name.text);
      continue;
    }
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return null;
    const v = unparen(p.initializer);
    if (!(ts.isIdentifier(v) || ts.isStringLiteral(v) || ts.isNumericLiteral(v))) return null;
    out.set(p.name.text, v.getText(sf));
  }
  for (const el of pattern.elements) {
    if (el.dotDotDotToken !== undefined || el.initializer !== undefined) return null;
    if (!ts.isIdentifier(el.name)) return null;
    const key = el.propertyName === undefined ? el.name.text : (el.propertyName as ts.Identifier | ts.StringLiteral).text;
    if (!out.has(key)) return null;
  }
  return out;
}

