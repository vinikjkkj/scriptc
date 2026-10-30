// http.request's timeout option is validated when the request is built (Node's
// ClientRequest: getTimerDuration with the option's own name, 'timeout'). A bad
// value throws synchronously; 0 and absent answer quietly.
import * as http from "http";

function build(label: string, timeout: number): void {
  try {
    const r = http.request({ host: "127.0.0.1", port: 1, timeout: timeout });
    r.on("error", () => {});
    r.destroy();
    console.log(label, "ok");
  } catch (e: any) {
    console.log(label, "THROW", e.name, e.code, JSON.stringify(e.message));
  }
}

build("zero", 0);
build("five", 5);
build("negative", -1);
build("nan", NaN);
build("infinity", Infinity);
build("large-negative", -10000000000);
console.log("end");
