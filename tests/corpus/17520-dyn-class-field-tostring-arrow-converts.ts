// A class whose toString is an arrow-function FIELD, not a method, held in
// `any`. The field is an own data property, and ToPrimitive reads it through
// Get and calls it because it is callable, so String(), a template span, `+`,
// a direct d.toString() call and util.format's %s all run the field's
// function. Node: String(d) is "F", `${d}` is "F", d + "" is "F", d.toString()
// is "F", and format("%s", d) is "F".
import { format } from "node:util";

class F {
  toString = () => "F";
}

const d: any = new F();
console.log("String", String(d));
console.log("template", `${d}`);
console.log("plus", d + "");
console.log("method", d.toString());
console.log("format", format("%s", d));
console.log("%s", d);
