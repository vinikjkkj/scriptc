// a tick queued by a connect callback destroys the other client socket; each socket closes once and the server closes after both.
import * as net from "net";
// two client sockets connect to one server; the second 'connect' batch-mate's
// tick destroys the other socket. Every socket closes, so the program ends.
let serverClosed = 0;
const srv = net.createServer((s) => {
  s.on("data", () => {});
  s.on("end", () => s.end());
  s.on("close", () => {
    serverClosed++;
    if (serverClosed === 2) console.log("server side done");
  });
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const a = net.createConnection({ port, host: "127.0.0.1" });
  const b = net.createConnection({ port, host: "127.0.0.1" });
  let opened = 0;
  const go = () => {
    opened++;
    if (opened < 2) return;
    process.nextTick(() => { console.log("tick destroys b"); b.destroy(); });
    a.write("x");
    a.end();
    b.write("y");
  };
  a.on("connect", go);
  b.on("connect", go);
  let closed = 0;
  const done = () => { closed++; if (closed === 2) srv.close(() => console.log("srv closed")); };
  a.on("close", () => { console.log("a closed"); done(); });
  b.on("close", () => { console.log("b closed"); done(); });
});
