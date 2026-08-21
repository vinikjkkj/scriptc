// Node v25.9.0 renders a StringDecoder as
//
//   StringDecoder {
//     encoding: 'utf8',
//     Symbol(kNativeDecoder): <Buffer 00 00 00 00 00 00 01>
//   }
//
// and this file pins the part that is Node-exact here: the CONSTRUCTOR
// NAME. On base the value printed `{ encoding: 'utf8' }` — no name at
// all — on both the static and the dyn surface.
//
// The symbol line is NOT pinned, and that is a statement rather than an
// omission. Node's value under Symbol(kNativeDecoder) is the SEVEN-BYTE
// native decoder state (four buffered bytes, the missing count, the
// buffered count, the encoding id); this tier holds the same information
// packed into an f64, so the shape deliberately does not name the symbol
// (IrRecordShape.builtin.slotSymbols) — naming it would have printed the
// compiler's own packed number where Node prints a Buffer, which is the
// leak the reserved-key change removed. The rendering is therefore still
// one line short of Node's, on purpose, and `util.inspect(d) === <Node's
// text>` is a comparison this file does not make.
//
// What it does pin, byte-exactly on both surfaces: the name, the one
// visible key, and that neither surface prints anything else.
import { StringDecoder } from "node:string_decoder";
import * as util from "node:util";

const d = new StringDecoder("utf8");

// the static surface (the per-shape helper) and the dyn one, which must
// agree with each other as well as with Node's prefix
const s = util.inspect(d);
const u: unknown = d;
const t = util.inspect(u);
console.log(String(s.startsWith("StringDecoder {")));
console.log(String(t.startsWith("StringDecoder {")));
console.log(String(s === t));

// a decoder holding a partial sequence renders under the same name (the
// packed cell is invisible either way)
const p = new StringDecoder("utf8");
console.log(JSON.stringify(p.write(Buffer.from([0xe2, 0x82]))));
console.log(String(util.inspect(p).startsWith("StringDecoder {")));

// the visible key is Node's, and the packed cell is not a key under any
// spelling
console.log(JSON.stringify(Object.keys(u as Record<string, unknown>)));
console.log(JSON.stringify(u));
const o = u as Record<string, unknown>;
console.log(String("%pending" in o), String("kNativeDecoder" in o));
console.log(JSON.stringify(o["%pending"]), JSON.stringify(o["kNativeDecoder"]));

// ...and the packed cell still survives the crossing it is out of band
// for: the partial sequence completes after a round trip.
const back = u as StringDecoder;
console.log(JSON.stringify(back.write(Buffer.from([0x61]))), back.encoding);
