const net = require("net");
function wire(sock, log) {
  sock.on("data", () => log.push("on1"));
  sock.prependListener("data", () => log.push("pre"));
  sock.prependOnceListener("data", () => log.push("preOnce"));
  sock.once("data", () => log.push("once"));
}
const server = net.createServer((c) => {
  c.on("error", () => {});
  c.write("a");
  setTimeout(() => c.write("b"), 50);
});
server.listen(0, "127.0.0.1", () => {
  const log = [];
  const s = net.connect(server.address().port, "127.0.0.1");
  s.on("error", () => {});
  wire(s, log);
  setTimeout(() => {
    console.log(log.join(","));
    s.destroy();
    server.close();
  }, 200);
});
