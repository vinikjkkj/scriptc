// The cycle collector must run from the release path while the program is still running, not only at exit: thousands of two-node rings, each holding
// half a megabyte, are dropped one after another. If no pass ever ran before exit, the garbage would pile up past 2 GB; the program prints whether its
// peak resident size stayed under 1.2 GB (Node's own collector keeps it far below that) after every shape, so a collector that stops triggering after its
// first pass, never triggers, or triggers only at exit fails the line, and the sums prove every ring was built and read.
class Ring {
  payload: Buffer;
  peer: Ring | null = null;
  tag: any;
  constructor(n: number) {
    this.payload = Buffer.alloc(512 * 1024, n & 255);
    this.tag = "r" + n;
  }
}

function residentOk(): boolean {
  return process.resourceUsage().maxRSS < 1.2e6; // peak resident size, in kilobytes
}

let sum = 0;
for (let i = 0; i < 4000; i++) {
  const a = new Ring(i);
  const b = new Ring(i + 1);
  a.peer = b;
  b.peer = a;
  sum += a.payload[7] + b.payload[9] + a.tag.length;
}
console.log("class rings", sum, residentOk());

let dsum = 0;
for (let i = 0; i < 4000; i++) {
  const ring: any = { buf: Buffer.alloc(512 * 1024, i & 255), self: null, n: i };
  ring.self = ring;
  dsum += ring.buf[3] + ring.self.n;
}
console.log("dyn rings", dsum, residentOk());

// a pass that ran must leave the next ones able to run: a second wave after a quiet stretch of plain allocation
let q = 0;
for (let i = 0; i < 200000; i++) q += ("x" + i).length;
let wsum = 0;
for (let i = 0; i < 4000; i++) {
  const a = new Ring(i);
  const b = new Ring(i);
  a.peer = b;
  b.peer = a;
  wsum += a.payload[0] + b.payload[0];
}
console.log("second wave", q, wsum, residentOk());
