// dns.lookup(hostname, callback) on a name that cannot exist: the callback
// gets Node's ENOTFOUND message, and the delivery is asynchronous.
import * as dns from "node:dns";

dns.lookup("host-that-cannot-exist.invalid", (err, address) => {
  if (err) {
    console.log("failed:", err.message);
    return;
  }
  console.log("unexpectedly resolved", address);
});
console.log("queued");
