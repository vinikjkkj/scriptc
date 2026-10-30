// A destroyed socket answers the call unchanged: no validation, no warning,
// no registration (Node's setStreamTimeout returns before touching anything).
import * as net from "net";

const d = new net.Socket();
d.destroy();
const r = d.setTimeout(5, () => console.log("must not fire"));
console.log("same", r === d);
d.setTimeout(-1, () => console.log("must not fire either"));
d.setTimeout(2147483648);
setTimeout(() => console.log("end"), 30);
