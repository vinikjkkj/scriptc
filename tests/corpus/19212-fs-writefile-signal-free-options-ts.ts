// Corpus 19212: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
import * as fs from "node:fs";
import * as os from "node:os";
const D: string = fs.mkdtempSync(os.tmpdir() + "/fscb-19212-");
const cb = (tag: string) => (e: NodeJS.ErrnoException | null): void => console.log(tag, e === null ? "null" : e.code);

fs.writeFile(D + "/t1.txt", "one", (e1) => {
  cb("plain")(e1);
  fs.writeFile(D + "/t2.txt", "two", "utf8", (e2) => {
    cb("enc")(e2);
    fs.writeFile(D + "/t3.txt", "three", { flag: "w", flush: false }, (e3) => {
      cb("record")(e3);
      fs.appendFile(D + "/t3.txt", "+x", { flag: "a" }, (e4) => {
        cb("append")(e4);
        console.log("read", fs.readFileSync(D + "/t3.txt", "utf8"), fs.readFileSync(D + "/t1.txt", "utf8"));
        fs.rmSync(D, { recursive: true, force: true });
        console.log("main end");
      });
    });
  });
});

