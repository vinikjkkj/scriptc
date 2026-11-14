// n-ary concat chains: sizes around the intern range (16..128) and the 512 slack threshold, empty and non-ASCII operands, 9+ operand chains, template literals, shared and sole-owner left operands
function rep(c, n) { return c.repeat(n); }
let h = 0, tot = 0;
function mix(s) { tot += s.length; for (let i = 0; i < s.length; i += 97) h = (h * 31 + s.charCodeAt(i)) | 0; }
const sizes = [0, 1, 15, 16, 40, 41, 42, 127, 128, 129, 130, 300, 511, 512, 513, 2000, 11000];
const keep = [];
for (let r = 0; r < 40; r++) {
  for (const n of sizes) {
    const a = rep("a", n), b = rep("é", n % 7), c = rep("c", n >> 1), d = "";
    const s3 = a + b + c;
    const s5 = a + "|" + b + d + c;
    const s9 = a + "1" + b + "2" + c + "3" + d + "4" + a;
    const t = `${a}<${r % 10}>${b}-${c}`;
    mix(s3); mix(s5); mix(s9); mix(t);
    if (r === 0) keep.push(s9);
  }
}
let acc = "";
for (let i = 0; i < 2000; i++) acc = acc + "x" + i + "y";
mix(acc);
const k = keep[keep.length - 1] + "z" + keep[0] + "w";
mix(k);
console.log(tot, h, k.length, acc.length);
