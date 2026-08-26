// The negative control for poolish-cli.ts. Overriding an inherited
// implicit-generic method is admitted; a call whose receiver's runtime
// class the static type does NOT pin must still refuse BY NAME. Generic
// methods own no vtable slot, so there is nothing to sort the two bodies
// out at run time, and a refusal replaced by a wrong answer would be
// silent — this program would print the base's answer where Node prints
// the override's.
//
// Node prints:
//     cb:base:p9
//     Pooled.end[Base.end<p9>]
//     log=PB
// The compiled binary must print none of it: the deferred fence at
// poolish/typed.js:19 throws instead, naming the method.
import typed from "poolish/typed.js";
import poolish from "poolish";

const sink = (s: unknown): void => {
  console.log("cb:" + String(s));
};

const p = new poolish.Pooled("p9");
console.log(typed.endThroughBase(p, sink));
console.log("log=" + p.log);
