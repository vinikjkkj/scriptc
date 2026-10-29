// bson encodeUTF8Into shape: Buffer.write(source, offset, undefined, 'utf8') over
// a Buffer-typed receiver, against the 3-argument and encoding-only forms.
// Node: an explicit undefined length is the omitted length (this.length - offset).
type NodeJsEncoding = 'base64' | 'hex' | 'utf8' | 'binary';
type NodeJsBuffer = ArrayBufferView &
  Uint8Array & {
    write(string: string, offset: number, length: undefined, encoding: 'utf8'): number;
    toString: (this: Uint8Array, encoding: NodeJsEncoding, start?: number, end?: number) => string;
  };

function encodeInto(buffer: NodeJsBuffer, source: string, byteOffset: number): number {
  return buffer.write(source, byteOffset, undefined, 'utf8');
}

const buf = Buffer.alloc(12);
console.log("a", encodeInto(buf, "hé", 2), buf[2], buf[3], buf[4], buf[5]);
console.log("b", encodeInto(buf, "✓x", 7), buf[7], buf[8], buf[9], buf[10], buf[11]);
console.log("c", encodeInto(buf, "", 0), buf[0]);
console.log("d", buf.write("ok", 0, undefined, "utf8"), buf[0], buf[1]);
console.log("e", buf.write("zz", 10, "utf8"), buf[10], buf[11]);
const small = Buffer.alloc(3);
console.log("f", encodeInto(small, "✓", 1), small[1], small[2], small[0]);
console.log("g", encodeInto(small, "abcdef", 0), small.toString("hex"));
console.log("h", buf.toString("hex", 0, 4), buf.toString("utf8", 2, 5).length);
