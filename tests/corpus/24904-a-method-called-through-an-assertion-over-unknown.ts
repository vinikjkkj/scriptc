// The program asserts through `unknown` that an object has a callable member and calls it: the call runs the member the object really has, on the object, and
// its answer converts to the asserted type; an async member answers its promise, and a rejection stays a rejection. The same object is reached again through a plain unknown variable.
class Client {
  calls = 0;
  ping(n: number): number {
    this.calls += n;
    return this.calls;
  }
  plain(a: string, b: number): string {
    this.calls++;
    return a + "!" + b;
  }
  async later(a: string, b: number): Promise<string> {
    await null;
    this.calls++;
    return a + "?" + b;
  }
  async boom(msg: string): Promise<number> {
    await null;
    throw new Error(msg);
  }
}
async function main(): Promise<void> {
  const c = new Client();
  const u: unknown = c;
  console.log((u as { ping: (n: number) => number }).ping(2));
  console.log((c as unknown as { ping: (n: number) => number }).ping(3));
  console.log((c as unknown as { plain: (a: string, b: number) => string }).plain("x", 7));
  const viaArgs = ["y", 8] as const;
  console.log((c as unknown as { plain: (...a: unknown[]) => string }).plain(...viaArgs));
  console.log(await (c as unknown as { later: (a: string, b: number) => Promise<string> }).later("p", 1));
  console.log(await (c as unknown as { later: (...a: unknown[]) => Promise<string> }).later(...viaArgs));
  try {
    await (c as unknown as { boom: (m: string) => Promise<number> }).boom("no");
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  console.log(c.calls);
}
main();
