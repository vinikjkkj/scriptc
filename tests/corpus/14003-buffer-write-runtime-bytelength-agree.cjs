// For each run-time encoding name the count written by buf.write equals
// Buffer.byteLength(string, name) when the buffer has room, and Buffer.isEncoding
// agrees with whether the name writes at all.
var names = ["utf8", "UTF-8", "ucs2", "utf-16le", "latin1", "binary", "ascii", "base64", "base64url", "hex", "bogus"];
var s = "hé日😀 AbC+/=";
for (var i = 0; i < names.length; i++) {
  var e = names[i];
  var isEnc = Buffer.isEncoding(e);
  var src = e.toLowerCase().indexOf("base64") >= 0 ? "AbC+/xyz" : s;
  var len = Buffer.byteLength(src, e);
  var big = Buffer.alloc(len + 4, 0);
  var n = isEnc ? big.write(src, 0, e) : -1;
  console.log(e, isEnc, len, n, isEnc ? (n === len) : "skip");
}
var roomy = Buffer.alloc(64, 0);
console.log(roomy.write(s, 2, "utf16le"), Buffer.byteLength(s, "utf16le"));
