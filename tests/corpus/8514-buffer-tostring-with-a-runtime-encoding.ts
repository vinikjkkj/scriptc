// Buffer.toString(encoding, start, end) where the encoding is a VALUE of type
// BufferEncoding (pg-protocol's BufferReader reads every string through
// `this.buffer.toString(this.encoding, ...)`): the runtime folds aliases (case
// insensitively, as Node does) and throws ERR_UNKNOWN_ENCODING for an unknown name.
type Enc = BufferEncoding;
class Reader {
  offset = 0;
  buffer: Buffer;
  encoding: Enc;
  constructor(buffer: Buffer, encoding: Enc = "utf-8") {
    this.buffer = buffer;
    this.encoding = encoding;
  }
  string(length: number): string {
    const r = this.buffer.toString(this.encoding, this.offset, this.offset + length);
    this.offset += length;
    return r;
  }
  all(): string {
    return this.buffer.toString(this.encoding);
  }
}
const b = Buffer.from("héllo wörld", "utf8");
console.log(new Reader(b).string(6), new Reader(b, "hex").all(), new Reader(b, "base64").string(4), new Reader(b, "latin1").all().length, new Reader(b, "ucs2").string(4).length);
const names: Enc[] = ["utf8", "UTF-8" as Enc, "binary", "ascii", "HEX" as Enc];
for (const n of names) {
  try {
    console.log(n, Buffer.from("abc").toString(n, 1, 3));
  } catch (e) {
    console.log(String(e));
  }
}
try {
  console.log(b.toString("nope" as Enc));
} catch (e) {
  console.log(String(e));
}
