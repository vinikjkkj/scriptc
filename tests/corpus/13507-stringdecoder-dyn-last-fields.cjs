// A StringDecoder held in a dyn field (a function-constructor instance) answers
// lastNeed / lastTotal / lastChar after partial multibyte writes, as Node does.
var StringDecoder = require("string_decoder").StringDecoder;
function Holder(enc) {
  this.d = new StringDecoder(enc);
}
function show(label, h, out) {
  var lc = h.d.lastChar;
  console.log(label + " " + JSON.stringify(out) + " need=" + h.d.lastNeed + " total=" + h.d.lastTotal +
    " last=" + lc[0] + "," + lc[1] + "," + lc[2] + "," + lc[3]);
}
var a = new Holder("utf8");
show("utf8-e2", a, a.d.write(Buffer.from([0xe2])));
var b = new Holder("utf8");
show("utf8-e2-82", b, b.d.write(Buffer.from([0xe2, 0x82])));
var c = new Holder("utf8");
show("utf8-f0-9f-98", c, c.d.write(Buffer.from([0xf0, 0x9f, 0x98])));
var d = new Holder("utf8");
show("utf8-A", d, d.d.write(Buffer.from([0x41])));
var e = new Holder("base64");
show("base64-AB", e, e.d.write(Buffer.from([0x41, 0x42])));
var f = new Holder("utf16le");
show("utf16le-surr", f, f.d.write(Buffer.from([0x3d, 0xd8])));
var g = new Holder("utf16le");
show("utf16le-odd", g, g.d.write(Buffer.from([0x41])));
var h = new Holder("hex");
show("hex-41", h, h.d.write(Buffer.from([0x41])));
