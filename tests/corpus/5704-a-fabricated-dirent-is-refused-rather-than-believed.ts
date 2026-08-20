// The MIRRORED MISREAD: the leak out and the misread in are one fact.
//
// The same cell that escaped into Object.keys was also ACCEPTED on the way
// back. A plain object that merely spells "%dtype" was read as the libuv
// entry kind, so `JSON.parse('{"name":"z","parentPath":"p","%dtype":2}')
// as fs.Dirent` answered `isDirectory() === true` — a fs.Dirent
// manufactured out of a JSON string, silently. Node answers a TypeError
// there ("back.isFile is not a function"), because the parsed object has
// no prototype method to call.
//
// The same for StringDecoder: `{"%enc":"utf8","%pending":0}` decoded
// bytes. And the JSON ROUND TRIP is the one that reads like real code —
// stringify a Dirent, parse it back, call isFile() on it.
//
// All three now refuse. The texts are not Node's (the uncaught-report
// divergence), so each is caught and reduced to its KIND, which is what
// both sides agree on.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

function probe(name: string, f: () => string): void {
  try {
    console.log(name + " built " + f());
  } catch (e) {
    console.log(name + " caught " + String(e instanceof TypeError));
  }
}

const parsed: unknown = JSON.parse('{"name":"z","parentPath":"p","%dtype":2}');
probe("parsed", () => {
  const d = parsed as fs.Dirent;
  return d.name + " " + String(d.isDirectory());
});

const bare: unknown = JSON.parse('{"name":"z","parentPath":"p"}');
probe("bare", () => {
  const d = bare as fs.Dirent;
  return d.name + " " + String(d.isDirectory());
});

const dir = fs.mkdtempSync(join(tmpdir(), "scr-dl-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const rows = fs.readdirSync(dir, { withFileTypes: true });
const trip: unknown = JSON.parse(JSON.stringify(rows[0]));
probe("roundtrip", () => {
  const d = trip as fs.Dirent;
  return d.name + " " + String(d.isFile());
});

const fake: unknown = JSON.parse('{"%enc":"utf8","%pending":0}');
probe("decoder", () => (fake as StringDecoder).write(Buffer.from([104, 105])));

const named: unknown = JSON.parse('{"encoding":"utf8"}');
probe("named", () => (named as StringDecoder).write(Buffer.from([104, 105])));

fs.rmSync(dir, { recursive: true, force: true });
