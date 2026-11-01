// Two connections accepted in ONE listen wake. The server's own prints pin the
// accept/tick/job order; client-side connect callbacks are not printed because
// their order against the server's accepts is completion-timing dependent on
// Windows (IOCP), so only the count is printed, after both clients closed.
import * as net from "net";
let connected = 0;
const srv = net.createServer((s) => {
  console.log("conn");
  process.nextTick(() => console.log("conn tick"));
  Promise.resolve().then(() => console.log("conn job"));
  s.end();
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  let n = 0;
  const done = () => { if (++n === 2) srv.close(() => console.log("closed " + connected)); };
  for (const nm of ["A", "B"]) {
    const c = net.connect(port, "127.0.0.1", () => { connected++; });
    c.on("close", done);
    c.resume();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* hold the loop so both are in the backlog */ }
});
