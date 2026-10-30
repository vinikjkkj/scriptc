// A plain net.Server is not an http.Server: server.timeout and server.setTimeout
// belong to http.Server only (Node's net.Server has neither; timeout is undefined
// there and setTimeout is not a function). The compiler refuses both at build.
import * as net from "net";
const srv = net.createServer(() => {});
srv.timeout = 5;
console.log("timeout", srv.timeout);
srv.close();
