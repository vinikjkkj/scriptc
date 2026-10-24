"use strict";
// zlib over untyped operands: data of any accepted kind, Node's options bag (validated with Node's own
// messages), maxOutputLength, and the callback forms (run one at a time: concurrent threadpool jobs
// finish in no fixed order). Compressed bytes are zlib-build dependent, so round trips and the
// deterministic stored (level 0) length are compared, never raw deflate output.
const zlib = require("zlib");
const big = Buffer.alloc(1000, "a");
const d = zlib.deflateSync(big);
function t(f) {
  try {
    const r = f();
    console.log("ok", Buffer.isBuffer(r) ? r.length : r);
  } catch (e) {
    console.log(e.name, e.code, e.errno, e.message);
  }
}
const same = (a, b) => Buffer.compare(a, Buffer.isBuffer(b) ? b : Buffer.from(b)) === 0;
const untyped = (x) => x;
t(() => zlib.inflateSync(d, { maxOutputLength: 5 }));
t(() => zlib.inflateSync(d, { maxOutputLength: 1000 }));
t(() => zlib.inflateSync(d, { maxOutputLength: 999 }));
t(() => zlib.deflateSync(big, { maxOutputLength: 5 }));
t(() => zlib.inflateSync(d, { maxOutputLength: 0 }));
t(() => zlib.inflateSync(d, { maxOutputLength: -1 }));
t(() => zlib.inflateSync(d, { maxOutputLength: "x" }));
t(() => zlib.inflateSync(untyped("abc")));
t(() => zlib.inflateSync(untyped(Buffer.from("garbage"))));
t(() => zlib.inflateSync(untyped(d.subarray(0, 5))));
t(() => zlib.deflateSync(untyped(5)));
t(() => zlib.deflateSync(untyped(undefined)));
t(() => zlib.deflateSync(untyped(null)));
t(() => same(zlib.inflateSync(zlib.deflateSync(untyped("hello world"))), "hello world"));
t(() => same(zlib.inflateSync(zlib.deflateSync(untyped(Buffer.from([1, 2, 3, 4, 5])))), Buffer.from([1, 2, 3, 4, 5])));
t(() => zlib.deflateSync(big, { level: 99 }));
t(() => zlib.deflateSync(big, { level: 1.5 }));
t(() => zlib.deflateSync(big, { level: "9" }));
t(() => zlib.deflateSync(big, { level: 0 }).length);
t(() => same(zlib.inflateSync(zlib.deflateSync(big, { level: 9 })), big));
t(() => same(zlib.inflateSync(zlib.deflateSync(big, { windowBits: 9 })), big));
t(() => zlib.deflateSync(big, { windowBits: 7 }));
t(() => same(zlib.inflateSync(zlib.deflateSync(big, { memLevel: 1, strategy: 2 })), big));
t(() => zlib.deflateSync(big, { memLevel: 10 }));
t(() => zlib.deflateSync(big, { strategy: 5 }));
t(() => same(zlib.inflateSync(zlib.deflateSync(big, { chunkSize: 100 })), big));
t(() => zlib.deflateSync(big, { chunkSize: 1 }));
t(() => same(zlib.inflateSync(zlib.deflateSync(big, null)), big));
t(() => same(zlib.gunzipSync(zlib.gzipSync(untyped("gzip me"))), "gzip me"));
t(() => same(zlib.inflateRawSync(zlib.deflateRawSync(untyped("raw me"))), "raw me"));
t(() => zlib.unzipSync(zlib.gzipSync(untyped("auto"))).toString() + zlib.unzipSync(zlib.deflateSync(untyped("auto"))).toString());
t(() => zlib.inflateSync(zlib.deflateSync(big, { dictionary: Buffer.from("aaaa") }), { dictionary: Buffer.from("aaaa") }).length);
t(() => zlib.inflateSync(zlib.deflateSync(big, { dictionary: Buffer.from("aaaa") })));
function step(n) {
  if (n === 0) return console.log("end");
  const cases = [
    () => zlib.deflate(big, (err, out) => { console.log("cb deflate", err, zlib.inflateSync(out).equals(big)); step(n - 1); }),
    () => zlib.inflate(d, { maxOutputLength: 10 }, (e, o) => { console.log("cb inflate", e && e.code, e && e.message, o); step(n - 1); }),
    () => zlib.inflate(Buffer.from("bad"), (e, o) => { console.log("cb bad", e.code, e.errno, e.message, o); step(n - 1); }),
    () => zlib.gzip(untyped("hello"), { level: 1 }, (e, o) => { console.log("cb gzip", e, zlib.gunzipSync(o).toString()); step(n - 1); }),
    () => zlib.unzip(zlib.gzipSync(untyped("u")), (e, o) => { console.log("cb unzip", e, o.toString()); step(n - 1); }),
  ];
  cases[cases.length - n]();
}
try { zlib.deflate(big); } catch (e) { console.log(e.name, e.code, e.message); }
try { zlib.deflate(untyped(7), () => {}); } catch (e) { console.log(e.name, e.code, e.message); }
console.log("sync done");
step(5);
