// Unbounded recursion must throw Node's catchable RangeError ("Maximum call stack size exceeded") instead of crashing: direct, mutual, allocating, inside an
// async function (a fiber), and again after the catch (the stack must be usable). Only the catch is printed: Node's frame count differs from ours.
function depth(n: number): number {
  return n === 0 ? 0 : 1 + depth(n - 1);
}
function ping(n: number): number {
  return n === 0 ? 0 : 1 + pong(n - 1);
}
function pong(n: number): number {
  return n === 0 ? 0 : 1 + ping(n - 1);
}
function build(n: number): string[] {
  return n === 0 ? [] : [String(n), ...build(n - 1).slice(0, 1)];
}
function attempt(name: string, f: () => unknown): void {
  try {
    f();
    console.log(name, "no throw");
  } catch (e) {
    console.log(name, e instanceof RangeError, (e as Error).message);
  }
}
attempt("direct", () => depth(10000000));
attempt("mutual", () => ping(10000000));
attempt("alloc", () => build(10000000));
console.log("after", depth(1000), ping(1000));
attempt("direct again", () => depth(10000000));
async function viaAsync(): Promise<void> {
  await Promise.resolve();
  attempt("async", () => depth(10000000));
  console.log("async after", depth(1000));
}
viaAsync().then(() => console.log("done"));
