// Corpus 19207: fs callback form of u1t (rows 19207); operates in a temp directory under cwd and removes it.
import * as fs from "node:fs";
const D: string = "fsw-19207";
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.writeFileSync(D + "/ut-a", "x");
fs.unlink(D + "/ut-a", (e) => {
  console.log("unlink-ok", e);
  fs.unlink(D + "/ut-a", (e2) => {
    console.log("unlink-enoent", e2?.code, e2?.errno, e2?.syscall, e2?.path, e2?.message);
    fs.writeFileSync(D + "/ut-b", "y");
    fs.rename(D + "/ut-b", D + "/ut-c", (e3) => {
      console.log("rename-ok", e3, fs.existsSync(D + "/ut-b"), fs.readFileSync(D + "/ut-c", "utf8"));
      fs.rename(D + "/ut-missing", D + "/ut-d", (e4) => {
        console.log("rename-enoent", e4?.code, e4?.errno, e4?.syscall, e4?.path, e4?.message);
        fs.mkdirSync(D + "/ut-dir");
        fs.unlink(D + "/ut-dir", (e5) => {
          console.log("unlink-dir", e5?.code, e5?.errno, e5?.syscall, e5?.path, e5?.message);
          fs.rmdirSync(D + "/ut-dir");
          fs.unlinkSync(D + "/ut-c");
          console.log("main end");
          fs.rmSync(D, { recursive: true, force: true });
        });
      });
    });
  });
});
console.log("main end");
