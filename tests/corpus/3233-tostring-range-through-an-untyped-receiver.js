// `d.toString(encoding, start, end)` -- Buffer's decode-a-window form --
// reached through a receiver the compiler cannot type. protobufjs's
// BufferReader reads EVERY string field through it:
//
//     return this.buf.utf8Slice ? this.buf.utf8Slice(t, n)
//                               : this.buf.toString("utf-8", t, n)
//
// The dyn `toString` lowering claimed the 0- and 1-argument spellings and
// stopped there, so the 3-argument one fell into the method fence -- not
// because the operation was missing (scr_bytes_to_str_range has served the
// STATIC Buffer spelling all along) but because the dyn arity did not
// reach it.
//
// The two extra arguments belong to exactly ONE receiver kind, and this
// program pins what every other kind does with them. Measured against
// Node, not assumed: a plain Uint8Array's toString is ARRAY's (the element
// join, arguments ignored), strings/arrays/objects/booleans ignore them
// too, and a NUMBER reads argument 0 as a RADIX -- so an encoding name
// there is always V8's RangeError.

function win(b, s, e) {
  return b.toString("utf-8", s, e);
}
function win2(b, s) {
  return b.toString("utf8", s);
}
function winEnc(b, enc, s, e) {
  return enc === "hex" ? b.toString("hex", s, e) : b.toString("base64", s, e);
}

var buf = Buffer.from("hello world");
console.log("mid   ", JSON.stringify(win(buf, 1, 5)));
console.log("head  ", JSON.stringify(win(buf, 0, 5)));
console.log("tail  ", JSON.stringify(win2(buf, 6)));
console.log("all   ", JSON.stringify(win(buf, 0, buf.length)));
console.log("empty ", JSON.stringify(win(buf, 3, 3)));

// The clamps: a negative start is ZERO (it does NOT count from the end,
// unlike slice), an end past the length is the length, and a reversed
// window is empty.
console.log("neg   ", JSON.stringify(win(buf, -3, 99)));
console.log("past  ", JSON.stringify(win(buf, 6, 999)));
console.log("rev   ", JSON.stringify(win(buf, 5, 2)));
console.log("negEnd", JSON.stringify(win(buf, 0, -1)));

// Fractional bounds truncate toward zero (ToIntegerOrInfinity).
console.log("frac  ", JSON.stringify(win(buf, 1.9, 5.9)));

// The other encodings over the same window.
console.log("hex   ", winEnc(buf, "hex", 0, 4));
console.log("b64   ", winEnc(buf, "b64", 0, 6));

// A multi-byte window: the boundary is in BYTES, so a window that splits a
// UTF-8 sequence answers the replacement character -- Node's decode, and
// the reason the unit matters.
var uni = Buffer.from("aé你z");
console.log("uniAll", JSON.stringify(win(uni, 0, uni.length)));
console.log("uniCut", JSON.stringify(win(uni, 0, 2)));
console.log("uniMid", JSON.stringify(win(uni, 1, 3)));

// --- a plain Uint8Array is NOT a Buffer ---------------------------------
// Its toString is Array.prototype's: the element join, and both extra
// arguments are ignored.
var u8 = new Uint8Array([104, 105, 33]);
console.log("u8    ", JSON.stringify(win(u8, 0, 1)));
console.log("u8two ", JSON.stringify(win2(u8, 2)));

// --- the kinds that ignore the extra arguments --------------------------
console.log("str   ", JSON.stringify(win("abcdef", 1, 3)));
console.log("arr   ", JSON.stringify(win([1, 2, 3], 1, 2)));
console.log("obj   ", JSON.stringify(win({ a: 1 }, 1, 2)));
console.log("bool  ", JSON.stringify(win(true, 1, 2)));

// An OWN toString still wins -- the member lookup happens first.
console.log("ownTS ", JSON.stringify(win({ toString: function () { return "MINE"; } }, 1, 2)));

// --- a NUMBER receiver reads argument 0 as a radix ----------------------
function shows(f) {
  try {
    return "ok:" + f();
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
console.log("num   ", shows(function () { return win(255, 1, 2); }));

// --- nullish receivers keep the property-read TypeError -----------------
var nul = JSON.parse("null");
console.log("null  ", shows(function () { return win(nul, 0, 1); }));

// --- the BufferReader shape this came from ------------------------------
function Reader(b) {
  this.buf = b;
  this.pos = 0;
  this.len = b.length;
}
Reader.prototype.u8 = function () {
  return this.buf[this.pos++];
};
Reader.prototype.string = function () {
  var n = this.u8();
  var start = this.pos;
  var end = this.pos + n;
  if (end > this.len) throw RangeError("index out of range: " + this.pos + " + " + n + " > " + this.len);
  this.pos = end;
  return this.buf.utf8Slice ? this.buf.utf8Slice(start, end) : this.buf.toString("utf-8", start, end);
};

// length-prefixed strings, the wire shape a protobuf field decodes as
var wire = Buffer.concat([
  Buffer.from([5]),
  Buffer.from("alpha"),
  Buffer.from([4]),
  Buffer.from("beta"),
  Buffer.from([0]),
  Buffer.from([3]),
  Buffer.from("éx"),
]);
var r = new Reader(wire);
console.log("wire  ", [r.string(), r.string(), JSON.stringify(r.string()), r.string()].join("/"));
console.log("wireER", shows(function () { return new Reader(Buffer.from([9, 1, 2])).string(); }));
