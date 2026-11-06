// `String`, `Number` and `Boolean` stored where a function taking ANY value is expected (a parameter, a field, an annotated variable,
// a record of converters): the callback converts every element an untyped array passes, like the direct call.
class Money { cents: number; constructor(cents: number) { this.cents = cents; } toString(): string { return "$" + (this.cents / 100).toFixed(2); } valueOf(): number { return this.cents; } }
const a: any[] = [1, "x", { k: 1 }, [2, [3]], null, undefined, true, "", NaN, new Money(1234)];

function conv(f: (v: any) => string): string { return a.map(f).join("|"); }
console.log(conv(String));
console.log(conv((v) => String(v)));

const holder: { f: (v: any) => string } = { f: String };
console.log(a.map(holder.f).join("|"), holder.f(5), holder.f({ k: 2 }));

const fn: (v: any) => string = String;
console.log(a.map(fn).join("|"));

function cn(f: (v: any) => number): string { return a.map(f).join("|"); }
console.log(cn(Number));
function cb(f: (v: any) => boolean): string { return a.map(f).join("|"); }
console.log(cb(Boolean));
console.log(a.filter(Boolean as (v: any) => boolean).length);

const table: Record<string, (v: any) => string> = { s: String };
console.log(table["s"](5), table["s"]({ k: 1 }), table["s"](null));
