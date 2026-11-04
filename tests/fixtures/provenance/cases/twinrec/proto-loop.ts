// Methods installed on a base class's prototype in a loop, named only by the declaration file, called through a
// typed receiver (ioredis' redis.quit()).
import { Redis } from "twinrec/protoloop";
const r = new Redis();
console.log(r.get("a"));
console.log(r.set("a", "b"));
console.log(r.quit(), r.n, r.label);
