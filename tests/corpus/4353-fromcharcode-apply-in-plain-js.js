// The `.apply` whole-array call as PLAIN JS writes it — which is how the
// site that motivated the lowering is spelled. `String.fromCharCode.apply`'s
// TypeScript signature demands `number[]` for the argument list, so the
// typed-array spelling and the base64 encoder's own untyped accumulator can
// only be written here.
//
// protobufjs's src/util/base64.js, reduced but unchanged in shape.

// --- a typed-array argument list ---------------------------------------------
const bytes = new Uint8Array([74, 83, 33]);
console.log("bytes:", String.fromCharCode.apply(String, bytes));
console.log("bytes-empty:", JSON.stringify(String.fromCharCode.apply(String, new Uint8Array(0))));
console.log("bytes-subarray:", String.fromCharCode.apply(String, bytes.subarray(0, 2)));

// --- the base64 encoder, verbatim in shape ------------------------------------
const b64 = new Array(64);
for (let n = 0; n < 64; n++) {
  b64[n] = n < 26 ? n + 65 : n < 52 ? n + 71 : n < 62 ? n - 4 : n - 59 | 43;
}
const encode = function (buffer, start, end) {
  let parts = null, chunk = [], i = 0, j = 0, t = 0;
  while (start < end) {
    var b = buffer[start++];
    switch (j) {
      case 0: chunk[i++] = b64[b >> 2]; t = (3 & b) << 4; j = 1; break;
      case 1: chunk[i++] = b64[t | b >> 4]; t = (15 & b) << 2; j = 2; break;
      case 2: chunk[i++] = b64[t | b >> 6]; chunk[i++] = b64[63 & b]; j = 0; break;
    }
    if (i > 8191) {
      (parts || (parts = [])).push(String.fromCharCode.apply(String, chunk));
      i = 0;
    }
  }
  if (j) {
    chunk[i++] = b64[t];
    chunk[i++] = 61;
    if (j === 1) chunk[i++] = 61;
  }
  if (parts) {
    if (i) parts.push(String.fromCharCode.apply(String, chunk.slice(0, i)));
    return parts.join("");
  }
  return String.fromCharCode.apply(String, chunk.slice(0, i));
};

const src = [];
for (let k = 0; k < 40; k++) src.push((k * 37 + 11) & 255);
console.log("b64-0:", JSON.stringify(encode(src, 0, 0)));
console.log("b64-1:", encode(src, 0, 1));
console.log("b64-2:", encode(src, 0, 2));
console.log("b64-3:", encode(src, 0, 3));
console.log("b64-all:", encode(src, 0, src.length));
console.log("b64-mid:", encode(src, 7, 23));

// --- the answer agrees with Node's own base64 ---------------------------------
console.log("agrees:", encode(src, 0, src.length) === Buffer.from(src).toString("base64"));

// --- an untyped accumulator, the loose shape ----------------------------------
function units(s) {
  const u = [];
  for (let i = 0; i < s.length; i++) u.push(s.charCodeAt(i));
  return u;
}
console.log("roundtrip:", String.fromCharCode.apply(String, units("round trip ✓")));
console.log("roundtrip-empty:", JSON.stringify(String.fromCharCode.apply(String, units(""))));
