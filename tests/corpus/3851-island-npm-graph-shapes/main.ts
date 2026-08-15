// @dynamic
// The embedded npm graph's SHAPES, all four in one program — the rows
// 2447 does not reach, and the ones a table emitter gets wrong silently.
//
//   - a CommonJS entry, so the row carries the synthesized ESM FACADE
//     (default = module.exports, plus the names lexed at build time);
//   - a JSON module, format 2, wrapped default-only like Node;
//   - two relative requires, so the graph has EDGES rather than the empty
//     edge table 2447 emits;
//   - a module over NPM_COMPRESS_MIN that deflates smaller than it is, so
//     its row stores raw DEFLATE and main has to install the inflater
//     before the first load.
//
// Both backends embed these from the same store() rule, so a divergence
// shows up here as inflated garbage rather than as a compile error.
import lib, { padded, tags, counts } from "shapeslib";

// The CJS default IS module.exports: the facade's default binding.
console.log(`${lib.kind} ${lib.padWidth}`);

// Named bindings off the facade — lexed from the source at build time.
console.log(padded("ab"), padded("abcdefghij"));
console.log(tags.join(","), counts.join(","));

// The JSON module's data, having crossed the island boundary into a
// typed slot: duplicates collapse, insertion order holds.
const uniqueTags = new Set(tags);
console.log(uniqueTags.size, uniqueTags.has("img"), uniqueTags.has("div"));
for (const t of uniqueTags) console.log(t);

const uniqueCounts = new Set(counts);
console.log(uniqueCounts.size, [...uniqueCounts].join("|"));

// The compressed module's own export, reached through the CJS entry, and
// an intrinsic slot fed from it (an 'any' number into repeat).
const w: any = lib.padWidth;
console.log("=".repeat(w));
console.log(`${lib.padded("x")}|`);
