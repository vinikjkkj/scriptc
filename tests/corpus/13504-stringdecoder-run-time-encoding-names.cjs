// new StringDecoder(enc) with a run-time string: Node's normalization (case-insensitive
// alias set, utf-8/ucs2/binary folded), an undefined encoding means utf8, and an
// unknown name throws ERR_UNKNOWN_ENCODING.
var StringDecoder = require("string_decoder").StringDecoder;
var names = ["UTF8", "utf-8", "ucs2", "binary", "base64url", "Hex"];
for (var i = 0; i < names.length; i++) {
  var d = new StringDecoder(names[i]);
  console.log(names[i] + " -> " + d.encoding);
}
var dflt = new StringDecoder(undefined);
console.log("default -> " + dflt.encoding);
var bad = "nope";
try {
  new StringDecoder(bad);
  console.log("no throw");
} catch (e) {
  console.log(e.name + " " + e.code + " " + e.message);
}
var ok = new StringDecoder(names[2]);
console.log(JSON.stringify(ok.write(Buffer.from([0x41, 0x00]))));
var num = 5;
try {
  new StringDecoder(num);
} catch (e) {
  console.log(e.code + " " + e.message);
}
