// Two connections in one listen wake; the first 'connection' listener throws
// and an 'uncaughtException' listener takes it, so the second is accepted later.
const net = require("net");
let k = 0;
process.on("uncaughtException", (e) => console.log("uncaught " + e.message));
const srv = net.createServer((s) => {
  const id = ++k;
  console.log("conn" + id);
  process.nextTick(() => console.log("conn" + id + " tick"));
  s.end();
  if (id === 1) throw new Error("boom");
  srv.close();
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  for (const nm of ["A", "B"]) {
    const c = net.connect(port, "127.0.0.1");
    c.resume();
  }
  setTimeout(() => console.log("end"), 100);
  const t0 = Date.now();
  while (Date.now() - t0 < 60) { /* busy */ }
});
