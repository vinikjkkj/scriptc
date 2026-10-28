import Cl, { Other } from "./cl.ts";
import Redis, { clusterBeforeInit, setOtherLater } from "./redis.ts";

console.log("init-before", Redis.Cluster === undefined, typeof Redis.Cluster);
console.log("fn-before", clusterBeforeInit());

Redis.Cluster = Cl;
console.log("after", Redis.Cluster === Cl, typeof Redis.Cluster, clusterBeforeInit());

// a class value read, then a method on it
const K = Redis.Cluster;
const made = K.make();
console.log("class value", K.name, made instanceof Cl);

// cross-module read through the imported class object
const rc = Redis.createClient();
console.log("cross", Redis.defaultOptions.retries, rc instanceof Redis);

// reassignment at module scope
const again = Cl;
Redis.Cluster = again;
console.log("reassign", Redis.Cluster === again);

// a subclass sees the parent's static through the constructor chain
class Sub extends Redis {}
console.log("subclass", Sub.Cluster === Cl, Sub.defaultOptions.retries);

// a write from a function body, read back later
console.log("other-before", Redis.Other === undefined);
setOtherLater();
console.log("other-after", Redis.Other === Other);

// value flowing into an argument and an array
function same(k: typeof Cl): boolean {
  return k === Cl;
}
console.log("arg", same(Redis.Cluster), [Redis.Cluster][0] === Cl);
