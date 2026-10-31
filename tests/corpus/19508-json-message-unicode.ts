// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases: string[] = [
  "\"\u00e9\" x",
  "{\"\u00e9\": x}",
  "\"\ud83d\ude00\" x",
  "\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9 x",
  "\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00 x",
  "\ud83d\ude00",
  "\u00e9",
  "{\"a\":1}\u00e9",
  "[\"\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\", nope]",
  "\"\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9 \u0001\"",
  "\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9 nope",
];
let idx = 0;
for (const s of cases) {
  idx++;
  try {
    JSON.parse(s);
    console.log(idx, "OK", s.length);
  } catch (e: any) {
    console.log(idx, e.name, e instanceof SyntaxError, e.message.length, e.message);
  }
}
