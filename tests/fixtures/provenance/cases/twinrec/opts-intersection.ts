// A derived class that re-declares its base's `options` and re-assigns it from defaults(): every member read off the
// result is read off an intersection of two option records, live off the object.
import { Derived } from "twinrec/opts";
const a = new Derived({ shardedSubscribers: true });
console.log(a.describe());
const c = new Derived({ redisOptions: { keyPrefix: "r:" } });
console.log(c.describe(), c.options.keyPrefix);
const b = new Derived({ scaleReads: "slave", slotsRefreshInterval: 7 });
console.log(b.describe());
console.log(b.options.slotsRefreshInterval, b.options.scaleReads, b.options.keyPrefix);
b.options.slotsRefreshInterval = 1;
console.log(b.describe());
try {
  new Derived({ scaleReads: "bogus" as "all" });
} catch (e) {
  console.log((e as Error).message);
}
import { Late } from "twinrec/opts";
console.log(new Late(true).describe());
console.log(new Late(false).describe());
