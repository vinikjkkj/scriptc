// server.keepAliveTimeout is a plain property: 5000 by default, assignable without
// validation (Node reads it back as assigned, negatives included). server.timeout
// defaults to 0 and reads back what was assigned.
import * as http from "http";
const srv = http.createServer(() => {});
console.log("defaults", srv.keepAliveTimeout, srv.timeout);
srv.keepAliveTimeout = 0;
srv.timeout = 250;
console.log("assigned", srv.keepAliveTimeout, srv.timeout);
srv.keepAliveTimeout = -5;
console.log("negative", srv.keepAliveTimeout);
