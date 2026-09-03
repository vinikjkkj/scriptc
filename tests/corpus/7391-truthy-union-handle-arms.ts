// ToBoolean over a union whose arm is a runtime HANDLE — `if (sock)` on a
// `net.Socket | undefined` field, and the same test on the net/dgram
// siblings.
//
//   error SC3001: the LLVM backend does not support this construct yet
//   (truthy:union:netSocket)
//
// A JS object is always truthy, so the answer for every one of these arms
// is the constant `true`; the union's OTHER arm (undefined/null) is the
// only thing that can make the test false. The C lane always answered
// that way — its per-union ToBoolean helper handles the unit, number,
// string, bool and jsval arms by value and falls to `return true` for
// everything else. The LLVM lane instead carried its own hand-written
// list of arm kinds it would answer `true` for, and that list had never
// grown past the container/fetch/date families: the whole
// net/http/h2/dgram/tls handle family fell through to the refusal, so a
// program the C backend compiled was rejected on LLVM for a construct
// with no semantic content at all.
//
// Both lanes now read REF_TRUTHY_KINDS, the shared set the frontend
// already folds constant-true truthiness with, so a handle kind added in
// the future is answered by both backends or by neither. Kinds whose
// truthiness is genuinely value-dependent (bigint — `0n` is falsy —, and
// jsval, which only the engine can answer) are deliberately NOT in that
// set and stay refused on LLVM: a constant there would be a silent wrong
// answer rather than a missing feature.
//
// Every line prints from one causal chain. The socket arm is filled from
// a real accepted connection, so the fixture also pins that the handle
// stored into the union is the live one.
import * as dgram from "node:dgram";
import * as net from "node:net";

interface Holder {
  server: net.Server | undefined;
  sock: net.Socket | undefined;
  udp: dgram.Socket | null;
}

const held: Holder = { server: undefined, sock: undefined, udp: null };

// ── the EMPTY union: the unit arm answers false ───────────────────────
console.log("empty server:", held.server ? "truthy" : "falsy", !held.server);
console.log("empty sock:", held.sock ? "truthy" : "falsy", !held.sock);
console.log("empty udp:", held.udp ? "truthy" : "falsy", !held.udp);

// ── a dgram socket needs no peer to exist, so it fills first ──────────
held.udp = dgram.createSocket("udp4");
console.log("held udp:", held.udp ? "truthy" : "falsy", !held.udp);
held.udp.close();
// closing does not make the handle disappear: the object is still an
// object, and Node still says truthy.
console.log("closed udp:", held.udp ? "truthy" : "falsy");

// ── the net pair, filled from a live connection ───────────────────────
const server = net.createServer((sock) => {
  held.sock = sock;
  console.log("held sock:", held.sock ? "truthy" : "falsy", !held.sock);
  if (held.sock) {
    console.log("if-branch on the socket arm");
  } else {
    console.log("else-branch on the socket arm");
  }
  // the same helper answers a boolean-valued read and a double negation
  const asBool: boolean = held.sock ? true : false;
  console.log("as bool:", asBool, !!held.sock, !!held.server, !!held.udp);
  sock.end("bye");
});

held.server = server;
console.log("held server:", held.server ? "truthy" : "falsy", !held.server);

server.listen(0, () => {
  const port = server.address().port;
  const c = net.connect(port, "127.0.0.1");
  let got = "";
  c.on("data", (chunk: Buffer) => {
    got += chunk.toString("utf8");
  });
  c.on("close", () => {
    console.log("client got:", got);
    server.close();
    // the union still holds both handles after the server closed
    console.log("final server:", held.server ? "truthy" : "falsy");
    console.log("final sock:", held.sock ? "truthy" : "falsy");
  });
});
