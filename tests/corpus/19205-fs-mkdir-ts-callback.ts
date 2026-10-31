// Corpus 19205: fs callback form of m1t (rows 19205); operates in a temp directory under cwd and removes it.
import * as fs from "node:fs";
const D: string = "fsw-19205";
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.mkdir(D + "/mt-plain", (e) => {
  console.log("plain", e);
  fs.mkdir(D + "/mt-plain", (e2) => {
    console.log("eexist", e2?.code, e2?.errno, e2?.syscall, e2?.path, e2?.message);
    fs.mkdir(D + "/mt-rec/a/b", { recursive: true }, (e3, first) => {
      console.log("rec-created", e3, first);
      fs.mkdir(D + "/mt-rec/a/b", { recursive: true }, (e4, again) => {
        console.log("rec-existing", e4, again);
        fs.mkdir(D + "/mt-mode", 0o700, (e5) => {
          console.log("mode", e5);
          fs.mkdir(D + "/mt-mode2", "755", (e6) => {
            console.log("modestr", e6);
            fs.writeFileSync(D + "/mt-file", "x");
            fs.mkdir(D + "/mt-file/sub", { recursive: true }, (e7) => {
              console.log("rec-enotdir", e7?.code, e7?.errno, e7?.syscall, e7?.path, e7?.message);
              fs.mkdir(D + "/mt-nope/x/y", (e8) => {
                console.log("plain-enoent", e8?.code, e8?.errno, e8?.syscall, e8?.path, e8?.message);
                fs.mkdir(D + "/mt-rec2", { recursive: false }, (e9) => {
                  console.log("recfalse", e9);
                  console.log("main end");
                  fs.rmSync(D, { recursive: true, force: true });
                });
              });
            });
          });
        });
      });
    });
  });
});
console.log("main end");
