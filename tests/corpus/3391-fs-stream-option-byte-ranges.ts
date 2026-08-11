// createReadStream's byte-range options. `end` is INCLUSIVE and is a
// BUDGET, not a hint: it is spent against bytes DELIVERED, so a short read
// cannot lose a byte and a bounded stream stops without a further read(2).
// An off-by-one here is a wrong ANSWER that no trap census can see, which
// is why every boundary is pinned by value: the first byte, the last byte,
// the running checksum, and every chunk size.
//
// `highWaterMark: 0` is in here for the opposite reason — Node answers such
// a stream with no 'data' at all, and the obvious `hwm > 0 ? hwm : default`
// guard silently turns that into "read the whole file".
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import type { Readable } from "node:stream";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") i = i - 1;
  return path.slice(i + 1);
}
function freshDir(dir: string): void {
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) rmSync(dir + "/" + name);
    rmdirSync(dir);
  }
  mkdirSync(dir);
}
const scratch = "tmp-3391-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
const payload = Buffer.alloc(300);
for (let i = 0; i < payload.length; i = i + 1) payload[i] = (i * 37 + 11) % 256;
writeFileSync(src, payload);

async function report(rs: Readable, tag: string): Promise<void> {
  const sizes: number[] = [];
  let first = -1;
  let last = -1;
  let total = 0;
  let sum = 0;
  await new Promise<void>((res) => {
    rs.on("data", (c: Buffer) => {
      sizes.push(c.length);
      for (let i = 0; i < c.length; i = i + 1) sum = (sum * 31 + (c[i] ?? 0)) % 1000003;
      if (first < 0 && c.length > 0) first = c[0] ?? -1;
      if (c.length > 0) last = c[c.length - 1] ?? -1;
      total = total + c.length;
    });
    rs.on("close", () => res());
  });
  console.log(tag, "n=" + sizes.length, "total=" + total, "first=" + first, "last=" + last, "sum=" + sum, "sizes=" + sizes.join(","));
}

// the bound, from both ends and at both edges
await report(createReadStream(src, { start: 10 }), "start10");
await report(createReadStream(src, { end: 20 }), "end20");
await report(createReadStream(src, { start: 10, end: 20 }), "s10e20");
await report(createReadStream(src, { start: 0, end: 0 }), "s0e0");
await report(createReadStream(src, { start: 299 }), "s299");
await report(createReadStream(src, { start: 299, end: 299 }), "s299e299");
await report(createReadStream(src, { start: 300 }), "s300");
await report(createReadStream(src, { start: 0, end: 299 }), "wholeByBound");
await report(createReadStream(src, { start: 5, end: 1000000000 }), "endPastEof");
// the bound against a highWaterMark that does not divide it
await report(createReadStream(src, { start: 10, highWaterMark: 7 }), "s10hwm7");
await report(createReadStream(src, { start: 10, end: 30, highWaterMark: 7 }), "s10e30hwm7");
await report(createReadStream(src, { start: 1, end: 8, highWaterMark: 3 }), "s1e8hwm3");
await report(createReadStream(src, { end: 0, highWaterMark: 1 }), "e0hwm1");
await report(createReadStream(src, { highWaterMark: 128 }), "hwm128");
await report(createReadStream(src, { highWaterMark: 0 }), "hwm0");

// an empty file emits no 'data' whichever way it is bounded
const empty = scratch + "/empty.bin";
writeFileSync(empty, "");
await report(createReadStream(empty), "empty");
await report(createReadStream(empty, { start: 0, end: 99 }), "emptyBounded");

// encoding folds the same decoder the setEncoding path uses, and a
// multi-byte character straddling a chunk boundary must survive it
const utf = scratch + "/u.txt";
writeFileSync(utf, "héllo wörld ".repeat(400));
for (const hwm of [7, 4096]) {
  const parts: string[] = [];
  const es = createReadStream(utf, { encoding: "utf8", highWaterMark: hwm });
  await new Promise<void>((res) => {
    es.on("data", (c: string) => { parts.push(c); });
    es.on("close", () => res());
  });
  const joined = parts.join("");
  console.log("enc hwm=" + hwm, "chunks=" + parts.length, "chars=" + joined.length, "head=" + joined.slice(0, 12), "tail=" + joined.slice(joined.length - 12));
}
// an encoding over a bounded range: the bound counts BYTES, the length
// counts characters, and conflating them is the other off-by-one
const bounded: string[] = [];
const be = createReadStream(utf, { encoding: "utf8", start: 0, end: 12 });
await new Promise<void>((res) => {
  be.on("data", (c: string) => { bounded.push(c); });
  be.on("close", () => res());
});
console.log("encBounded", JSON.stringify(bounded.join("")));

// Node's second spelling of { encoding }: a bare string second argument
const bare: string[] = [];
const bs = createReadStream(utf, "utf8");
await new Promise<void>((res) => {
  bs.on("data", (c: string) => { bare.push(c); });
  bs.on("close", () => res());
});
console.log("bareEncoding chars=" + bare.join("").length, JSON.stringify(bare.join("").slice(0, 12)));

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
