// A base whose method body only throws, declared `unknown` in its .d.ts, and a
// subclass that overrides it with a value. Calls through the base type reach the
// override and the result is used; the base body itself throws when called directly.
import Redis, { Commander } from "./lib.js";

const c: Commander = new Redis();
const v = c.send("get", "s");
const w = c.send("set");
console.log(v, w);
const r = new Redis();
console.log(r.send("x"), r.send("y", "z"));
try {
  new Commander().send("q");
  console.log("no throw");
} catch (e) {
  console.log("thrown", (e as Error).message);
}
