import * as net from "net";
let k = 0;
const srv = net.createServer((s) => {
  const id = ++k;
  console.log("conn" + id);
  process.nextTick(() => console.log("conn" + id + " tick"));
  Promise.resolve().then(() => console.log("conn" + id + " job"));
  s.end();
  if (id === 3) srv.close();
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  for (const nm of ["A", "B", "C"]) {
    const c = net.connect(port, "127.0.0.1", () => console.log(nm + " connect"));
    c.resume();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* busy */ }
});
