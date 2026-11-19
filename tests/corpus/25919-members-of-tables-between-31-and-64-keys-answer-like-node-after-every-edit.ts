// Dynamic objects of 31..64 members (around the member index threshold): hits at every position, misses, same-length keys differing in one byte, repeated reads between appends, overwrites and deletes, `in`, and key order.
function mk(): any {
  return {};
}
const out: string[] = [];
for (const n of [30, 31, 32, 33, 47, 63, 64, 65]) {
  const d = mk();
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = i % 2 === 0 ? "m" + (i % 10) + String.fromCharCode(97 + (i % 26)) + i : "member_" + i;
    keys.push(k);
    d[k] = i * 3;
    // a read after every append: the table is looked up while it grows through the threshold
    if (d[keys[(i * 5) % keys.length]!] !== ((i * 5) % keys.length) * 3) out.push("grow read " + n + " " + i);
  }
  let s = 0;
  for (let r = 0; r < 20; r++) for (let i = 0; i < n; i++) s += d[keys[(i * 7 + r) % n]!];
  out.push(n + " sum " + s);
  const miss = ["", "m", "member_", "member_" + n, "m0a", "m0a0x", "nope", keys[0] + "x", keys[n - 1]!.slice(0, -1)];
  out.push(n + " miss " + miss.map((k) => (k in d ? "1" : "0") + String(d[k])).join(","));
  d[keys[n >> 1]!] = "over";
  delete d[keys[1]!];
  d["fresh" + n] = n;
  d[keys[1]!] = "back";
  out.push(n + " edit " + Object.keys(d).length + " " + String(d[keys[n >> 1]!]) + " " + String(d[keys[1]!]) + " " + String(d["fresh" + n]) + " " + Object.keys(d).slice(-3).join(","));
  for (let i = 0; i < n; i += 3) delete d[keys[i]!];
  let alive = 0;
  for (const k of keys) if (k in d) alive++;
  out.push(n + " after deletes " + alive + " " + Object.keys(d).length + " " + String(d[keys[2 % n]!]));
}
console.log(out.join("\n"));
