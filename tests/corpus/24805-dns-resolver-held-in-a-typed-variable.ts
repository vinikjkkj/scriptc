// A dns.Resolver held in a TypeScript variable (annotated and inferred) and used through the members the runtime answers.
import dgram from "node:dgram";
import dns from "node:dns";
class Holder {
  readonly resolver: dns.Resolver = new dns.Resolver({ timeout: 100, tries: 1 });
}
const probe = dgram.createSocket("udp4");
probe.bind(0, "127.0.0.1", () => {
  const closedPort = probe.address().port;
  probe.close(() => {
    const annotated: dns.Resolver = new dns.Resolver({ timeout: 100, tries: 1 });
    annotated.setServers(["127.0.0.1:" + closedPort]);
    annotated.setLocalAddress("127.0.0.1", "::1");
    const servers: string[] = annotated.getServers();
    console.log(servers.length, servers[0] === "127.0.0.1:" + closedPort);
    const held = new Holder();
    held.resolver.setServers(["127.0.0.1:" + closedPort]);
    annotated.resolveSrv("_a._tcp.example.com", (err, records) => {
      console.log("annotated", err ? err.code : "ok", records, records === undefined);
      held.resolver.resolveSrv("_b._tcp.example.com", (err2: NodeJS.ErrnoException | null, records2: dns.SrvRecord[]) => {
        console.log("held", err2 ? err2.code : "ok", err2 ? err2.syscall : "", records2);
        const idle = new dns.Resolver();
        idle.cancel();
        console.log("cancelled idle resolver", idle.getServers().length >= 0);
      });
    });
  });
});
