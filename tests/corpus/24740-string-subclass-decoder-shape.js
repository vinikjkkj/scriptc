// ioredis verbatim-string.js / decoder.js: a class extending String, constructed by a decoder that compares the class value.
class VerbatimString extends String {
  constructor(format, value) {
    super(value);
    this.format = format;
  }
}
function decode(type, fmt, text) {
  if (type === VerbatimString) return new VerbatimString(fmt, text);
  return text;
}
const a = decode(VerbatimString, "txt", "hello");
const b = decode(String, "txt", "plain");
console.log(typeof a, a.format, String(a), a.length, a instanceof VerbatimString, a instanceof String, typeof b, b);
console.log(a);
console.log(a.valueOf(), a.toString(), a + "!", `${a}`, JSON.stringify(a), JSON.stringify({ a }));
console.log(Object.keys(a), a.constructor === VerbatimString, a.constructor.name, Object.getPrototypeOf(a) === VerbatimString.prototype);
const replies = [];
for (let i = 0; i < 50; i++) replies.push(decode(VerbatimString, i % 2 ? "txt" : "mkd", "reply-" + i));
console.log(replies.length, replies[7].format, replies[7] + "", replies[8].format, replies[49].length);
console.log(replies.filter((r) => r instanceof VerbatimString).length, replies.map((r) => r.toUpperCase()).slice(0, 2).join());
