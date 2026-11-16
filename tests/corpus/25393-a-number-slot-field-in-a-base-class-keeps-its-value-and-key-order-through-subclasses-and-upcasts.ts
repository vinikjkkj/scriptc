// A number-slot field declared by a base class: the subclass layout embeds it, an upcast reads it by the base layout, and a dyn view of a subclass
// instance lists the base field first, then the subclass's own, with the same values whichever static type holds the instance.
class Base {
  id: number;
  off: any;
  constructor(id: number, src: any) {
    this.id = id;
    this.off = src.off;
  }
  end(): any {
    return this.off + 1;
  }
}
class Mid extends Base {
  len: any;
  note: string;
  constructor(id: number, src: any) {
    super(id, src);
    this.len = src.len;
    this.note = "mid" + id;
  }
  span(): any {
    return this.len + this.off;
  }
}
class Leaf extends Mid {
  tail: any;
  constructor(id: number, src: any) {
    super(id, src);
    this.tail = src.tail;
  }
  all(): any {
    return this.tail + this.len;
  }
}

function asAny(x: any): any {
  return x;
}
function describe(tag: string, b: Base): void {
  const o = asAny(b);
  console.log(tag, Object.keys(o).join(","), JSON.stringify(o), String(b.off), String(b.end()));
}

const src = { off: 65000, len: 70000, tail: 80000 };
const list: Base[] = [new Base(1, src), new Mid(2, src), new Leaf(3, src), new Leaf(4, { off: "o", len: 2, tail: null })];
for (const b of list) describe("up", b);
const m: Mid = new Leaf(5, { off: 5000.5, len: 6000, tail: -0 });
console.log(m.span(), m.len, m.off);
const l = new Leaf(6, { off: 1e21, len: NaN, tail: 70000 });
console.log(l.all(), l.span(), l.end(), Object.is(l.len, NaN));
