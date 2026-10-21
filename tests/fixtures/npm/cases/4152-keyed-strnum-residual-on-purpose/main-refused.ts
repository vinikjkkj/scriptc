// rToFixedDot: the dot spelling of toFixed over a dynamic number has no static
// lowering, so it is refused at BUILD time (npm-static.test.ts, 4152 refused row).
import { rToFixedDot } from "keyedstrnum-refused"
console.log("rToFixedDot    = " + rToFixedDot())
