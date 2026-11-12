// Distilled from tests/harness/llvm-stackless-lifted.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
async function ps(v: string): Promise<string> { return v + "!"; }
async function pf(n: number): Promise<number> { return n + 1; }
function mk(tag: string, k: number): () => Promise<string> {
  const inner = async (): Promise<string> => { const x = await ps(tag); return x + ":" + String(k); };
  return inner;
}
function mkn(k: number): () => Promise<number> {
  const inner = async (): Promise<number> => { const v = await pf(k); return v * 2; };
  return inner;
}
async function main(): Promise<void> {
  console.log("lifted-ref", await mk("T", 7)());
  console.log("lifted-f64", await mkn(5)());
  const a = mk("A", 1), b = mk("B", 2);
  console.log("two", await a(), await b());
}
void main();
