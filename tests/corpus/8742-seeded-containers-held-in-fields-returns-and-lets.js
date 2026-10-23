// Seeded containers that do not sit in a const binding every use of which is
// visible: a class field, a return value, an argument, a `let`. Nothing here
// can prove that no other type reaches them, so they are the dyn-flavoured
// box wherever they flow.
'use strict';

class Cache {
  constructor() {
    this.hits = new Map([["start", 0]]);
    this.seen = new Set([0]);
  }
  record(key, value) {
    this.hits.set(key, value);
    this.seen.add(value);
  }
}
const c = new Cache();
c.record("a", 1);
c.record("b", "two");
c.record(3, { three: true });
c.record("d", null);
console.log(c.hits.size, c.seen.size, c.hits.get("b"), c.hits.get(3).three, c.hits.get("d"), c.seen.has("two"));

function make() { return new Map([["x", 1]]); }
const made = make();
made.set("y", [1, 2, 3]);
made.set(0, "zero");
console.log(made.size, made.get("y").length, made.get(0));

function count(m) { return m.size; }
console.log(count(new Map([["q", 1]])), count(new Set([1, 2])));

let l = new Map([["a", 1]]);
l.set(2, "two");
l = new Map([["b", 2]]);
l.set("c", false);
console.log(l.size, l.get("b"), l.get("c"), l.has(2));

const holder = { m: new Map([["h", 1]]), s: new Set(["h"]) };
holder.m.set(5, "five");
holder.s.add(5);
console.log(holder.m.size, holder.m.get(5), holder.s.has(5), holder.s.has("h"));

const list = [new Map([["l", 1]]), new Set([1])];
list[0].set("m", "str");
list[1].add("s");
console.log(list[0].get("m"), list[1].has("s"), list[1].size);
