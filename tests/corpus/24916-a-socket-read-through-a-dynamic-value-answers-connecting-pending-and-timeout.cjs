const net = require("net");
function probe(sock) {
  return [sock.connecting, sock.pending, sock.timeout, typeof sock.destroyed].join(",");
}
const server = net.createServer((c) => {
  c.on("error", () => {});
  c.end("hi");
});
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  s.on("error", () => {});
  console.log(probe(s));
  s.on("connect", () => {
    console.log(probe(s));
    s.setTimeout(500);
    console.log(probe(s));
    s.destroy();
    server.close();
  });
});
