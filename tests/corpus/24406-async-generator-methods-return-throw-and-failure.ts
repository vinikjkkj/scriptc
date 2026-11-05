class Feed {
  private n = 0;
  private async *source(limit: number): AsyncGenerator<number, void, undefined> {
    try { while (this.n < limit) { await null; this.n++; yield this.n; } } finally { console.log("source-finally", this.n); }
  }
  async *pairs(limit: number): AsyncGenerator<string, void, undefined> {
    for await (const v of this.source(limit)) yield "p" + v;
  }
  async sum(limit: number): Promise<number> { let t = 0; for await (const v of this.source(limit)) { t += v; if (t > 5) return t; } return t; }
}
async function main() {
  const f = new Feed();
  for await (const p of f.pairs(3)) console.log(p);
  console.log(await new Feed().sum(10));
  const g = new Feed().pairs(5);
  console.log((await g.next()).value);
  const r = await g.return();
  console.log(r.done);
  const h = new Feed().pairs(5);
  await h.next();
  try { await h.throw(new Error("thrown-in")); } catch (e) { console.log("caught", (e as Error).message); }
  console.log((await h.next()).done);
}
class Failing { async *go(): AsyncGenerator<number, void, undefined> { yield 1; throw new Error("gen-fail"); } }
main().then(async () => {
  try { for await (const v of new Failing().go()) console.log("f", v); } catch (e) { console.log("caught", (e as Error).message); }
});
