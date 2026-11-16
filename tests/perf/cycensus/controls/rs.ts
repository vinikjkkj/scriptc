// the holder-scan control for RAW heap strings (build with -DSCR_CYCEN_RAWSTR=1 -DSCR_CYCEN_HOLD_CHAIN=1 -DSCR_CYCEN_HOLD_KIND=3): 3000 distinct 40-byte strings held ONLY by the item
// buffer of a module-level typed array (root: a module global), and 1000 held ONLY by an array field of a class instance (root: the instance, held by a module global)
const held: string[] = [];
class Box { items: string[] = []; }
const box = new Box();
function fill(n: number) {
  for (let i = 0; i < n; i++) held.push("planted-in-module-array-" + String(100000 + i) + "-padpadpad");
  for (let i = 0; i < n / 3; i++) box.items.push("planted-in-class-field--" + String(200000 + i) + "-padpadpad");
}
fill(3000);
class Ring { me: Ring | null = null; v = 0; }
const rings: Ring[] = [];
for (let i = 0; i < 3000; i++) { const r = new Ring(); r.me = r; r.v = i; if (i % 3 === 0) rings.push(r); } // cyclic garbage drives collector passes; a third stays live
setTimeout(() => { console.log(held.length, box.items.length); }, 5);
