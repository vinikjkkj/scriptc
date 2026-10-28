// `instanceof Stream` through the CommonJS spellings: `require("stream").Stream`, a
// const alias of it, a destructured require, the `node:` specifier, and the member
// read inline. Operands: a Readable, a plain object, a number and undefined.
var Stream = require("stream").Stream;
var S2 = require("node:stream").Stream;
var { Stream: S3 } = require("stream");
var Readable = require("stream").Readable;
var yes = new Readable();
var no = { c: 3 };
var n = JSON.parse("null");
console.log(yes instanceof Stream, no instanceof Stream, 1 instanceof S2, undefined instanceof S3);
console.log(yes instanceof require("stream").Stream, n instanceof Stream);
console.log(require("stream").Stream === Stream, S2 === S3);
var net = require("net");
var EE = require("events").EventEmitter;
var ee = new EE();
var srv = net.createServer();
console.log(ee instanceof EE, srv instanceof net.Server, srv instanceof EE, ee instanceof net.Socket, srv instanceof net.Socket);
console.log(require("stream").Readable === Readable, new Readable() instanceof require("stream").Writable);
