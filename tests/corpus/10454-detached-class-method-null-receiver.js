// A class method is strict code: a detached call with a null or undefined
// receiver runs the body with `this` null or undefined, and `this === null` /
// `this === undefined` answer from that receiver, not from the class type. A
// property read on it throws Node's TypeError, which the body catches here.

class Counter {
  constructor() {
    this.hits = 0;
  }
  probe() {
    if (this === null) return "null";
    if (this === undefined) return "undef";
    this.hits += 1;
    return "hit " + this.hits;
  }
  isNull() {
    return this === null;
  }
  notNull() {
    return this !== null;
  }
  looseNullish() {
    return this == null;
  }
  read() {
    try {
      return this.hits;
    } catch (e) {
      return e.message;
    }
  }
}

const c = new Counter();
const probe = c.probe;
console.log(probe.call(null));
console.log(probe.call(undefined));
console.log(probe.bind(null)());
console.log(probe.bind(undefined)());
console.log(probe.call(c));
const isNull = c.isNull;
console.log(isNull.call(null), isNull.call(undefined), isNull.call(c));
const notNull = c.notNull;
console.log(notNull.call(null), notNull.call(c));
const looseNullish = c.looseNullish;
console.log(looseNullish.call(null), looseNullish.call(undefined), looseNullish.call(c));
const read = c.read;
console.log(read.call(null));
