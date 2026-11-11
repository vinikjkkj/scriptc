// A class with an async method held through `unknown`: its dynamic member wrapper boxes the method's Promise, so the program must link the
// checked-dynamic async unit even when nothing else in it awaits a dynamic value.
export {};
class K {
  public async go(n: number): Promise<number> { return n + 1; }
  public plain(): string { return "plain"; }
}
const u: unknown = new K();
console.log(typeof u);
const k = new K();
console.log(await k.go(1), k.plain());
