// The sha256_password builtin-RHS shape: `stream instanceof Tls.TLSSocket` where the left
// side is an untyped stream and the right side is a namespace member of the Node builtin
// 'tls' (a class value, typed by the real @types/node through this directory's tsconfig).
// A tls.connect socket IS a TLSSocket (and a net.Socket); a net.connect socket is not.
// Both sockets target a closed loopback port and are destroyed at the end; their error events
// are swallowed, so nothing depends on the network.
import * as Tls from "tls";
import * as Net from "net";

function check(stream: unknown): string {
  if (stream instanceof Tls.TLSSocket) return "tls";
  return "plain";
}
const plain = Net.connect({ host: "127.0.0.1", port: 1 });
const secure = Tls.connect({ host: "127.0.0.1", port: 1 });
plain.on("error", () => {});
secure.on("error", () => {});
console.log(check(plain));
console.log(check(secure));
console.log(check({ encrypted: true }));
console.log(check(null));
console.log(check(undefined));
console.log(check("socket"));
console.log(check(42));
plain.destroy();
secure.destroy();
// Destroyed sockets keep their class: a TLSSocket stays a TLSSocket after close.
console.log("closed", check(plain), check(secure));
