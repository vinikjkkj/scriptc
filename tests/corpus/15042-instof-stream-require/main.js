// `instanceof Stream` through the CommonJS spellings: `require("stream").Stream`, a
// const alias of it, a destructured require, the `node:` specifier, and the member
// read inline. Operands: a Readable, a plain object, a number and undefined.
var Stream = require("stream").Stream;
var S2 = require("node:stream").Stream;
var { Stream: S3 } = require("stream");
var Readable = require("stream").Readable;
var yes = require("fs").createReadStream("/dev/null");
var no = { c: 3 };
var n = JSON.parse("null");
var one = JSON.parse("1");
var und = [][0];
console.log(yes instanceof Stream, no instanceof Stream, one instanceof S2, und instanceof S3);
console.log(yes instanceof require("stream").Stream, n instanceof Stream);
var net = require("net");
var EE = require("events").EventEmitter;
var srv = net.createServer();
console.log(srv instanceof net.Server, srv instanceof EE, srv instanceof net.Socket);
console.log(yes instanceof require("stream").Writable);
