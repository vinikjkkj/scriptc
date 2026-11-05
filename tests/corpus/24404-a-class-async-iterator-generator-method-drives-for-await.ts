class Src {
  private async *gen(n: number): AsyncGenerator<number> { for (let i = 0; i < n; i++) { await null; yield i; } }
  async *[Symbol.asyncIterator](): AsyncGenerator<number> { try { for await (const v of this.gen(3)) yield v; } finally { console.log("done"); } }
  async total(): Promise<number> { let t = 0; for await (const v of this.gen(4)) t += v; return t; }
}
async function main() {
  for await (const v of new Src()) console.log("v", v);
  for await (const v of new Src()) { console.log("e", v); break; }
  console.log(await new Src().total());
}
main();
