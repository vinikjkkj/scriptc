class Tag extends String {
  constructor(kind, text) {
    super(text);
    this.kind = kind;
    this.seen = [kind, text];
  }
  describe() { return this.kind + ":" + this.length; }
}
let total = 0;
const keep = [];
for (let i = 0; i < 2000; i++) {
  const t = new Tag("k" + (i % 7), "payload-" + i);
  total += t.describe().length + t.length + String(t).length;
  if (i % 250 === 0) keep.push(t);
}
console.log(total, keep.length, keep[2].describe(), keep[3] + "", keep[1] instanceof Tag);
const m = new Map();
for (const t of keep) m.set(String(t), t);
console.log(m.size, m.get("payload-500").kind);
keep.length = 0;
m.clear();
try { Tag("x", "y"); } catch (e) { console.log(e.message); }
console.log(new Tag("z", "end"));
