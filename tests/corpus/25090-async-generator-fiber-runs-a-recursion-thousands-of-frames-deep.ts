// A fiber stack must hold a synchronous recursion about as deep as Node's own stack does.
// Node (V8) overflows this chain a little above 7000 frames; 6000 frames must work on a fiber stack.
function f(n: number, a: number, b: number): number {
  if (n === 0) return a + b;
  return f(n - 1, a + 1, b ^ n) + 1;
}
async function* g(n: number) {
  await new Promise<void>((r) => setTimeout(r, 1));
  yield f(n, 0, 0);
}
async function main() {
  for (const n of [10, 2000, 4000, 6000]) {
    for await (const v of g(n)) console.log(n, v);
  }
  console.log("done");
}
main();
