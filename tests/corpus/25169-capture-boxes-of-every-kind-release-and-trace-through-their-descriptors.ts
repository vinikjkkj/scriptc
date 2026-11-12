// A captured mutable variable lives in a ScrBox; the box of an object-typed variable keeps its payload's retain/release entry points
// and trace flag in a shared per-type descriptor. Every kind of capture box is built, shared between closures, mutated, left in a cycle
// (a closure stored in the very variable it captures) and dropped in volume.
class Pal { name: string; link: Pal | null = null; constructor(name: string) { this.name = name; } }
interface Pt { x: number; y: number }

function counters(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    let num = i;              // f64 box
    let flag = i % 2 === 0;   // bool box
    let str = "s" + (i % 9);  // string box
    let arr = [i, i + 1];     // array box
    let pt: Pt = { x: i, y: 1 }; // record box
    let pal = new Pal("p" + (i % 5)); // object box (class instance)
    const bump = (): number => { num += 1; flag = !flag; str += "!"; arr = [num]; pt = { x: pt.x + 1, y: pt.y }; pal = new Pal(str); return num; };
    const peek = (): number => num + (flag ? 1 : 0) + str.length + arr.length + pt.x + pal.name.length;
    bump(); bump();
    total += peek();
  }
  return total;
}
console.log(counters(20000));

// boxes that close a cycle: the closure is stored in the object its own capture box holds
function rings(n: number): number {
  let seen = 0;
  for (let i = 0; i < n; i++) {
    let me = new Pal("m" + i);
    let again: (() => number) | null = null;
    again = () => me.name.length + (again === null ? 0 : 1);
    me.link = me;
    const f = again;
    seen += f();
    me = new Pal("n" + i); // the box now holds a different object; the old ring is garbage
  }
  return seen;
}
console.log(rings(20000));

// many live capture boxes at once, shared by several closures, read after other boxes were dropped
const fns: Array<() => number> = [];
for (let i = 0; i < 5000; i++) {
  let shared = i;
  let pal = new Pal("q" + i);
  const inc = (): number => { shared += 2; return shared; };
  const get = (): number => shared + pal.name.length;
  fns.push(i % 2 === 0 ? inc : get);
  fns.push(get);
}
let acc = 0;
for (const f of fns) acc += f();
console.log(acc, fns.length);
fns.length = 0;
console.log(counters(100));
