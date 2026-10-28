// dns.lookup('') answers null with the family's default and does not query
// the resolver. Node also warns DEP0118 on stderr, once per process.
import * as dns from "node:dns";

dns.lookup("", (err, address, family) => {
  console.log("empty", err === null, address === null, typeof address, family);
});
dns.lookup("", { family: 6 }, (err, address, family) => {
  console.log("empty6", err === null, address === null, family);
});
console.log("queued");
