// @exit: 3
// The http.request timeout option above 2^31-1 warns once at construction
// (TimeoutOverflowWarning, deferred) and clamps. The warning lands in the
// 'warning' listener in call order behind the synchronous output.
import * as http from "http";

process.on("warning", (w: any) => {
  console.log("warning", w.name, JSON.stringify(w.message));
});

const r = http.request({ host: "127.0.0.1", port: 1, timeout: 2147483648 });
r.on("error", () => {});
console.log("built");
r.destroy();
process.exitCode = 3;
