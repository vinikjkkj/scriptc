// A bound function is "bound " plus its target's name, stacking on a rebind, through typed and untyped slots alike.
function foo(a: number, b: number) { return a + b; }
const arrow = (x: number) => x;
function viaFunction(f: Function): string { return f.name; }
function viaType(f: (x: number) => number): string { return f.name; }
function viaAny(f: any): string { return f.name; }
const b1 = foo.bind(null, 1);
const b2 = arrow.bind(null);
console.log(b1.name, b2.name, b1.bind(null).name, b2.bind(null).bind(null).name);
console.log(viaFunction(b1), viaFunction(b2), viaFunction(b1.bind(null)), viaType(arrow), viaType(b2), viaAny(b2), viaAny(foo.bind(null)));
console.log(viaType((x) => x + 1) === "", viaFunction(function () {}) === "");
