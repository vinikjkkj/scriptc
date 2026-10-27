// encodings/internal.js:50 shape: a builtin class reached through a require binding, constructed inside a function.
var StringDecoder = require("string_decoder").StringDecoder;
function InternalDecoder(options, codec) {
  this.decoder = new StringDecoder(codec.enc);
}
InternalDecoder.prototype.write = function (buf) {
  return this.decoder.write(buf);
};
var d = new InternalDecoder({}, { enc: "utf8" });
console.log(JSON.stringify(d.write(Buffer.from([0xe2, 0x82, 0xac, 0x41]))));
function Pt(x) { this.x = x; }
var Alias = Pt;
console.log(new Alias(5).x, new Pt(6).x);
