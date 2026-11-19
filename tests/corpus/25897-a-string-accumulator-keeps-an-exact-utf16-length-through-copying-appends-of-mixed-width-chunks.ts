// buf += chunk; buf.length: the copying append carries the cached UTF-16 length of the left side to the result. Chunks of 1, 2, 3 and 4 byte characters, a buffer shared with another variable (so it is copied, not appended in place), a reused old value, and charCodeAt after each step.
const chunks = ["abc", "éè", "€", "\u{1F600}x", "plain-ascii-chunk-of-some-length-0123456789", "￿", "z"];
function run(reuse: boolean): string {
  let buf = "";
  let prev = "";
  let out = "";
  for (let i = 0; i < 400; i++) {
    const c = chunks[i % chunks.length]!;
    if (reuse && i % 5 === 0) prev = buf;
    buf += c;
    const len = buf.length;
    out += (len % 97) + (buf.charCodeAt(len - 1) % 10) + (reuse ? ":" + prev.length % 89 : "") + ",";
  }
  return out + "|" + buf.length + "|" + [...buf].length;
}
console.log(run(false));
console.log(run(true));
let closureBuf = "";
const write = (chunk: string): number => { closureBuf += chunk; return closureBuf.length; };
let acc = 0;
for (let i = 0; i < 600; i++) acc += write(chunks[(i * 3) % chunks.length]!);
console.log(acc, closureBuf.length, closureBuf.charCodeAt(closureBuf.length - 2));
const left = "L".repeat(200) + "é";
console.log(left.length);
const grown = left + "\u{1F600}" + "tail";
console.log(grown.length, left.length, `${left}${"€"}${"q"}`.length, left.length);
