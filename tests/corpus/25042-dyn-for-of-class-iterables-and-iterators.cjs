class Counter {
  constructor(n, log) { this.n = n; this.log = log; }
  next() {
    this.log.push("next");
    const done = this.n <= 0;
    const v = done ? undefined : this.n--;
    return { value: v, done };
  }
  return() {
    this.log.push("return");
    return { value: undefined, done: true };
  }
  [Symbol.iterator]() {
    this.log.push("iter");
    return this;
  }
}
class Bag {
  constructor(n, log) { this.n = n; this.log = log; }
  [Symbol.iterator]() {
    this.log.push("bag-iter");
    let n = this.n;
    const log = this.log;
    return { next() { log.push("bnext"); return { value: n, done: n-- <= 0 }; }, return() { log.push("breturn"); return { value: undefined, done: true }; } };
  }
}
function drain(x, log) {
  for (const v of x) {
    log.push("v" + v);
    if (v === 2) break;
  }
}
function spread(x) {
  return [...x];
}
function thrower(x, log) {
  try {
    for (const v of x) {
      throw new Error("body" + v);
    }
  } catch (e) {
    log.push(e.message);
  }
}
function scenario(x1, l1, x2, l2, x3, l3) {
  drain(x1, l1);
  console.log(l1.join(" "));
  console.log(spread(x2).join(","), l2.join(" "));
  thrower(x3, l3);
  console.log(l3.join(" "));
}
{
  const a = [], b = [], c = [];
  scenario(new Counter(5, a), a, new Counter(3, b), b, new Counter(3, c), c);
}
{
  const a = [], b = [], c = [];
  scenario(new Bag(5, a), a, new Bag(3, b), b, new Bag(3, c), c);
}
const log4 = [];
drain([9, 8, 2, 1], log4);
console.log(log4.join(" "));
