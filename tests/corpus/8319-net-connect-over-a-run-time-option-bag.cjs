// net.connect / createConnection over an argument whose shape only the run
// time knows (computed-key bags, values of unknown type, literals the typed
// lowering cannot take): Node's validation order and texts for the argument
// and the option bag, then a real dial (ECONNREFUSED through the socket's
// 'error' event, a connection to a live server). Node is the oracle.
const net = require("net");
const show = (fn) => {
  try {
    fn();
    console.log("ok");
  } catch (e) {
    console.log(`${e.name}|${e.code}|${e.message}`);
  }
};
show(() => net.connect({}));
show(() => net.connect({ host: "x" }));
show(() => net.connect({ port: -1 }));
show(() => net.connect({ port: "abc" }));
show(() => net.connect({ port: 70000 }));
show(() => net.connect({ port: 1.5 }));
show(() => net.connect({ port: 8080, host: 5 }));
show(() => net.connect(null));
show(() => net.connect(undefined));
show(() => net.connect(true));
show(() => net.connect(-5));
function bag(k, v) {
  return { port: 8080, [k]: v };
}
show(() => net.connect(bag("objectMode", true)));
show(() => net.connect(bag("autoSelectFamily", "no")));
show(() => net.connect(bag("autoSelectFamilyAttemptTimeout", 0)));
show(() => net.connect(bag("host", ["h"])));

function bag2(port, host) {
  const o = {};
  o["port"] = port;
  o["host"] = host;
  return o;
}
const server = net.createServer((sock) => {
  sock.end("hello");
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const c = net.connect(bag2(port, "127.0.0.1"));
  // TCP is a byte stream: how the payload splits across 'data' events is
  // the transport's choice and varies run to run, so the program prints the
  // concatenated payload once, at close.
  const chunks = [];
  c.on("data", (d) => chunks.push(d));
  c.on("close", () => {
    const payload = Buffer.concat(chunks);
    console.log("data", payload.length, payload.toString());
    server.close(() => {
      const dead = net.connect(bag2(1, "127.0.0.1"));
      dead.on("error", (e) => console.log("error", e.message.replace(/:\d+$/, ":PORT")));
      dead.on("close", () => console.log("closed"));
    });
  });
});
