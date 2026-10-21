const xs = ["a", "b"];
const ys = [1, 2];
const s = xs[3];
const t = xs[4];
console.log(s + t);
console.log(`${s + t}`);
console.log(String(s + t));
console.log(xs[3] + xs[4]);
console.log(xs[0] + xs[4]);
console.log(xs[4] + xs[1]);
console.log(xs[3] + "x");
console.log("x" + xs[3]);
console.log(xs[3] + ys[0]);
console.log(xs[0] + ys[7]);
console.log(ys[7] + xs[1]);
console.log(ys[3] + ys[4]);
console.log(ys[3] + 1);
console.log(xs[0] + xs[1]);
console.log(ys[0] + ys[1]);
console.log(xs[5] + xs[6] + "!");
console.log("<" + (xs[5] + xs[6]) + ">");
function f(i: number, j: number) {
  const a = xs[i];
  const b = xs[j];
  console.log(a + b);
  const n = ys[i];
  console.log(a + n, n + b, `${a + n}`);
}
f(0, 1); f(0, 9); f(9, 1); f(8, 9);
