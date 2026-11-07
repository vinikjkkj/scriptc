/* PRIMITIVE-WRAPPER SUBCLASSES.
 *
 *     class C extends String { constructor(a, s) { super(s); this.a = a; } m() { ... } }
 *
 * (also Number and Boolean) is rewritten, in a JavaScript file, into the constructor-function form the lowering already models:
 *
 *     let C = function C(a, s) {
 *       "use strict";
 *       if (!(this instanceof C)) { throw new TypeError("Class constructor C cannot be invoked without 'new'"); }
 *       __scrSuperString(this, s);
 *       this.a = a;
 *     };
 *     Object.setPrototypeOf(C.prototype, String.prototype);
 *     Object.defineProperty(C.prototype, "m", { value: ({ m() { ... } }).m, writable: true, configurable: true });
 *
 * `__scrSuperString(this, x)` makes the object `new C(..)` allocated the String wrapper (internal slot `%prim` = ToString(x)); the
 * prototype link reaches the real String.prototype value, so instanceof, String(v), method calls and inspect answer as Node's.
 *
 * Gate (everything else keeps the loud "extending classes not declared in the program" refusal): a plain class DECLARATION (no
 * export modifier, no decorators) extending the unshadowed global String / Number / Boolean; an explicit constructor whose FIRST
 * statement is `super()` or `super(arg)` (no spread, no `this` in arg) and which contains no other `super`; members are plain
 * (non-static, non-async, non-generator) methods with identifier or string-literal names, nothing else (no fields, accessors,
 * static members, `super.` use).
 *
 * Purely syntactic (typescript5, the sanctioned parsing island). */
import ts from "typescript5";

const PREFILTER = /\bextends\s+(?:String|Number|Boolean)\b/;
const BASES = new Set(["String", "Number", "Boolean"]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

function declaresName(sf: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) ||
        ts.isFunctionExpression(n) || ts.isClassExpression(n) || ts.isBindingElement(n) || ts.isImportSpecifier(n) ||
        ts.isImportClause(n) || ts.isNamespaceImport(n)) &&
      n.name !== undefined && ts.isIdentifier(n.name) && n.name.text === name
    ) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return found;
}

function containsKind(n: ts.Node, kinds: readonly ts.SyntaxKind[]): boolean {
  let found = false;
  const visit = (c: ts.Node): void => {
    if (found) return;
    if (kinds.includes(c.kind)) {
      found = true;
      return;
    }
    c.forEachChild(visit);
  };
  visit(n);
  return found;
}

function methodName(m: ts.MethodDeclaration): string | null {
  if (ts.isIdentifier(m.name)) return m.name.text;
  if (ts.isStringLiteral(m.name)) return m.name.text;
  return null;
}

function rewrite(sf: ts.SourceFile, text: string, cls: ts.ClassDeclaration): string | null {
  if (cls.name === undefined || ts.getDecorators(cls) !== undefined) return null;
  if (ts.getModifiers(cls) !== undefined && ts.getModifiers(cls)!.length > 0) return null;
  if (cls.typeParameters !== undefined) return null;
  const heritage = cls.heritageClauses ?? [];
  if (heritage.length !== 1 || heritage[0]!.token !== ts.SyntaxKind.ExtendsKeyword) return null;
  const baseExpr = heritage[0]!.types[0]!.expression;
  if (!ts.isIdentifier(baseExpr) || !BASES.has(baseExpr.text) || heritage[0]!.types.length !== 1) return null;
  if (heritage[0]!.types[0]!.typeArguments !== undefined) return null;
  const base = baseExpr.text;
  if (declaresName(sf, base)) return null;
  const name = cls.name.text;
  let ctor: ts.ConstructorDeclaration | null = null;
  const methods: ts.MethodDeclaration[] = [];
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) {
      if (ctor !== null || m.body === undefined) return null;
      ctor = m;
    } else if (ts.isMethodDeclaration(m)) {
      if ((ts.getModifiers(m) ?? []).length > 0 || m.asteriskToken !== undefined || methodName(m) === null) return null;
      if (m.body === undefined || methodName(m) === "constructor") return null;
      if (containsKind(m, [ts.SyntaxKind.SuperKeyword])) return null;
      methods.push(m);
    } else if (ts.isSemicolonClassElement(m)) {
      continue;
    } else return null;
  }
  if (ctor === null || ctor.body === undefined) return null;
  if ((ts.getModifiers(ctor) ?? []).length > 0) return null;
  const stmts = ctor.body.statements;
  const first = stmts[0];
  if (first === undefined || !ts.isExpressionStatement(first)) return null;
  const call = first.expression;
  if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.SuperKeyword) return null;
  if (call.arguments.length > 1 || call.arguments.some((a) => ts.isSpreadElement(a))) return null;
  if (call.arguments.length === 1 && containsKind(call.arguments[0]!, [ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword])) return null;
  // no other `super` anywhere in the constructor
  let supers = 0;
  const countSupers = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.SuperKeyword) supers++;
    n.forEachChild(countSupers);
  };
  countSupers(ctor);
  if (supers !== 1) return null;
  // the parameter list must be plain (a parameter property is TypeScript only)
  const params = ctor.parameters;
  const paramText = params.length === 0 ? "" : text.slice(params[0]!.getStart(sf), params[params.length - 1]!.getEnd());
  const superFn = `__scrSuper${base}`;
  const argText = call.arguments.length === 1 ? `, ${call.arguments[0]!.getText(sf)}` : "";
  const bodyRest = text.slice(first.getEnd(), ctor.body.getEnd() - 1);
  let out =
    `let ${name} = function ${name}(${paramText}) { "use strict"; ` +
    `if (!(this instanceof ${name})) { throw new TypeError("Class constructor ${name} cannot be invoked without 'new'"); } ` +
    `${superFn}(this${argText});${bodyRest}};` +
    ` Object.setPrototypeOf(${name}.prototype, ${base}.prototype);`;
  for (const m of methods) {
    const mn = methodName(m)!;
    const params2 = m.parameters.length === 0 ? "" : text.slice(m.parameters[0]!.getStart(sf), m.parameters[m.parameters.length - 1]!.getEnd());
    const asyncKw = (ts.getModifiers(m) ?? []).length > 0 ? "async " : "";
    const key = JSON.stringify(mn);
    out +=
      ` Object.defineProperty(${name}.prototype, ${key}, { value: ({ ${asyncKw}${key}(${params2}) ${text.slice(m.body!.getStart(sf), m.body!.getEnd())} })[${key}], writable: true, configurable: true });`;
  }
  const original = text.slice(cls.getStart(sf), cls.getEnd());
  const origNl = (original.match(/\n/g) ?? []).length;
  const outNl = (out.match(/\n/g) ?? []).length;
  if (outNl > origNl) return null;
  return out + "\n".repeat(origNl - outNl);
}

/** The rewritten text, or null when the file has no qualifying class. */
export function primSubclassEdits(fileName: string, text: string): string | null {
  if (!PREFILTER.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) {
      const r = rewrite(sf, text, n);
      if (r !== null) {
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: r });
        return;
      }
    }
    n.forEachChild(visit);
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
