"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = probe;
class Other {
  constructor(n) {
    this.n = n;
  }
}
class Base {
  constructor() {
    this.kind = "base";
  }
}
class Derived extends Base {
  describe() {
    return Derived.opts.port + ":" + Derived.shared;
  }
}
class Sub extends Derived {}
// tsc places these after the class: own properties of the class object, inherited down the constructor chain.
Base.shared = "b";
Base.cleared = "base";
Derived.cluster = Other;
Derived.opts = { port: 1 };
Sub.opts = { port: 2 };
Sub.cleared = undefined;
function probe() {
  const seen = [
    Derived.opts.port,
    Sub.opts.port,
    Sub.shared,
    Derived.shared,
    String(Sub.cleared),
    Base.cleared,
    typeof Derived.cluster,
    new Derived().describe(),
    new Sub().describe(),
  ];
  Sub.shared = "s";
  seen.push(Sub.shared, Derived.shared, Base.shared);
  return seen.join(" ");
}
