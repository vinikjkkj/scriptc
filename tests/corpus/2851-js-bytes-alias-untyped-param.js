// A caller-owned Uint8Array written through an UNTYPED parameter:
// protobufjs's writer shape, `write(val, buf, pos) { buf[pos] = val }`.
// The typed array crosses the static→dyn boundary by REFERENCE, so the
// write lands on the caller's buffer (Node has no copy to lose it in).
function writeByte(val, buf, pos) { buf[pos] = val; }
function writeFixed32(val, buf, pos) {
  buf[pos] = val & 255;
  buf[pos + 1] = (val >>> 8) & 255;
  buf[pos + 2] = (val >>> 16) & 255;
  buf[pos + 3] = val >>> 24;
}
function readAt(buf, i) { return buf[i]; }
function bothAlias(x, y, i) { x[i] = 42; return y[i]; }

var u = new Uint8Array(6);
writeByte(10, u, 0);
writeByte(7, u, 1);
writeFixed32(0x04030201, u, 2);
var hex = "";
for (var i = 0; i < u.length; i++) {
  var h = u[i].toString(16);
  hex += h.length < 2 ? "0" + h : h;
}
console.log("hex", hex);
console.log("caller sees", u[1], readAt(u, 3), u.length);
// Two parameters bound to the SAME buffer see each other's writes.
console.log("aliased", bothAlias(u, u, 5), u[5]);

var b = Buffer.alloc(3);
writeByte(65, b, 0);
writeByte(66, b, 1);
console.log("buffer", b.toString("utf8", 0, 2), b[0], b.length);
