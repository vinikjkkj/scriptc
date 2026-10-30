// The JS twin: an expando on a plain net.Server (Node: `srv.timeout = 5` works as a
// plain property). Refused at build, as on main; the candidate must not accept it.
const net = require("net");
const srv = net.createServer(() => {});
console.log("before", srv.timeout);
srv.timeout = 5;
srv.close();
