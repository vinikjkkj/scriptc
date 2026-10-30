// A server with no timeout options: its connections checker must not hold the
// process, so close() on an idle server exits at once.
import * as http from "http";
const srv = http.createServer((q, s) => { s.end("ok"); });
console.log("defaults");
srv.listen(0, "127.0.0.1", () => {
  srv.close(() => console.log("closed"));
});
