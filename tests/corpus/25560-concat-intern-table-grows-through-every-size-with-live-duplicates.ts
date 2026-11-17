// A growing run of concatenations in the interning band (16..128 bytes), many of them duplicates of strings still alive: the cache grows from its
// smallest table to its largest and every string keeps its exact contents, length and equality.
const kept: string[] = [];
let sum = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 24000; i++) {
    const s = "record-key-" + (i % 9000) + "-round-" + round + "-padding-padding";
    kept.push(s);
    sum += s.length;
  }
}
const seen = new Map<string, number>();
for (const s of kept) seen.set(s, (seen.get(s) ?? 0) + 1);
let dup = 0;
for (const [, n] of seen) if (n > 1) dup++;
console.log(kept.length, sum, seen.size, dup);
console.log(kept[0], kept[8999], kept[9000], kept[kept.length - 1]);
let same = 0;
for (let i = 0; i < kept.length; i += 997) if (kept[i] === "record-key-" + (i % 24000 % 9000) + "-round-" + Math.floor(i / 24000) + "-padding-padding") same++;
console.log(same);
