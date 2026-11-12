// Dynamic objects built from a literal or converted from a typed record are sized for the members the code is about to write, once; any
// member added afterwards still grows the table. Every observable is checked against Node: key order (also after a delete and a re-add),
// `in`, hasOwnProperty, JSON, inspect, spread, and members assigned to an object after it was built (the shape ioredis uses on its
// commands: `command.pipelineIndex = position`).
function convert(v) { return v; }
// members added to a dynamic object after it was built: order, in, hasOwnProperty, delete and re-add, JSON, inspect, spread
const c0 = convert({ name: "c0", args: [0, "x0"], done: false });
const c1 = convert({ name: "c1", args: [1, "x1"], done: false });
c0.pipelineIndex = 0; c0.tag = "t0"; c1.pipelineIndex = 1;
console.log(Object.keys(c0).join(), Object.keys(c1).join());
console.log("pipelineIndex" in c0, "tag" in c1, c0.hasOwnProperty("tag"), c1.hasOwnProperty("tag"), c1.pipelineIndex);
console.log(JSON.stringify(c0), JSON.stringify(c1));
console.log(c0);
console.log({ ...c1 });
delete c0.pipelineIndex;
c0.pipelineIndex = 99;
console.log(Object.keys(c0).join(), JSON.stringify(c0));
c1.late = 1; c1.later = 2; c1.latest = 3;
console.log(Object.keys(c1).join(), "late" in c1, Object.getOwnPropertyNames(c1).length);

// literals of 2..9 members, each then extended and trimmed
const lits = [
  { a: 1, b: 2 },
  { a: 1, b: 2, c: 3 },
  { a: 1, b: 2, c: 3, d: 4 },
  { a: 1, b: 2, c: 3, d: 4, e: 5 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 },
];
const out = [];
for (const lit of lits) {
  const o = convert(lit);
  const n = Object.keys(o).length;
  o.extra1 = n; o.extra2 = n * 2;
  delete o.b;
  o.b = "again";
  out.push(Object.keys(o).join("") + ":" + JSON.stringify(o).length + ":" + ("c" in o) + ":" + Object.values(o).length);
}
console.log(out.join(" "));

// many objects of the same literal shape held live, then half dropped and rebuilt with other shapes
const live = [];
for (let i = 0; i < 300; i++) live.push({ id: i, name: "n" + i, tags: [i, i + 1], flag: i % 2 === 0 });
for (let i = 0; i < 300; i += 2) live[i] = { k1: i, k2: i + 1, k3: i + 2, k4: i + 3, k5: i + 4 };
let sum = 0;
for (const o of live) { for (const k of Object.keys(o)) sum += k.length; sum += Object.keys({ ...o }).length; }
console.log(sum, JSON.stringify(live[1]), JSON.stringify(live[2]));
console.log(live[5], live[6]);

// a typed record converted to a dynamic value, then written through the dynamic view
/** @type {{ host: string, port: number, secure: boolean, retries: number }} */
const rec = { host: "h", port: 6379, secure: false, retries: 3 };
const dyn = convert(rec);
dyn.timeout = 50; dyn.tls = { ca: "x", cert: "y", key: "z" };
console.log(Object.keys(dyn).join(), JSON.stringify(dyn), dyn);
