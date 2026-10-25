/* METHOD-SLOT MUTATION, by staging.
 *
 * A typed `class` in a JavaScript file has a fixed method table: every `x.m()`
 * is a direct call to the declared method, and an instance or prototype write
 * to a method name has no lowering (SC1090 "assignment to non-variables").
 * JavaScript's model is different: a method is a property of the prototype
 * object, looked up at call time, so `C.prototype.m = f` replaces the method for
 * every existing and future instance, `inst.m = f` shadows it for one instance,
 * and `C.prototype[k] = f` binds a method whose name is a run-time value.
 *
 * The lowering already implements that model for FUNCTION constructors
 * (`function C() {}` plus `C.prototype.m = fn`): the value is a dyn object
 * linked to a dyn prototype, and every write and call dispatches at run time
 * (proto-class.ts, lower-classes.ts). So a class that is MUTATED is staged into
 * exactly that spelling, which the compiler already accepts, and an UNMUTATED
 * class is left untouched: the staging is decided per class from the writes in
 * the file, so a program that never mutates a class keeps its typed lowering.
 *
 * WHICH CLASSES. A top-level, non-exported `class C` in a file is mutated when
 * the file writes to it:
 *   - `C.prototype.m = v` or `C.prototype[k] = v` (static or computed key);
 *   - `v.m = x` where `v` is a top-level `const|let|var v = new C(...)` and `m`
 *     is a method name of C (or of a same-file ancestor);
 *   - `this.m = x` inside C (or a same-file descendant) where `m` is a method
 *     name of C (an ordinary field write `this.f = x` is NOT a mutation).
 * Classes linked by `extends` are staged together. A component that spans FILES
 * is NOT staged: staging a base turns every subclass in other files, and every
 * value built from them, into untyped values, and the measured cascade on the
 * real ioredis build (124 -> 166 error lines) exceeds what is cleared. Those
 * writes keep their SC1090 refusal, named and open.
 *
 * WHAT IS STAGED, and the semantics each piece keeps:
 *   class C extends B { constructor(a) {...} m(x) {...} get g() {...}
 *     static s() {...} }
 * becomes
 *   function C(a) { "use strict"; if (!(this instanceof C)) throw TypeError(...);
 *     ...body (super(args) -> B.call(this, args)) }
 *   Object.setPrototypeOf(C.prototype, B.prototype); Object.setPrototypeOf(C, B);
 *   Object.defineProperty(C.prototype, "m", { value: function (x) {...},
 *     writable: true, enumerable: false, configurable: true });
 *   ... accessors via get/set; statics on C; `super.m(x)` -> B.prototype.m.call(this, x).
 * Methods are non-enumerable, strict, and not constructible, as in a class.
 * Known divergences (recorded, not hidden): a method's `.name` is the empty
 * string (an anonymous function expression, so the method's own name cannot
 * shadow an outer binding); the staged constructor is a plain function value.
 *
 * REFUSED (the class is left as it was, so its refusal stays loud): instance or
 * static FIELDS (PropertyDeclaration), static blocks, private names, decorators,
 * `new.target`, `super` in any other position, a base that is not a same-file
 * top-level class identifier, export syntax, and class expressions.
 *
 * Purely syntactic (typescript5, the sanctioned parsing island; destructured
 * aliases are js-destructure-alias.ts). */
import ts from "typescript5";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

interface Edit {
  start: number;
  end: number;
  text: string;
}

function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
  return (ts.getModifiers?.(n as ts.HasModifiers) ?? []).some((m) => m.kind === kind);
}

/** The own method names a class declares on its prototype (get/set included). */
function prototypeMethodNames(cls: ts.ClassDeclaration): Set<string> {
  const out = new Set<string>();
  for (const m of cls.members) {
    if (!(ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m))) continue;
    if (hasModifier(m, ts.SyntaxKind.StaticKeyword)) continue;
    if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) out.add(m.name.text);
  }
  return out;
}

function isPlainReadChain(e: ts.Expression): boolean {
  e = unparen(e);
  if (ts.isIdentifier(e)) return true;
  if (ts.isPropertyAccessExpression(e) && !e.questionDotToken) return isPlainReadChain(e.expression);
  return false;
}

function isStringKey(n: ts.PropertyName): boolean {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n);
}

/** Does `n`'s enclosing class declaration chain (within the file) reach `name`? */
function enclosingClass(n: ts.Node): ts.ClassDeclaration | null {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isClassDeclaration(p)) return p;
  }
  return null;
}

/* PACKAGE SCOPE. A class's mutation can be written in another file of its
 * package (ioredis: transaction.js writes `pipeline.exec` on a Pipeline declared in
 * Pipeline.js), and a subclass can sit in another file (Pipeline extends Commander
 * from utils/Commander.js). So the facts are gathered over every .js/.cjs file of
 * the package the file belongs to, and staging is decided on the whole picture:
 * a mutated class stages its whole `extends` component, in every file of the
 * package. The file being desugared is parsed from its own text; the others from
 * disk (cached per package for the process). Facts the scan cannot resolve make a
 * write fall back to NAME matching (an instance write `x.m = v` on a receiver of
 * unknown class marks every package class that declares method m: a superset of
 * the true mutation, which costs speed, never meaning). */
interface ClassFact {
  key: string;
  file: string;
  name: string;
  decl: ts.ClassDeclaration;
  sf: ts.SourceFile;
  /** The `extends` expression text (spelled in this file), or null. */
  baseText: string | null;
  /** The base's key when it resolves to a package class, else null. */
  baseKey: string | null;
  /** True when a base is declared but does not resolve to a package class. */
  baseUnresolved: boolean;
  protoMethods: Set<string>;
  hasStatic: boolean;
}
interface PackageFacts {
  classes: Map<string, ClassFact>;
  /** Keys of classes written through their prototype or as instances. */
  mutated: Set<string>;
  /** Keys of classes with a static-side write `C.x = v` somewhere in the package. */
  staticWritten: Set<string>;
  /** Method names written on receivers of unknown class (name fallback). */
  unknownWriteNames: Set<string>;
}
const KEY_SEP = "\u0000";
const packageCache = new Map<string, Map<string, { mtime: number; sf: ts.SourceFile; text: string }>>();

function packageRootOf(fileName: string): string {
  let dir = dirname(fileName);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return dirname(fileName);
    dir = up;
  }
}

function listPackageJs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 8 || out.length > 800) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.c?js$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

/** The resolved file of a relative require spec, or null. */
function resolveRequireFile(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(fromFile), spec);
  for (const c of [base, base + ".js", base + ".cjs", join(base, "index.js"), join(base, "index.cjs")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

function parseFacts(file: string, sf: ts.SourceFile): {
  classes: Map<string, ts.ClassDeclaration>;
  requires: Map<string, string>;
  exportDefault: string | null;
} {
  const requires = new Map<string, string>();
  let exportDefault: string | null = null;
  const classes = new Map<string, ts.ClassDeclaration>();
  const dup = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && st.name) {
      if (hasModifier(st, ts.SyntaxKind.ExportKeyword) || hasModifier(st, ts.SyntaxKind.DefaultKeyword)) continue;
      if (classes.has(st.name.text)) dup.add(st.name.text);
      classes.set(st.name.text, st);
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer ? unparen(d.initializer) : undefined;
        if (ts.isIdentifier(d.name) && init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) &&
          init.expression.text === "require" && init.arguments.length === 1 && ts.isStringLiteral(init.arguments[0]!)) {
          const f = resolveRequireFile(file, init.arguments[0].text);
          if (f !== null) requires.set(d.name.text, f);
        }
      }
    }
    if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) &&
      st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = unparen(st.expression.left);
      const r = unparen(st.expression.right);
      if (ts.isPropertyAccessExpression(l) && l.name.text === "default" && ts.isIdentifier(l.expression) &&
        l.expression.text === "exports" && ts.isIdentifier(r)) exportDefault = r.text;
    }
  }
  for (const d of dup) classes.delete(d);
  return { classes, requires, exportDefault };
}

/** The key of the class an expression denotes in `file`, or null. */
function resolveClass(
  file: string,
  e: ts.Expression,
  perFile: Map<string, { classes: Map<string, ts.ClassDeclaration>; requires: Map<string, string>; exportDefault: string | null }>,
): string | null {
  e = unparen(e);
  const info = perFile.get(file);
  if (!info) return null;
  if (ts.isIdentifier(e)) return info.classes.has(e.text) ? file + KEY_SEP + e.text : null;
  if (ts.isPropertyAccessExpression(e) && e.name.text === "default" && ts.isIdentifier(e.expression)) {
    const g = info.requires.get(e.expression.text);
    if (g === undefined) return null;
    const gi = perFile.get(g);
    if (!gi || gi.exportDefault === null || !gi.classes.has(gi.exportDefault)) return null;
    return g + KEY_SEP + gi.exportDefault;
  }
  return null;
}

function gatherPackage(fileName: string, text: string): PackageFacts {
  const root = packageRootOf(fileName);
  let cache = packageCache.get(root);
  if (!cache) {
    cache = new Map();
    for (const f of listPackageJs(root)) {
      try {
        const t = readFileSync(f, "utf8");
        cache.set(f, { mtime: 0, text: t, sf: ts.createSourceFile(f, t, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) });
      } catch {
        /* unreadable: not part of the picture */
      }
    }
    packageCache.set(root, cache);
  }
  // The file being desugared is always parsed from the text it was handed.
  const own = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const sources = new Map<string, ts.SourceFile>();
  for (const [f, v] of cache) sources.set(f, v.sf);
  sources.set(fileName, own);

  const facts: PackageFacts = {
    classes: new Map(), mutated: new Set(), staticWritten: new Set(), unknownWriteNames: new Set(),
  };
  const perFile = new Map<string, { classes: Map<string, ts.ClassDeclaration>; requires: Map<string, string>; exportDefault: string | null }>();
  for (const [f, sf] of sources) {
    const r = parseFacts(f, sf);
    perFile.set(f, { classes: r.classes, requires: r.requires, exportDefault: r.exportDefault });
  }
  // Class facts (bases resolved, method names from the ancestor chain later).
  for (const [f, info] of perFile) {
    const sf = sources.get(f)!;
    for (const [name, decl] of info.classes) {
      const key = f + KEY_SEP + name;
      const h = decl.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword);
      const baseExpr = h?.types[0]?.expression;
      const baseKey = baseExpr ? resolveClass(f, baseExpr, perFile) : null;
      facts.classes.set(key, {
        key, file: f, name, decl, sf,
        baseText: baseExpr ? baseExpr.getText(sf) : null,
        baseKey,
        baseUnresolved: baseExpr !== undefined && baseKey === null,
        protoMethods: prototypeMethodNames(decl),
        hasStatic: decl.members.some((m) => hasModifier(m, ts.SyntaxKind.StaticKeyword)),
      });
    }
  }
  const ancestorMethods = (key: string): Set<string> => {
    const out = new Set<string>();
    let cur: string | null = key;
    const seen = new Set<string>();
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const c = facts.classes.get(cur);
      if (!c) break;
      for (const m of c.protoMethods) out.add(m);
      cur = c.baseKey;
    }
    return out;
  };
  // Mutation facts, over every file of the package.
  for (const [f, sf] of sources) {
    const info = perFile.get(f)!;
    // Top-level instance bindings `const v = new Y(...)`, resolved.
    const instanceOf = new Map<string, string>();
    const declCount = new Map<string, number>();
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        declCount.set(d.name.text, (declCount.get(d.name.text) ?? 0) + 1);
        const init = d.initializer ? unparen(d.initializer) : undefined;
        if (init && ts.isNewExpression(init)) {
          const k = resolveClass(f, init.expression, perFile);
          if (k !== null) instanceOf.set(d.name.text, k);
        }
      }
    }
    for (const [v, n] of declCount) if (n > 1) instanceOf.delete(v);
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = unparen(n.left);
        if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
          const target = unparen(left.expression);
          const member = ts.isPropertyAccessExpression(left) ? left.name.text : undefined;
          if (ts.isPropertyAccessExpression(target) && target.name.text === "prototype") {
            const k = resolveClass(f, target.expression, perFile);
            if (k !== null) facts.mutated.add(k);
          } else if (ts.isIdentifier(target) && instanceOf.has(target.text)) {
            const k = instanceOf.get(target.text)!;
            if (member === undefined || ancestorMethods(k).has(member)) facts.mutated.add(k);
          } else if (target.kind === ts.SyntaxKind.ThisKeyword) {
            const owner = enclosingClass(n);
            if (owner && owner.name && member !== undefined) {
              const k = f + KEY_SEP + owner.name.text;
              if (info.classes.get(owner.name.text) === owner && ancestorMethods(k).has(member)) facts.mutated.add(k);
            }
          } else if (member !== undefined) {
            const k = resolveClass(f, target, perFile);
            if (k !== null) facts.staticWritten.add(k);
            else facts.unknownWriteNames.add(member);
          } else {
            // computed write on an unresolved receiver: no name to match, nothing to mark
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // Name fallback: an unresolved write names a method some package class declares.
  for (const m of facts.unknownWriteNames) {
    for (const [key, c] of facts.classes) if (ancestorMethods(key).has(m)) facts.mutated.add(key);
  }
  return facts;
}

/** The staged class keys of the package: the mutated classes and their whole
 * `extends` components, with a component dropped when any member cannot be spelled. */
function stagedKeys(facts: PackageFacts): Set<string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const k of facts.classes.keys()) parent.set(k, k);
  for (const c of facts.classes.values()) {
    if (c.baseKey !== null) parent.set(find(c.key), find(c.baseKey));
  }
  const roots = new Set<string>();
  for (const m of facts.mutated) if (facts.classes.has(m)) roots.add(find(m));
  // A component that spans files is refused as a whole. Staging a base changes the
  // static type of every subclass and of every value built from them, in other files
  // too, and the measured cascade (ioredis, AFTER2: 124 -> 166 error lines) is larger
  // than the class it clears. Only same-file components are staged here.
  const filesOf = new Map<string, Set<string>>();
  for (const c of facts.classes.values()) {
    const r = find(c.key);
    if (!filesOf.has(r)) filesOf.set(r, new Set());
    filesOf.get(r)!.add(c.file);
  }
  const bad = new Set<string>();
  for (const [r, fs] of filesOf) if (fs.size > 1) bad.add(r);
  for (const c of facts.classes.values()) {
    const r = find(c.key);
    if (!roots.has(r)) continue;
    if (c.baseUnresolved) bad.add(r);
    if (classSpellingBlocker(c.decl, c.sf) !== null) bad.add(r);
    if (c.baseKey !== null) {
      const b = facts.classes.get(c.baseKey)!;
      if (staticSurfaceOf(b.decl, facts.staticWritten, b.key)) bad.add(r);
    }
  }
  const out = new Set<string>();
  for (const c of facts.classes.values()) {
    const r = find(c.key);
    if (roots.has(r) && !bad.has(r)) out.add(c.key);
  }
  return out;
}

export function mutatedClassEdits(fileName: string, text: string): string | null {
  if (!/\bclass\b/.test(text)) return null;
  const facts = gatherPackage(fileName, text);
  const staged = stagedKeys(facts);
  const mine = [...staged].map((k) => facts.classes.get(k)!).filter((c) => c.file === fileName);
  if (mine.length === 0) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Edit[] = [];
  for (const c of mine) {
    const decl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === c.name);
    if (!decl) return null;
    const out = spellClass(decl, sf, text, c.baseText);
    if (out === null) return null;
    edits.push({ start: decl.getStart(sf), end: decl.getEnd(), text: out });
  }
  edits.sort((a, b) => a.start - b.start);
  let res = "";
  let at = 0;
  for (const e of edits) {
    res += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return res + text.slice(at);
}

/** Does a class carry anything a subclass would inherit through its constructor
 * (a static member, or a static write anywhere in its package)? */
function staticSurfaceOf(cls: ts.ClassDeclaration, staticWritten: Set<string>, key: string): boolean {
  if (staticWritten.has(key)) return true;
  return cls.members.some((m) => hasModifier(m, ts.SyntaxKind.StaticKeyword));
}

/** Why a class cannot be spelled as a function constructor (null: it can). */
function classSpellingBlocker(cls: ts.ClassDeclaration, sf: ts.SourceFile): string | null {
  if (ts.canHaveDecorators?.(cls) && (ts.getDecorators?.(cls)?.length ?? 0) > 0) return "decorators";
  const st: { why: string | null } = { why: null };
  const check = (n: ts.Node): void => {
    if (st.why !== null) return;
    if (ts.isPropertyDeclaration(n)) { st.why = "field"; return; }
    if (ts.isClassStaticBlockDeclaration(n)) { st.why = "static block"; return; }
    if (ts.isPrivateIdentifier(n)) { st.why = "private name"; return; }
    if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.NewKeyword) { st.why = "new.target"; return; }
    if (n.kind === ts.SyntaxKind.SuperKeyword) {
      const p = n.parent;
      const ok = (ts.isCallExpression(p) && p.expression === n) ||
        (ts.isPropertyAccessExpression(p) && p.expression === n);
      if (!ok) st.why = "super in an unsupported position";
    }
    ts.forEachChild(n, check);
  };
  for (const m of cls.members) check(m);
  void sf;
  return st.why;
}

/** Spell one class as a function constructor plus defineProperty'd members. */
function spellClass(cls: ts.ClassDeclaration, sf: ts.SourceFile, text: string, baseText: string | null): string | null {
  const name = cls.name!.text;
  const base = baseText;
  const ctor = cls.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  // Super edits inside this class: super(...) and super.m(...) / super.m.
  const superEdits: Edit[] = [];
  let bail = false;
  const findSuper = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.SuperKeyword) {
      const p = n.parent;
      if (ts.isCallExpression(p) && p.expression === n) {
        if (base === null) { bail = true; return; }
        const open = text.indexOf("(", n.getEnd());
        const args = p.arguments.length > 0;
        superEdits.push({ start: n.getStart(sf), end: n.getEnd(), text: base + ".call" });
        superEdits.push({ start: open, end: open + 1, text: args ? "(this, " : "(this" });
        return;
      }
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        if (base === null) { bail = true; return; }
        const gp = p.parent;
        const isCall = ts.isCallExpression(gp) && gp.expression === p;
        if (isCall) {
          const open = text.indexOf("(", p.getEnd());
          const args = gp.arguments.length > 0;
          superEdits.push({ start: p.getStart(sf), end: p.getEnd(), text: `${base}.prototype.${p.name.text}.call` });
          superEdits.push({ start: open, end: open + 1, text: args ? "(this, " : "(this" });
        } else {
          superEdits.push({ start: p.getStart(sf), end: p.getEnd(), text: `${base}.prototype.${p.name.text}` });
        }
        return;
      }
      bail = true;
      return;
    }
    ts.forEachChild(n, findSuper);
  };
  for (const m of cls.members) findSuper(m);
  if (bail) return null;

  const sliceEdited = (start: number, end: number): string => {
    const es = superEdits.filter((e) => e.start >= start && e.end <= end).sort((a, b) => a.start - b.start);
    let out = "";
    let at = start;
    for (const e of es) {
      if (e.start < at) continue;
      out += text.slice(at, e.start) + e.text;
      at = e.end;
    }
    return out + text.slice(at, end);
  };
  const paramsText = (fn: ts.SignatureDeclaration): string => fn.parameters.map((p) => text.slice(p.getStart(sf), p.getEnd())).join(", ");
  const fnBody = (fn: ts.FunctionLikeDeclaration): string => {
    if (!fn.body) return "";
    return sliceEdited(fn.body.getStart(sf) + 1, fn.body.getEnd() - 1);
  };

  const lines: string[] = [];
  const ctorBodyText = ctor ? fnBody(ctor) : "";
  lines.push(`function ${name}(${ctor ? paramsText(ctor) : base !== null ? "...__sc_args" : ""}) {`);
  lines.push(`"use strict";`);
  lines.push(`if (!(this instanceof ${name})) throw new TypeError("Class constructor ${name} cannot be invoked without 'new'");`);
  if (!ctor && base !== null) lines.push(`${base}.apply(this, __sc_args);`);
  lines.push(ctorBodyText);
  lines.push(`}`);
  if (base !== null) {
    // Instance inheritance only. Object.setPrototypeOf has no lowering, so the
    // static side is not linked here: a base with a static surface is refused
    // upstream (staticSurfaceOf), so nothing static is left to inherit.
    lines.push(`${name}.prototype = Object.create(${base}.prototype, { constructor: { value: ${name}, writable: true, configurable: true, enumerable: false } });`);
  }
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m) || ts.isSemicolonClassElement(m)) continue;
    if (!(ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m))) return null;
    const isStatic = hasModifier(m, ts.SyntaxKind.StaticKeyword);
    const target = isStatic ? name : `${name}.prototype`;
    let key: string;
    if (ts.isComputedPropertyName(m.name)) key = text.slice(m.name.expression.getStart(sf), m.name.expression.getEnd());
    else if (ts.isIdentifier(m.name)) key = JSON.stringify(m.name.text);
    else if (isStringKey(m.name)) key = JSON.stringify((m.name as ts.StringLiteral | ts.NumericLiteral).text);
    else return null;
    const isAsync = hasModifier(m, ts.SyntaxKind.AsyncKeyword);
    if (ts.isMethodDeclaration(m)) {
      const gen = m.asteriskToken !== undefined;
      lines.push(`Object.defineProperty(${target}, ${key}, { value: ${isAsync ? "async " : ""}function${gen ? "*" : ""} (${paramsText(m)}) {`);
      lines.push(`"use strict";`);
      lines.push(fnBody(m));
      lines.push(`}, writable: true, enumerable: false, configurable: true });`);
    } else {
      const kind = ts.isGetAccessorDeclaration(m) ? "get" : "set";
      lines.push(`Object.defineProperty(${target}, ${key}, { ${kind}: function (${paramsText(m)}) {`);
      lines.push(`"use strict";`);
      lines.push(fnBody(m));
      lines.push(`}, enumerable: false, configurable: true });`);
    }
  }
  return lines.join("\n");
}
