// A Buffer is a Uint8Array: element reads past the end are undefined, writes past the end are ignored, in a parser that probes beyond the packet and a writer that overruns it.
const buf = Buffer.from([0x03, 0x00, 0x00, 0x01, 0xff]);
let n = buf.length;
console.log(buf[n], buf[n + 3], buf[-1], buf[0.5], buf[n] === undefined, buf[n - 1] === undefined);
buf[n] = 1;
buf[n + 2] |= 4;
buf[-1] = 7;
console.log(buf.toString("hex"), buf.length);
function readLen(p: Buffer, at: number): number { return p[at] | (p[at + 1] << 8) | (p[at + 2] << 16); }
console.log(readLen(buf, 0), readLen(buf, 3), readLen(buf, 4), readLen(buf, 9));
function readLenOrNone(p: Buffer, at: number): number | undefined {
  if (p[at + 2] === undefined) return undefined;
  return readLen(p, at);
}
console.log(readLenOrNone(buf, 0), readLenOrNone(buf, 3), readLenOrNone(buf, 2));
function writePacket(p: Buffer, at: number, parts: number[]): number {
  for (let k = 0; k < parts.length; k++) p[at + k] = parts[k];
  return at + parts.length;
}
const small = Buffer.alloc(4);
console.log(writePacket(small, 2, [1, 2, 3, 4, 5]), small.toString("hex"), small.length);
const sub = buf.subarray(1, 3);
console.log(sub[2], sub[1], sub.length);
sub[2] = 9;
console.log(buf.toString("hex"));
