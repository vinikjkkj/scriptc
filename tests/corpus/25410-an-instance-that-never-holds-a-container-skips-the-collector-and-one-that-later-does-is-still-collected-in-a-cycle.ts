// A class whose fields are all dynamic keeps a per-instance bit that says "a container was stored here". While it is clear the instance is not a possible
// cycle root and is not traced; the first container store sets it. Whatever the bit says, values read back the same, a cycle through an instance that later
// held a container is collected, and a leaf-only instance reachable only from a garbage cycle is freed with its fields.
class Cell {
  name: any;
  size: any;
  flag: any;
  link: any;
  note: string;
  seq: number;
  constructor(src: any, i: number) {
    this.name = src.name + i;
    this.size = src.size;
    this.flag = src.flag;
    this.link = null;
    this.note = "n" + (i % 5);
    this.seq = i;
  }
  hold(v: any): void {
    this.link = v;
  }
  weight(): any {
    return this.size + this.seq;
  }
}

const src: any = { name: "col", size: 70000, flag: true };

// 1. leaf-only instances: churned and dropped, never a container
let leafSum = 0;
for (let i = 0; i < 30000; i++) {
  const c = new Cell(src, i);
  leafSum += c.weight();
}
console.log("leaf-only", leafSum);

// 2. instances that later hold a container, in a cycle: boxed self, an array holding the instance, a nested object
let cycSum = 0;
for (let i = 0; i < 30000; i++) {
  const c = new Cell(src, i);
  if (i % 3 === 0) c.hold(c);
  else if (i % 3 === 1) c.hold([c, i]);
  else c.hold({ owner: c, i });
  cycSum += c.weight();
}
console.log("cyclic", cycSum);

// 3. a leaf-only instance reachable only from a garbage cycle (an object that holds itself and the instance)
let reach = 0;
for (let i = 0; i < 30000; i++) {
  const c = new Cell(src, i);
  const ring: any = { item: c, self: null };
  ring.self = ring;
  reach += ring.item.seq + c.weight();
}
console.log("reachable only from a cycle", reach);

// 4. live leaf-only instances held across many collections keep their values
const live: Cell[] = [];
for (let i = 0; i < 2000; i++) live.push(new Cell(src, i));
for (let r = 0; r < 20; r++) {
  for (let i = 0; i < 5000; i++) {
    const c = new Cell(src, i);
    c.hold(c);
  }
}
let liveSum = 0;
for (const c of live) liveSum += c.weight();
console.log("live", live.length, liveSum, live[1999].name, live[0].note);

// 5. overwrite a container with a leaf: the bit stays set, the value is the leaf
const k = new Cell(src, 7);
k.hold([k]);
k.hold("leaf");
console.log("overwritten", k.link, k.weight());
