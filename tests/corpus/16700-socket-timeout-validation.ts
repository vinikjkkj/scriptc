// socket.setTimeout(ms) validates like Node's getTimerDuration: a negative,
// NaN or infinite delay throws ERR_OUT_OF_RANGE synchronously; zero and the
// in-range values answer quietly. The thrown messages are Node's own text.
import * as net from "net";

function probe(label: string, ms: number): void {
  const s = new net.Socket();
  try {
    s.setTimeout(ms);
    console.log(label, "ok");
  } catch (e: any) {
    console.log(label, "THROW", e.name, e.code, JSON.stringify(e.message));
  }
  s.destroy();
}

probe("zero", 0);
probe("one", 1);
probe("fraction", 1.5);
probe("tiny", 0.25);
probe("max", 2147483647);
probe("negative", -1);
probe("nan", NaN);
probe("infinity", Infinity);
probe("neg-infinity", -Infinity);
probe("large-negative", -10000000000);
console.log("end");
