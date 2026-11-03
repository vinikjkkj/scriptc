// A union with both a class arm and a record arm: an instance of the class keeps taking the
// class arm (the instance itself, so a write through the union is seen by the holder), in either
// arm order, while a plain object takes the record arm.
class Hdr {
  affectedRows = 3;
  insertId = 7;
}
interface Rec {
  affectedRows: number;
}
function f(x: unknown): number {
  const u = x as Rec | Hdr;
  u.affectedRows = 9;
  return u.affectedRows;
}
function g(x: unknown): number {
  const u = x as Hdr | Rec;
  u.affectedRows = 8;
  return u.affectedRows;
}
const h = new Hdr();
const k = new Hdr();
console.log(f(h), h.affectedRows, g(k), k.affectedRows);
const o = { affectedRows: 1 };
console.log(f(o), o.affectedRows);
