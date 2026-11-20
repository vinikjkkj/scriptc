"use strict";
// The worker pool is real parallelism: Node runs zlib's callback forms on
// libuv's threadpool, so a slow job neither blocks the main thread nor holds
// back a fast job submitted after it. Three facts, each deterministic in Node
// because the gap between the jobs is orders of magnitude:
//  1. while the slow job runs, the loop keeps turning (an interval ticks);
//  2. the fast job's callback runs BEFORE the slow one's, though it was
//     submitted second (completion order, not submission order);
//  3. both deliver the right bytes (round trip), through the callback with
//     err === null.
// 6 MB of random bytes is incompressible, so level 9 deflate costs far more
// than the sub-millisecond fast job on any machine; no timing is printed, only
// the facts it implies.
const zlib = require("zlib");
const crypto = require("crypto");
const big = crypto.randomBytes(6 * 1024 * 1024);
const small = Buffer.from("tiny payload, a few bytes");
const log = [];
let ticks = 0;
const iv = setInterval(() => {
  ticks++;
}, 2);
let pending = 2;
function finish() {
  if (--pending !== 0) return;
  clearInterval(iv);
  console.log(log.join("\n"));
  console.log("interval ran while the pool worked", ticks >= 3);
}
zlib.deflate(big, { level: 9 }, (err, out) => {
  log.push("slow err=" + (err === null) + " roundtrip=" + zlib.inflateSync(out).equals(big));
  finish();
});
zlib.deflate(small, (err, out) => {
  log.push("fast err=" + (err === null) + " roundtrip=" + zlib.inflateSync(out).equals(small));
  finish();
});
console.log("submitted", pending);
