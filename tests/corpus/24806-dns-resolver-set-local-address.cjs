"use strict";
// Resolver#setLocalAddress(ipv4[, ipv6]): Node's validation messages and codes, and the effect: the UDP query and the TCP retry leave from the
// bound address (the program is its own nameserver and reports the source it saw), an address the host does not own is a refused connection,
// and an address of the other family changes nothing for an IPv4 server.
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
const t = (label, f) => {
  try {
    f();
    console.log(label, "ok");
  } catch (e) {
    console.log(label, e.name, e.code, JSON.stringify(e.message), Object.keys(e).join(","));
  }
};
const v = new dns.Resolver();
t("no args", () => v.setLocalAddress());
t("number", () => v.setLocalAddress(5));
t("v4", () => v.setLocalAddress("127.0.0.1"));
t("v4 and v6", () => v.setLocalAddress("127.0.0.1", "::1"));
t("v4 and undefined", () => v.setLocalAddress("127.0.0.1", undefined));
t("v4 and null", () => v.setLocalAddress("127.0.0.1", null));
t("v4 and number", () => v.setLocalAddress("127.0.0.1", 5));
t("garbage", () => v.setLocalAddress("nope"));
t("v6 first", () => v.setLocalAddress("::1"));
t("v6 twice", () => v.setLocalAddress("::1", "::1"));
t("v4 twice", () => v.setLocalAddress("127.0.0.1", "127.0.0.1"));
t("bad second", () => v.setLocalAddress("127.0.0.1", "zzz"));
t("empty", () => v.setLocalAddress(""));
t("empty second", () => v.setLocalAddress("127.0.0.1", ""));
t("any", () => v.setLocalAddress("0.0.0.0", "::"));
t("extra argument", () => v.setLocalAddress("127.0.0.1", "::1", 7));
t("with port", () => v.setLocalAddress("127.0.0.1:53"));
t("leading space", () => v.setLocalAddress(" 127.0.0.1"));
t("leading zero", () => v.setLocalAddress("127.0.0.01"));
t("v4 mapped", () => v.setLocalAddress("::ffff:1.2.3.4"));
t("zone", () => v.setLocalAddress("127.0.0.1", "fe80::1%lo"));
console.log(v.setLocalAddress.length, v.setLocalAddress.name);

let tcpSeen = "";
const udp = dgram.createSocket("udp4");
let truncate = false;
udp.on("message", (msg, rinfo) => {
  console.log("udp server saw", rinfo.address);
  udp.send(answerFor(msg, truncate), rinfo.port, rinfo.address);
});
udp.bind(0, "127.0.0.1", () => {
  const port = udp.address().port;
  const tcp = net.createServer((sock) => {
    console.log("tcp server saw", sock.remoteAddress);
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
  tcp.listen(port, "127.0.0.1", () => {
    const out = (label) => (err, recs) => console.log(label, err ? err.code : "ok", recs === undefined ? "undefined" : recs.length);
    // 1: a bound source over UDP
    const r1 = new dns.Resolver({ timeout: 300, tries: 1 });
    r1.setServers(["127.0.0.1:" + port]);
    r1.setLocalAddress("127.0.0.2");
    r1.resolveSrv("_a._tcp.example.com", (err, recs) => {
      out("udp from 127.0.0.2")(err, recs);
      // 2: the TCP retry leaves from the same address
      truncate = true;
      r1.resolveSrv("_b._tcp.example.com", (err2, recs2) => {
        out("tcp retry from 127.0.0.2")(err2, recs2);
        truncate = false;
        // 3: an IPv6-only local address does nothing for an IPv4 server, and the second form sets the IPv4 one
        const r2 = new dns.Resolver({ timeout: 300, tries: 1 });
        r2.setServers(["127.0.0.1:" + port]);
        r2.setLocalAddress("::1");
        r2.resolveSrv("_c._tcp.example.com", (err3, recs3) => {
          out("v6 local, v4 server")(err3, recs3);
          r2.setLocalAddress("127.0.0.3", "::1");
          r2.resolveSrv("_d._tcp.example.com", (err4, recs4) => {
            out("v4 and v6 local")(err4, recs4);
            // 4: a one-address call puts the other family back to any; an address the host does not own is refused
            r2.setLocalAddress("::1");
            r2.resolveSrv("_e._tcp.example.com", (err5, recs5) => {
              out("v4 reset by a v6-only call")(err5, recs5);
              const r3 = new dns.Resolver({ timeout: 300, tries: 1 });
              r3.setServers(["127.0.0.1:" + port]);
              r3.setLocalAddress("203.0.113.5");
              r3.resolveSrv("_f._tcp.example.com", (err6, recs6) => {
                out("unowned address")(err6, recs6);
                tcp.close();
                udp.close();
              });
            });
          });
        });
      });
    });
  });
});
