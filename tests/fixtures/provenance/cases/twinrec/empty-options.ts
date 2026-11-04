// A base class that starts `options` as an empty object literal, read by its own methods and by a subclass that
// replaces it with the merged options.
import { Holder, Cluster } from "twinrec/emptyopts";
console.log(new Holder().prefixed("a"));
console.log(new Cluster({ keyPrefix: "p:" }).describe());
console.log(new Cluster({ shardedSubscribers: true }).describe());
const c = new Cluster();
console.log(c.options.keyPrefix, c.options.slotsRefreshInterval, c.prefixed("z"));
