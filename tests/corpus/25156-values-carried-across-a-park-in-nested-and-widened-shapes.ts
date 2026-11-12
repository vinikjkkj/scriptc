// Distilled from tests/harness/stackless-crosspark-widening.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
type Join = (a: string, b: string) => string;

async function g(): Promise<string> {
  return "G";
}

async function tick(): Promise<number> {
  return 1;
}

async function indirectAcrossPark(f: Join): Promise<string> {
  return f("a", "b") + (await g());
}

async function indirectAcrossTwoParks(f: Join): Promise<string> {
  return f("x", "y") + (await g()) + (await g());
}

async function manyForOf(a: number[], b: number[], c: number[], d: number[], e: number[], p: number[], q: number[]): Promise<number> {
  let total = 0;
  for (const x of a) { await tick(); total = total + x; }
  for (const x of b) { await tick(); total = total + x; }
  for (const x of c) { await tick(); total = total + x; }
  for (const x of d) { await tick(); total = total + x; }
  for (const x of e) { await tick(); total = total + x; }
  for (const x of p) { await tick(); total = total + x; }
  for (const x of q) { await tick(); total = total + x; }
  return total;
}

async function manyForOfOverStrings(a: string[], b: string[], c: string[], d: string[], e: string[], p: string[], q: string[]): Promise<string> {
  let out = "";
  for (const s of a) { await tick(); out = out + s; }
  for (const s of b) { await tick(); out = out + s; }
  for (const s of c) { await tick(); out = out + s; }
  for (const s of d) { await tick(); out = out + s; }
  for (const s of e) { await tick(); out = out + s; }
  for (const s of p) { await tick(); out = out + s; }
  for (const s of q) { await tick(); out = out + s; }
  return out;
}

async function main(): Promise<void> {
  const cat: Join = (a, b) => a + b;
  console.log("indirect", await indirectAcrossPark(cat));
  console.log("indirect2", await indirectAcrossTwoParks(cat));
  console.log("forof", await manyForOf([1], [2], [3], [4], [5], [6], [7]));
  console.log("forof2", await manyForOfOverStrings(["p"], ["q"], ["r"], ["s"], ["t"], ["u"], ["v"]));
  console.log("done");
}
void main();
