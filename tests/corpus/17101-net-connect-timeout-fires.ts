// createConnection({ timeout }) arms the idle clock at the dial: a server that never
// answers gets the 'timeout' event, and the listener destroys the socket.
import * as net from "net";
const srv = net.createServer((s) => { s.on("error", () => {}); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.createConnection({ port, host: "127.0.0.1", timeout: 50 });
  c.on("connect", () => console.log("connected"));
  c.on("timeout", () => { console.log("timeout event"); c.destroy(); });
  c.on("close", () => { console.log("closed"); srv.close(); });
});
