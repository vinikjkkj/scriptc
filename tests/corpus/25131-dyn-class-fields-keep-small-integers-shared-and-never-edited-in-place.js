// A class whose fields hold dyn values (untyped JS: values read out of JSON.parse and returned by dynamic calls) stores freshly computed numbers
// into them: counters, offsets, lengths. A small integer stored that way is one shared immortal box, so every observable property of the number
// must stay what Node answers whatever the way it got there: the sign of zero, NaN, fractions, the integers on both sides of the shared range, the
// compound assignments and increments, a field copied into another and then changed, a value returned from a method and stored by its caller.
class Reader {
  constructor(buf) { this.buf = buf; this.offset = JSON.parse("0"); this.len = JSON.parse("0"); this.sign = JSON.parse("1"); }
  readInt() { const v = this.buf[this.offset]; this.offset = this.offset + 1; return v; }
  readLen() { this.len = this.len + this.readInt(); return this.len; }
  skip(n) { this.offset += n; }
  neg() { this.sign = this.sign * -1; this.sign = this.sign * 0; return this.sign; }
}
class Column {
  constructor(r) {
    this.a = r.readInt();
    this.b = r.readInt() + 0;
    this.c = r.readLen();
    this.d = r.offset;
    this.e = r.readInt() * 1;
    this.f = r.neg();
    this.g = r.readInt() - r.readInt();
    this.h = r.readInt() / 4;
  }
}
const nums = [3, 7, 0, 1023, 1024, -1, -128, -129, 255, 256, 5, 0.5, 100000, 2];
const r = new Reader(JSON.parse(JSON.stringify(nums)));
const col = new Column(r);
console.log(col.a, col.b, col.c, col.d, col.e, Object.is(col.f, -0), 1 / col.f, col.g, col.h, r.offset, r.len);
// many columns of the same small values, each then changed on its own: no change may show through another holder
const cols = [];
const base = JSON.parse(JSON.stringify([7, 7, 7, 7, 0, 1023, -128, 1024, 7.5, 9, 9, 9, 9, 9, 9, 9, 9]));
for (let i = 0; i < 500; i++) cols.push(new Column(new Reader(base)));
let k = 0;
for (const c of cols) { if (k++ % 2 === 0) { c.a++; c.b += 10; c.c = c.c - 7; c.e = -c.e; c.f = c.f + 1; } }
let sa = 0, sb = 0, sc = 0, se = 0, sf = 0, negz = 0;
for (const c of cols) { sa += c.a; sb += c.b; sc += c.c; se += c.e; sf += c.f; if (Object.is(c.f, -0)) negz++; }
console.log(sa, sb, sc, se, sf, negz, cols.at(1).a, cols.at(0).a, cols.at(1).b, cols.at(0).b, cols.at(3).c, cols.at(2).c);
// a field copied into another object, then the original changed
const r2 = new Reader(JSON.parse("[5,5,5,5]"));
const c2 = new Column(r2);
const copy = { a: c2.a, b: c2.b };
c2.a += 1;
c2.b = c2.b * 2;
console.log(copy.a, copy.b, c2.a, c2.b, Object.is(copy.a, 5));
// a counter walked across the edge of the shared range, up and down, stored in a field each step
const rc = new Reader(JSON.parse("[]"));
rc.offset = JSON.parse("1020");
const seen = [];
for (let i = 0; i < 8; i++) { seen.push(rc.offset); rc.skip(1); }
rc.offset = JSON.parse("-125");
for (let i = 0; i < 8; i++) { seen.push(rc.offset); rc.skip(-1); }
console.log(seen.join(" "));
