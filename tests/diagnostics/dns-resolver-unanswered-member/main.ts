// The real @types/node declares every c-ares member on dns.Resolver. The runtime's resolver object answers resolveSrv, getServers,
// setServers, cancel and setLocalAddress; any other member is a named compile-time refusal, not a runtime "is not a function".
import dns from "node:dns";
const r = new dns.Resolver();
r.setServers(["127.0.0.1:1"]);
r.resolve4("example.com", (err, addresses) => {
  console.log(err, addresses);
});
