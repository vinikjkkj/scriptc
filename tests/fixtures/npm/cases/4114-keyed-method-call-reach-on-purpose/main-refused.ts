// The two dot rows of 4114 that were once refused at BUILD time. The runtime
// answers both on an untyped array now; tests/harness/npm-static.test.ts
// (4114, formerly refused rows) builds them on both backends and diffs Node.
import { tReduce, tFlat } from "keyedreach-refused"
console.log("tReduce   = " + tReduce())
console.log("tFlat     = " + tFlat())
