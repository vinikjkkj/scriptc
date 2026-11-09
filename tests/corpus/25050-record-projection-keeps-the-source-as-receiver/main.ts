import { mk, mkp, mkk, mki, peek, bump } from "./lib.cjs";
interface R { n: number; name: string; exec(): number; getName(): string; readonly g: string; }
function cast(u: unknown): R { return u as R; }
function viaAny(u: any): R { const r: R = u; return r; }
function takes(r: R): string { return r.getName() + r.exec(); }
let i = 0;
for (const u of [mk() as unknown, mkp() as unknown, mkk() as unknown, mki() as unknown]) {
  i++;
  const r = cast(u);
  console.log(i, r.exec(), r.getName(), r.g);
  r.n = 100;
  console.log(i, "write through", peek(u), r.exec(), r.g);
  bump(u);
  console.log(i, "source write", r.n, r.exec(), r.g);
  console.log(i, "stable", r.exec === r.exec, typeof r.exec);
  const r2 = viaAny(u);
  console.log(i, "any", r2.exec(), r2.g, takes(u as any));
}
// A null-prototype object a record of one function member views: the member is written after the binding is initialised.
function parse(s: string): number { return s.length; }
const EJSON: { parse: typeof parse } = Object.create(null);
EJSON.parse = parse;
console.log(EJSON.parse("abc"), Object.keys(EJSON), typeof EJSON.parse);
