// Object.defineProperty on a class instance fills a per-instance property table (the instance's `%props` slot, a container). The container bit must treat that
// table like any other container: an instance that never gets a defined property stays out of the collector, and one that does (here a property holding the
// instance itself, so a cycle runs through the table) is still collected. The RC audit of the run must come out clean and the values must match Node.
class P {
  id: any;
  tag: any;
  constructor(i: number) {
    this.id = i;
    this.tag = "t" + (i % 3);
  }
}

let s = 0;
let leafy = 0;
for (let i = 0; i < 20000; i++) {
  const p = new P(i);
  if (i % 2 === 0) Object.defineProperty(p, "self", { value: p, enumerable: true, configurable: true, writable: true });
  if (i % 3 === 0) Object.defineProperty(p, "leafy", { value: "str" + i, enumerable: true, configurable: true, writable: true });
  s += p.id;
  if (i % 3 === 0) leafy += i;
}
console.log("defined", s, leafy);

// plain instances that never get a defined property, held live across many collections
const live: P[] = [];
for (let i = 0; i < 3000; i++) live.push(new P(i));
let churn = 0;
for (let r = 0; r < 20; r++) {
  for (let i = 0; i < 5000; i++) {
    const p = new P(i);
    Object.defineProperty(p, "self", { value: p, enumerable: true, configurable: true, writable: true });
    churn += p.id;
  }
}
let liveSum = 0;
for (const p of live) liveSum += p.id;
console.log("live", live.length, liveSum, live[2999].tag, churn);
