// A base class and a subclass declared in a .d.ts, implemented by a compiled
// .js twin. The subclass overrides send with a longer parameter list (an
// untyped third parameter) and the twin's statics are written through the
// class name and read back. Calls through the base type reach the override
// with JavaScript argument semantics: an omitted argument is undefined.
import Redis, { Base } from "./lib.js";

Redis.Cluster = 5;
Redis.Cluster = Redis.Cluster + 1;
Redis.Command = Redis.Command + "!";
const r = new Redis(7);
const b: Base = r;
console.log(Redis.Cluster, Redis.Command, r.send("a"));
console.log(b.send("x"), b.send("y", "s"));
