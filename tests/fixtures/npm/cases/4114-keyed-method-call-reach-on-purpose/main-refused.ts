// The two dot rows of 4114 that used to have no static lowering (a build
// refusal); a dyn array answers them now, pinned by
// tests/harness/npm-static.test.ts (4114, dot rows).
import { tReduce, tFlat } from "keyedreach-refused"
console.log("tReduce   = " + tReduce())
console.log("tFlat     = " + tFlat())
