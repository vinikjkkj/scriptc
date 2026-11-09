// An interface member whose signature no record projection can adapt (a rest parameter, an overload set) is a dynamic function slot: a value that
// arrives dynamic (installed by a function taking `any`, as ioredis' addTransactionSupport does) is cast to the interface without failing on
// representation, data members stay typed, and an object literal fed into the same interface calls the same way.
interface Rest {
  count(...args: unknown[]): number;
}
interface Over {
  pick(a: string): string;
  pick(a: number): number;
}
interface Mixed {
  name: string;
  tag(prefix: string, ...more: string[]): string;
}
interface Chain {
  count(...args: unknown[]): number;
  exec(cb?: (e: Error | null) => void): Promise<[Error | null, unknown][] | null>;
}
function install(t: any): void {
  t.count = (...args: unknown[]) => args.length;
  t.pick = (a: unknown) => (typeof a === "string" ? a + "!" : (a as number) + 1);
  t.name = "inst";
  t.tag = (p: string, ...m: string[]) => p + ":" + m.join(",");
  t.exec = async () => [[null, 1], [null, "x"]];
}
async function main(): Promise<void> {
  const holder: any = JSON.parse("{}");
  install(holder);
  const r = holder as Rest;
  console.log(r.count(), r.count(1, "a", null));
  const o = holder as Over;
  console.log(o.pick("s"), o.pick(4));
  const m = holder as Mixed;
  console.log(m.name, m.tag("p"), m.tag("p", "a", "b"));
  const res = await (holder as Chain).exec();
  console.log(JSON.stringify(res), res === null ? "null" : res.length);
  const lit: Mixed = { name: "lit", tag: (p: string, ...more: string[]) => p + "/" + more.length };
  console.log(lit.name, lit.tag("q", "1", "2"));
  const lc: Chain = { count: (...a: unknown[]) => a.length, exec: async (): Promise<[Error | null, unknown][] | null> => null };
  console.log(lc.count(1, 2), await lc.exec());
  const lr: Rest = { count: (...a: unknown[]) => a.length * 2 };
  console.log(lr.count(1, 2, 3));
}
main();
