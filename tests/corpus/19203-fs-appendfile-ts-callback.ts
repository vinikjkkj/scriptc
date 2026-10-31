// Corpus 19203: fs callback form of a1t (rows 19203); operates in a temp directory under cwd and removes it.
import * as fs from "node:fs";
const D: string = "fsw-19203";
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.appendFile(D + "/ap-t.txt", "one", (e) => {
  console.log("plain", e, fs.readFileSync(D + "/ap-t.txt", "utf8"));
  fs.appendFile(D + "/ap-t.txt", Buffer.from("-two"), (e2) => {
    console.log("buf", e2, fs.readFileSync(D + "/ap-t.txt", "utf8"));
    fs.appendFile(D + "/ap-t.txt", "-3", { encoding: "utf8", mode: 0o600 }, (e3) => {
      console.log("opts", e3, fs.readFileSync(D + "/ap-t.txt", "utf8"));
      fs.appendFile(D + "/ap-t.txt", "4", "utf8", (e4) => {
        console.log("enc-str", e4, fs.readFileSync(D + "/ap-t.txt", "utf8"));
        fs.appendFile(D + "/ap-t.txt", "-w", { flag: "w" }, (e5) => {
          console.log("flag-w", e5, fs.readFileSync(D + "/ap-t.txt", "utf8"));
          fs.appendFile(D + "/ap-missing/x", "q", (e6) => {
            console.log("enoent", e6?.code, e6?.errno, e6?.syscall, e6?.path, e6?.message);
            console.log("main end");
            fs.rmSync(D, { recursive: true, force: true });
          });
        });
      });
    });
  });
});
console.log("main end");
