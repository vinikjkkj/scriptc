// An agent timeout of NaN is falsy in Node's net.connect (`if (options.timeout)`):
// it arms nothing, and a request through the agent completes normally.
import * as http from "http";
const srv = http.createServer((q, s) => { s.end("ok " + q.url); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const agent = new http.Agent({ timeout: NaN });
  const r = http.request({ host: "127.0.0.1", port, path: "/nan", agent }, (res) => {
    let body = "";
    res.on("data", (d: any) => { body += d; });
    res.on("end", () => { console.log("status", res.statusCode, body); srv.close(); });
  });
  r.on("timeout", () => console.log("timeout event"));
  r.on("error", (e: any) => console.log("error", e.code));
  r.end();
});
