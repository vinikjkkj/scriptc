// A spread last among the arguments, landing on the fixed parameters of an untyped JS signature (ioredis's `new Redis(...args)`): the spread's
// elements fill the parameters in order, a missing element is undefined and surplus elements are dropped, for constructors and plain functions.
class Redis {
  constructor(arg1, arg2, arg3) {
    this.a = arg1; this.b = arg2; this.c = arg3;
  }
}
function make(...args) { return new Redis(...args); }
function three(x, y, z) { return [x, y, z].map(String).join("/"); }
function viaCall(...args) { return three(...args); }
function lead(first, ...args) { return three(first, ...args); }
for (const r of [make("x", 2), make(), make(1, 2, 3, 4)]) console.log(r.a, r.b, r.c);
console.log(viaCall("p"), viaCall("p", "q", "r", "s"), viaCall(), lead("L", "m"));
function fromString(args) { return three(...args); }
console.log(fromString("abc"), fromString(["only"]), fromString(new Set([7, 8])));
try { fromString(5); } catch (e) { console.log(e.constructor.name); }
