// A getter a class declares, read through the interface the binding is typed as: the read is the accessor call, once per read,
// side effects and thrown errors included.
interface R { n: number; exec(): number; readonly g: string; }
class K {
  n = 1;
  name = "k";
  calls = 0;
  exec(): number { return this.n + 1; }
  get g(): string {
    this.calls++;
    if (this.n < 0) throw new Error("negative " + this.n + " after " + this.calls);
    return this.name + this.n + ":" + this.calls;
  }
}
class Sub extends K {
  get g(): string { return "sub-" + super.g; }
}

const k = new K();
const r: R = k;
console.log(r.g, r.g);
k.n = 4;
console.log(r.g, k.calls);
r.n = 9;
console.log(k.g, r.exec());

const s = new Sub();
const rs: R = s;
console.log(rs.g, rs.g);

const bad = new K();
const rb: R = bad;
bad.n = -3;
try {
  console.log(rb.g);
} catch (e) {
  console.log((e as Error).message, bad.calls);
}
console.log(rb.n, bad.calls);

function use(x: R): string { return x.g + "|" + x.g; }
console.log(use(new K()));
const erased = new K() as unknown as R;
console.log(erased.g, erased.g);
const order: string[] = [];
class Spy {
  n = 0;
  get g(): string { order.push("get" + this.n); return "v" + this.n++; }
  exec(): number { order.push("exec"); return 1; }
}
const rsp: R = new Spy() as unknown as R;
console.log(rsp.g + rsp.exec() + rsp.g, order.join(","));

// A class with no subclass: the binding keeps the instance type behind the interface.
interface Q { n: number; readonly g: string; }
class Plain {
  n = 2;
  tag = "p";
  get g(): string { return this.tag + this.n; }
}
const plain = new Plain();
const q: Q = plain;
console.log(q.g);
plain.n = 7;
console.log(q.g, q.n);
