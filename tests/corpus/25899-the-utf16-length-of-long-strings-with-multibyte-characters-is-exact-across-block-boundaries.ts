// .length of a fresh string whose bytes are not all ASCII: every width class, astral pairs straddling 16-byte block edges, and sizes around 255 blocks (4,080 bytes) where a vector scan folds its lane counters. Compared with Node through the printed lengths, a checksum of every length, and charCodeAt/indexOf on the same strings.
const parts = ["a", "é", "€", "\u{1F600}", "z", "￿", "\u{10000}", "plain-run-0123456789"];
let checksum = 0;
let lines = "";
for (let target = 1; target <= 9000; target += (target < 300 ? 1 : 397)) {
  for (let phase = 0; phase < 4; phase++) {
    let s = "";
    let k = phase;
    while (s.length < target) {
      s += parts[k % parts.length]!;
      k += 1 + (k % 3);
    }
    const len = s.length;
    checksum = (checksum * 31 + len) >>> 0;
    checksum = (checksum * 31 + s.charCodeAt(len - 1)) >>> 0;
    checksum = (checksum * 31 + s.indexOf("z")) >>> 0;
    if (target % 997 < 10 || target < 40) lines += target + ":" + phase + ":" + len + "," ;
  }
}
console.log(lines);
console.log(checksum);
const big = ("\u{1F600}x€").repeat(1500);
console.log(big.length, big.charCodeAt(4499), big.indexOf("x", 4000), [...big].length);
