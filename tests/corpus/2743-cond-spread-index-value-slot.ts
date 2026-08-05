// `...(c ? { k: v } : {})` into a PURE index-signature target whose value
// slot has no "absent" of its own — `Record<string, string>` (the IQ-attrs
// builder idiom) and `Record<string, unknown>`.
//
// The merge helper models presence with the OVERFLOW entry itself: the key
// is written only on the present side, so an absent key is genuinely
// absent — `Object.keys` and `JSON.stringify` both agree with Node. The
// value travels widened to `T | undefined` (or, for an `unknown` slot, as
// the checked-dynamic tree's own undefined) purely as the helper's
// signalling channel; it narrows back before the keyed write.
//
// The evaluation shape is the part worth pinning: `cond` runs exactly ONCE
// (it is lowered once and used once, even where it is an impure indexed
// read), and the carried value runs only when its arm is taken.

function attrsFirst(c: string | undefined): Record<string, string> {
  return { ...(c ? { id: c } : {}), to: "x", type: "get" };
}

function attrsLast(c: string | undefined): Record<string, string> {
  return { to: "x", ...(c ? { id: c } : {}) };
}

function unknownSlot(c: boolean, v: number): Record<string, unknown> {
  return { ...(c ? { n: v } : {}), k: 1 };
}

// The EMPTY arm on the TRUE side (the reversed orientation).
function emptyTrueArm(c: boolean, v: string): Record<string, string> {
  return { to: "y", ...(c ? {} : { id: v }) };
}

let calls = 0;
function mk(s: string): string {
  calls += 1;
  return s;
}
function lazyValue(c: boolean): Record<string, string> {
  return { ...(c ? { id: mk("a") } : {}), to: "z" };
}

let conds = 0;
function pick(b: boolean): boolean {
  conds += 1;
  return b;
}
function condOnce(b: boolean): Record<string, string> {
  return { ...(pick(b) ? { id: "1" } : {}), to: "w" };
}

// Mixed with a real spread source, and with a runtime-keyed property.
function withSpread(base: Record<string, string>, c: boolean): Record<string, string> {
  return { ...base, ...(c ? { id: "1" } : {}), to: "m" };
}
function withRuntimeKey(k: string, c: boolean): Record<string, string> {
  return { [k]: "kv", ...(c ? { id: "1" } : {}) };
}

// A numeric slot: the widening is not string-specific.
function numSlot(c: boolean): Record<string, number> {
  return { ...(c ? { n: 1 } : {}), base: 2 };
}

// The cond is an INDEXED read on the value being rebuilt — the zapo shape,
// and the one a naive desugar would evaluate twice. (An undefined-armed
// source slot, which is what the same read is under
// noUncheckedIndexedAccess.)
function rebuild(attrs: Record<string, string | undefined>): Record<string, string> {
  return { ...(attrs["id"] ? { id: attrs["id"] } : {}), to: "d", type: "result" };
}

// The same root in its other spelling: a whole spread SOURCE that may be
// absent. `{ ...maybe }` over `Record<K, V> | undefined` spreads nothing
// for the nullish arm, exactly like copying an empty record.
interface UsyncInput {
  readonly attrs?: Record<string, string>;
  readonly jid: string;
}
function usync(input: UsyncInput): Record<string, string> {
  return { ...input.attrs, jid: input.jid };
}
function bind(bindings: Record<string, unknown>, context?: Record<string, unknown>): Record<string, unknown> {
  return { ...bindings, ...context };
}
function nullableSource(m: Record<string, string> | null): Record<string, string> {
  return { ...m, tail: "t" };
}
// An absent source COMBINED with a conditional spread.
function both(m: Record<string, string> | undefined, c: boolean): Record<string, string> {
  return { ...m, ...(c ? { id: "1" } : {}), to: "b" };
}

function keys(r: Record<string, unknown>): string {
  return Object.keys(r).join(",");
}

function main(): void {
  const a = attrsFirst(undefined);
  console.log("A", JSON.stringify(a), keys(a));
  const b = attrsFirst("v1");
  console.log("B", JSON.stringify(b), keys(b));
  const c = attrsLast(undefined);
  console.log("C", JSON.stringify(c), keys(c));
  const d = attrsLast("v2");
  console.log("D", JSON.stringify(d), keys(d));
  const e = unknownSlot(false, 7);
  console.log("E", JSON.stringify(e), keys(e));
  const f = unknownSlot(true, 7);
  console.log("F", JSON.stringify(f), keys(f));
  const g = emptyTrueArm(false, "v3");
  console.log("G", JSON.stringify(g), keys(g));
  const h = emptyTrueArm(true, "v3");
  console.log("H", JSON.stringify(h), keys(h));
  const i = lazyValue(false);
  console.log("I", "calls=" + calls, JSON.stringify(i), keys(i));
  const j = lazyValue(true);
  console.log("J", "calls=" + calls, JSON.stringify(j), keys(j));
  const k = condOnce(false);
  console.log("K", "conds=" + conds, JSON.stringify(k), keys(k));
  const l = condOnce(true);
  console.log("L", "conds=" + conds, JSON.stringify(l), keys(l));
  const base: Record<string, string> = { a: "1" };
  const m = withSpread(base, false);
  console.log("M", JSON.stringify(m), keys(m));
  const n = withSpread(base, true);
  console.log("N", JSON.stringify(n), keys(n));
  const o = withRuntimeKey("dyn", false);
  console.log("O", JSON.stringify(o), keys(o));
  const p = withRuntimeKey("dyn", true);
  console.log("P", JSON.stringify(p), keys(p));
  const q = numSlot(false);
  console.log("Q", JSON.stringify(q), keys(q));
  const r = numSlot(true);
  console.log("R", JSON.stringify(r), keys(r));
  const s = rebuild({ from: "f" });
  console.log("S", JSON.stringify(s), keys(s));
  const t = rebuild({ id: "i9", from: "f" });
  console.log("T", JSON.stringify(t), keys(t));
  // The absent key must be absent to every observer, not merely
  // undefined-valued.
  console.log("U", Object.keys(a).indexOf("id"), Object.keys(b).indexOf("id"), Object.keys(a).length, Object.keys(b).length);
  const v = usync({ jid: "j1" });
  console.log("V", JSON.stringify(v), keys(v));
  const w = usync({ attrs: { index: "3", last: "true" }, jid: "j2" });
  console.log("W", JSON.stringify(w), keys(w));
  const x = bind({ svc: "s" }, undefined);
  console.log("X", JSON.stringify(x), keys(x));
  const y = bind({ svc: "s" }, { req: 4 });
  console.log("Y", JSON.stringify(y), keys(y));
  console.log("Z", JSON.stringify(nullableSource(null)), JSON.stringify(nullableSource({ h: "1" })));
  console.log("AA", JSON.stringify(both(undefined, false)), JSON.stringify(both({ z: "0" }, true)));
}

main();
