// Strings of 16 to 128 bytes built by concatenation are what the runtime's content table deduplicates. The same content is built here from many different
// splits of its bytes (so the probe's two-piece hash and the stored string's one-piece hash must agree for every split), kept alive, dropped in
// waves and rebuilt, in chains (a + b + c) and one-shot sums. Every result must equal its twins and print like Node's; a table whose probe and death hashes disagreed
// leaves a dangling entry that the sanitized run reports.
const base: string[] = [];
for (let i = 0; i < 97; i++) {
  let s = "";
  for (let k = 0; k < 140; k++) s += String.fromCharCode(97 + ((i * 31 + k * 7) % 26));
  base.push(s);
}
const live: string[] = [];
let distinct = 0;
const seen = new Map<string, number>();
let checksum = 0;
let twinMismatch = 0;
for (let round = 0; round < 30; round++) {
  for (let i = 0; i < 400; i++) {
    const src = base[(i * 5 + round) % 97]!;
    const n = 16 + ((i * 13 + round * 3) % 113); // 16..128
    const cut = 1 + ((i * 7 + round) % (n - 1));
    const a = src.slice(0, cut);
    const b = src.slice(cut, n);
    const whole = a + b; // two pieces
    const chain = src.slice(0, 3) + src.slice(3, cut + 2) + src.slice(cut + 2, n); // three pieces, other splits
    if (whole !== chain || whole.length !== n) twinMismatch++;
    if (!seen.has(whole)) { seen.set(whole, 0); distinct++; }
    seen.set(whole, seen.get(whole)! + 1);
    checksum = (checksum * 31 + whole.charCodeAt(n - 1) + whole.length) % 1000003;
    if (i % 3 === 0) live.push(whole);
    if (i % 3 === 1) live.push(chain + "");
  }
  if (round % 4 === 3) live.splice(0, Math.floor(live.length / 2)); // drop a wave
}
let liveLen = 0;
for (const s of live) liveLen += s.length;
console.log("distinct", distinct, "live", live.length, "liveLen", liveLen, "checksum", checksum, "twinMismatch", twinMismatch);
let tail = "";
for (let i = 0; i < 2000; i++) { tail += base[i % 97]!.slice(0, 1 + (i % 7)); if (tail.length > 120) tail = tail.slice(60); }
console.log("tail", tail.length, tail.slice(0, 12));
