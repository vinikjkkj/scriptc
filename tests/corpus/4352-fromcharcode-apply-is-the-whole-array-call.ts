// `String.fromCharCode.apply(thisArg, codes)` — the ES5 spelling of
// `String.fromCharCode(...codes)`.
//
// This is the whole `Function.prototype.apply` population of zapo's compiled
// protobufjs bundle: three sites in the base64 encoder, all of the same shape,
// all previously
//   SC1090 Function.prototype.apply on a compiled function value (compiled
//          calls are direct — no runtime 'this' or arguments object exists to
//          re-route; spell the call directly: 'String.fromCharCode(...)')
// The fence is right about the general case and wrong about this one:
// `String.fromCharCode` reads no receiver, and the SPREAD form already lowers
// by handing the whole array to the runtime, so nothing here needs a call
// frame built at runtime. `f.apply(X, arr)` and `f(...arr)` are the same call.
//
// Every expectation is Node's: the UTF-16 code-unit rules (wrap, truncate,
// lone surrogates recombining), the empty and absent argument lists, and the
// two receiver spellings the idiom uses.

const codes: number[] = [104, 101, 108, 108, 111];

// --- the three receiver spellings the idiom writes ---------------------------
console.log("this-String:", String.fromCharCode.apply(String, codes));
console.log("this-null:", String.fromCharCode.apply(null, codes));
console.log("this-undefined:", String.fromCharCode.apply(undefined, codes));

// --- CONTROL: the spread form, which already lowered -------------------------
console.log("spread:", String.fromCharCode(...codes));
console.log("plain:", String.fromCharCode(104, 105));

// --- the empty and absent argument lists --------------------------------------
const empty: number[] = [];
console.log("empty-array:", JSON.stringify(String.fromCharCode.apply(String, empty)));
console.log("no-list:", JSON.stringify(String.fromCharCode.apply(String)));

// --- ToUint16: wrap, truncate, and the negative end ---------------------------
// 65601 is 65 + 65536, 0.5 truncates toward zero, -1 wraps to 0xFFFF.
console.log("wrap:", JSON.stringify(String.fromCharCode.apply(String, [65601, 66.9, -1, 0])));

// --- adjacent lone surrogates recombine into ONE code point -------------------
const surrogates = [0xd83d, 0xde00];
const pair = String.fromCharCode.apply(String, surrogates);
console.log("surrogates:", pair.length, pair.charCodeAt(0), pair.charCodeAt(1), JSON.stringify(pair));

// --- a SLICE of a longer buffer, the base64 encoder's own spelling ------------
const buf: number[] = [];
for (let i = 0; i < 8; i++) buf.push(97 + i);
console.log("slice:", String.fromCharCode.apply(String, buf.slice(0, 3)),
  String.fromCharCode.apply(String, buf.slice(5)));

// --- the protobufjs base64 shape, in miniature --------------------------------
// A code array filled in a loop, flushed in chunks, joined at the end.
function encodeChunks(input: string, chunk: number): string {
  const acc: string[] = [];
  const units: number[] = [];
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    units[n++] = input.charCodeAt(i);
    if (n >= chunk) {
      acc.push(String.fromCharCode.apply(String, units.slice(0, n)));
      n = 0;
    }
  }
  if (n > 0) acc.push(String.fromCharCode.apply(String, units.slice(0, n)));
  return acc.join("");
}
console.log("chunked:", encodeChunks("the quick brown fox", 4));
console.log("chunked-exact:", encodeChunks("abcd", 4));
console.log("chunked-empty:", JSON.stringify(encodeChunks("", 4)));

// --- a BINDING as the thisArg, which is effect-free too ------------------------
const recv = String;
console.log("binding-this:", String.fromCharCode.apply(recv, codes));

// --- the result is an ordinary string ------------------------------------------
const s = String.fromCharCode.apply(String, codes);
console.log("string-ops:", s.length, s.toUpperCase(), s.indexOf("ll"), s === "hello");
