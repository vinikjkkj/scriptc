// Dyn boxes of every scalar kind (number, bool, null, undefined) and string are built, read, dropped and rebuilt in interleaved order so that a dead box
// reaches its kind's freelist, is handed out again, and must read back as its NEW kind and value; a dead box parked on the wrong list, with its old payload,
// or twice, would show as a wrong tag, a wrong number or a crash. Each round also drops a class ring and a dyn ring (candidates for the collector) and a
// string that dies while a second reference still holds an equal one, so the release paths of strings, scalars and containers all interleave.
class Node {
  next: Node | null = null;
  val: any;
  constructor(v: any) {
    this.val = v;
  }
}

function mix(i: number): any {
  switch (i % 5) {
    case 0:
      return i * 3;
    case 1:
      return i % 2 === 0;
    case 2:
      return null;
    case 3:
      return undefined;
    default:
      return "s" + (i % 17);
  }
}

function tag(v: any): string {
  if (v === null) return "null";
  if (v === undefined) return "undef";
  return typeof v;
}

let sum = 0;
let kinds = "";
const keep: any[] = [];
for (let i = 0; i < 60000; i++) {
  const a: any = mix(i);
  const b: any = mix(i + 1);
  const c: any = mix(i + 2);
  if (typeof a === "number") sum += a;
  if (typeof b === "string") sum += b.length;
  if (c === true) sum += 1;
  if (i % 7777 === 0) {
    kinds += tag(a) + "," + tag(b) + "," + tag(c) + ";";
    keep.push(b);
  }
  const x = new Node(a);
  const y = new Node(b);
  x.next = y;
  y.next = x;
  const ring: any = { v: 0, self: null, w: 0 };
  ring.v = c;
  ring.w = mix(i + 3);
  ring.self = ring;
  if (ring.self.w === null) sum += 2;
}
console.log("sum", sum);
console.log("kinds", kinds);
console.log("keep", keep.length, keep.map((v: any) => tag(v)).join(","));

// values taken from the freelists after the churn are fresh boxes of the requested kind
const probe: any[] = [];
for (let i = 0; i < 10; i++) probe.push(mix(i * 7 + 1));
console.log("probe", probe.map((v: any) => tag(v) + ":" + String(v)).join(" "));
