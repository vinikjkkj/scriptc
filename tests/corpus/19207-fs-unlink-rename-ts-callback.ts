// Corpus 19207: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
import * as fs from "node:fs";
import * as os from "node:os";
const D: string = fs.mkdtempSync(os.tmpdir() + "/fscb-19207-");
const cb = (tag: string) => (e: NodeJS.ErrnoException | null): void => console.log(tag, e === null ? "null" : e.code);

fs.writeFileSync(D + "/ut-a", "x");
fs.unlink(D + "/ut-a", (e) => {
  cb("unlink-ok")(e);
  fs.unlink(D + "/ut-a", (e2) => {
    console.log("unlink-enoent", e2 === null ? "null" : e2.code, e2 === null ? "" : e2.syscall);
    fs.writeFileSync(D + "/ut-b", "y");
    fs.rename(D + "/ut-b", D + "/ut-c", (e3) => {
      cb("rename-ok")(e3);
      console.log("renamed", fs.existsSync(D + "/ut-b"), fs.readFileSync(D + "/ut-c", "utf8"));
      fs.rename(D + "/ut-missing", D + "/ut-d", (e4) => {
        console.log("rename-enoent", e4 === null ? "null" : e4.code, e4 === null ? "" : e4.syscall);
        fs.rmSync(D, { recursive: true, force: true });
        console.log("main end");
      });
    });
  });
});

