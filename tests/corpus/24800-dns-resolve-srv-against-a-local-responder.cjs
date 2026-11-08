"use strict";
// node:dns over a non-blocking resolver: dns.resolveSrv sends a query to the configured server and calls back with the SRV records or
// Node's error (code, syscall querySrv, hostname). The program is its own nameserver (a node:dgram UDP responder on loopback).
const dgram = require("node:dgram");
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
const records = [
  [10, 60, 5060, "sip1.example.com"],
  [20, 30, 5061, "sip2.example.com"],
];
let mode = "ok";
const server = dgram.createSocket("udp4");
server.on("message", (msg, rinfo) => {
  const id = msg.readUInt16BE(0);
  let qend = 12;
  while (msg[qend] !== 0) qend += msg[qend] + 1;
  qend += 5;
  const question = msg.subarray(12, qend);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  let flags = 0x8180;
  let answers = 0;
  let body = Buffer.alloc(0);
  if (mode === "ok") {
    answers = records.length;
    body = Buffer.concat(
      records.map(([priority, weight, port, target]) => {
        const t = encodeName(target);
        const rdata = Buffer.alloc(6 + t.length);
        rdata.writeUInt16BE(priority, 0);
        rdata.writeUInt16BE(weight, 2);
        rdata.writeUInt16BE(port, 4);
        t.copy(rdata, 6);
        const rr = Buffer.alloc(12);
        rr.writeUInt16BE(0xc00c, 0);
        rr.writeUInt16BE(33, 2);
        rr.writeUInt16BE(1, 4);
        rr.writeUInt32BE(300, 6);
        rr.writeUInt16BE(rdata.length, 10);
        return Buffer.concat([rr, rdata]);
      }),
    );
  } else if (mode === "nxdomain") flags = 0x8183;
  else if (mode === "servfail") flags = 0x8182;
  else if (mode === "refused") flags = 0x8185;
  else if (mode === "notimp") flags = 0x8184;
  else if (mode === "formerr") flags = 0x8181;
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers, 6);
  server.send(Buffer.concat([header, question, body]), rinfo.port, rinfo.address);
});
function show(label, err, recs) {
  const e = err
    ? { name: err.name, message: err.message, code: err.code, errno: err.errno, syscall: err.syscall, hostname: err.hostname, keys: Object.keys(err).join(",") }
    : null;
  // on a failure Node passes no records; a callback typed from its declaration (`addresses: SrvRecord[]`) receives an empty array there,
  // so the row reads the records only on success
  console.log(label, JSON.stringify(e), err ? "" : JSON.stringify(recs), err ? "" : Object.keys(recs[0]).join(","));
}
server.bind(0, "127.0.0.1", () => {
  const port = server.address().port;
  dns.setServers(["127.0.0.1:" + port]);
  console.log("servers", JSON.stringify(dns.getServers()).replace(String(port), "PORT"));
  const modes = ["ok", "nxdomain", "servfail", "refused", "notimp", "formerr"];
  let i = 0;
  const next = () => {
    if (i === modes.length) {
      // two queries in flight at once complete independently, each with its own callback
      mode = "ok";
      let pending = 2;
      const done = () => {
        if (--pending === 0) server.close();
      };
      dns.resolveSrv("_a._tcp.example.com", (err, recs) => {
        show("a", err, recs);
        done();
      });
      dns.resolveSrv("_b._tcp.example.com", (err, recs) => {
        show("b", err, recs);
        done();
      });
      console.log("both queries started");
      return;
    }
    mode = modes[i++];
    dns.resolveSrv("_sip._tcp.example.com", (err, recs) => {
      show(mode, err, recs);
      next();
    });
  };
  next();
});
