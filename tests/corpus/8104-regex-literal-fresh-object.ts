// Each evaluation of a regex literal is a new RegExp object (lastIndex is per object); a literal consumed in place keeps the shared static.
function mk(): RegExp { return /ab/; }
const a = mk(), b = mk();
a.lastIndex = 5;
console.log(a.lastIndex, b.lastIndex, mk().lastIndex);
const lit = [/q/, /q/];
lit[0]!.lastIndex = 9;
console.log(lit[1]!.lastIndex, lit[0]!.lastIndex);
for (let i = 0; i < 3; i++) {
  const r = /z/;
  console.log(r.lastIndex);
  r.lastIndex = i + 1;
}
const g1 = () => /a/g;
const x = g1(), y = g1();
console.log(x.exec("aa") !== null, x.lastIndex, y.lastIndex);
class H { re = /h/; other = /h/; }
const h = new H();
h.re.lastIndex = 4;
console.log(h.other.lastIndex, h.re.lastIndex, new H().re.lastIndex);
function viaParam(r: RegExp): number { r.lastIndex = 7; return r.lastIndex; }
console.log(viaParam(/p/), viaParam(/p/), /p/.lastIndex);
console.log("a-b".replace(/-/, "+"), /c/.test("abc"), "x1y".split(/\d/).join(","));
const sticky = /y/y; sticky.lastIndex = 1;
console.log(sticky.test("ay"), sticky.lastIndex);
