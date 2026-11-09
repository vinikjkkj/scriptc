// The zapo shape: a class instance held as a dynamic value, its method called through a parenthesized cast. The method reads this; on main it ran with no
// receiver (TypeError: Cannot read properties of undefined) instead of binding the instance.
class Pipe {
  queue: string[] = [];
  options = { name: "pipe" };
  hset(key: unknown, field?: unknown, value?: unknown): string {
    this.queue.push(this.options.name + ":" + [key, field, value].filter((x) => x !== undefined).map(String).join(","));
    return String(this.queue.length);
  }
}
const p: any = new Pipe() as any;
console.log((p.hset as (key: unknown, field?: unknown, value?: unknown) => unknown)("k", "f", 1));
console.log((p.hset as (key: unknown, field?: unknown, value?: unknown) => unknown)("k2"));
console.log(p.queue.join("|"));
