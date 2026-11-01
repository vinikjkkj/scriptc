// @ts-nocheck
// A function typed with an undefined or null arm: `.call` / `.apply` read the
// member first, so a nullish value throws before the arguments; the live value
// takes the normal call.
let n: number = 0;
function se(v: any): any { console.log("se", v); n += 1; return v; }
function probe(label: string, fn: () => any) {
  try { const r = fn(); console.log(label, "ok", r); }
  catch (e: any) { console.log(label, e.constructor.name, e.message, "n=" + n); }
}
let fu: ((this: any, x: number) => number) | undefined = undefined;
let fnl: ((this: any, x: number) => number) | null = null;
probe("union call", () => fu.call(se("this"), se("arg")));
probe("union apply", () => fu.apply(se("this"), [se("arg")]));
probe("null union call", () => fnl.call(se("this"), se("arg")));
let live: ((this: any, x: number) => number) | undefined = function (x: number) { return x + 1; };
probe("live union call", () => live.call({ k: 3 }, se(4)));
console.log("total", n);
