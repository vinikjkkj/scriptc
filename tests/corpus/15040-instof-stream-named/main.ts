// `instanceof` through the NAMED imports, over an unknown operand holding every runtime object
// kind the program can produce. Columns: Stream, Readable, Writable, Duplex, Transform,
// EventEmitter, net.Socket, net.Server. Node's answers are the prototype chain, plus Writable's
// Symbol.hasInstance (every Duplex-family object answers true for Writable).
import * as net from "net";
import * as tls from "tls";
import * as fs from "fs";
import { EventEmitter } from "events";
import { Stream, Readable, Writable, Duplex, Transform, PassThrough } from "stream";

class MyReadable extends Readable {}
class MyEmitter extends EventEmitter {}
class Plain {}

const sock = net.connect({ host: "127.0.0.1", port: 1 });
sock.on("error", () => {});
const tsock = tls.connect({ host: "127.0.0.1", port: 1 });
tsock.on("error", () => {});
const srv = net.createServer();

function pick(i: number): unknown {
  switch (i) {
    case 0: return { a: 1 };
    case 1: return null;
    case 2: return undefined;
    case 3: return 1;
    case 4: return "s";
    case 5: return true;
    case 6: return new Readable();
    case 7: return new Writable();
    case 8: return new Duplex();
    case 9: return new Transform();
    case 10: return new PassThrough();
    case 11: return new EventEmitter();
    case 12: return new Error("e");
    case 13: return new TypeError("t");
    case 14: return Buffer.from("ab");
    case 15: return new Uint8Array(2);
    case 16: return srv;
    case 17: return sock;
    case 18: return tsock;
    case 19: return new MyReadable();
    case 20: return new MyEmitter();
    case 21: return new Plain();
    case 22: return fs.createReadStream("/dev/null");
    case 23: return new Date(0);
    case 24: return [1];
    case 25: return () => 1;
    default: return new RangeError("r");
  }
}
for (let i = 0; i < 27; i++) {
  const v = pick(i);
  console.log(
    i,
    v instanceof Stream,
    v instanceof Readable,
    v instanceof Writable,
    v instanceof Duplex,
    v instanceof Transform,
    v instanceof EventEmitter,
    v instanceof net.Socket,
    v instanceof net.Server,
  );
}
sock.destroy();
tsock.destroy();
