// node:dns in a TypeScript source: resolveSrv with a typed callback (err, SrvRecord[]), setServers and getServers typed by @types/node.
import dgram from "node:dgram";
import dns from "node:dns";
const server = dgram.createSocket("udp4");
server.on("message", (msg, rinfo) => {
  const id = msg.readUInt16BE(0);
  let qend = 12;
  while (msg[qend] !== 0) qend += msg[qend]! + 1;
  qend += 5;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  const tgt = Buffer.from([3, 115, 105, 112, 0]);
  const rdata = Buffer.alloc(6 + tgt.length);
  rdata.writeUInt16BE(5, 0);
  rdata.writeUInt16BE(7, 2);
  rdata.writeUInt16BE(5060, 4);
  tgt.copy(rdata, 6);
  const rr = Buffer.alloc(12);
  rr.writeUInt16BE(0xc00c, 0);
  rr.writeUInt16BE(33, 2);
  rr.writeUInt16BE(1, 4);
  rr.writeUInt32BE(60, 6);
  rr.writeUInt16BE(rdata.length, 10);
  header.writeUInt16BE(1, 6);
  server.send(Buffer.concat([header, msg.subarray(12, qend), rr, rdata]), rinfo.port, rinfo.address);
});
server.bind(0, "127.0.0.1", () => {
  dns.setServers(["127.0.0.1:" + server.address().port]);
  const servers: string[] = dns.getServers();
  console.log(servers.length);
  dns.resolveSrv("_sip._tcp.example.com", (err: NodeJS.ErrnoException | null, addresses: dns.SrvRecord[]) => {
    console.log(err, addresses.length, addresses[0]!.name, addresses[0]!.port, addresses[0]!.priority, addresses[0]!.weight);
    server.close();
  });
});
