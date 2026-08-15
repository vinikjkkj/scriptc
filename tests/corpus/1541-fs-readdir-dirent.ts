// readdirSync(path, { withFileTypes: true }): Dirent rows — name,
// parentPath (the path argument as given, Node's rule), and the type
// probes isFile/isDirectory/isSymbolicLink (no symlinkSync lowering
// exists to mint a link, so the probe pins the false answers). OS order
// is unguaranteed
// (993's rule), so the corpus sorts by name before printing. The
// portless workspace-glob idiom rides on top: filter(isDirectory) then
// map(name).
//
// The scratch directory is mkdtempSync's under the OS temp dir, and its
// name never reaches stdout. The earlier spelling built it as
// `/tmp/scr-dirent-${basename(process.argv[1])}`, which was wrong twice:
// the basename is the RUNNING PROGRAM's, and the differential lanes hand
// the two sides different ones by construction (Node sees
// 1541-fs-readdir-dirent.ts, the C binary program.exe, and the LLVM lane's
// two legs program-llvmc.exe against program-llvm.exe), so the sides could
// never agree on any text derived from it; and the hardcoded "/tmp" does
// not exist on Windows, where mkdirSync died ENOENT before the first row
// printed. mkdtempSync keeps the per-lane collision safety the basename was
// reaching for without putting a non-reproducible byte anywhere near stdout.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-dirent-"));
fs.mkdirSync(join(dir, "sub-a"));
fs.mkdirSync(join(dir, "sub-b"));
fs.writeFileSync(join(dir, "file.txt"), "x");

const entries = fs.readdirSync(dir, { withFileTypes: true });
const rows: string[] = [];
for (const e of entries) {
  rows.push(`${e.name} dir=${e.isDirectory()} file=${e.isFile()} link=${e.isSymbolicLink()} parent=${e.parentPath === dir}`);
}
rows.sort();
for (const row of rows) console.log(row);

// The portless glob shape: filter on a probe + a name test, then map.
const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("sub-")).map((e) => e.name);
dirs.sort();
console.log(dirs.join(","), entries.length);

// The error path throws Node's scandir errno error, catchably.
try {
  fs.readdirSync(join(dir, "missing"), { withFileTypes: true });
  console.log("no-throw");
} catch (e) {
  const code = (e as NodeJS.ErrnoException).code;
  console.log("caught", code === undefined ? "?" : code);
}
fs.rmSync(dir, { recursive: true, force: true });
