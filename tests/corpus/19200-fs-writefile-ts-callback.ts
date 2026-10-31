// Corpus 19200: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
import * as fs from "node:fs";
import * as os from "node:os";
const D: string = fs.mkdtempSync(os.tmpdir() + "/fscb-19200-");
const cb = (tag: string) => (e: NodeJS.ErrnoException | null): void => console.log(tag, e === null ? "null" : e.code);

fs.writeFile(D + "/a.txt", "hello", (e) => {
  cb("str")(e); console.log("read", fs.readFileSync(D + "/a.txt", "utf8"));
  fs.writeFile(D + "/b.bin", Buffer.from([0, 1, 255]), (e2) => {
    cb("buf")(e2); console.log("hex", fs.readFileSync(D + "/b.bin").toString("hex"));
    fs.writeFile(D + "/c.bin", new Uint8Array([65, 66]), (e3) => {
      cb("u8")(e3); console.log("hex", fs.readFileSync(D + "/c.bin").toString("hex"));
      fs.writeFile(D + "/d.txt", "héllo", "latin1", (e4) => {
        cb("enc")(e4); console.log("len", fs.readFileSync(D + "/d.txt").length);
        fs.writeFile(D + "/e.txt", "opts", { encoding: "utf8", mode: 0o600, flag: "w" }, (e5) => {
          cb("opts")(e5);
          fs.writeFile(D + "/e.txt", "more", { flag: "a" }, (e6) => {
            cb("append-flag")(e6); console.log("text", fs.readFileSync(D + "/e.txt", "utf8"));
            fs.writeFile(D + "/missing/x.txt", "a", (e7) => {
              console.log("enoent", e7 === null ? "null" : e7.code, e7 === null ? "" : e7.syscall);
              fs.writeFile(D + "/a.txt", "again", { flag: "wx" }, (e8) => {
                console.log("eexist", e8 === null ? "null" : e8.code, e8 === null ? "" : e8.syscall);
                fs.rmSync(D, { recursive: true, force: true });
                console.log("main end");
              });
            });
          });
        });
      });
    });
  });
});

