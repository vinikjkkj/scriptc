// A string_decoder.StringDecoder that crosses into `unknown`. Node's own
// keys are exactly ["encoding"]; the decoder's real state lives behind
// Symbol(kNativeDecoder) and is not a key at all.
//
// scriptc modelled the value as two RESERVED fields, `%enc` and
// `%pending`, and both crossed as ordinary members: Object.keys answered
// ["%enc","%pending"], JSON.stringify answered {"%enc":"utf8",...}, and
// after a partial UTF-8 write the second one printed the PACKED PARTIAL
// SEQUENCE as a number (`"%pending":8577538`) — internal decoder bytes on
// stdout. Node's visible key was absent under any name.
//
// The encoding field already held exactly Node's value, so it became the
// visible key `encoding`; `%pending` is Node's symbol slot and travels out
// of band. Both halves are pinned here, including the partial-sequence
// state that must survive between the two writes.
import { StringDecoder } from "node:string_decoder";

const sd = new StringDecoder("utf8");
const u: unknown = sd;
const o = u as Record<string, unknown>;

console.log(JSON.stringify(Object.keys(o)));
console.log(JSON.stringify(Object.getOwnPropertyNames(o)));
const forin: string[] = [];
for (const k in o) forin.push(k);
console.log(JSON.stringify(forin.filter((k) => k.startsWith("%"))));
console.log(JSON.stringify(Object.keys({ ...o })));
console.log(JSON.stringify(u));
console.log(String("%pending" in o));
console.log(JSON.stringify(o["%enc"]));

// The partial sequence: two bytes of a three-byte euro sign, then the
// third. The state that carries between the calls is the slot.
const first = sd.write(Buffer.from([0xe2, 0x82]));
const rest = sd.write(Buffer.from([0xac]));
console.log(JSON.stringify([first, rest, sd.encoding]));
console.log(JSON.stringify(Object.keys(o)));
