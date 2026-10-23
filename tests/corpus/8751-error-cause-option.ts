function mk(msg: string, cause: unknown): Error { return new Error(msg, { cause }); }
const e = mk("outer", new Error("inner"));
console.log(e.message, (e.cause as Error).message, e.cause instanceof Error);
const e2 = new Error("plain");
console.log(e2.cause === undefined);
class WrapErr extends Error {
  constructor(m: string, inner: unknown) { super(m, { cause: inner }); this.name = "WrapErr"; }
}
const w = new WrapErr("w", "str-cause");
console.log(w.message, w.name, w.cause, w instanceof Error);
const t = TypeError("t", { cause: 42 });
console.log(t.cause, t.name, String(t));
let n = 0;
const e3 = new Error("o", { cause: ++n, extra: ++n } as any);
console.log(e3.cause, n);
try { throw new RangeError("r", { cause: { code: 7 } }); } catch (x) { console.log(((x as Error).cause as { code: number }).code); }
