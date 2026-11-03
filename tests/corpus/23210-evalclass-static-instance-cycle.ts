// Instances hold their evaluation and the evaluation holds instances: a
// reference cycle among ordinary refcounted objects. Many evaluations are
// created and dropped; the cycle collector must reclaim them (RC audit).
function make(seed: number) {
  return class Registry {
    static all: Registry[] = [];
    static first = new Registry("first");
    name: string;
    constructor(name: string) {
      this.name = name + seed;
      Registry.all.push(this);
    }
    link(other: string): Registry {
      return new Registry(other);
    }
  };
}
let total = 0;
for (let i = 0; i < 50; i++) {
  const R = make(i);
  const x = R.first.link("x");
  total += x.name.length + R.all.length;
}
const keep = make(7);
const k = keep.first.link("k");
console.log(total, k.name, keep.all.length, keep.first.name);
