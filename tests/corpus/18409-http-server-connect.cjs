// The server 'connect' listener (http.serverOnConnect) in plain JavaScript:
// a CONNECT request is handed to the listener with its raw socket instead of
// the 'request' listener. The listener answers the tunnel and closes.
const http = require("node:http");
const net = require("node:net");

const srv = http.createServer((req, res) => { res.end("no"); });
srv.on("connect", (req, sock, head) => {
  console.log("connect", req.method, req.url, head.length);
  sock.end("HTTP/1.1 200 OK\r\n\r\n");
  srv.close();
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const s = net.connect(port, "127.0.0.1", () => {
    s.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
  });
  s.on("data", (d) => { console.log("got", d.toString().split("\r\n")[0]); s.destroy(); });
  s.on("error", () => {});
});
