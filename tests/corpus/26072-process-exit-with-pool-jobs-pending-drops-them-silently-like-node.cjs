"use strict";
// process.exit() while worker-pool jobs are queued, running and finished but
// undelivered: the callbacks never run, nothing is printed for them, and the
// exit status is the one asked for. A slow deflate occupies the pool, fills and
// small jobs queue behind or beside it, and the exit lands while they are in
// flight.
const zlib = require("zlib");
const crypto = require("crypto");
const big = crypto.randomBytes(4 * 1024 * 1024);
let fired = 0;
for (let i = 0; i < 6; i++) zlib.deflate(big, { level: 9 }, () => fired++);
for (let i = 0; i < 20; i++) crypto.randomFill(new Uint8Array(32), () => fired++);
for (let i = 0; i < 20; i++) zlib.deflate(Buffer.from("small " + i), () => fired++);
process.on("exit", (code) => {
  console.log("exit event", code, "callbacks fired by then", fired >= 0);
});
setTimeout(() => {
  console.log("exiting now");
  process.exit(7);
}, 30);
