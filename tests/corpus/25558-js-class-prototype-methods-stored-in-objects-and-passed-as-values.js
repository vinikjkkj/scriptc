// Prototype methods used as values in a JavaScript file (mysql2's writer: Packet.prototype.writeDouble, captureStackHolder(PromiseConnection.prototype.execute)).
class Packet {
  constructor() { this.out = []; }
  writeDouble(v) { this.out.push("d" + v); }
  writeFloat(v) { this.out.push("f" + v); }
}
function writerFor(type) {
  if (type === "double") return { length: 8, writer: Packet.prototype.writeDouble };
  return { length: 4, writer: Packet.prototype.writeFloat };
}
function holder(fn) { return typeof fn === "function" ? fn.name : "none"; }
const pk = new Packet();
for (const t of ["double", "float", "double"]) { const w = writerFor(t); w.writer.call(pk, w.length); }
console.log(pk.out.join(","), holder(Packet.prototype.writeDouble), holder(undefined));
class Query { next() { return Query.prototype.resultsetHeader; } resultsetHeader() { return "header"; } }
const q = new Query();
console.log(q.next().call(q));
