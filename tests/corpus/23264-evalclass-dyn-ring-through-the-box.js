// A ring THROUGH the class-value box: the evaluation captures an object that holds the box (the cycle collector owns it).
// a cycle THROUGH the class-value box: the evaluation captures an object that holds the box
function anyv(x) { return x; }
let sum = "";
for (let n = 0; n < 300; n++) {
  const holder = JSON.parse("{}");
  const C = class K { m() { return holder; } };
  holder.C = C;
  const D = anyv(holder.C);
  sum = typeof new D().m();
}
console.log(sum);
