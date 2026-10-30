// IncomingMessage.setTimeout delegates to the connection's socket and validates
// even after the request body ended (the socket is still the connection's): the
// same call after the response ends and the socket is detached is a no-op.
import * as http from "http";
const srv = http.createServer((q, s) => {
  let body = "";
  q.on("data", (d: any) => { body += d; });
  q.on("end", () => {
    try { const x = q.setTimeout(-1); console.log("req neg ret", x === q); }
    catch (e: any) { console.log("req neg THROW", e.code); }
    s.end("body " + body);
  });
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/" }, (res) => {
    res.resume();
    res.on("end", () => { console.log("client end"); srv.close(); });
  });
  r.on("error", (e: any) => console.log("client error", e.code));
  r.write("abc");
  r.end();
});
