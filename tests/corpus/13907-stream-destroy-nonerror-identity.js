// destroy(x) with a truthy non-Error x: 'error' receives x itself (its type
// and inspected value are x's own). Falsy x (0, null, undefined)
// closes without 'error'. Listeners here are untyped (the dynamic lane).
import { Readable } from "node:stream";

function run(label, v) {
  const s = new Readable({ objectMode: true, read() {} });
  s.on("error", (e) => console.log(label, "error", typeof e, e));
  s.on("close", () => console.log(label, "close"));
  s.destroy(v);
  console.log(label, "destroyed", s.destroyed);
}
const obj = { code: "X", n: 1 };
const fn = function foo() {};
const arr = [1];
run("str", "plain");
run("num", 42);
run("obj", obj);
run("fn", fn);
run("arr", arr);
run("zero", 0);
run("null", null);
run("undef", undefined);
