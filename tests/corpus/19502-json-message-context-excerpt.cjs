// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "nopexxxxxxxxxxxxxxx",
  "nopexxxxxxxxxxxxxxxx",
  "[1,2,3,4,5,6,7,8,9,10,11,12,nope]",
  "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,nope]",
  "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,nope,16,17,18,19,20,21,22]",
  "[nope,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]",
  "[1,2,nopeyyyyyy]",
  "[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,@]",
  "nope{\"aaaaaaaaaaaaaaaaaaaa\": 1}",
  "{\"aaaaaaaaaaaaaaaaaaaa\": nope}",
  "{\"a\":[1,{\"b\":nope}]}",
  "{\"aaaaaaaaaaaaaaaaaaaa\": 1} nope",
  "xxxxxxxxxxxxxxxxxxxx",
  "xxxxxxxxxxxxxxxxxxxxx",
  "[1,2,3,4,5,6,7,8,9,nope]",
];
let idx = 0;
for (const s of cases) {
  idx++;
  try {
    JSON.parse(s);
    console.log(idx, "OK", s.length);
  } catch (e) {
    console.log(idx, e.name, e instanceof SyntaxError, e.message.length, e.message);
  }
}
