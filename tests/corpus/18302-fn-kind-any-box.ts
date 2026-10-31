import * as util from "node:util";
async function af(): Promise<number> { return 1; }
function* gf(): Generator<number> { yield 1; }
async function* agf(): AsyncGenerator<number> { yield 1; }
class C { m(): number { return 1; } static s(): number { return 2; } }
class D extends C {}
const arrow = () => 1;
const aarrow = async () => 2;
const named = function nm() { return 3; };
const anon = function () { return 4; };
const bindTarget = function g1(a: number) { return a; };
const bound = bindTarget.bind(null);
const abound = af.bind(null);
const o = { meth() { return 5; }, am: async () => 6 };
function take(x: any): any { return x; }
const a: any = af; console.log(a);
const ar: any = arrow; console.log(ar);
const nm: any = named; console.log(util.inspect(nm));
const a2: any = af; console.log(util.inspect(a2));
