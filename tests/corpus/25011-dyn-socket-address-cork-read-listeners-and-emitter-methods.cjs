const net = require("net");
function methods(s, log) {
  log.push("address-fresh " + JSON.stringify(s.address()));
  const f1 = () => log.push("f1");
  const f2 = () => log.push("f2");
  s.on("custom", f1);
  s.once("custom", f2);
  s.prependListener("custom", () => log.push("pre"));
  log.push("count " + s.listenerCount("custom") + " " + s.listenerCount("custom", f1) + " " + s.listenerCount("nothing"));
  log.push("listeners " + s.listeners("custom").length + " " + (s.listeners("custom")[1] === f1));
  log.push("names " + JSON.stringify(s.eventNames()));
  log.push("emit " + s.emit("custom", 1, 2) + " " + s.emit("custom") + " " + s.emit("none"));
  log.push("count-after " + s.listenerCount("custom"));
  s.removeListener("custom", f1);
  log.push("count-removed " + s.listenerCount("custom"));
  log.push("max " + s.getMaxListeners());
  s.setMaxListeners(3);
  log.push("max-set " + s.getMaxListeners());
  log.push("paused " + s.isPaused());
  s.removeAllListeners("custom");
  log.push("names-after " + JSON.stringify(s.eventNames()));
}
function connected(s, log) {
  const a = s.address();
  log.push("address " + a.address + " " + a.family + " " + (typeof a.port) + " " + Object.keys(a).join(","));
  s.cork();
  s.cork();
  s.write("a");
  log.push("corked " + s.writableCorked + " " + s.writableLength + " " + s.bytesWritten);
  s.uncork();
  log.push("corked1 " + s.writableCorked + " " + s.writableLength);
  s.uncork();
  log.push("corked0 " + s.writableCorked + " " + s.writableLength);
  s.uncork();
  log.push("uncork-extra " + s.writableCorked);
}
function onData(s, d, log) {
  log.push("data " + d.toString() + " read " + s.readableDidRead);
  s.destroy();
}
function onClose(s, log, server) {
  log.push("closed address " + JSON.stringify(s.address()));
  console.log(log.join("\n"));
  server.close();
}
const server = net.createServer((c) => {
  c.on("error", () => {});
  c.on("data", (d) => { c.write("got:" + d.toString()); });
});
server.listen(0, "127.0.0.1", () => {
  const log = [];
  const s = net.connect(server.address().port, "127.0.0.1");
  s.on("error", () => {});
  methods(s, log);
  s.on("connect", () => connected(s, log));
  s.once("data", (d) => onData(s, d, log));
  s.on("close", () => onClose(s, log, server));
});
