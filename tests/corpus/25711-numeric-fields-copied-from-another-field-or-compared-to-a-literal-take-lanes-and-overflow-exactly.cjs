// A class whose constructor copies one numeric field into another (`this.type = this.code`) and stores a call result that is only ever compared against a number literal
// (`this.scale === 31`) keeps all of them exactly, even when the program also reads a field NAMED `type` through a tagged union of unrelated records: lane values, and the overflow answers for fractions, negatives, NaN, -0, too-large numbers and non-numbers.
class Col {
  constructor(a, b, c, d, scale) {
    this.a = a;
    this.b = b;
    this.code = c;
    this.type = this.code;
    this.d = d;
    this.scale = scale;
  }
  total() { return this.a + this.b + this.code + this.d; }
  label() {
    if (this.scale === 31) return "float";
    if (this.scale === 0) return "int";
    return "dec(" + this.scale + ")";
  }
}
function show(c) {
  console.log(c.a, c.b, c.code, c.type, c.d, c.scale, c.label(), Object.is(c.a, -0), typeof c.type, Object.keys(c).join(","));
}
show(new Col(1, 2, 3, 4, 31));
show(new Col(0, 255, 253, 4294967295, 0));
show(new Col(4294967296, -1, 1.5, NaN, 2));
show(new Col(-0, 7, "s", null, undefined));
show(new Col(9007199254740993, 1e21, true, 0.1 + 0.2, 31));
const many = [];
let first = null;
let c31 = null;
for (let i = 0; i < 1000; i++) {
  const c = new Col(i, i * 2, i % 256, i * 1000, i % 32);
  many.push(c);
  if (i === 0) first = c;
  if (i === 31) c31 = c;
}
let sum = 0;
for (const c of many) sum += c.a + c.b;
console.log(sum, many.length, c31.label(), first.label(), c31.type);
console.log(new Col(1, 2, 3, 4, 31).total(), new Col(1.5, 2, 3, 4, 31).total());
const o = new Col(1, 2, 3, 4, "five");
console.log(o.scale, o.type, o.label(), o.code, o.total());
function tagged(n) { return n > 1 ? { type: "a", x: n } : { type: "b", y: "s" }; }
const t1 = tagged(2);
const t2 = tagged(0);
console.log(t1.type === "a" ? t1.x : t1.y, t2.type === "a" ? t2.x : t2.y);
