// The default keep-alive server answers Keep-Alive: timeout=5 (5000 ms, whole
// seconds) on a keep-alive response, and the connection stays open until the client
// closes it; the client closes first here, so no idle destroy happens.
import * as http from "http";
import * as net from "net";
const srv = http.createServer((q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n"));
  let got = "";
  c.on("data", (d) => {
    got += d.toString("latin1");
    if (got.includes("ok")) {
      console.log(JSON.stringify(got.split("\r\n").filter((l) => /Keep-Alive|Connection/.test(l))));
      c.destroy();
      srv.close();
    }
  });
});
