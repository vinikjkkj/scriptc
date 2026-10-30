// @exit: 3
// socket.setTimeout(ms) above 2^31-1 defers a TimeoutOverflowWarning through
// nextTick (process.emitWarning's own timing) and clamps the delay. The
// 'warning' listener sees the warning object; the default stderr report carries
// the pid, so the exit directive keeps stderr out of the comparison.
import * as net from "net";

process.on("warning", (w: any) => {
  console.log("warning", w.name, w.code, JSON.stringify(w.message));
});

const s = new net.Socket();
s.setTimeout(2147483648);
console.log("sync after overflow");
s.setTimeout(10000000000000000000);
s.setTimeout(2147483647);
process.nextTick(() => console.log("user tick"));
s.destroy();
process.exitCode = 3;
console.log("end");
