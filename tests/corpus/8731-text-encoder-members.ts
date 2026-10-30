// TextEncoder members: encoding, encode (composed and stored), encodeInto into a destination, and the
// byteLength of a composed encode.
const stored = new TextEncoder();
console.log(stored.encoding, new TextEncoder().encoding);
const bytes = stored.encode("hé€\u{1F600}");
console.log(bytes.length, bytes[0], bytes[1], bytes[2], bytes[3], bytes instanceof Uint8Array);
console.log(new TextEncoder().encode("").length, new TextEncoder().encode("ab").byteLength);
const dst = new Uint8Array(6);
const r = stored.encodeInto("hé€", dst);
console.log(r.read, r.written, dst[0], dst[1], dst[2], dst[3], dst[4]);
const small = new Uint8Array(4);
const r2 = stored.encodeInto("ab€", small);
console.log(r2.read, r2.written, small[0], small[1], small[2]);
const sink = new Uint8Array(8);
console.log(new TextEncoder().encode("xyé").byteLength, new TextEncoder().encodeInto("z", sink).written, sink[0]);
