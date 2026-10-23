// net.isIP / isIPv4 / isIPv6 taken as values: the same interned function each
// time, so identity holds, and a call through the value answers like the call form.
import * as net from "node:net";
import { isIP, isIPv4, isIPv6 } from "node:net";

const pick = isIP;
const probes: string[] = ["10.0.0.1", "::1", "nope", "fe80::1%lo0", "1.2.3"];
console.log(pick === isIP, isIPv4 === isIPv4, isIPv6 === isIPv4);
for (const p of probes) {
  console.log(p, pick(p), isIPv4(p), isIPv6(p), net.isIP(p), net.isIPv6(p));
}
const table = { v4: isIPv4, v6: isIPv6 };
console.log(table.v4("1.2.3.4"), table.v6("1.2.3.4"), table.v6("::"));
