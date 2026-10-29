// (0, net_1.createConnection)(options): the comma-indirect call of a net module
// function against a local server on an ephemeral port.
const net_1 = require("net");
const server = net_1.createServer(function (sock) {
  sock.end("hello from server\n");
});
server.listen(0, "127.0.0.1", function () {
  const port = server.address().port;
  const client = (0, net_1.createConnection)({ port: port, host: "127.0.0.1" });
  let text = "";
  client.on("data", function (d) { text += String(d); });
  client.on("end", function () {
    console.log("client got: " + text.trim());
    server.close(function () { console.log("server closed"); });
  });
});
