// Three connections accepted in one listen wake; server-side prints only (see 20100).
import * as net from "net";
let k = 0;
const srv = net.createServer((s) => {
  const id = ++k;
  console.log("conn" + id);
  process.nextTick(() => console.log("conn" + id + " tick"));
  Promise.resolve().then(() => console.log("conn" + id + " job"));
  s.end();
  if (id === 3) srv.close(() => console.log("closed " + k));
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  for (const nm of ["A", "B", "C"]) {
    const c = net.connect(port, "127.0.0.1");
    c.resume();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* busy */ }
});
