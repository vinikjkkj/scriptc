/* Stable names for lifted closures.
 *
 * The lowerer names every lifted lambda `%fn<N>[_<what>]` from one module-wide counter, so ANY lambda added, removed or
 * lowered in a different order changes the name of every lambda after it. Symbols then differ between builds of nearly the
 * same program: a profile or an order file keyed on them goes stale, and two builds cannot be diffed by name.
 *
 * This pass runs once, on the finished function list, and renames each lambda from what is NOT global: its parent (the
 * function whose body creates or calls it) and its ordinal among that parent's lambdas, in the order the parent's body
 * mentions them:
 *
 *     %fn.<6 base-36 chars of a hash of the parent's final name>.<ordinal>[_<what>]
 *
 * An edit inside one function can only move the names of the lambdas of THAT function (and of their own descendants); every
 * other function keeps its name. The name is a pure function of the parent's name, so a rename of a root function (which is
 * the program's own name, e.g. `%m47.feMul`) is the only thing that propagates. A lambda that no function mentions keeps its
 * counter name (it is dead code and nothing keys on it).
 *
 * The other counter-named families (the interned helpers `%promise.adapt.N`, `%rec.width.N`, `%union.retag.N`, `%fn.adapt.N`,
 * `%fn.width.N`, `%boundmeth.N`, `%obj.cview.N`, `%union.field.N`, `%obj.width.N`) are named from a hash of what they ARE: their
 * parameters, result type and body, with every counter-named symbol and every record/union id replaced by a placeholder or by the
 * shape's own structure. Two helpers with the same structure are told apart by their order of appearance. A lambda no function
 * mentions is named the same way (from its own content) instead of keeping its counter name.
 *
 * Nothing about behaviour changes: only strings that are IR symbol names are rewritten (every name starts with `%`), and
 * string literal payloads are never touched. */
import type { IrFunction } from "../../ir/nodes.js";

const LAMBDA = /^%fn(\d+)(_[A-Za-z0-9_$]*)?$/;
/** Keys whose string value is DATA (a literal's text), never a symbol name. */
const DATA_KEYS = new Set(["value", "text", "raw", "cooked", "pattern", "flags", "source", "literal", "message", "chars", "bytes"]);

/** 6 base-36 characters (about 2.1e9 values) of an FNV-1a hash: short because the name is a symbol that every binary carries, and '.'
 * (not '~') is the separator because the C mangler maps it to one character instead of five. */
function hash6(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(-6);
}
/** The mangled form the C and LLVM backends make of a name ('.' becomes '_'): two names equal here would collide as symbols. */
const mangled = (n: string): string => n.replace(/\./g, "_");

/** The lambda names a function body mentions, in first-mention order. */
function mentions(body: unknown, lambdas: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [body];
  // iterative pre-order, children pushed in reverse so the visit order is the document order
  while (stack.length > 0) {
    const n = stack.pop();
    if (typeof n === "string") {
      if (lambdas.has(n) && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
      continue;
    }
    if (n === null || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]);
      continue;
    }
    const rec = n as Record<string, unknown>;
    const keys = Object.keys(rec);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]!;
      if (k === "loc" || k === "type") continue;
      const v = rec[k];
      if (typeof v === "string" && DATA_KEYS.has(k)) continue; // a literal's text, not a symbol
      stack.push(v);
    }
  }
  return out;
}

/** The interned-helper families the lowerer numbers from a shared counter (`%arr.map.12`, `%rec.width.7`, `%unit.strand.3`, ...): a known
 * first segment, one more word, and a decimal tail. `%init.N` (the per-module initialiser) and user symbols are not in it. */
const HELPER_FAMILIES = "(?:unit|union|util|arr|obj|object|bytes|defer|rec|assert|emitter|str|emit|lying|env|map|promise|strdec|class|server|cls|iter)\\.[A-Za-z]+|ctorwitness|boundmeth|bindthis|fn\\.(?:adapt|width)";
const HELPER_BASE = new RegExp(`^%(${HELPER_FAMILIES})\\.(\\d+)$`);
const HELPER_TOKEN = new RegExp(`(?<![A-Za-z0-9_])(${HELPER_FAMILIES})\\.(\\d+)(?![A-Za-z0-9])`, "g");
const COUNTER_LAMBDA_TOKEN = /(?<![A-Za-z0-9_])fn\d+(?:_[A-Za-z0-9_$]*)?(?![A-Za-z0-9_])/g;

export interface StableNameTables {
  records?: readonly { id: string; fields: readonly { name: string; type: unknown }[]; view?: boolean }[];
  unions?: readonly { id: string; arms: readonly unknown[] }[];
}

/** A canonical text of an IR subtree that does not depend on any counter: `loc` dropped, counter-named symbols replaced by a
 * placeholder, record and union ids replaced by the shape's own structure (to a bounded depth). */
function canonical(root: unknown, tables: StableNameTables): string {
  const recs = new Map((tables.records ?? []).map((r) => [r.id, r]));
  const unis = new Map((tables.unions ?? []).map((u) => [u.id, u]));
  // A shape is described by a short digest of its own structure, memoised per (id, depth): expanding it inline at every mention
  // grows with fields^depth, and a real program's wide, mutually referencing records (pg, ioredis, mysql2) overflow an array.
  const digests = new Map<string, string>();
  const digest = (id: string, depth: number, isUnion: boolean): string => {
    const key = (isUnion ? "U" : "R") + depth + ":" + id;
    let d = digests.get(key);
    if (d !== undefined) return d;
    const tmp: string[] = [];
    if (isUnion) {
      for (const arm of unis.get(id)!.arms) walk(arm, depth + 1, tmp);
    } else {
      const shape = recs.get(id)!;
      for (const f of shape.fields) {
        tmp.push(JSON.stringify(f.name), ":");
        walk(f.type, depth + 1, tmp);
      }
      tmp.push(shape.view ? "view" : "plain");
    }
    d = hash6(tmp.join(""));
    digests.set(key, d);
    return d;
  };
  const walk = (n: unknown, depth: number, out: string[]): void => {
    if (typeof n === "string") {
      out.push(JSON.stringify(n.charCodeAt(0) === 37 ? n.replace(HELPER_TOKEN, "$1.#").replace(COUNTER_LAMBDA_TOKEN, "fn#") : n));
      return;
    }
    if (n === null || typeof n !== "object") {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      out.push("[");
      for (const x of n) walk(x, depth, out);
      out.push("]");
      return;
    }
    const rec = n as Record<string, unknown>;
    out.push("{");
    for (const k of Object.keys(rec)) {
      if (k === "loc") continue;
      out.push(k, "=");
      const v = rec[k];
      // a record or union id is a first-seen counter: say what the shape IS instead (to a bounded depth)
      if (k === "shapeId" && typeof v === "string") {
        out.push(recs.has(v) && depth < 3 ? "R:" + digest(v, depth, false) : "R#");
        continue;
      }
      if (k === "unionId" && typeof v === "string") {
        out.push(unis.has(v) && depth < 3 ? "U:" + digest(v, depth, true) : "U#");
        continue;
      }
      walk(v, depth, out);
    }
    out.push("}");
  };
  const out: string[] = [];
  walk(root, 0, out);
  return out.join("");
}

/** Renames the interned helper functions (see the header) and every reference to them. */
function renameHelpers(functions: IrFunction[], parts: readonly unknown[], tables: StableNameTables): number {
  const bases: IrFunction[] = [];
  for (const f of functions) if (HELPER_BASE.test(f.name)) bases.push(f);
  if (bases.length === 0) return 0;
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const f of functions) if (!HELPER_BASE.test(f.name)) used.add(mangled(f.name));
  for (const f of bases) {
    const fam = HELPER_BASE.exec(f.name)![1]!;
    const h = hash6(fam + "|" + canonical({ p: f.params, r: f.returnType, a: f.async, b: f.body }, tables));
    let name = `%${fam}.${h}`;
    let k = 0;
    while (used.has(mangled(name))) name = `%${fam}.${h}_${++k}`;
    used.add(mangled(name));
    names.set(f.name, name);
  }
  const rewrite = (s: string): string => {
    if (s.charCodeAt(0) !== 37) return s;
    return s.replace(HELPER_TOKEN, (w) => {
      const to = names.get("%" + w);
      return to === undefined ? w : to.slice(1);
    });
  };
  rewriteAll(parts, rewrite);
  return names.size;
}

/** Applies `rewrite` to every symbol-name string reachable from `parts`, never to literal payloads or `loc`. */
function rewriteAll(parts: readonly unknown[], rewrite: (s: string) => string): void {
  const stack: unknown[] = [...parts];
  // An IR node can be reachable twice (a shared subtree); a rewrite that ran on it twice would rewrite its own output, and a new name
  // that starts with digits ("6adw58") would then be taken for the counter 6 followed by letters.
  const seen = new Set<object>();
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === null || typeof n !== "object") continue;
    if (seen.has(n)) continue;
    seen.add(n);
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        const v = n[i];
        if (typeof v === "string") n[i] = rewrite(v);
        else stack.push(v);
      }
      continue;
    }
    const rec = n as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (k === "loc") continue;
      const v = rec[k];
      if (typeof v === "string") {
        if (!DATA_KEYS.has(k)) rec[k] = rewrite(v);
      } else stack.push(v);
    }
  }
}

/** Renames the lifted lambdas of `functions` in place, and every reference to them anywhere in `parts`. Returns the number
 * renamed (0 when there is nothing to do). */
export function renameLiftedFunctions(functions: IrFunction[], parts: readonly unknown[], tables: StableNameTables = {}): number {
  const helpers = renameHelpers(functions, parts, tables);
  const lambdas = new Set<string>();
  for (const f of functions) if (LAMBDA.test(f.name)) lambdas.add(f.name);
  if (lambdas.size === 0) return helpers;

  // parent -> its lambdas in mention order; first mention (in function-list order) wins
  const claimed = new Set<string>();
  const children = new Map<string, string[]>();
  for (const f of functions) {
    const own: string[] = [];
    for (const l of mentions(f.body, lambdas)) {
      if (l === f.name || claimed.has(l)) continue;
      claimed.add(l);
      own.push(l);
    }
    if (own.length > 0) children.set(f.name, own);
  }

  // roots first: a lambda is named only once its parent's FINAL name is known
  const finalName = new Map<string, string>();
  const used = new Set<string>();
  for (const f of functions) if (!lambdas.has(f.name)) used.add(mangled(f.name));
  const queue: string[] = [];
  for (const f of functions) if (!lambdas.has(f.name)) queue.push(f.name);
  // a lambda nothing mentions: named from its own content, then a root for its descendants
  for (const f of functions) {
    if (!lambdas.has(f.name) || claimed.has(f.name)) continue;
    const m = LAMBDA.exec(f.name)!;
    const h = hash6("orphan|" + canonical({ p: f.params, r: f.returnType, a: f.async, b: f.body }, tables));
    let name = `%fn.${h}.o${m[2] ?? ""}`;
    let k = 0;
    while (used.has(mangled(name))) name = `%fn.${h}.o${++k}${m[2] ?? ""}`;
    used.add(mangled(name));
    finalName.set(f.name, name);
    queue.push(f.name);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const parent = queue[qi]!;
    const kids = children.get(parent);
    if (kids === undefined) continue;
    const parentFinal = finalName.get(parent) ?? parent;
    const h = hash6(parentFinal);
    let ordinal = 0;
    for (const kid of kids) {
      const m = LAMBDA.exec(kid)!;
      let name = `%fn.${h}.${ordinal++}${m[2] ?? ""}`;
      while (used.has(mangled(name))) name += "x"; // a hash collision: deterministic, still unique as a symbol
      used.add(mangled(name));
      finalName.set(kid, name);
      queue.push(kid);
    }
  }
  if (finalName.size === 0) return helpers;

  // rewrite: a symbol string starting with '%' that mentions a renamed lambda, as a whole word
  const word = /(?<![A-Za-z0-9_])fn\d+(?:_[A-Za-z0-9_$]*)?(?![A-Za-z0-9_])/g;
  const rewrite = (s: string): string => {
    if (s.charCodeAt(0) !== 37 || s.indexOf("fn") < 0) return s;
    return s.replace(word, (w) => {
      const to = finalName.get("%" + w);
      return to === undefined ? w : to.slice(1);
    });
  };
  const stack: unknown[] = [...parts];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === null || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        const v = n[i];
        if (typeof v === "string") n[i] = rewrite(v);
        else stack.push(v);
      }
      continue;
    }
    const rec = n as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (k === "loc") continue;
      const v = rec[k];
      if (typeof v === "string") {
        if (!DATA_KEYS.has(k)) rec[k] = rewrite(v);
      } else stack.push(v);
    }
  }
  return finalName.size + helpers;
}
