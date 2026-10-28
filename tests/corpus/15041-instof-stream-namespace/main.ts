// The NAMESPACE spellings (`stream.X`, `events.EventEmitter`, `net.Socket`, `net.Server`) over
// typed and unknown operands.
import * as stream from "stream";
import * as events from "events";
import * as net from "net";

const r = new stream.Readable();
const d = new stream.Duplex();
const e = new events.EventEmitter();
const ur: unknown = new stream.Writable();
const uo: unknown = { b: 2 };
const un: unknown = null;
const us: unknown = net.createServer();
console.log(r instanceof stream.Stream, d instanceof stream.Stream, e instanceof events.EventEmitter);
console.log(ur instanceof stream.Stream, uo instanceof stream.Stream, un instanceof stream.Stream);
console.log(ur instanceof stream.Writable, uo instanceof stream.Readable, ur instanceof stream.Duplex);
console.log(us instanceof net.Server, us instanceof events.EventEmitter, us instanceof net.Socket);
console.log(ur instanceof events.EventEmitter, uo instanceof events.EventEmitter);
