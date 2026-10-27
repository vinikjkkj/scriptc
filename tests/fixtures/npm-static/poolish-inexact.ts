// The positive control for poolish-cli.ts. Overriding an inherited
// implicit-generic method is admitted, and a call whose receiver's runtime
// class the static type does NOT pin dispatches on that runtime class: a
// generic method owns no vtable slot, so the compiled call tests the
// receiver's class and reaches the override, as Node does.
//
// Node prints:
//     cb:base:p9
//     Pooled.end[Base.end<p9>]
//     log=PB
// The compiled binary prints the same three lines.
import typed from "poolish/typed.js";
import poolish from "poolish";

const sink = (s: unknown): void => {
  console.log("cb:" + String(s));
};

const p = new poolish.Pooled("p9");
console.log(typed.endThroughBase(p, sink));
console.log("log=" + p.log);
