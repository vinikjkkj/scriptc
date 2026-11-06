// Untyped methods of a class declared in a package's factory (`--npm-static capenv`). A method read off an instance
// is the function of one evaluation: `.call(other)` keeps the captured bindings of the evaluation it came from,
// identity holds within an evaluation and fails across two, and a detached call answers where the body does not
// touch `this`. On base every such read is refused (SC1090 "a captured binding read through a detached receiver").
import { make } from "capenv";

function pick(o: any, k: string): any {
  return o[k];
}
const a = make("p", 1);
const b = make("q", 2);
const add = pick(a, "add");
const both = pick(a, "both");
const viaArrow = pick(a, "viaArrow");
const noop = pick(a, "noop");
console.log(add("-"), add.call(b, "-"), add.apply(b, ["+"]), add.bind(b, "*")());
try {
  console.log(both("-"));
} catch (e) {
  console.log("detached both", (e as Error).name);
}
console.log(both.call(b, "-"));
try {
  console.log(viaArrow("-"));
} catch (e) {
  console.log("detached viaArrow", (e as Error).name);
}
console.log(viaArrow.call(b, "-"));
console.log(noop(), noop.call(b));
console.log(pick(a, "add") === add, pick(b, "add") === add, pick(make("p", 1), "add") === add);
