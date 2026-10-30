// @exit: 3
// createConnection's timeout above 2^31-1 warns once (TimeoutOverflowWarning,
// deferred to nextTick: the warning listener sees it after the synchronous output)
// and clamps. The dial is refused on a closed port, so the 'error' arrives after.
import * as net from "net";
process.on("warning", (w: any) => console.log("warning", w.name, JSON.stringify(w.message)));
const c = net.createConnection({ port: 1, host: "127.0.0.1", timeout: 2147483648 });
c.on("error", (e: any) => console.log("error", e.code));
console.log("created");
process.exitCode = 3;
