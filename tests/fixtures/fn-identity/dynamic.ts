function g(n: number): boolean { return n === 42; }
function h(n: number): boolean { return n === 7; }
const arrow = (n: number): boolean => n > 0;
const anon = function (n: number): boolean { return n < 0; };
const named = function inner(n: number): boolean { return n === 1; };
class K { static s(n: number): boolean { return n === 3; } m(n: number): boolean { return n === 4; } }
class C { x = 1; }
function take(f: (n: number) => boolean): string { return f.name; }
function takeFn(f: Function): string { return f.name; }
function takeAny(f: any): string { return f.name; }
function make(): (n: number) => boolean { return (n) => n === 9; }
console.log("p-decl " + take(g) + "|" + take(h));
console.log("p-arrow " + take(arrow) + "|" + take(anon) + "|" + take(named));
console.log("p-literal [" + take((n) => n === 1) + "]|[" + take(function (n) { return n === 2; }) + "]");
console.log("p-bound " + take(g.bind(null)) + "|" + take(arrow.bind(null)) + "|" + take(g.bind(null).bind(null)));
console.log("p-static " + take(K.s));
console.log("p-factory [" + take(make()) + "]");
console.log("p-array " + take([g, arrow][0]!) + "|" + take([g, arrow][1]!));
console.log("p-record " + take({ a: g, b: arrow }.a) + "|" + take({ a: g, b: arrow }.b));
console.log("p-function " + takeFn(g) + "|" + takeFn(arrow) + "|" + takeFn(g.bind(null)));
console.log("p-any " + takeAny(g) + "|" + takeAny(arrow) + "|" + takeAny(g.bind(null)) + "|" + takeAny(C) + "|[" + takeAny(class {}) + "]");
let f = g;
console.log("r-1 " + f.name);
f = h;
console.log("r-2 " + f.name);
let af = arrow;
af = anon;
console.log("r-3 " + af.name);
af = af.bind(null);
console.log("r-4 " + af.name);
let cond = process.argv.length > 99;
let pick = cond ? g : h;
console.log("r-5 " + pick.name);
let fe = function (n: number): boolean { return n === 1; };
console.log("r-6 " + fe.name);
fe = (n) => n === 2;
console.log("r-7 " + fe.name);
let loop = g;
for (let i = 0; i < 2; i++) { loop = i === 0 ? arrow : h; }
console.log("r-8 " + loop.name);
