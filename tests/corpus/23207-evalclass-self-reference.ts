// A named class expression refers to ITS evaluation by its own name.
function make(seed: number) {
  return class Node {
    value: number;
    constructor(v: number) {
      this.value = v + seed;
    }
    sibling(): Node {
      return new Node(this.value + 1);
    }
    cls(): typeof Node {
      return Node;
    }
  };
}
const A = make(100);
const B = make(200);
const a = new A(1);
const s = a.sibling();
console.log(a.value, s.value, s instanceof A, s instanceof B, s.sibling().sibling().value);
console.log(a.cls() === A, a.cls() === B, new B(0).cls() === B);
console.log(a.constructor === A);
