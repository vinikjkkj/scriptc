// A symbol key reaching a checked-dynamic parameter that holds a program-class instance: the class's symbol-keyed field answers by identity; a symbol it does not declare is absent.
const kLimit = Symbol("limit");
const kOther = Symbol("other");
class Q {
  constructor() { this[kLimit] = 5; this.name = "q"; }
}
function readLimit(o) { return o[kLimit]; }
function hasLimit(o) { return kLimit in o; }
function readOther(o) { return o[kOther]; }
const q = new Q();
console.log(readLimit(q), hasLimit(q), readOther(q), hasLimit({}), readLimit({ a: 1 }));
