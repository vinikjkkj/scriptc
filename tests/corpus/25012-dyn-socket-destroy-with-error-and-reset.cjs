const net = require("net");
function g(s, k) { return s[k]; }
function wire(s, name, log) {
  s.on("error", (e) => log.push(name + " error " + e.message + " " + e.code + " " + (s.errored === e)));
  s.on("close", (had) => log.push(name + " close " + had + " errored=" + (s.errored ? s.errored.message : null) + " readyState=" + g(s, "readyState") + " destroyed=" + s.destroyed + " closed=" + s.closed));
}
function reset(s) { s.resetAndDestroy(); }
function destroyWith(s, e) { s.destroy(e); return s.errored; }
function resetIdle(s) { s.resetAndDestroy(); }
const server = net.createServer((c) => {
  c.on("error", (e) => log.push("srv error " + e.code));
  c.on("data", () => {});
  setTimeout(() => reset(c), 50);
});
const log = [];
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const a = net.connect(port, "127.0.0.1");
  wire(a, "a", log);
  a.on("connect", () => { const e = destroyWith(a, new Error("boom")); log.push("a errored-sync " + (e && e.message)); });
  const b = net.connect(port, "127.0.0.1");
  wire(b, "b", log);
  b.on("connect", () => { log.push("b errored-sync " + destroyWith(b, undefined)); });
  const c = net.connect(port, "127.0.0.1");
  wire(c, "c", log);
  const idle = new net.Socket();
  wire(idle, "idle", log);
  resetIdle(idle);
  const idle2 = new net.Socket();
  wire(idle2, "idle2", log);
  destroyWith(idle2, new TypeError("typed"));
  setTimeout(() => { log.push("c final " + g(c, "readyState")); server.close(); console.log(log.join("\n")); }, 400);
});
