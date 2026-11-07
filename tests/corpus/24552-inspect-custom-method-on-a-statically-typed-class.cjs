// A class that declares `[Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect)` prints through it everywhere
// util.inspect and console.log reach an instance: at the top, inside arrays and records, under a depth limit, with the
// arguments Node passes, with a string answer indented under its parent and any other answer inspected in its place.
const k = Symbol.for("nodejs.util.inspect.custom");
const util = require("util");
class Money {
  constructor(n) { this.n = n; }
  [k](depth, options, inspect) {
    return "Money<" + this.n + "," + depth + "," + typeof options.stylize + "," + typeof inspect + "," + options.stylize("s", "special") + ">";
  }
}
class Pair {
  constructor() { this.a = 1; }
  [k]() { return "line1\nline2"; }
}
class AsNumber { [k]() { return 42; } }
class AsNull { [k]() { return null; } }
class AsRecord { constructor() { this.hidden = 1; } [k]() { return { shown: this.hidden, more: [1, 2] }; } }
class Opts {
  [k](depth, options) {
    return Object.keys(options).join(",") + "|" + options.depth + "|" + options.breakLength + "|" + options.compact + "|" + options.sorted;
  }
}
class Nested {
  constructor() { this.deep = { a: { b: 1 } }; }
  [k](depth, options, inspect) { return "N:" + inspect(this.deep, Object.assign({}, options, { depth: 0 })); }
}
const wrap = { m: new Money(5), list: [new Money(6), new Pair()], nested: { deep: { m: new Money(7) } } };
console.log(new Money(1));
console.log(util.inspect(new Money(2)), util.inspect(new Pair()));
console.log(wrap);
console.log(util.inspect(wrap, { depth: 0 }));
console.log({ x: { y: new Pair() } });
console.log(new AsNumber(), new AsNull(), new AsRecord(), [new AsNumber(), new AsRecord()]);
console.log(new Opts(), util.inspect(new Opts(), { depth: 1, breakLength: 50, compact: false, sorted: true }));
console.log(new Nested());
console.log("%s|%O", new Money(3), new Money(4));
