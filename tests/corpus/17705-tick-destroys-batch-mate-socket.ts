// a tick queued by a connect callback destroys the other client socket. The tick's line is printed first
// and 'srv closed' last; the three events in between are collected and printed sorted, because their order
// is not fixed across poller backends (Windows reports the batch in a different order than Linux).
import * as net from "net";
const events: string[] = [];
let serverClosed = 0;
const srv = net.createServer((s) => {
  s.on("data", () => {});
  s.on("end", () => s.end());
  s.on("close", () => {
    serverClosed++;
    if (serverClosed === 2) {
      events.push("server side done");
      flush();
    }
  });
});
function flush() {
  if (events.length !== 3) return;
  for (const line of events.sort()) console.log(line);
  srv.close(() => console.log("srv closed"));
}
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const a = net.createConnection({ port, host: "127.0.0.1" });
  const b = net.createConnection({ port, host: "127.0.0.1" });
  let opened = 0;
  const go = () => {
    opened++;
    if (opened < 2) return;
    process.nextTick(() => {
      console.log("tick destroys b");
      b.destroy();
    });
    a.write("x");
    a.end();
    b.write("y");
  };
  a.on("connect", go);
  b.on("connect", go);
  a.on("close", () => {
    events.push("a closed");
    flush();
  });
  b.on("close", () => {
    events.push("b closed");
    flush();
  });
});
