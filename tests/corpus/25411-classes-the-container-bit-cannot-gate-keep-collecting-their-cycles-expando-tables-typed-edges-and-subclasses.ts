// The container bit gates only a standalone class whose every reference-holding field is dynamic. These shapes keep their normal collection: a class with a typed
// edge to another instance, and a class hierarchy with a dynamic field of its own. Each builds garbage cycles in a loop; the RC audit of the run must come out
// clean and the values must match Node.
class Typed {
  id: any;
  next: Typed | null;
  constructor(i: number) {
    this.id = i;
    this.next = null;
  }
}
class Base {
  id: any;
  constructor(i: number) {
    this.id = i;
  }
}
class Derived extends Base {
  extra: any;
  peer: any;
  constructor(i: number) {
    super(i);
    this.extra = i + 1;
    this.peer = null;
  }
}

let b = 0;
for (let i = 0; i < 20000; i++) {
  const x = new Typed(i);
  const y = new Typed(i + 1);
  x.next = y;
  y.next = x; // a typed cycle
  b += x.id + y.id;
}
console.log("typed", b);

let c = 0;
for (let i = 0; i < 20000; i++) {
  const d = new Derived(i);
  d.peer = d;
  c += d.id + d.extra;
}
console.log("hierarchy", c);
