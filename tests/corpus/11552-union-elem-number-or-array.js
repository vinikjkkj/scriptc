// element read over a number | number[] union: the number arm answers undefined, the way (5)[0] does in Node
function pick(n) {
  if (n === 0) return 5;
  return [10, 20];
}
function first(n) {
  const v = pick(n);
  return v[1];
}
for (let n = 0; n < 2; n++) {
  console.log(n, String(first(n)));
}
const a = pick(0);
const b = pick(1);
console.log(String(a[0]), String(b[0]));
