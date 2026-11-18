// Node: an out-of-range read used as a number is undefined converted to a number: NaN in arithmetic, 0 under a bitwise operator, false in a comparison and a condition.
const b = new Uint8Array([1, 2, 3]);
let i = 5;
const a = b[i];
console.log(b[i] + 1, b[i] * 2, b[i] - b[0], -b[i], +b[i], b[i] / 2, b[i] % 3, b[i] ** 2);
console.log(b[i] | 0, b[i] & 255, b[i] ^ 7, b[i] << 3, b[i] >> 1, b[i] >>> 0, ~b[i]);
console.log(b[i] > 0, b[i] < 0, b[i] >= 0, b[i] <= 0, b[i] == 0, !b[i], b[i] ? "t" : "f", b[i] || 7, b[i] && 8);
console.log(Number(b[i]), Math.max(b[i], 1), Math.min(2, b[i]), Math.floor(b[i]), Math.abs(b[i]), isNaN(b[i]), Number.isNaN(b[i]), Number.isInteger(b[i]));
console.log(a + 1, a | 0, Number.isNaN(a), a === undefined);
let sum = 0;
for (let k = 0; k < 6; k++) sum += b[k] || 0;
console.log(sum);
let word = 0;
for (let k = 0; k < 4; k++) word = (word << 8) | b[k];
console.log(word);
const hi = (b[4] << 8) | b[5];
console.log(hi, (b[2] << 8) | b[3]);
