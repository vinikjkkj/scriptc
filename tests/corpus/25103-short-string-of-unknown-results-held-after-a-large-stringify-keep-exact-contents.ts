// A large JSON.stringify raises the JSON builder's size hint, and String(unknown) builds its result in that builder. Many short results held at
// once must each hold their own text and nothing else: the contents, the lengths and a checksum over all of them are the same as Node's, for
// every value kind the walker handles and for results just under, at and over the sizes where a result stops being "mostly slack".
const raise: string[] = new Array(30000).fill("abcdefghij");
console.log("raised", JSON.stringify(raise).length);

function mix(i: number): unknown {
  switch (i % 7) {
    case 0: return Buffer.from("key-" + i + "-0123456789");
    case 1: return i * 0.25;
    case 2: return "s" + i;
    case 3: return i % 2 === 0;
    case 4: return [i, "x" + i, i + 0.5];
    case 5: return null;
    default: return new Uint8Array([i & 255, (i >> 3) & 255]);
  }
}
const held: string[] = [];
for (let i = 0; i < 4000; i++) held.push(String(mix(i)));
let sum = 0;
for (let i = 0; i < held.length; i++) {
  const s = held[i];
  for (let j = 0; j < s.length; j += 3) sum = (sum * 33 + s.charCodeAt(j)) >>> 0;
  sum = (sum + s.length) >>> 0;
}
console.log("held", held.length, sum);
console.log(held[0], held[1], held[2], held[3], held[4], held[5], held[6]);
console.log(held[3994], held[3995], held[3996], held[3997], held[3998], held[3999]);

// lengths around the trim threshold: result length n built into a block that is mostly slack for small n and nearly full for large n
const edges: string[] = [];
for (const n of [0, 1, 63, 64, 65, 127, 128, 129, 255, 256, 1000, 4095, 4096, 4097, 40000, 65000, 65535, 65536, 65537, 70000]) {
  const b: unknown = Buffer.alloc(n, 97 + (n % 20));
  const r = String(b);
  edges.push(n + ":" + r.length + ":" + (r.length > 0 ? r.charCodeAt(0) + "," + r.charCodeAt(r.length - 1) : "-"));
}
console.log(edges.join(" "));

// a long result built from a nested array: pays the doubling once, and its text is intact
const parts: unknown[] = [];
for (let i = 0; i < 3000; i++) parts.push([i, "p" + i]);
const longStr = String(parts as unknown);
console.log("long", longStr.length, longStr.slice(0, 24), longStr.slice(-24));
