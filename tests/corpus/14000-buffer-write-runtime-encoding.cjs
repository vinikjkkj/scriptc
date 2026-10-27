// buf.write(string, offset, encoding) with the encoding as a RUN-TIME string:
// every alias spelling (any case) folds to the same encoder the literal form uses,
// and the returned byte count plus the buffer bytes match Node for each one.
var names = ["utf8", "UTF8", "utf-8", "Utf-8", "ucs2", "UCS-2", "utf16le", "utf-16le", "latin1", "binary", "BINARY", "ascii", "base64", "BASE64", "base64url", "hex", "HEX"];
var text = "héllo 日本";
for (var i = 0; i < names.length; i++) {
  var e = names[i];
  var buf = Buffer.alloc(40, 0x2e);
  var n = buf.write(text, 3, e);
  console.log(e + " " + n + " " + buf.toString("hex"));
}
var hexText = "00ff10ab";
var b2 = Buffer.alloc(12, 0);
console.log(b2.write(hexText, 2, "hex"), b2.toString("hex"));
var b3 = Buffer.alloc(8, 0);
console.log(b3.write("aGVsbG8=", 0, "BASE64"), b3.toString("latin1"));
var ena = ["base64", "BASE64", "Base64url"];
for (var j = 0; j < ena.length; j++) {
  var bb = Buffer.alloc(8, 0x30);
  var k = bb.write("aGVsbG8=", 1, ena[j]);
  console.log(ena[j], k, bb.toString("hex"));
}
var b4 = Buffer.alloc(6, 0);
console.log(b4.write("ab", 1, "ucs2"), JSON.stringify(b4.toString("hex")));
