// String(f) of a function that crossed a converted parameter slot is the text of f itself; a bound function prints as native code.
function foo(a: number) { return a + 1; }
const arrow = (x: number) => x * 2;
function viaFunction(f: Function): string { return String(f); }
function viaType(f: (x: number) => number): string { return f.toString(); }
console.log(viaFunction(foo));
console.log(viaFunction(arrow));
console.log(viaType(foo), viaType(arrow));
const bound = foo.bind(null);
console.log(viaFunction(bound), viaFunction(bound.bind(null)));
