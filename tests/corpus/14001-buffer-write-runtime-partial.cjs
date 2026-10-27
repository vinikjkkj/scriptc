// Partial writes at run-time encodings: the byte budget (buffer end after the offset)
// truncates at a unit boundary per encoding (whole utf8 code points, whole utf16le
// units, byte-level for the rest). The 4-argument form takes an explicit length.
var s = "aé日😀z";
var encs = ["utf8", "utf16le", "latin1", "hex", "base64", "ascii"];
for (var i = 0; i < encs.length; i++) {
  var e = encs[i];
  var src = e === "base64" ? "aGVsbG8gd29ybGQ=" : s;
  var buf = Buffer.alloc(7, 0x3f);
  var n = buf.write(src, 2, e);
  console.log(e, n, buf.toString("hex"));
  var small = Buffer.alloc(9, 0x3f);
  var m = small.write(src, 1, 4, e);
  console.log(e, "len4", m, small.toString("hex"));
}
var full = Buffer.alloc(3, 0x41);
console.log(full.write("日本", 0, "utf8"), full.toString("hex"));
var odd = Buffer.alloc(5, 0);
console.log(odd.write("abc", 4, "utf16le"), odd.toString("hex"));
var off = Buffer.alloc(4, 0);
console.log(off.write("xy", 4, "utf8"), off.toString("hex"));
