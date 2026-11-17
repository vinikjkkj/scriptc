type Sweep = (tick: number) => void;
class Clock {
  private readonly sweeps: Set<Sweep> = new Set();
  public readonly log: string[] = [];
  register(s: Sweep): () => void {
    this.sweeps.add(s);
    return () => { this.sweeps.delete(s); };
  }
  get size(): number { return this.sweeps.size; }
  has(s: Sweep): boolean { return this.sweeps.has(s); }
  advance(t: number): void { for (const s of this.sweeps) s(t); }
}
const clock = new Clock();
const seen: string[] = [];
const a: Sweep = (t) => { seen.push("a" + t); };
const b: Sweep = (t) => { seen.push("b" + t); };
const offA = clock.register(a);
const offB = clock.register(b);
clock.register(a); // the same function again: one member
console.log(clock.size, clock.has(a), clock.has(b));
clock.advance(1);
offA();
console.log(clock.size, clock.has(a), clock.has(b));
clock.advance(2);
offA(); // deleting twice is harmless
const c: Sweep = (t) => { seen.push("c" + t); };
clock.register(c);
clock.advance(3);
offB();
console.log(clock.size, seen.join(","));
// a registration that deletes itself while the set is iterated, and one added during iteration
const set = new Set<Sweep>();
const order: string[] = [];
const self: Sweep = (t) => { order.push("self" + t); set.delete(self); };
const late: Sweep = (t) => { order.push("late" + t); };
const adder: Sweep = (t) => { order.push("adder" + t); if (!set.has(late)) set.add(late); };
set.add(self); set.add(adder);
for (const s of set) s(1);
for (const s of set) s(2);
console.log(order.join(","), set.size);
set.clear();
console.log(set.size);
