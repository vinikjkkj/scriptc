let x: number;
let s: string;
const f = () => { console.log(x); };
const g = () => { console.log(s, typeof s); };
f(); g();
const k = () => { console.log(x + 1, s ?? "none"); };
k();
const m = () => { try { console.log(s.length); } catch (e) { console.log((e as Error).message); } };
m();
x = 3; s = "q";
f(); g(); m();
function outer() {
  let y: string;
  const h = () => { console.log(y); };
  h();
  const hl = () => { try { console.log(y.length); } catch (e) { console.log((e as Error).message); } };
  hl();
  y = "z";
  h(); hl();
}
outer();
function inner2() {
  let n: number;
  const inc = () => { n += 1; console.log(n); };
  inc();
  n = 1;
  inc();
}
inner2();
function loopy() {
  let acc: number;
  const read = () => { console.log("acc", acc); };
  for (let i = 0; i < 2; i++) { read(); acc = i; }
  read();
}
loopy();
