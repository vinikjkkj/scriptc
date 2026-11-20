// A const alias of Object.prototype.toString answers the [[Class]] probe through .call like Node, over every value kind.
const toStr = Object.prototype.toString;
function tag(x: unknown) { return toStr.call(x); }
console.log(tag([]), tag(2), tag({}), tag(null), tag("a"), tag(true), tag(new Set<number>()), tag(new Error("x")), tag(Promise.resolve()), tag(undefined), tag(() => 1), tag(new Date(0)), tag(/x/), tag(Symbol("s")), tag(1n), tag(Buffer.from("a")));
const loc = Object.prototype.toString; console.log(loc.call([1]), loc.call(null));
function f() { const t = Object.prototype.toString; return t.call(new Map<string, number>()) + t.call(Uint8Array.of(1)); } console.log(f());
