// out[off + i - start] = str.charCodeAt(i): the buffer and the string are borrowed from their locals for the write (a pure read as the value operand). The control reassigns both locals inside the operands.
function writeAscii(out: Uint8Array, outOff: number, str: string, start: number, end: number): void {
  for (let i = start; i < end; i++) out[outOff + (i - start)] = str.charCodeAt(i);
}
const buf = new Uint8Array(16);
writeAscii(buf, 2, "hello world", 0, 11);
let tail = "";
for (let i = 0; i < buf.length; i++) tail += buf[i] + ",";
console.log(tail);
function reassignDuring(): string {
  let out = new Uint8Array(4);
  let s = "abcd";
  const keep = out;
  out[(out = new Uint8Array(4), 0)] = s.charCodeAt((s = "zzzz", 1));
  return keep[0] + "|" + out[0] + "|" + s;
}
console.log(reassignDuring());
