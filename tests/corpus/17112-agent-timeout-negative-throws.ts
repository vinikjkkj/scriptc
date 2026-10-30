// new http.Agent({ timeout: -1 }) builds (the option is stored), and the first
// request through it throws ERR_OUT_OF_RANGE from the socket's delay check, before
// any dial: Node's createSocket -> net.connect `if (options.timeout)`.
import * as http from "http";
let accepted = 0;
const srv = http.createServer((q, s) => { accepted++; s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const agent = new http.Agent({ timeout: -1 });
  console.log("agent built");
  try {
    http.request({ host: "127.0.0.1", port, path: "/", agent }, () => console.log("response"));
    console.log("no throw");
  } catch (e: any) {
    console.log("THROW", e.name, e.code, JSON.stringify(e.message));
  }
  setTimeout(() => { console.log("accepted", accepted); srv.close(); }, 100);
});
