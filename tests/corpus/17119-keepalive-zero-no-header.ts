// keepAliveTimeout 0 disables the keep-alive idle clock, and Node writes no
// Keep-Alive header at all: only Connection: keep-alive goes out.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ keepAliveTimeout: 0 }, (q, s) => { s.end("ok"); });
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
