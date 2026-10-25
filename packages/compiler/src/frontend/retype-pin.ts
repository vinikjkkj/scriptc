/* RETYPE PIN: a JavaScript `var`/`let` whose later assignments store a
 * different KIND of value than its initializer's type must not get a slot of
 * the initializer's type.
 *
 * THE DEFECT. In a JavaScript source the declared type of
 * `var value = matches[i]` is what the initializer says (`string | null`); the
 * checker does not reject `value = parseInt(value, 10)` (JavaScript has no
 * annotation to violate), and Node simply stores the number. The compiled
 * slot is the union `string | null`, which has no arm for a number, so the
 * program built and then threw "a 'number' value is not representable in the
 * target union" at run time, where Node prints its answer. A refusal turned
 * into a runtime throw is not a fix, and a silent difference is the worse
 * class.
 *
 * THE REPAIR is the one the open-record rule already uses (js-desugar.ts):
 * the type is the checker's, so it has to change before the checker runs. The
 * decision is taken on one checked program; the declarations it names are
 * re-served with the initializer wrapped in an `any` cast
 * (`var value = /** @type {any} *\/ (matches[i])`), and the second load types
 * the binding as `any` everywhere it flows: the checked-dynamic slot every
 * unannotated JavaScript binding already uses.
 *
 * WHAT IS PINNED. Only what the program itself proves: a `var`/`let` with an
 * initializer and no `@type` annotation, whose declared type is made of
 * primitive kinds or objects (never `any`/`unknown`), declared INSIDE a function
 * (module-scope bindings are module globals and keep their slot), and at least one `=`
 * assignment to that very binding (anywhere in the file, closures included)
 * whose right-hand side has a kind the declared type has no arm for
 * (string, number, boolean, bigint, null, undefined, object). Objects count as
 * one kind: two different object shapes are not told apart here. */
import * as ts from "./ts7/adapter.js";

export interface RetypePin {
  /** Offsets of the initializer within the text the checker saw. */
  readonly start: number;
  readonly end: number;
  /** The initializer's own text, so the re-serve can verify its offsets. */
  readonly text: string;
  readonly why: string;
}

type Kind = "s" | "n" | "b" | "bi" | "null" | "undef" | "obj";

function kindsOf(checker: ts.TypeChecker, t0: ts.Type): Set<Kind> | null {
  const t = checker.getBaseTypeOfLiteralType(t0);
  const out = new Set<Kind>();
  for (const c of t.isUnionType() ? ts.constituentTypes(t) : [t]) {
    const f = c.flags;
    if ((f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return null;
    if ((f & ts.TypeFlags.StringLike) !== 0) out.add("s");
    else if ((f & ts.TypeFlags.NumberLike) !== 0) out.add("n");
    else if ((f & ts.TypeFlags.BooleanLike) !== 0) out.add("b");
    else if ((f & ts.TypeFlags.BigIntLike) !== 0) out.add("bi");
    else if ((f & ts.TypeFlags.Null) !== 0) out.add("null");
    else if ((f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) out.add("undef");
    else if ((f & ts.TypeFlags.ESSymbolLike) !== 0) return null;
    else out.add("obj");
  }
  return out.size === 0 ? null : out;
}

function hasTypeJsdoc(node: ts.Node): boolean {
  const text = node.getSourceFile().text;
  let i = node.getStart();
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  if (text.slice(i - 2, i) !== "*/") return false;
  const open = text.lastIndexOf("/**", i - 2);
  return open >= 0 && /@type\b/.test(text.slice(open, i));
}

function isLibFile(program: ts.Program, sf: ts.SourceFile): boolean {
  return sf.isDeclarationFile || program.isSourceFileDefaultLibrary(sf);
}

/** Function-local bindings only: a module-scope binding is a module global,
 * whose storage a dynamic slot does not take the same way (the pre-declaration
 * window of a function-valued module var is SC1030 as `any`, corpus 2861). */
function insideFunction(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isFunctionLike(p)) return true;
  }
  return false;
}

/** Members every object has through Object.prototype: never an expando, so a read of one
 * is not a reason to pin. */
const OBJECT_PROTOTYPE_NAMES = new Set([
  "constructor", "__proto__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "toString", "toLocaleString", "valueOf", "__defineGetter__", "__defineSetter__",
  "__lookupGetter__", "__lookupSetter__",
]);

/** The uses of an expando binding that keep its object in the dynamic slot. A
 * pinned object is a checked-dynamic value, and a dynamic object crossing into a
 * typed slot is COPIED, so a write the callee makes through that slot is lost.
 * (A Date crosses as a handle by reference, so this guard is for object literals.)
 * Only two uses are safe: the receiver of a property read or write, and a
 * `return` from a function with no JSDoc type of its own (its callers get the
 * dynamic value, never a typed copy made here). Any other use (an argument, a
 * stored value, a bare reference) keeps the binding as it is, and the write
 * stays the loud refusal it was. */
function onlyDynSafeUses(checker: ts.TypeChecker, sf: ts.SourceFile, sym: ts.Symbol, decl: ts.VariableDeclaration): boolean {
  let scope: ts.Node = decl;
  while (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  let ok = true;
  ts.walkPreorder(scope, (n) => {
    if (!ok) return undefined;
    if (!ts.isIdentifier(n) || n === decl.name) return undefined;
    if (checker.getSymbolAtLocation(n) !== sym) return undefined;
    const p = n.parent;
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) return undefined;
    if (ts.isReturnStatement(p)) {
      let fn: ts.Node = p;
      while (!ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
      if (!ts.isSourceFile(fn) && !jsdocTypedFn(sf, fn)) return undefined;
    }
    ok = false;
    return undefined;
  });
  return ok;
}

/** A function whose own JSDoc types it (`@returns`, `@param`, `@template`, `@type`). */
function jsdocTypedFn(sf: ts.SourceFile, fn: ts.Node): boolean {
  let i = fn.getStart(sf);
  while (i > 0 && /\s/.test(sf.text[i - 1]!)) i--;
  if (sf.text.slice(i - 2, i) !== "*/") return false;
  const open = sf.text.lastIndexOf("/**", i - 2);
  return open >= 0 && /@(?:returns?|param|template|type)\b/.test(sf.text.slice(open, i));
}

/** An EXPANDO pin (the second kind of pollution the header names). A JavaScript
 * `x.k = v` on a function-local binding `x` whose static type is a plain object
 * literal, or a non-generic, non-class interface (Date, an instance of a lib
 * interface), and which declares no member `k` and no index signature: Node adds
 * the own property, and the compiled object has no slot for it. The binding's
 * initializer is re-served as an `any` cast, so the binding is the checked-dynamic
 * slot and the write is a keyed dynamic write. Class instances keep their own
 * property-table story (lowerUndeclaredMemberWrite), arrays and generic
 * containers are not touched. */
function expandoPins(checker: ts.TypeChecker, sf: ts.SourceFile): RetypePin[] {
  const out: RetypePin[] = [];
  const seen = new Set<number>();
  // Every `x.k` over an identifier: a write (`x.k = v`) or a read. A read of a member the
  // object's type never declares (`date.label` after `date.label = ...` in another function)
  // is the same open object, and the same pin answers it.
  const writes: ts.PropertyAccessExpression[] = [];
  ts.walkPreorder(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && !OBJECT_PROTOTYPE_NAMES.has(n.name.text)) {
      writes.push(n);
    }
    return undefined;
  });
  for (const access of writes) {
    const recv = access.expression as ts.Identifier;
    const prop = access.name.text;
    const sym = checker.getSymbolAtLocation(recv);
    if (sym === undefined) continue;
    const t = checker.getTypeAtLocation(recv);
    // The receiver is an object, or a union of objects with null/undefined (a helper that returns
    // `null` on one path and the record on the other): every object arm must be open, and none may
    // declare the member.
    const arms = t.isUnionType() ? ts.constituentTypes(t) : [t];
    let open = false;
    let literal = false;
    let closed = false;
    for (const c of arms) {
      if ((c.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) continue;
      if ((c.flags & ts.TypeFlags.Object) === 0) { closed = true; break; }
      const csym = c.getSymbol();
      if (csym !== undefined && (csym.flags & ts.SymbolFlags.Class) !== 0) { closed = true; break; }
      const co = c as ts.ObjectType;
      // A JavaScript object literal is typed with ObjectFlags.JSLiteral (the checker's "open" flag for JS
      // object literals); a TypeScript one with ObjectLiteral.
      const lit = (co.objectFlags & (ts.ObjectFlags.ObjectLiteral | ts.ObjectFlags.JSLiteral)) !== 0;
      const iface = csym !== undefined && (csym.flags & ts.SymbolFlags.Interface) !== 0 &&
        (co.objectFlags & ts.ObjectFlags.Reference) === 0;
      if (!lit && !iface) { closed = true; break; }
      if (checker.getPropertyOfType(c, prop) !== undefined || checker.getIndexInfosOfType(c).length > 0) {
        closed = true;
        break;
      }
      if (lit) literal = true;
      open = true;
    }
    if (closed || !open) continue;
    for (const d of checker.declarationsOf(sym)) {
      if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      if (!ts.isVariableDeclarationList(d.parent) || !insideFunction(d)) continue;
      const stmt = d.parent.parent;
      if (hasTypeJsdoc(d) || (stmt !== undefined && hasTypeJsdoc(stmt))) break;
      const start = d.initializer.getStart();
      if (seen.has(start)) break;
      // A Date (a lib interface) crosses into the dynamic slot as a handle, by reference: no copy, so
      // every use keeps the identity. Only an object literal's copy can lose a write.
      if (literal && !onlyDynSafeUses(checker, sf, sym, d)) break;
      seen.add(start);
      const end = d.initializer.getEnd();
      out.push({
        start,
        end,
        text: sf.text.slice(start, end),
        why: `'${recv.text}' is ${checker.typeToString(t)} and takes the expando member '${prop}' it does not declare`,
      });
      break;
    }
  }
  return out;
}

export function computeRetypePins(program: ts.Program): Map<string, RetypePin[]> {
  const checker = program.getTypeChecker();
  const out = new Map<string, RetypePin[]>();
  for (const sf of program.getSourceFiles()) {
    if (isLibFile(program, sf) || !/\.(m|c)?jsx?$/.test(sf.fileName)) continue;
    // Declarations first, then assignments to them.
    const decls: ts.VariableDeclaration[] = [];
    const assigns: ts.BinaryExpression[] = [];
    // ITERATIVE (walkPreorder): a pathologically deep tree must reach the
    // deep-nesting preflight's named refusal, not overflow this pass's stack.
    ts.walkPreorder(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined &&
        ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) === 0 &&
        insideFunction(n)
      ) {
        decls.push(n);
      } else if (
        ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)
      ) {
        assigns.push(n);
      }
      return undefined;
    });
    const expando = expandoPins(checker, sf);
    if (decls.length === 0 || assigns.length === 0) {
      if (expando.length > 0) out.set(sf.fileName, expando);
      continue;
    }
    const byName = new Map<string, ts.BinaryExpression[]>();
    for (const a of assigns) {
      const name = (a.left as ts.Identifier).text;
      const l = byName.get(name);
      if (l === undefined) byName.set(name, [a]);
      else l.push(a);
    }
    const pins: RetypePin[] = [];
    for (const d of decls) {
      const name = (d.name as ts.Identifier).text;
      const cands = byName.get(name);
      if (cands === undefined) continue;
      const stmt = d.parent.parent;
      if (hasTypeJsdoc(d) || (stmt !== undefined && hasTypeJsdoc(stmt))) continue;
      const declT = kindsOf(checker, checker.getTypeAtLocation(d.name));
      if (declT === null) continue;
      let why: string | null = null;
      for (const a of cands) {
        const sym = checker.getSymbolAtLocation(a.left);
        if (sym === undefined || !checker.declarationsOf(sym).includes(d)) continue;
        const rhs = kindsOf(checker, checker.getTypeAtLocation(a.right));
        if (rhs === null) continue;
        for (const k of rhs) {
          if (!declT.has(k)) {
            why = `'${name}' declared ${[...declT].join("|")} is assigned ${[...rhs].join("|")}`;
            break;
          }
        }
        if (why !== null) break;
      }
      if (why === null) continue;
      const init = d.initializer!;
      const start = init.getStart();
      const end = init.getEnd();
      pins.push({ start, end, text: sf.text.slice(start, end), why });
    }
    for (const e of expando) if (!pins.some((p) => p.start === e.start)) pins.push(e);
    if (pins.length > 0) out.set(sf.fileName, pins);
  }
  return out;
}

/** Re-serves `text` with every pinned initializer wrapped in an `any` cast.
 * The wrap adds no line break, so line numbers are unchanged. Returns null
 * when an offset no longer names the recorded text. */
export function applyRetypePins(text: string, pins: readonly RetypePin[]): string | null {
  const sorted = [...pins].sort((a, b) => b.start - a.start);
  let out = text;
  for (const p of sorted) {
    if (out.slice(p.start, p.end) !== p.text) return null;
    out = `${out.slice(0, p.start)}/** @type {any} */ (${p.text})${out.slice(p.end)}`;
  }
  return out;
}

/** Moves retype pins taken on an unpinned text past the seed-pin wrappers
 * (`/** @type {any} *\/ (` before a seed, `)` after it) inserted into
 * `pinnedText`. The pin's own text is re-read from the pinned text, so a seed
 * wrapped INSIDE an initializer is part of what gets wrapped. */
export function shiftRetypePins(
  pins: readonly RetypePin[],
  seeds: readonly { readonly start: number; readonly end: number }[],
  pinnedText: string | null,
): RetypePin[] {
  const opener = "/** @type {any} */ (".length;
  const move = (pos: number, isEnd: boolean): number => {
    let p = pos;
    for (const s of seeds) {
      if (s.start < pos || (isEnd && s.start === pos)) p += opener;
      if (s.end <= pos) p += 1;
    }
    return p;
  };
  return pins.map((pin) => {
    const start = move(pin.start, false);
    const end = move(pin.end, true);
    return { start, end, text: pinnedText === null ? pin.text : pinnedText.slice(start, end), why: pin.why };
  });
}
