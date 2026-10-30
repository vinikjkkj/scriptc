// socket.setTimeout answers the socket (Node's `return this`), so the calls
// chain and the answer is the same socket object.
import * as net from "net";

const s = new net.Socket();
const r = s.setTimeout(10);
console.log("same", r === s);
const q = s.setTimeout(20).setTimeout(0);
console.log("chained", q === s);
s.destroy();
console.log("end");
