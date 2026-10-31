// dns.lookup with a callback (the dns.lookup row): the answer for a numeric
// host arrives through the callback with the error argument null.
import * as dns from "node:dns";

dns.lookup("127.0.0.1", (err, addr, fam) => {
  console.log("lookup", err === null, addr, fam);
});
