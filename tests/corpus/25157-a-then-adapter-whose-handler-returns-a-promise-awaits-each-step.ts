// Distilled from tests/harness/stackless-then-adapter.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
async function inc(n: number): Promise<number> {
  return n + 1;
}
async function dbl(n: number): Promise<number> {
  return n * 2;
}
async function say(n: number): Promise<void> {
  console.log("say", n);
}

async function main(): Promise<void> {
  console.log("chain", await inc(1).then(dbl));
  await inc(10).then(say);
  console.log("done");
}
void main();
