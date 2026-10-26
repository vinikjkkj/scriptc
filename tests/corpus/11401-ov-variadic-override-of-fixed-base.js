class B { m(a, b) { return "B:" + a + ":" + b; } }
class S extends B {
  m() {
    let parts = "";
    for (let i = 0; i < arguments.length; i++) parts += (i ? "," : "") + arguments[i];
    return "S:" + arguments.length + ":" + parts;
  }
}
const s = new S();
const b = s;
console.log(b.m(1), b.m(1, 2, 3), s.m(), s.m(4, 5));
class R { r(a, b) { return "R:" + arguments.length + ":" + a + ":" + b; } }
const rr = new R();
console.log(rr.r(1), rr.r(1, 2, 3), rr.r());
class T extends R { r(x) { return "T:" + x; } }
const t = new T();
console.log(t.r(7), new R().r(8, 9));
