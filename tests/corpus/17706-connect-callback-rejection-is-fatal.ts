// an unhandled rejection in a connect callback ends the process at that callback: no later event or timer runs.
import * as net from "net";
const srv = net.createServer(() => {});
srv.listen(0, "127.0.0.1", () => {
  const c = net.createConnection({ port: srv.address().port, host: "127.0.0.1" });
  c.on("connect", () => {
    console.log("connect");
    Promise.reject(new Error("unhandled in connect"));
    c.destroy();
  });
  setTimeout(() => console.log("after-connect-timer"), 50);
  c.on("close", () => { console.log("closed"); srv.close(); });
});
