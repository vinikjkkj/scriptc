const net = require("net");
function enc(s) { s.setEncoding("utf8"); }
function rd(s, log) {
  const a = s.read(2);
  log.push("read2 " + a);
  const rest = s.read();
  log.push("rest " + rest);
  peek("readable", s, log);
}
function peek(tag, s, log) {
  log.push(tag + " bytesRead=" + s.bytesRead + " readableLength=" + s.readableLength + " flowing=" + s.readableFlowing + " enc=" + s.readableEncoding + " didRead=" + s.readableDidRead + " ended=" + s.readableEnded);
}
const server = net.createServer((c) => {
  c.on("error", () => {});
  c.write("abcdef");
  setTimeout(() => c.end("gh"), 80);
});
const log = [];
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  s.on("error", () => {});
  peek("start", s, log);
  enc(s);
  s.on("readable", () => {
    rd(s, log);
  });
  s.on("end", () => { peek("end", s, log); });
  s.on("close", () => {
    peek("close", s, log);
    console.log(log.join("\n"));
    server.close();
  });
});
