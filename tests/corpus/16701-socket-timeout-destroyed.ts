// A destroyed socket returns from setTimeout before any validation (Node's
// setStreamTimeout: `if (this.destroyed) return this`), so a bad value is
// silent on a destroyed stream, and an overflowing one warns nothing.
import * as net from "net";

const d = new net.Socket();
d.destroy();
console.log("destroyed", d.destroyed);
d.setTimeout(-1);
d.setTimeout(NaN);
d.setTimeout(-5);
d.setTimeout(2147483648);
console.log("end");
