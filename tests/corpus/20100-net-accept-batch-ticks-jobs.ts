import * as net from "net";
const srv = net.createServer((s) => {
  console.log("conn");
  process.nextTick(() => console.log("conn tick"));
  Promise.resolve().then(() => console.log("conn job"));
  s.end();
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  let n = 0;
  const done = () => { if (++n === 2) srv.close(); };
  const a = net.connect(port, "127.0.0.1", () => console.log("A connect"));
  const b = net.connect(port, "127.0.0.1", () => console.log("B connect"));
  a.on("close", done); b.on("close", done);
  a.resume(); b.resume();
  // hold the loop so both handshakes are in the backlog before the first poll
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* busy */ }
});
