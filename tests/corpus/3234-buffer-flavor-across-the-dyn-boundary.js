// Buffer-ness across the static->dyn boundary.
//
// A Buffer and a Uint8Array share ONE static representation (SCR_BYTES_U8)
// and ONE IR type, so the difference between them lives on the VALUE: the
// producer stamps `ScrBytes.flavor`, and the dyn node re-asks it through
// `ScrDyn.buffer`. Every string branch reads the second one -- a Buffer's
// toString and string coercion DECODE, a plain Uint8Array's JOIN its
// elements.
//
// The boundary constructor was not deriving the second from the first, so
// a Buffer that crossed into an untyped parameter stopped being a Buffer:
//
//     function hex(b) { return b.toString("hex"); }
//     hex(Buffer.from("hi"))     // Node: "6869"   was: "104,105"
//
// No fence, no diagnostic -- the same source spelling answered one way
// through a typed slot and another through an untyped one. This program is
// both sides of every branch that reads the flag.

function tsNo(b) {
  return b.toString();
}
function tsEnc(b, enc) {
  return enc === "hex" ? b.toString("hex") : b.toString("base64");
}
function tsRange(b, s, e) {
  return b.toString("utf-8", s, e);
}
function coerce(b) {
  return "" + b;
}
function templ(b) {
  return `[${b}]`;
}
function joined(b) {
  return [b, b].join("|");
}

var buf = Buffer.from("hi there");
var u8 = new Uint8Array([104, 105]);

console.log("buf 0 ", JSON.stringify(tsNo(buf)));
console.log("u8  0 ", JSON.stringify(tsNo(u8)));
console.log("buf hx", tsEnc(buf, "hex"));
console.log("u8  hx", tsEnc(u8, "hex"));
console.log("buf 64", tsEnc(buf, "b64"));
console.log("u8  64", tsEnc(u8, "b64"));
console.log("buf rg", JSON.stringify(tsRange(buf, 3, 8)));
console.log("u8  rg", JSON.stringify(tsRange(u8, 0, 1)));
console.log("buf +''", JSON.stringify(coerce(buf)));
console.log("u8  +''", JSON.stringify(coerce(u8)));
console.log("buf tpl", templ(buf));
console.log("u8  tpl", templ(u8));
console.log("buf jn ", joined(buf));
console.log("u8  jn ", joined(u8));

// A Buffer built FROM a Uint8Array is a Buffer; a Uint8Array built from a
// Buffer is not. The constructor stamps the flavor, not the source.
console.log("from u8", JSON.stringify(tsNo(Buffer.from(u8))));
console.log("u8 of b", JSON.stringify(tsNo(new Uint8Array(buf))));

// Slices keep the receiver's flavor on BOTH sides of the boundary.
function sliceThen(b) {
  return b.slice(0, 2).toString();
}
console.log("slice b", JSON.stringify(sliceThen(buf)));
console.log("slice u", JSON.stringify(sliceThen(u8)));
console.log("subarr ", JSON.stringify(tsNo(buf.subarray(3, 8))));

// The OTHER readers of the same fact -- and the reason the two homes had
// to be reconciled rather than one of them patched. inspect and JSON ask
// the PAYLOAD flavor, the string branches asked the DYN node, and while
// the boundary left the second unset the same value printed as a Buffer
// and stringified as a Uint8Array.
function show(b) {
  console.log(b);
}
function asJson(b) {
  return JSON.stringify(b);
}
show(buf);
show(u8);
console.log("json b ", asJson(buf));
console.log("json u ", asJson(u8));

// Through JSON.parse there is no Buffer at all: the parser makes arrays.
var arr = JSON.parse("[104,105]");
console.log("parsed ", JSON.stringify(tsNo(arr)));

// And the flavor survives a round trip through a dyn container.
function boxAndBack(b) {
  var box = { v: b };
  return box.v.toString("hex");
}
console.log("boxed b", boxAndBack(buf));
console.log("boxed u", boxAndBack(u8));
