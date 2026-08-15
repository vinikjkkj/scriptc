// rmSync's `force` removes a READ-ONLY file.
//
// On Windows the read-only attribute — the bit `{ mode: 0o400 }` and
// `chmodSync(p, 0o444)` set — makes the delete itself fail with EPERM, so
// `force: true` quietly did not mean "remove it anyway" there: a tree
// holding one read-only file survived a recursive forced rm that Node
// completes. Node's rimraf chmods the path back to 0o666 and retries the
// unlink, and so does this now; a retry that still fails reports the
// ORIGINAL errno, so a genuinely locked file keeps naming the error the
// user's operation actually hit rather than the repair attempt's.
//
// POSIX never consults the file's own mode for unlink (the DIRECTORY's
// write bit governs), so it always answered correctly here — which is why
// both platforms print the same lines below and Node stays the oracle for
// both. Paths carry mkdtemp's random component, so nothing prints a path.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A tree with a read-only member, removed forcibly.
const dir = mkdtempSync(join(tmpdir(), "scr-rmro-"));
writeFileSync(join(dir, "ro.txt"), "locked", { mode: 0o400 });
writeFileSync(join(dir, "rw.txt"), "open");
console.log("wrote:", readFileSync(join(dir, "ro.txt"), "utf8"));
rmSync(dir, { recursive: true, force: true });
console.log("tree gone:", !existsSync(dir));

// A single read-only FILE, not a tree — the non-recursive forced form.
const d2 = mkdtempSync(join(tmpdir(), "scr-rmro2-"));
const one = join(d2, "one.txt");
writeFileSync(one, "x");
chmodSync(one, 0o444);
rmSync(one, { force: true });
console.log("file gone:", !existsSync(one));

// A read-only file nested a level down, so the recursive walk (not just
// the top-level unlink) takes the same path.
const deep = join(d2, "sub");
writeFileSync(join(d2, "keep.txt"), "keep");
rmSync(join(d2, "keep.txt"), { force: true });
console.log("plain gone:", !existsSync(join(d2, "keep.txt")));

// force still swallows a missing path, and the directory itself goes.
rmSync(join(d2, "never-existed"), { force: true });
console.log("missing ok");
rmSync(d2, { recursive: true, force: true });
console.log("all gone:", !existsSync(d2), !existsSync(deep));
