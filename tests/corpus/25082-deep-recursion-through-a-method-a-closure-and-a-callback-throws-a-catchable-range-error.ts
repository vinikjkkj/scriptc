// The same through a method, a closure that calls itself, and a callback cycle (the recursion is closed by an INDIRECT call, so no direct call graph shows it).
// Only the catch is printed: Node's frame count differs from ours.
class Tree {
  kids: Tree[] = [];
  v: number;
  constructor(v: number) { this.v = v; }
  height(): number {
    return this.kids.length === 0 ? 1 : 1 + this.kids[0]!.height();
  }
  loop(n: number): number {
    return n === 0 ? 0 : 1 + this.loop(n - 1);
  }
}
const fact = (n: number): number => (n === 0 ? 0 : 1 + fact(n - 1));
function viaCallback(n: number, f: (k: number) => number): number {
  return n === 0 ? 0 : 1 + f(n - 1);
}
const cb = (k: number): number => viaCallback(k, cb);
function attempt(name: string, f: () => unknown): void {
  try {
    f();
    console.log(name, "no throw");
  } catch (e) {
    console.log(name, e instanceof RangeError, (e as Error).name, (e as Error).message);
  }
}
attempt("method", () => new Tree(1).loop(10000000));
attempt("closure", () => fact(10000000));
attempt("callback cycle", () => cb(10000000));
console.log("moderate", new Tree(1).loop(5000), fact(5000));
async function deepAsync(n: number): Promise<number> {
  await Promise.resolve();
  return n === 0 ? 0 : 1 + new Tree(1).loop(n);
}
deepAsync(3000).then((v) => console.log("async moderate", v));
