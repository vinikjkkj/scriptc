// The same program with static imports: the reference the dynamic import() form must equal.
import ExpDefault, { Redis, helper } from "expclass";
const r = new Redis({ host: "h" });
console.log(r.get("k"), r.ping(), r.calls, r.opts.host);
console.log(r instanceof ExpDefault, r instanceof Redis, ExpDefault === Redis, typeof helper, helper(1));
console.log(new ExpDefault({ host: "x" }).get("y"));
