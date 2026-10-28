// Typed operands: process.stdout and process.stderr (typed WriteStream), a typed net.Socket and a
// typed EventEmitter. Node: the stdio streams and the socket are streams; the emitter is not.
import { Stream } from "stream";
import { EventEmitter } from "events";
import * as net from "net";

const sock: net.Socket = net.connect({ host: "127.0.0.1", port: 1 });
sock.on("error", () => {});
const em = new EventEmitter();
console.log(process.stdout instanceof Stream, process.stderr instanceof Stream);
console.log(sock instanceof Stream, sock instanceof net.Socket, sock instanceof net.Server);
console.log(em instanceof Stream, em instanceof EventEmitter);
sock.destroy();
