// A catch binding typed as the base class holds a leaf instance: passed into unknown, the leaf class answers instanceof, the base answers instanceof, and the leaf's own field is read.
class Base2 extends Error {
  readonly tag: string;
  constructor(message: string, tag: string) { super(message); this.tag = tag; this.name = 'Base2'; }
}
class Leaf2 extends Base2 {
  describe(): string { return 'leaf:' + this.tag; }
}
function probe(e: unknown): string {
  return String(e instanceof Leaf2) + ' ' + String(e instanceof Base2) + ' ' + String((e as any).tag);
}
try {
  throw new Leaf2('lf', 'L5');
} catch (e) {
  console.log(probe(e));
}
