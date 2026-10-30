// A user toString that answers an OBJECT is not a primitive, so ToPrimitive
// goes on to valueOf for the STRING hint as well as the DEFAULT hint. Node:
// String(d) is "7", a template span is "7", "" + d is "7", and util.format's
// %s is "7".
import { format } from "node:util";

class Odd {
  toString(): any {
    return {};
  }
  valueOf(): number {
    return 7;
  }
}

const d: any = new Odd();
console.log("String", String(d));
console.log("template", `${d}`);
console.log("plus", d + "");
console.log("format", format("%s", d));
