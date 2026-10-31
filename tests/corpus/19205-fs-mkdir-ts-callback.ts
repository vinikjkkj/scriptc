// Corpus 19205: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
import * as fs from "node:fs";
import * as os from "node:os";
const D: string = fs.mkdtempSync(os.tmpdir() + "/fscb-19205-");
const cb = (tag: string) => (e: NodeJS.ErrnoException | null): void => console.log(tag, e === null ? "null" : e.code);

fs.mkdir(D + "/mt-plain", (e) => {
  cb("plain")(e);
  fs.mkdir(D + "/mt-plain", (e2) => {
    console.log("eexist", e2 === null ? "null" : e2.code);
    fs.mkdir(D + "/mt-rec/a/b", { recursive: true }, (e3, first) => {
      cb("rec-created")(e3);
      console.log("first", typeof first === "string" && first.endsWith("mt-rec"));
      fs.mkdir(D + "/mt-rec/a/b", { recursive: true }, (e4, again) => {
        console.log("rec-existing", e4 === null ? "null" : "err", again === undefined ? "no-path" : "path");
        fs.mkdir(D + "/mt-mode", 0o700, (e5) => {
          cb("mode")(e5);
          fs.mkdir(D + "/mt-mode2", "755", (e6) => {
            cb("modestr")(e6);
            fs.writeFileSync(D + "/mt-file", "x");
            fs.mkdir(D + "/mt-file/sub", { recursive: true }, (e7) => {
              console.log("rec-enotdir", e7 === null ? "null" : e7.code, e7 === null ? "" : e7.syscall);
              fs.mkdir(D + "/mt-nope/x/y", (e8) => {
                console.log("plain-enoent", e8 === null ? "null" : e8.code);
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

