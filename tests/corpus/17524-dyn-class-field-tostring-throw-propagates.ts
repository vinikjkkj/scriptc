// A toString FIELD that throws must propagate out of String(), a template
// span and util.format's %s, not be caught or inspected. Node prints "boom"
// for each conversion, caught at the call site.
import { format } from "node:util";

class T {
  toString = () => {
    throw new Error("boom");
  };
}

const d: any = new T();
try {
  console.log("String", String(d));
} catch (e: any) {
  console.log("String threw", e.message);
}
try {
  console.log("template", `${d}`);
} catch (e: any) {
  console.log("template threw", e.message);
}
try {
  console.log("format", format("%s", d));
} catch (e: any) {
  console.log("format threw", e.message);
}
