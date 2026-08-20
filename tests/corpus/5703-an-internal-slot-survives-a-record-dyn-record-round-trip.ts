// The opposite control, and the reason a leak this shape cannot be fixed
// by dropping the cell: the state a builtin hides behind its surface has
// to survive a record→dyn→record round trip, because in JS the cast is
// the identity and `(u as fs.Dirent).isFile()` still works.
//
// This one passes on BOTH sides on purpose. It is not evidence for the
// change; it is what stops the NEXT change to the encoding from buying
// clean key lists with a silently wrong isFile().
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-dl-"));
fs.writeFileSync(join(dir, "f.txt"), "x");
fs.mkdirSync(join(dir, "d"));
const rows = fs.readdirSync(dir, { withFileTypes: true });
const out: string[] = [];
for (const row of rows) {
  const u: unknown = row;
  const back = u as fs.Dirent;
  out.push(`${back.name} file=${back.isFile()} dir=${back.isDirectory()} link=${back.isSymbolicLink()}`);
}
out.sort();
for (const line of out) console.log(line);

// The decoder's pending partial sequence must cross too: the first write
// keeps two bytes of a three-byte euro sign, and the round trip has to
// hand them to the second.
const sd = new StringDecoder("utf8");
const first = sd.write(Buffer.from([0xe2, 0x82]));
const u2: unknown = sd;
const back2 = u2 as StringDecoder;
console.log(JSON.stringify([first, back2.write(Buffer.from([0xac])), back2.encoding]));

fs.rmSync(dir, { recursive: true, force: true });
