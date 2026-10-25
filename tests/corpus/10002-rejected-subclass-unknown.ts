// A rejection reason that is an Error subclass keeps its class through an any-typed handler: instanceof up the chain and the prototype method of the leaf class, reached through the dynamic view.
class Base2 extends Error {
  readonly tag: string;
  constructor(message: string, tag: string) { super(message); this.tag = tag; this.name = 'Base2'; }
}
class Leaf2 extends Base2 {
  describe(): string { return 'leaf:' + this.tag; }
}
async function boom(): Promise<void> {
  throw new Leaf2('bad', 'T9');
}
boom().catch((e: any) => {
  console.log(String(e instanceof Leaf2), String(e instanceof Base2), String(e instanceof Error));
  console.log(e.tag);
  const t = e.describe();
  console.log(t);
});
