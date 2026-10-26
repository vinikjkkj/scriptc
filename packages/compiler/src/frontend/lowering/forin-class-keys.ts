/* The key-order model of for-in over a CLASS INSTANCE (SC1052).
 *
 * Node's `for (k in obj)` on an instance lists its OWN enumerable string
 * keys in creation order, then the enumerable inherited ones. For a class
 * instance the keys are the instance's own properties, created by the
 * class's field definitions (base first, in declaration order) and by any
 * later property write. A value statically typed as class C may be an
 * instance of any class in C's subtree, so the key list is selected by the
 * RUNTIME class (an instanceof chain, deepest subclass first, as the union
 * for-in selects its arm by tag).
 *
 * The walk is exact only when every key's creation position is static:
 *   - every class in the chain is a user class (no runtime-provided base:
 *     an EventEmitter base also contributes enumerable prototype keys);
 *   - no instance property is created outside the field definitions (the
 *     constructor/method-assigned fields `collectedFields` appear at run
 *     time, in run-time order, so their position is not static);
 *   - no hidden captured fields, parameter properties, symbol-keyed fields,
 *     private or accessor-spelled members;
 *   - in TypeScript sources every field has an initializer (an
 *     initializer-less TS field's creation depends on useDefineForClassFields);
 *   - the subclass set is closed: every class whose `extends` names C in the
 *     compiled program is a registered user class (a class expression
 *     extending the tree is refused, since it may register after this site).
 * Anything else returns a refusal with its reason; nothing is guessed.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { constituentTypes } from "../ts7/checker.js";
import { isJsSourceFileName } from "../shared.js";

export interface ClassKeyEntry {
  info: ClassInfo;
  /** The own keys in Node's creation order (base fields first). */
  keys: string[];
  /** Ancestor count, the dispatch priority (deepest first). */
  depth: number;
}

export type ClassKeyPlan =
  | { ok: true; base: ClassKeyEntry; subs: ClassKeyEntry[] }
  | { ok: false; reason: string };

interface SubclassIndex {
  /** parent class symbol -> class-like declarations extending it */
  children: Map<ts.Symbol, ts.ClassLikeDeclaration[]>;
  /** an `extends` whose base does not resolve to a class symbol: it may
   * extend anything, so the closed world is unknown (refused, loudly) */
  unresolved: string | null;
  /** a `delete` whose receiver may be a class instance (a class-typed or
   * untyped receiver): it removes a key the walk would still list */
  unsafeDelete: string | null;
}

const indexCache = new WeakMap<Lowerer, SubclassIndex>();

/** One iterative pass over every non-declaration source file (no recursion:
 * a 7000-level expression must not overflow the stack here). */
function subclassIndexOf(L: Lowerer): SubclassIndex {
  const cached = indexCache.get(L);
  if (cached) return cached;
  const children = new Map<ts.Symbol, ts.ClassLikeDeclaration[]>();
  let unresolved: string | null = null;
  let unsafeDelete: string | null = null;
  for (const sf of L.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
        for (const h of node.heritageClauses) {
          if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          const base = h.types[0];
          if (!base) continue;
          let sym = L.checker.getSymbolAtLocation(base.expression) ?? undefined;
          if (sym && sym.flags & ts.SymbolFlags.Alias) sym = L.checker.getAliasedSymbol(sym);
          if (!sym) {
            unresolved ??= `an 'extends' at ${sf.fileName}:${sf.getLineAndCharacterOfPosition(base.getStart(sf)).line + 1} does not name a class`;
            continue;
          }
          const list = children.get(sym) ?? [];
          list.push(node);
          children.set(sym, list);
        }
      }
      if (ts.isDeleteExpression(node) && unsafeDelete === null) {
        let operand: ts.Expression = node.expression;
        while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
        if (ts.isPropertyAccessExpression(operand) || ts.isElementAccessExpression(operand)) {
          const rt = L.checker.getTypeAtLocation(operand.expression);
          const isClassDecl = (sym: ts.Symbol | undefined): boolean =>
            sym !== undefined && L.checker.declarationsOf(sym).some((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d));
          const constituents: readonly ts.Type[] = rt.isUnionType() ? constituentTypes(rt) : [rt];
          if (rt.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            unsafeDelete = `a delete on an untyped receiver (${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`;
          } else if (constituents.some((t: ts.Type) => isClassDecl(t.getSymbol()))) {
            unsafeDelete = `a delete on a class-typed receiver (${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`;
          }
        }
      }
      ts.forEachChild(node, (c) => {
        stack.push(c);
      });
    }
  }
  const idx: SubclassIndex = { children, unresolved, unsafeDelete };
  indexCache.set(L, idx);
  return idx;
}

/** The keys one class contributes, or a refusal. `chain` is base-first. */
function ownKeysOf(chain: ClassInfo[], last: ClassInfo): string[] | string {
  for (const c of chain) {
    if (c.def.runtime === true || c.builtinEmitter === true || c.builtinError === true ||
        c.builtinStream !== undefined || c.protoClass === true) {
      return `'${c.def.name}' extends a runtime-provided class (${c.def.name.startsWith('%') ? c.def.name.slice(1) : c.def.name}): its prototype keys are enumerable and identity-bearing`;
    }
    if (c.collectedFields && c.collectedFields.size > 0) {
      return `'${c.def.name}' creates instance properties outside its field definitions (run-time creation order)`;
    }
    if (c.captures && c.captures.length > 0) return `'${c.def.name}' carries hidden captured fields`;
    if (c.paramProps && c.paramProps.length > 0) return `'${c.def.name}' declares parameter properties`;
    if (c.symbolFields && c.symbolFields.size > 0) return `'${c.def.name}' has symbol-keyed fields`;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const c of chain) {
    const jsOwner = c.decl !== null && isJsSourceFileName(c.decl.getSourceFile().fileName);
    for (const f of c.fieldOrder) {
      if (f.name.startsWith("%")) return `'${c.def.name}' carries hidden storage for dynamically defined properties ('${f.name}')`;
      if (f.name.includes("#") || f.name.startsWith("get:") || f.name.startsWith("set:")) {
        return `'${c.def.name}' has a private or accessor member '${f.name}'`;
      }
      if (f.initializer === undefined && !jsOwner && f.resetsToUndefined === undefined && f.redeclared !== true) {
        return `'${c.def.name}.${f.name}' is a TypeScript field without an initializer (its creation depends on useDefineForClassFields)`;
      }
      // A redeclared inherited field reuses the base slot: its key already
      // exists at the base position, so the first occurrence wins.
      if (!seen.has(f.name)) {
        seen.add(f.name);
        keys.push(f.name);
      }
    }
  }
  for (const k of keys) {
    if (!last.fields.has(k)) return `the key '${k}' is not a layout field of '${last.def.name}'`;
  }
  return keys;
}

/** Keys of a class instance (`className`), dispatched by runtime class. */
export function classInstanceKeyPlan(L: Lowerer, className: string): ClassKeyPlan {
  const info = L.classes.get(className);
  if (!info) return { ok: false, reason: `class '${className}' is not a compiled user class` };
  if (!info.decl || !info.decl.name) return { ok: false, reason: "an anonymous class" };
  let cSym: ts.Symbol | undefined = L.checker.getSymbolAtLocation(info.decl.name);
  if (cSym && cSym.flags & ts.SymbolFlags.Alias) cSym = L.checker.getAliasedSymbol(cSym);
  if (!cSym) return { ok: false, reason: `class '${className}' has no symbol` };
  const index = subclassIndexOf(L);
  if (index.unresolved !== null) return { ok: false, reason: `${index.unresolved}, so the subclass set is not closed` };
  if (index.unsafeDelete !== null) return { ok: false, reason: `${index.unsafeDelete} may remove a key of a class instance` };
  // Closed-world subtree of the static class.
  const tree: ts.ClassLikeDeclaration[] = [];
  const treeSyms = new Set<ts.Symbol>([cSym]);
  const queue: ts.Symbol[] = [cSym];
  while (queue.length > 0) {
    const sym = queue.shift()!;
    for (const child of index.children.get(sym) ?? []) {
      if (ts.isClassExpression(child)) {
        return { ok: false, reason: `a subclass of '${className}' is a class expression (it may register after this site)` };
      }
      tree.push(child);
      const cs = child.name ? L.checker.getSymbolAtLocation(child.name) : undefined;
      if (!cs) return { ok: false, reason: `a subclass of '${className}' has no symbol` };
      if (!treeSyms.has(cs)) {
        treeSyms.add(cs);
        queue.push(cs);
      }
    }
  }
  const chainOf = (start: ClassInfo): ClassInfo[] | string => {
    const chain: ClassInfo[] = [];
    let cur: ClassInfo | undefined = start;
    while (cur) {
      chain.unshift(cur);
      if (chain.length > 4096) return `the base chain of '${start.def.name}' is unbounded`;
      if (!cur.def.base) break;
      const next: ClassInfo | undefined = L.classes.get(cur.def.base);
      if (!next) return `the base '${cur.def.base}' of '${cur.def.name}' is not a compiled user class`;
      cur = next;
    }
    return chain;
  };
  const baseChain = chainOf(info);
  if (typeof baseChain === "string") return { ok: false, reason: baseChain };
  const baseKeys = ownKeysOf(baseChain, info);
  if (typeof baseKeys === "string") return { ok: false, reason: baseKeys };
  const subs: ClassKeyEntry[] = [];
  for (const decl of tree) {
    const sym = L.checker.getSymbolAtLocation(decl.name!);
    const sub = sym ? L.classBySymbol.get(sym) : undefined;
    if (!sub) return { ok: false, reason: `a subclass of '${className}' is not a registered user class` };
    const chain = chainOf(sub);
    if (typeof chain === "string") return { ok: false, reason: chain };
    const keys = ownKeysOf(chain, sub);
    if (typeof keys === "string") return { ok: false, reason: keys };
    subs.push({ info: sub, keys, depth: chain.length });
  }
  return { ok: true, base: { info, keys: baseKeys, depth: baseChain.length }, subs };
}
