// os.arch() is process.arch: the architecture of the running binary. The module was missing it, which a package that picks it
// from `typeof os` (mongodb's OsAdapter) cannot compile without.
import * as os from "os";
console.log(os.arch() === process.arch, os.arch().length > 0, typeof os.arch());
const a: string = os.arch();
console.log(a === process.arch);
