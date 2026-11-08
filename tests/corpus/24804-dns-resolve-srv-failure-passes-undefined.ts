// node:dns resolveSrv in a TypeScript source: on a failure Node calls back with no records (undefined), whatever the callback's declared
// records type says, so an annotated or contextually typed records parameter reads as undefined and a member use on it is Node's TypeError.
import dgram from "node:dgram";
import dns from "node:dns";
const probe = dgram.createSocket("udp4");
probe.bind(0, "127.0.0.1", () => {
  const closedPort = probe.address().port;
  probe.close(() => {
    dns.setServers(["127.0.0.1:" + closedPort]);
    dns.resolveSrv("_a._tcp.example.com", (err: NodeJS.ErrnoException | null, addresses: dns.SrvRecord[]) => {
      console.log("annotated", err ? err.code : "ok", addresses, typeof addresses, addresses === undefined);
      try {
        console.log(addresses.length);
      } catch (e) {
        console.log((e as Error).constructor.name, (e as Error).message);
      }
      dns.resolveSrv("_b._tcp.example.com", (err2, records) => {
        console.log("contextual", err2 ? err2.code : "ok", records, records === undefined);
        if (records !== undefined) console.log(records.length);
        dns.resolveSrv("_c._tcp.example.com", (err3, records3) => {
          console.log("narrowed", err3 ? err3.code : "ok", records3 ? records3.length : "none");
        });
      });
    });
  });
});
