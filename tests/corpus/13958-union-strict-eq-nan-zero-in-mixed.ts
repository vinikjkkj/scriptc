// Mixed arms and the strict-equality corners that a union compare must keep:
// NaN fails every compare, +0 === -0, a string "0" is not the number 0.
type Mixed = number | string | boolean | null;
const cases: Mixed[] = [0, -0, NaN, '0', false, null, 'NaN', 1e21, '1e21'];
let s = '';
for (const a of cases) {
  let row = '';
  for (const b of cases) row += (a === b) ? 'T' : '.';
  s += row + '\n';
}
console.log(s);
