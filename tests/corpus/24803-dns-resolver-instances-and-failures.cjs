"use strict";
// new dns.Resolver(options): each instance has its own servers, timeout and tries; a failing server answers with Node's code (a closed port
// is ECONNREFUSED, a silent one ETIMEOUT after the tries), a truncated UDP reply is retried over TCP, and cancel() settles what is in
// flight with ECANCELLED. The program is its own nameserver (UDP on loopback, and TCP on the same port for the truncation case).
const dgram = require("node:dgram");
const net = require("node:net");
const dns = require("node:dns");
function encodeName(name) {
  const bytes = [];
  for (const part of name.split(".")) {
    bytes.push(part.length);
    for (let i = 0; i < part.length; i++) bytes.push(part.charCodeAt(i));
  }
  bytes.push(0);
  return Buffer.from(bytes);
}
function answerFor(msg, truncated) {
  const id = msg.readUInt16BE(0);
  let qend = 12;
  while (msg[qend] !== 0) qend += msg[qend] + 1;
  qend += 5;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(truncated ? 0x8380 : 0x8180, 2);
  header.writeUInt16BE(1, 4);
  let body = Buffer.alloc(0);
  if (!truncated) {
    const t = encodeName("target.example.com");
    const rdata = Buffer.alloc(6 + t.length);
    rdata.writeUInt16BE(1, 0);
    rdata.writeUInt16BE(2, 2);
    rdata.writeUInt16BE(443, 4);
    t.copy(rdata, 6);
    const rr = Buffer.alloc(12);
    rr.writeUInt16BE(0xc00c, 0);
    rr.writeUInt16BE(33, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(60, 6);
    rr.writeUInt16BE(rdata.length, 10);
    body = Buffer.concat([rr, rdata]);
    header.writeUInt16BE(1, 6);
  }
  return Buffer.concat([header, msg.subarray(12, qend), body]);
}
function show(label, err, recs) {
  console.log(label, err ? err.code + " " + err.message : "ok", typeof recs, recs === undefined ? "" : JSON.stringify(recs.map((r) => [r.name, r.port, r.priority, r.weight])));
}
// 1: a UDP server that truncates and a TCP server on the same port that answers in full
const udp = dgram.createSocket("udp4");
udp.on("message", (msg, rinfo) => udp.send(answerFor(msg, true), rinfo.port, rinfo.address));
udp.bind(0, "127.0.0.1", () => {
  const port = udp.address().port;
  const tcp = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const reply = answerFor(buf.subarray(2, 2 + buf.readUInt16BE(0)), false);
        const lenp = Buffer.alloc(2);
        lenp.writeUInt16BE(reply.length, 0);
        sock.end(Buffer.concat([lenp, reply]));
      }
    });
  });
  // The TCP server reuses the UDP socket's port; if the host refuses it, report the code (the port number differs between processes).
  tcp.on("error", (e) => {
    console.log("tcp listen failed", e.code);
    process.exit(0);
  });
  tcp.listen(port, "127.0.0.1", () => {
    const r1 = new dns.Resolver({ timeout: 500, tries: 2 });
    r1.setServers(["127.0.0.1:" + port]);
    console.log("r1 servers", JSON.stringify(r1.getServers()).replace(String(port), "PORT"));
    r1.resolveSrv("_x._tcp.example.com", (err, recs) => {
      show("truncated->tcp", err, recs);
      tcp.close();
      udp.close();
      step2();
    });
  });
});
// 2: a closed port is refused; a silent server times out; cancel settles in-flight queries
function step2() {
  const probe = dgram.createSocket("udp4");
  probe.bind(0, "127.0.0.1", () => {
    const closedPort = probe.address().port;
    probe.close(() => {
      const r2 = new dns.Resolver({ timeout: 150, tries: 2 });
      r2.setServers(["127.0.0.1:" + closedPort]);
      r2.resolveSrv("_y._tcp.example.com", (err, recs) => {
        show("closed port", err, recs);
        const silent = dgram.createSocket("udp4");
        silent.bind(0, "127.0.0.1", () => {
          const r3 = new dns.Resolver({ timeout: 100, tries: 2 });
          r3.setServers(["127.0.0.1:" + silent.address().port]);
          r3.resolveSrv("_z._tcp.example.com", (err3, recs3) => {
            show("silent", err3, recs3);
            const r4 = new dns.Resolver({ timeout: 5000, tries: 1 });
            r4.setServers(["127.0.0.1:" + silent.address().port]);
            r4.resolveSrv("_c1._tcp.example.com", (e1, x1) => show("cancelled 1", e1, x1));
            r4.resolveSrv("_c2._tcp.example.com", (e2, x2) => {
              show("cancelled 2", e2, x2);
              silent.close();
              console.log("done");
            });
            r4.cancel();
            console.log("cancel called");
          });
        });
      });
    });
  });
}
