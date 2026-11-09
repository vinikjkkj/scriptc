// `(obj.method as Fn)(args)` is a METHOD call in JavaScript: the parenthesized member access keeps its reference, so `this` is obj. zapo's redis stores call
// `(pipeline.hset as (...args: unknown[]) => unknown)(key, ...)` and ioredis' generated command reads this.options.
class Queue {
  items: string[] = [];
  add(a: unknown, b?: unknown): number {
    this.items.push(b === undefined ? String(a) : String(a) + "+" + String(b));
    return this.items.length;
  }
  size(): number {
    return this.items.length;
  }
}
const q = new Queue();
console.log((q.add as (a: unknown, b?: unknown) => unknown)(1, "a"));
console.log((q.add)(2));
console.log((q.add!)(3, 4));
const d: any = q as any;
console.log((d.add as (a: unknown, b?: unknown) => unknown)(5), (d.size)());
console.log(q.items.join("|"), q.size());
