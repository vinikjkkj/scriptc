// for-loop heads with several let/const declarators, and no closure in the loop.
const keys = ['alpha', 'bb', 'c'];
const table = { alpha: 1, bb: 22, c: 333 };
const out = [];
for (let i = 0, n = keys.length; i < n; i++) {
  out.push(keys[i] + '=' + table[keys[i]]);
}
console.log(out.join(' '));
for (let a = 10, b = 1; a > b; a = a - 3, b = b + 1) {
  console.log('a', a, 'b', b);
}
for (const x = 2, y = 5; x < 3; ) {
  console.log('const head', x * y);
  break;
}
outer: for (let i = 0, j = 0; i < 3; i++, j += 2) {
  for (let k = 0, m = 2; k < 3; k++) {
    if (k === m) continue outer;
    if (i === 2) break outer;
    console.log('ij', i, j, k, m);
  }
}
let total = 0;
for (let i = 0, lim = 4; i < lim; i++) total += i;
console.log('total', total);
