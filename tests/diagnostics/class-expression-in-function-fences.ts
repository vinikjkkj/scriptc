// Class expressions inside functions compile per evaluation (a class value is
// the evaluation). These shapes stay refused, each by name.

// A captured binding written after its initializer: the per-evaluation class
// copies each captured binding when the class is created.
function counter() {
  let n = 0;
  const C = class {
    get(): number {
      return n;
    }
  };
  n = 5;
  return C;
}
const C1 = counter();
console.log(new C1().get());

// A captured binding declared after the class: Node throws at the read.
function early(k: number) {
  const C = class {
    get(): number {
      return later;
    }
  };
  const later = k;
  return C;
}
early(1);

// A static accessor on the evaluated class.
function withAccessor(k: number) {
  return class {
    static get both(): number {
      return k * 2;
    }
  };
}
withAccessor(1);

// A class value turned into text: Node prints the class's source text.
function make(k: number) {
  return class {
    n = k;
  };
}
const M = make(3);
console.log(String(M));

// Extending a class value minted by a function.
class D extends M {
  m = 1;
}
console.log(new D().m);

// A class value read through members the per-evaluation class does not carry.
console.log(M.prototype);
