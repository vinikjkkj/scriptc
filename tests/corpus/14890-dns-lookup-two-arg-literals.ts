// dns.lookup(hostname, callback): Node's default options (family 0). IP
// literals answer without the resolver, on process.nextTick, so both
// literal answers arrive before the resolver answer queued first.
import * as dns from "node:dns";

dns.lookup("example.invalid", (err, address) => {
  console.log("name", err === null ? "resolved" : err.message);
});
dns.lookup("127.0.0.1", (err, address) => {
  console.log("ip4", err === null, address);
});
dns.lookup("::1", (err, address) => {
  console.log("ip6", err === null, address);
});
console.log("queued");
