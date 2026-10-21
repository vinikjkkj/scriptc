// The two dot rows of 4114 that have no static lowering. A refusal at BUILD
// time, pinned by tests/harness/npm-static.test.ts (4114, refused rows).
import { tReduce, tFlat } from "keyedreach-refused"
console.log("tReduce   = " + tReduce())
console.log("tFlat     = " + tFlat())
