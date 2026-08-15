// Reference-identity Map keys and Set elements — records, class
// instances and promises — which the LLVM backend refused outright
// (`mapKey:record`, `mapKey:promise`) while the C backend has always
// compiled them. Seventeen of zapo's forty-one tier refusals were this
// one family, the largest single group.
//
// The refusal was honest about being a placeholder: "adding the suffix
// alone makes them compile and then SEGFAULT — this side needs more than
// the accessor name". What it needed was the ref-KEY CONSTRUCTOR.
// scr_map_new takes the value side's retain/release; a map with object
// keys must also be given the KEY side's, or it stores every key
// BORROWED and the first collection of one is a use-after-free. The C
// emitter has always called scr_map_new_ref / scr_set_new_ref_traced for
// exactly this; the LLVM emitter called scr_map_new for everything and
// so could not be allowed near a ref key. Every other ref entry point —
// set/get/has/delete/forEach/spread — was already reachable.
//
// So this file is mostly about OWNERSHIP, not about lookup. Lookup is
// easy to get right by accident; the cases that matter are the ones
// where the map is the only thing holding a key alive, where a key is
// released while the map still has it, and where the key can point back
// at the map (a cycle the collector has to be able to see, which is what
// the traced Set constructor is for). Run under SCRIPTC_RC_AUDIT=1 it
// must also finish with no audit lines.
interface Pt {
  x: number;
  y: number;
}
class Cell {
  id: number;
  tag: string;
  constructor(id: number, tag: string) {
    this.id = id;
    this.tag = tag;
  }
}

// ── identity, not structure ────────────────────────────────────────────
const k1: Pt = { x: 1, y: 2 };
const k2: Pt = { x: 1, y: 2 }; // structurally equal, a DIFFERENT key
const m = new Map<Pt, string>();
m.set(k1, "one");
m.set(k2, "two");
console.log("identity", m.size, m.get(k1) ?? "?", m.get(k2) ?? "?");
console.log("has", m.has(k1), m.has(k2), m.has({ x: 1, y: 2 }));
m.set(k1, "one-again"); // same key overwrites, size unchanged
console.log("overwrite", m.size, m.get(k1) ?? "?");
console.log("delete", m.delete(k1), m.size, m.get(k1) ?? "?", m.delete(k1));

// ── the map is the ONLY owner ──────────────────────────────────────────
// Nothing outside the loop holds these keys. If the map stored them
// borrowed, every one of them is freed at the end of its iteration and
// the reads below walk freed memory — which is precisely the crash the
// old refusal was standing in for.
const owned = new Map<Pt, number>();
for (let i = 0; i < 300; i++) owned.set({ x: i, y: -i }, i * 3);
let keySum = 0;
let valSum = 0;
owned.forEach((v, k) => {
  keySum += k.x + k.y;
  valSum += v;
});
console.log("owned", owned.size, keySum, valSum);

// The same, with class instances, and with the values also refcounted.
const cells = new Map<Cell, string>();
for (let i = 0; i < 300; i++) cells.set(new Cell(i, "c" + i.toString()), "v" + i.toString());
let idSum = 0;
let tagLen = 0;
cells.forEach((v, k) => {
  idSum += k.id;
  tagLen += k.tag.length + v.length;
});
console.log("cells", cells.size, idSum, tagLen);

// ── a key released while the map still holds it ────────────────────────
// `live` goes out of scope at the end of the block; the map's own
// reference must keep the object alive for the read afterwards.
const survives = new Map<Cell, number>();
{
  const live = new Cell(42, "keeper");
  survives.set(live, 99);
}
let found = -1;
let foundTag = "";
survives.forEach((v, k) => {
  found = v;
  foundTag = k.tag;
});
console.log("survives", survives.size, found, foundTag);

// ── Sets: the same three element kinds ─────────────────────────────────
const ps = new Set<Pt>();
for (let i = 0; i < 200; i++) ps.add({ x: i, y: i * 2 });
ps.add(k1);
ps.add(k1); // re-adding the SAME reference does not grow the set
console.log("set-records", ps.size, ps.has(k1), ps.has(k2));
const drained = [...ps];
console.log("spread", drained.length, drained[0]!.x, drained[199]!.y, drained[200]!.x);

const cs = new Set<Cell>();
const held = new Cell(7, "held");
cs.add(held);
cs.add(new Cell(7, "held")); // equal contents, different identity
console.log("set-cells", cs.size, cs.has(held), cs.has(new Cell(7, "held")));
cs.delete(held);
console.log("set-cells after delete", cs.size, cs.has(held));

// ── a key that can point BACK at the collection ────────────────────────
// This is why the ref Set needs the TRACED constructor: the element
// carries a collector header and can hold the set, so the set has to be
// headered too and its trace has to visit the key side.
interface Back {
  name: string;
  peers: Back[];
}
const ring = new Set<Back>();
const a: Back = { name: "a", peers: [] };
const b: Back = { name: "b", peers: [] };
a.peers.push(b);
b.peers.push(a);
ring.add(a);
ring.add(b);
let names = "";
ring.forEach((n) => {
  names += n.name + n.peers[0]!.name;
});
console.log("ring", ring.size, names);

// ── promises as keys, the shape zapo's store uses ──────────────────────
const pending = new Set<Promise<number>>();
const p1 = Promise.resolve(1);
const p2 = Promise.resolve(2);
pending.add(p1);
pending.add(p2);
pending.add(p1);
console.log("promise-set", pending.size, pending.has(p1), pending.has(p2));
pending.delete(p1);
console.log("promise-set after delete", pending.size, pending.has(p1));
// A promise as a MAP key is refused by the frontend on both backends
// (Map keys are numbers, strings and class instances); a promise as a
// SET element is not, and that Set is where zapo's `mapKey:promise`
// refusals came from — createStore's pending-task set.
const sum1 = await p1;
const sum2 = await p2;
console.log("awaited", sum1 + sum2);

// ── the value side keeps working while the key side is a reference ─────
const scalarVals = new Map<Cell, number>();
const boolVals = new Map<Cell, boolean>();
const nestedVals = new Map<Cell, Pt>();
for (let i = 0; i < 50; i++) {
  const c = new Cell(i, "n");
  scalarVals.set(c, i);
  boolVals.set(c, i % 2 === 0);
  nestedVals.set(c, { x: i, y: i });
}
let sTot = 0;
let bTot = 0;
let nTot = 0;
scalarVals.forEach((v) => {
  sTot += v;
});
boolVals.forEach((v) => {
  bTot += v ? 1 : 0;
});
nestedVals.forEach((v) => {
  nTot += v.x + v.y;
});
console.log("value-kinds", scalarVals.size, sTot, bTot, nTot);

// ── seeded construction, and a map rebuilt from another map's keys ─────
const seeded = new Map<Pt, number>([
  [k1, 1],
  [k2, 2],
]);
console.log("seeded", seeded.size, seeded.get(k1) ?? -1, seeded.get(k2) ?? -1);
const copy = new Map<Pt, number>();
seeded.forEach((v, k) => {
  copy.set(k, v * 10);
});
console.log("copied", copy.size, copy.get(k1) ?? -1, copy.get(k2) ?? -1);

// Repeated build-and-drop, so a leak or a double free has many chances.
for (let round = 0; round < 40; round++) {
  const tmp = new Map<Cell, Pt>();
  const tset = new Set<Cell>();
  for (let i = 0; i < 20; i++) {
    const c = new Cell(i, "r");
    tmp.set(c, { x: i, y: round });
    tset.add(c);
  }
  if (round === 39) console.log("last round", tmp.size, tset.size);
}
console.log("done");

export {};
