// Prototype data under an instance field name: the field is absent until a write, an own undefined is a real own value, and the class has enough numeric fields to carry
// the narrow block the absent fields join.
class Item {
  constructor(a, b, c, d) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
  sum() { return this.a + this.b + this.c + this.d; }
  cache() { if (this.memo === undefined) this.memo = this.sum() * 2; return this.memo; }
  setLabel(v) { this.label = v; }
  setNote(v) { this.note = v; }
}
Item.prototype.memo = undefined;
Item.prototype.label = "default-label";
Item.prototype.note = undefined;
function show(tag, o) {
  console.log(tag, o.memo, o.label, o.note, "memo" in o, Object.hasOwn(o, "memo"), Object.hasOwn(o, "label"), Object.hasOwn(o, "note"), Object.keys(o).join(","));
}
const x = new Item(1, 2, 3, 4);
show("fresh", x);
console.log(x.cache());
show("memo", x);
x.setLabel("mine");
show("label", x);
x.setNote(undefined);
show("note-undef", x);
x.setNote(0);
show("note-0", x);
x.setLabel(undefined);
show("label-undef", x);
const y = new Item(5, 6, 7, 8);
show("other", y);
const keys = [];
for (const k in x) keys.push(k);
console.log(keys.join(","));
const z = new Item(1, 1, 1, 1);
console.log(z.cache(), z.cache(), z.sum());
