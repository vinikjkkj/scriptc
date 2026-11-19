// A static record, a typed array or a tuple stored into an `any` field crosses the dynamic boundary as a COPY that remembers the object it was made
// from (and holds a counted reference to it). When that origin refers back to the instance holding the copy, the ring instance -> copy -> origin ->
// instance is garbage once the loop variable dies, and it must be collected while the program runs: four rings of each shape hold half a megabyte
// apiece, thousands of times over, and the program prints whether its peak resident size stayed under 1.2 GB. A collector that cannot see the
// copy -> origin edge keeps every ring until exit (gigabytes) and the line reads false; the sums prove every ring was built and read.
class Ring {
  payload: Buffer;
  tag: any;
  constructor(n: number) {
    this.payload = Buffer.alloc(512 * 1024, n & 255);
    this.tag = "free";
  }
}

function residentOk(): boolean {
  return process.resourceUsage().maxRSS < 1.2e6; // peak resident size, in kilobytes
}

let rec = 0;
for (let i = 0; i < 4000; i++) {
  const a = new Ring(i);
  const box: any = { ring: a, n: i };
  a.tag = box;
  rec += box.n + a.payload[5];
}
console.log("record origin", rec, residentOk());

let arr = 0;
for (let i = 0; i < 4000; i++) {
  const a = new Ring(i);
  const list: Ring[] = [a, a];
  a.tag = list;
  arr += list.length + a.payload[6];
}
console.log("array origin", arr, residentOk());

let tup = 0;
for (let i = 0; i < 4000; i++) {
  const a = new Ring(i);
  const pair: [Ring, number] = [a, i];
  a.tag = pair;
  tup += pair[1] + a.payload[7];
}
console.log("tuple origin", tup, residentOk());

// a ring that is still referenced must survive the passes the garbage rings trigger, and read back through its copy
const keep: Ring[] = [];
for (let i = 0; i < 50; i++) {
  const a = new Ring(i);
  const box: any = { ring: a, n: i };
  a.tag = box;
  keep.push(a);
}
let live = 0;
for (let i = 0; i < 3000; i++) {
  const g = new Ring(i);
  const b: any = { ring: g, n: i };
  g.tag = b;
}
for (const a of keep) live += a.tag.n + a.payload[1];
console.log("live", keep.length, live, residentOk());
