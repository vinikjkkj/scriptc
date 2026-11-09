const net = require("net");
const log = [];
function wire(s, name, events) {
  for (const ev of events) s.on(ev, (x) => log.push(name + " " + ev + (x ? " " + typeof x : "")));
}
function ctl(s, sink) {
  s.pause();
  s.pause();
  log.push("flowing " + s.readableFlowing);
  s.resume();
  log.push("flowing " + s.readableFlowing);
  s.resume();
  s.pipe(sink);
  s.unpipe(sink);
}
function meta(s) {
  s.on("newListener", (ev) => { if (ev === "custom") log.push("newListener custom"); });
  s.on("removeListener", (ev) => { if (ev === "custom") log.push("removeListener custom"); });
  const handler = () => {};
  s.on("custom", handler);
  s.off("custom", handler);
}
function teardown(s, sink, server) {
  s.destroy();
  sink.destroy();
  server.close();
  setTimeout(() => console.log(log.join("\n")), 30);
}
const server = net.createServer((c) => {
  c.on("error", () => {});
  c.write("x");
});
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  s.on("error", () => {});
  wire(s, "s", ["ready", "pause", "resume", "drain", "lookup"]);
  const sink = new net.Socket();
  sink.on("error", () => {});
  wire(sink, "sink", ["pipe", "unpipe"]);
  meta(s);
  s.on("data", () => {});
  s.on("connect", () => {
    log.push("connect");
    ctl(s, sink);
  });
  setTimeout(() => teardown(s, sink, server), 200);
});
