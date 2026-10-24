import * as util from "node:util";
const arr: number[] = [];
function f(): number[] { arr.push(arr.length); return arr; }
let name = "a";
function setName(): string { name = "b"; return "set"; }
console.log(name, setName(), name);
let cnt = 0;
function inc(): number { return ++cnt; }
console.log(cnt, inc(), cnt, inc());
console.log(f());
console.log(f(), "x", f(), 3);
const s = util.format("%j %s", f(), f());
console.log(s);
console.log(util.format(f(), f()));
const m = new Map<string, number>();
function addm(): number { m.set("k" + m.size, m.size); return m.size; }
console.log(m, addm(), m);
function v(): void { cnt += 10; }
console.log(v(), cnt, inc());
async function main() {
  const o = { n: 0 };
  const g = async () => { o.n++; return o; };
  console.log(o, await g(), o);
  console.log(await g(), await g());
}
main();
class P { x = 0; bump(): P { this.x++; return this; } }
const p = new P();
console.log(p.bump(), p.bump(), p);
console.log("%s %O", p.bump(), p.bump());
console.log(p, `${p.x}`, p.bump().x);
console.error(p.bump(), p.bump());
const o2 = { n: 0 };
function g2() { o2.n++; return o2; }
console.log(g2(), g2());
console.info(g2(), g2(), g2());
console.warn(g2(), g2());
console.debug(g2(), g2());
console.log("%s|%s", f(), f());
