// A user toString that throws: every conversion of the boxed class instance
// (String(), a template span, `+`, `==` against a string, and util.format's
// %s) propagates the exception to the caller, where it is catchable. The
// program continues after the last catch.
import { format } from "node:util";

class Loud {
  toString(): string {
    throw new Error("boom");
  }
}

const d: any = new Loud();

try {
  console.log("String", String(d));
} catch (e) {
  console.log("caught String", (e as Error).message);
}
try {
  console.log("template", `${d}`);
} catch (e) {
  console.log("caught template", (e as Error).message);
}
try {
  console.log("plus", d + "");
} catch (e) {
  console.log("caught plus", (e as Error).message);
}
try {
  console.log("eq", d == "x");
} catch (e) {
  console.log("caught eq", (e as Error).message);
}
try {
  console.log("format", format("%s", d));
} catch (e) {
  console.log("caught format", (e as Error).message);
}
console.log("after");
