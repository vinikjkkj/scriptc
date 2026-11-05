"use strict";
// removeListener / off / removeAllListeners on a socket held in a dyn field (mysql2 tears its connection down with removeAllListeners).
const Net = require("net");
const events = [];
const holder = {};
const server = Net.createServer((sock) => {
  sock.on("data", (d) => { sock.write("a" + d.toString()); setTimeout(() => { sock.write("b"); sock.end(); }, 20); });
});
server.listen(0, "127.0.0.1", () => {
  holder.stream = Net.connect(server.address().port, "127.0.0.1");
  const first = (d) => events.push("first:" + d.toString());
  const second = (d) => events.push("second:" + d.toString());
  const third = (d) => events.push("third:" + d.toString());
  holder.stream.on("data", first);
  holder.stream.on("data", second);
  holder.stream.on("data", third);
  holder.stream.off("data", second);
  holder.stream.removeListener("data", (d) => events.push("never"));
  holder.stream.on("close", () => {
    events.push("close");
    server.close();
    holder.s2 = Net.connect(1, "127.0.0.1");
    holder.s2.on("error", () => events.push("s2-error-removed-should-not-run"));
    holder.s2.on("close", () => events.push("s2-close-removed-should-not-run"));
    holder.s2.removeAllListeners();
    holder.s2.on("error", (e) => events.push("s2-error:" + e.code));
    holder.s2.on("close", () => { events.push("s2-close"); console.log(events.join("|")); });
  });
  holder.stream.write("x");
  setTimeout(() => holder.stream.removeAllListeners("data"), 10);
});
