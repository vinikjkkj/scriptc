// Commands installed on the prototype by a loop, called with a SPREAD argument (ioredis' redis.del(...keys), pipeline.sadd(key, ...members)): the call must
// reach the installed function with every element as its own argument, on the client and on the pipeline it hands out.
import { Redis } from "expclass";
const r = new Redis({ host: "h" });
const keys = ["a", "b", "c"];
console.log(r.del(...keys), r.mget(...keys.slice(1)), r.calls);
const p = r.pipeline();
p.sadd("set", ...keys);
p.sadd("set2", "x");
console.log(p.exec().join(","));
