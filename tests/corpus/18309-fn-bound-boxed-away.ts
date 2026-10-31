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
const bb: any = take(bound); console.log(bb);
console.log(util.inspect(take(bindTarget.bind(null))));
const bb4: any = take(bound); console.log("%o", bb4);
console.log(take(abound));
