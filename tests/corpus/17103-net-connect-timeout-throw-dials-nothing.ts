// A truthy invalid createConnection timeout throws BEFORE the dial (Node builds the
// Socket and validates the delay before connect): the server accepts nothing, with
// and without a connect listener (the listener is never registered on a throw).
import * as net from "net";
let accepted = 0;
const srv = net.createServer((s) => { accepted++; s.on("error", () => {}); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  try {
    net.createConnection({ port, host: "127.0.0.1", timeout: -1 });
    console.log("no throw");
  } catch (e: any) {
    console.log("THROW", e.name, e.code);
  }
  try {
    net.createConnection({ port, host: "127.0.0.1", timeout: -1 }, () => console.log("late connect"));
    console.log("no throw");
  } catch (e: any) {
    console.log("THROW2", e.name, e.code);
  }
  setTimeout(() => { console.log("accepted", accepted); srv.close(); }, 100);
});
