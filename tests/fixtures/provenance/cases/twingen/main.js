// A GENERIC declared class (`declare class Ring<T = any>`, `export = Ring`) paired with the
// function constructor the package ships (ioredis' denque queues). The queue fields are assigned
// in methods, not the constructor, so each reads `Ring<any> | undefined`; push and shift are
// called through them. Before, the generic declaration never paired with its twin, the receiver
// mapped to a record arm, and every call refused ("no compiled implementation").
const Ring = require("twingen");

class Holder {
  constructor() {
    this.n = 0;
  }
  resetOut() {
    this.out = new Ring();
  }
  resetIn() {
    this.inq = new Ring();
  }
  put(x) {
    this.out.push(x);
    this.n++;
  }
  flush() {
    const got = [];
    let item;
    while ((item = this.out.shift())) got.push(item);
    return got;
  }
  hold(x) {
    return this.inq.push(x);
  }
  held() {
    return this.inq.length;
  }
}

const h = new Holder();
h.resetOut();
h.resetIn();
h.put("a");
h.put("b");
h.put("c");
console.log(h.n, h.out.length, h.out.peek());
console.log(h.flush().join(","), h.out.length);
console.log(h.hold(1), h.hold(2), h.held());

// Accessor forms through the nullable fields: shorthand getter, get+set pair (read and write), setter-only (write).
h.put("z");
console.log(h.out.first, h.out.label);
h.out.label = "q";
console.log(h.out.label);
h.out.cap = 5;
console.log(h.out.capacity());

// The same accessors on a plain (non-nullable) binding.
const r = new Ring();
r.label = "w";
r.cap = 4;
console.log(r.label, r.capacity(), r.first);
