// A dyn field the constructor writes from a property read of a parameter (and that arithmetic reads) is stored as a raw double while it holds a
// number and as a plain slot for every other kind. Every reader must see the same value either way: a typed field read, a dyn keyed read through an
// untyped parameter, and the arithmetic over it.
class Cell {
  id: number;
  a: any;
  b: any;
  constructor(id: number, src: any) {
    this.id = id;
    this.a = src.a;
    this.b = src.b;
  }
  total(): any {
    return this.a + this.b;
  }
  below(n: number): boolean {
    return this.a < n;
  }
}

const sources: any[] = [
  { a: 5000, b: 1 },
  { a: -0, b: 0 },
  { a: NaN, b: 2 },
  { a: 1e21, b: 3 },
  { a: 9007199254740993, b: 4 },
  { a: 5000.5, b: -1 },
  { a: 7, b: 8 },
  { a: "text", b: "!" },
  { a: null, b: 5 },
  { a: undefined, b: 6 },
  { a: true, b: 7 },
  { a: [1, 2, 3], b: 8 },
  { a: { k: 1 }, b: 9 },
  { a: Buffer.from("hi"), b: 10 },
  { a: -2048, b: 1.5 },
  { a: Infinity, b: -Infinity },
  { a: 123456789, b: 0.1 },
];

const cells: Cell[] = sources.map((s, i) => new Cell(i, s));

function dynRead(o: any, key: string): any {
  return o[key];
}

for (const c of cells) {
  const t = c.a; // typed field read
  const d = dynRead(c, "a"); // dyn keyed read through an untyped parameter
  console.log(c.id, typeof t, Object.is(t, d), t, d);
  console.log("  total:", c.total(), "below:", c.below(6000));
  console.log("  strict:", c.a === dynRead(c, "a"), "same:", Object.is(c.a, dynRead(c, "a")));
}
