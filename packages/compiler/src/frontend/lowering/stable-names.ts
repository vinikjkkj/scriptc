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

/** Renames the lifted lambdas of `functions` in place, and every reference to them anywhere in `parts`. Returns the number
 * renamed (0 when there is nothing to do). */
export function renameLiftedFunctions(functions: IrFunction[], parts: readonly unknown[]): number {
  const lambdas = new Set<string>();
  for (const f of functions) if (LAMBDA.test(f.name)) lambdas.add(f.name);
  if (lambdas.size === 0) return 0;

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
  if (finalName.size === 0) return 0;

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
  return finalName.size;
}
