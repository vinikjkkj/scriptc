const net = require("net");
const P = ["remoteAddress", "remotePort", "remoteFamily", "localAddress", "localPort", "localFamily", "bytesRead", "bytesWritten", "readyState", "bufferSize", "connecting", "pending", "timeout", "destroyed", "writable", "readable", "closed", "errored", "allowHalfOpen", "autoSelectFamilyAttemptedAddresses", "readableLength", "writableLength", "readableFlowing", "readableEnded", "writableEnded", "writableFinished", "writableNeedDrain", "readableHighWaterMark", "writableHighWaterMark", "readableAborted", "readableDidRead", "readableEncoding", "readableObjectMode", "writableObjectMode", "writableCorked"];
function show(k, v, ctx) {
  if (v instanceof Error) return "Error:" + v.message;
  if ((k === "remotePort" && ctx.remoteIsServer) || (k === "localPort" && !ctx.remoteIsServer)) return v === ctx.port ? "SERVERPORT" : String(v);
  if (k === "remotePort" || k === "localPort") return typeof v === "number" && v > 0 ? "PORT" : String(v);
  return JSON.stringify(v);
}
function snap(tag, s, ctx) {
  const o = [];
  for (const k of P) o.push(k + "=" + show(k, s[k], ctx));
  console.log(tag + " " + o.join(" "));
}
const server = net.createServer((c) => {
  const port = server.address().port;
  snap("srv-conn", c, { port, remoteIsServer: false });
  c.on("data", () => { c.write("pong"); });
  c.on("error", () => {});
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const ctx = { port, remoteIsServer: true };
  const f = new net.Socket();
  snap("fresh", f, ctx);
  const s = net.connect(port, "127.0.0.1");
  s.on("error", () => {});
  snap("connecting", s, ctx);
  s.on("connect", () => {
    snap("connected", s, ctx);
    s.write("hello");
    snap("afterwrite", s, ctx);
  });
  s.on("data", () => {
    snap("data", s, ctx);
    s.end();
    snap("ended", s, ctx);
  });
  s.on("close", () => { snap("closed", s, ctx); server.close(); });
});
