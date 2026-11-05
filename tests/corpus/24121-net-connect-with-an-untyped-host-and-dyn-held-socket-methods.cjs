"use strict";
// net.connect(port, host) where host arrives untyped (mysql2: Net.connect(opts.config.port, opts.config.host)) is the host, never the
// listener; undefined means localhost and a function is the connect listener. The socket is then held in a dyn field and driven
// through its methods by name, as a driver does.
const Net = require("net");
const events = [];
function note(s) { events.push(s); }
class Conn {
  constructor(opts) {
    this.config = opts.config;
    if (!opts.config.stream) {
      this.stream = Net.connect(opts.config.port, opts.config.host);
      this.stream.setNoDelay(true);
      if (opts.config.enableKeepAlive) this.stream.setKeepAlive(true, 1000);
    } else {
      this.stream = opts.config.stream;
    }
    this.stream.on("error", this.onError.bind(this));
    this.stream.on("data", (d) => note("data:" + d.toString()));
    this.stream.on("close", () => { note("close"); this.done && this.done(); });
  }
  onError(e) { note("error:" + e.code); }
}
const server = Net.createServer((sock) => {
  sock.on("data", (d) => { sock.write("echo:" + d.toString()); sock.end(); });
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const live = new Conn({ config: { port, host: "127.0.0.1", enableKeepAlive: true } });
  live.stream.setTimeout(5000);
  live.stream.write("hello");
  live.done = () => {
    // undefined host = localhost, dialled while the server still listens (a refused localhost dial is platform-specific: it tries
    // ::1 and 127.0.0.1 in turn, which this row does not pin)
    const noHost = new Conn({ config: { port, host: undefined } });
    noHost.stream.on("connect", () => { note("connected-default-host"); noHost.stream.destroy(); });
    noHost.done = () => {
      server.close();
      const refused = new Conn({ config: { port: 1, host: "127.0.0.1" } });
      refused.done = () => { console.log(events.join("|")); };
    };
  };
});
