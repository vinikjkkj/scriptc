// util.format's %s over null-prototype objects (inspect, or the own
// toString when one is set) and over JSON dyn values (the runtime's
// insp.fmtS conversion, which must stay exact).
import { format } from "node:util";

const bare: any = Object.create(null);
bare.a = 1;
console.log(format("%s", bare));
console.log(format("%s", Object.create(null)));
const own: any = Object.create(null);
own.toString = function () { return "NP"; };
console.log(format("%s", own));
const parsed: any = JSON.parse('{"a":1}');
console.log(format("%s", parsed));
const list: any = JSON.parse("[1,2]");
console.log(format("%s", list));
