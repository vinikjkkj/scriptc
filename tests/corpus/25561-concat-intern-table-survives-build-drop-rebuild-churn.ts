// Build, drop and rebuild band-sized strings in waves of different sizes, so the interning cache grows while earlier entries die: contents never mix.
let checksum = 0;
function wave(count: number, tag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(tag + "-item-" + i + "-with-some-trailing-text-to-fill");
  return out;
}
for (const [count, tag] of [[300, "a"], [5000, "b"], [40, "c"], [30000, "d"], [700, "a"], [12000, "b"]] as [number, string][]) {
  const w = wave(count, tag);
  let local = 0;
  for (let i = 0; i < w.length; i++) { local += w[i]!.length; if (w[i]!.indexOf(tag + "-item-" + i + "-") !== 0) throw new Error("mixed " + i); }
  checksum += local * 3 + w.length;
  console.log(tag, count, local, w[w.length - 1]);
}
console.log(checksum);
